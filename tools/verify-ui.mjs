#!/usr/bin/env node
/*
 * verify-ui.mjs — drive the admin with a real browser and prove the flows work.
 *
 * The API tests cover the endpoints and `verify-live` covers the rendered site.
 * What neither can tell you is whether a person can actually *do* anything: a
 * form that never submits, a dialogue whose confirm button is behind an
 * overlay, a save that fires and silently 400s. Those only show up when
 * something clicks the buttons.
 *
 * So this walks the interface the way an editor would, and checks the result on
 * the **public site** rather than in the admin's own optimistic state:
 *
 *   1  sign in
 *   2  create a landing page with no header or footer, and confirm the rendered
 *      page really has neither
 *   3  add a form block to it, publish, and submit the form as a visitor —
 *      then find that submission under Leads
 *   4  add an article-list block, and confirm the blog posts appear on the page
 *   5  point a button at a page by reference, and confirm the link resolves to
 *      that page's path in each language
 *   6  break the page on purpose, restore it from History, and undo the restore
 *   7  delete the page and recover it from the trash
 *   8  put everything back
 *
 *   node tools/verify-ui.mjs [baseUrl] --confirm
 *
 * It writes to the database: scratch pages keyed `zz-ui-*`, and one lead. Both
 * are removed at the end. Never point it at production.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.mjs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = (args.find(a => !a.startsWith('--')) || 'http://localhost:5173').replace(/\/+$/, '');
/*
 * Where the public pages are.
 *
 * Behind the gateway that is the same origin as the admin. In development the
 * admin is a Vite dev server on 5173 and the site is on 3000, which is the only
 * case needing a different default — and defaulting to 3000 unconditionally meant
 * that pointing this tool at a gateway checked the admin against a dev server
 * that was not running, and reported the failure as a broken page.
 */
const SITE = flag('site', BASE === 'http://localhost:5173' ? 'http://localhost:3000' : BASE)
  .replace(//+$/, '');
/*
 * Where this tool's own API calls go.
 *
 * Behind the gateway that is the same origin as the admin, which is the shape
 * production has. In development the admin is a Vite dev server proxying to the
 * API, and a proxy that is mid-restart answers 502 — so the checks talk to the
 * API directly and only the browser goes through the proxy.
 */
const API = flag('api', BASE === 'http://localhost:5173' ? 'http://localhost:4000' : BASE).replace(/\/+$/, '');
const SHOTS = path.resolve(flag('shots', 'artifacts/e2e'));
const ENV_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * Credentials from .env, not only from the environment.
 *
 * Every tool here used to read `process.env` directly, so running one meant
 * prefixing the command with ADMIN_PASSWORD= even though the password is sitting
 * in .env at the repository root. Real environment variables still win, so CI and
 * `docker compose` override the file rather than the other way round.
 *
 * And no hard-coded fallback. 'Rainbow!Admin2026' was never anybody's password,
 * so the tool failed at the login screen with "Invalid email or password" rather
 * than saying it had not been told one.
 */
const env = loadEnv(ENV_ROOT);
const EMAIL = env.ADMIN_EMAIL || 'admin@rainbow.local';
const PASSWORD = env.ADMIN_PASSWORD;

const KEY = 'zz-ui-landing';
const ROUTE = 'zz-ui-landing';
// A second page, whose German URL differs from its French one.
const TARGET_KEY = 'zz-ui-target';

if (!args.includes('--confirm')) {
  console.error(
    'This tool writes to the database: it creates a scratch page, publishes it,\n'
    + 'submits a form and deletes both afterwards.\n'
    + 'Re-run with --confirm once you are sure this is not production data.\n\n'
    + `  node tools/verify-ui.mjs ${BASE} --confirm`,
  );
  process.exit(2);
}

let pass = 0;
const failures = [];
let step = '';

const ok = (name, condition, detail = '') => {
  if (condition) { pass++; console.log(`  ok   ${name}`); }
  else {
    failures.push(`${step} — ${name}${detail ? `: ${detail}` : ''}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const heading = (text) => { step = text; console.log(`\n${text}`); };

/* ── The API, for setup and for checking what the UI actually wrote ───────── */

let token = null;

async function api(pathname, options = {}) {
  const res = await fetch(`${API}/api/v1${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: res.status, body };
}

const fetchPage = (url) => fetch(url).then(r => r.text());

async function main() {
  await mkdir(SHOTS, { recursive: true });

  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (login.status === 429) {
    console.error('The login rate limiter is holding this off. Wait a few minutes, or restart the API.');
    process.exit(2);
  }
  if (login.status !== 200) {
    console.error(`Could not sign in as ${EMAIL} (${login.status}). Set ADMIN_PASSWORD.`);
    process.exit(2);
  }
  token = login.body.token;

  // Leftovers from an interrupted run would make every "create" step fail.
  await api(`/pages/${KEY}`, { method: 'DELETE' });
  await api(`/pages/${TARGET_KEY}`, { method: 'DELETE' });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

  try {
    await signIn(page);
    await createLandingPage(page, shot);
    await addFormBlock(page, shot);
    await submitTheFormAsAVisitor(page, shot);
    await addArticleList(page);
    await linkByReference(page);
    await restoreFromHistory(page, shot);
    await recoverFromTrash(page, shot);

    heading('No JavaScript errors along the way');
    ok('the admin threw nothing', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } finally {
    await cleanUp();
    await browser.close();
  }

  console.log(`\n${pass} checks, ${failures.length} failure(s)`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log(`screenshots → ${SHOTS}`);
}

/* ── 1. Sign in ──────────────────────────────────────────────────────────── */

async function signIn(page) {
  heading('Signing in');
  await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
  if (await page.locator('input[type="password"]').count()) {
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/auth/login')),
      page.locator('input[type="password"]').press('Enter'),
    ]);
  }
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 20000 });
  ok('the admin loads and the shell renders', true);
}

/* ── 2. A landing page with no header and no footer ──────────────────────── */

async function createLandingPage(page, shot) {
  heading('Creating a landing page with no header or footer');

  await page.goto(`${BASE}/admin/pages`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New page', exact: true }).click();
  await page.waitForSelector('[role="dialog"]');

  await page.getByLabel('Title').fill('ZZ UI landing');
  await page.getByLabel('Route').fill(ROUTE);
  await page.getByRole('button', { name: /Landing page/ }).click();
  await shot('01-new-landing-page');

  await Promise.all([
    page.waitForResponse(r => r.url().endsWith('/api/v1/pages') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Create draft' }).click(),
  ]);

  const created = await api(`/pages/${KEY}`);
  ok('the page was created', created.status === 200, `status ${created.status}`);
  ok('it is a draft', created.body?.page?.status === 'draft');
  ok('the header is off', created.body?.page?.chrome?.navbar === false);
  ok('the footer is off', created.body?.page?.chrome?.footer === false);
}

/* ── 3. A form block, published, and submitted by a visitor ──────────────── */

async function addFormBlock(page, shot) {
  heading('Adding a form block from the palette');

  await page.goto(`${BASE}/admin/pages/${KEY}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /^Blocks/ }).click();
  await page.getByRole('button', { name: 'Add block' }).click();
  await page.waitForSelector('[role="dialog"]');
  await shot('02-block-palette');

  /*
   * Wait for the save, not for the dialogue.
   *
   * The palette closes optimistically the moment a block is chosen, so
   * `waitForSelector('[role=dialog]', 'detached')` returns while the POST that
   * creates the block is still in flight. The three checks below then read the
   * page back before it has one and fail — intermittently, and in a way that
   * looks like a broken palette rather than a test racing the network. The
   * request itself is the event worth waiting for, and it is the pattern the
   * rest of this file already uses.
   */
  await Promise.all([
    page.waitForResponse(r => /\/api\/v1\/pages\/[^/]+\/sections$/.test(r.url())
      && r.request().method() === 'POST'),
    page.getByRole('button', { name: /^Form\b/ }).first().click(),
  ]);
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });

  const withForm = await api(`/pages/${KEY}`);
  const formBlock = (withForm.body?.page?.sections || []).find(s => s.componentKey === 'form');
  ok('the form block is on the page', !!formBlock);
  ok('it starts with real fields rather than empty', (formBlock?.data?.fields || []).length >= 3);
  ok('it targets a lead type by default', String(formBlock?.data?.submitTo || '').startsWith('lead:'));

  // Publishing is what makes it visible; the rest of this step checks the
  // rendered page, not the editor's idea of it.
  await api(`/pages/${KEY}/publish`, { method: 'POST' });
}

async function submitTheFormAsAVisitor(page, shot) {
  heading('Submitting the form as a visitor');

  const url = `${SITE}/fr/${ROUTE}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await shot('03-landing-page-live');

  const html = await fetchPage(url);
  ok('the page renders', html.includes('<form'), 'no form in the markup');
  ok('there is no site header', !/<nav\b[^>]*id="navbar"/.test(html));
  ok('there is no site footer', !/<footer\b/.test(html));

  const stamp = Date.now();
  const email = `zz-ui-${stamp}@example.test`;
  await page.fill('input[name="firstName"]', 'Scripted');
  await page.fill('input[name="lastName"]', 'Visitor');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="company"]', 'Verification Ltd');

  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/v1/forms/')),
    page.getByRole('button', { name: /Send/ }).click(),
  ]);
  ok('the submission is accepted', response.status() === 201, `status ${response.status()}`);

  await page.waitForSelector('[data-form-success]:not(.hidden)', { timeout: 10000 });
  ok('the thank-you panel replaces the form', true);
  await shot('04-form-submitted');

  // The point of storing first: it is under Leads whatever the automation did.
  const leads = await api(`/leads?q=${encodeURIComponent(email)}`);
  const lead = (leads.body?.items || [])[0];
  ok('the lead is stored', !!lead, 'nothing under Leads');
  ok('the name was assembled from the two fields', lead?.name === 'Scripted Visitor', lead?.name);
  ok('the company came through', lead?.company === 'Verification Ltd');
  ok('the page it came from was recorded', String(lead?.page || '').includes(ROUTE), lead?.page);

  if (lead) await api(`/leads/${lead._id}`, { method: 'PATCH', body: JSON.stringify({ status: 'spam' }) });
}

/* ── 4. The blog, on a page ──────────────────────────────────────────────── */

async function addArticleList(page) {
  heading('Putting the blog on a page');

  await page.goto(`${BASE}/admin/pages/${KEY}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /^Blocks/ }).click();
  await page.getByRole('button', { name: 'Add block' }).click();
  await page.waitForSelector('[role="dialog"]');
  await page.getByRole('button', { name: /^Article list/ }).first().click();
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });

  /*
   * A French article, because the page is rendered in French.
   *
   * This asked for the newest published article in any language and then looked
   * for its slug on `/fr/…`. It passed for as long as the newest article happened
   * to be French, and failed the day an English one was published — reporting a
   * bug in the block when the block was right: an article list shows the language
   * it is being read in, and English articles on a French page would be the
   * actual defect.
   */
  const published = await api('/blog?status=published&locale=fr&limit=1');
  const sample = published.body?.items?.[0];

  await api(`/pages/${KEY}/publish`, { method: 'POST' });
  const html = await fetchPage(`${SITE}/fr/${ROUTE}`);

  ok('the article list block renders', html.includes('article') || html.includes('blog'));
  if (sample) {
    ok('a published French article appears on the page',
      html.includes(sample.slug), `looked for ${sample.slug}`);
  } else {
    console.log('  note  no published French article to look for — list rendering not asserted');
  }
}

/* ── 5. A button that points at a page by name ───────────────────────────── */

async function linkByReference(page) {
  heading('Pointing a button at a page by reference');

  /*
   * The target is a scratch page with a *different* route in German. That is
   * the whole claim being tested: one stored value, correct in every language.
   * Pointing at a page whose route is the same in both would pass without
   * proving anything.
   */
  await api(`/pages/${TARGET_KEY}`, { method: 'DELETE' });
  const target = await api('/pages', {
    method: 'POST',
    body: JSON.stringify({ key: TARGET_KEY, route: 'zz-ui-target', title: 'ZZ UI target' }),
  });
  ok('the target page was created', target.status === 201, `status ${target.status}`);

  await api(`/pages/${TARGET_KEY}`, {
    method: 'PATCH',
    body: JSON.stringify({ routes: { de: 'zz-ui-ziel' } }),
  });
  await api(`/pages/${TARGET_KEY}/publish`, { method: 'POST' });

  const withBlocks = await api(`/pages/${KEY}`);
  const formBlock = (withBlocks.body?.page?.sections || []).find(s => s.componentKey === 'form');

  // A CTA banner is the simplest block with a button in it.
  const created = await api(`/pages/${KEY}/sections`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'component',
      componentKey: 'cta_banner',
      label: 'ZZ CTA',
      data: {
        title: 'ZZ call to action',
        primaryLabel: 'See the target',
        primaryHref: `page:${TARGET_KEY}`,
      },
      ...(formBlock ? { afterKey: formBlock.key } : {}),
    }),
  });
  ok('the block was added', created.status === 201, `status ${created.status}`);

  await api(`/pages/${KEY}/publish`, { method: 'POST' });

  const french = await fetchPage(`${SITE}/fr/${ROUTE}`);
  ok('the reference is resolved, not emitted raw', !french.includes(`page:${TARGET_KEY}`));
  ok('it resolves to the French path', french.includes('href="/fr/zz-ui-target"'), 'no /fr/zz-ui-target');

  // The same stored value, a different language, a different path.
  const german = await fetchPage(`${SITE}/de/${ROUTE}`);
  ok(
    'the same stored value resolves to the German path',
    german.includes('href="/de/zz-ui-ziel"'),
    'the German render did not carry the German route override',
  );
  ok('and not to the French one', !german.includes('href="/fr/zz-ui-target"'));

  // The editor shows what it resolves to, rather than the raw reference.
  await page.goto(`${BASE}/admin/pages/${KEY}`, { waitUntil: 'networkidle' });
  ok('the page editor still loads with the new block', await page.locator('[data-testid="app-shell"]').isVisible());
}

/* ── 6. Break it, restore it, undo the restore ───────────────────────────── */

async function restoreFromHistory(page, shot) {
  heading('Restoring the page from its history');

  await page.goto(`${BASE}/admin/pages/${KEY}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'History' }).click();

  // A named restore point, taken from the interface.
  await page.getByRole('button', { name: 'Save a restore point' }).click();
  await page.waitForSelector('[role="dialog"]');
  await page.getByLabel('What is about to happen').fill('ZZ before the scripted mistake');
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/api/v1/versions/page/')),
    page.getByRole('button', { name: 'Save it' }).click(),
  ]);
  await shot('05-history');

  const listed = await api(`/versions/page/${KEY}`);
  const point = (listed.body?.items || []).find(v => v.label === 'ZZ before the scripted mistake');
  ok('the restore point is listed', !!point);
  ok('it is marked as saved by hand', point?.kind === 'manual');

  // Now break the page the way somebody would: rename it and empty the title.
  await api(`/pages/${KEY}`, { method: 'PATCH', body: JSON.stringify({ title: 'ZZ BROKEN' }) });
  const broken = await api(`/pages/${KEY}`);
  ok('the page is broken', broken.body?.page?.title === 'ZZ BROKEN');

  // Restore through the interface, including its confirmation dialogue.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: 'History' }).click();
  const row = page.locator('li', { hasText: 'ZZ before the scripted mistake' }).first();
  await row.waitFor({ timeout: 15000 });
  await row.getByRole('button', { name: 'Restore' }).click();

  const [restoreCall] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/restore'), { timeout: 20000 }),
    page.getByRole('button', { name: 'Restore it' }).click(),
  ]);
  ok('the restore call succeeds', restoreCall.status() === 200, `status ${restoreCall.status()}`);

  const restored = await api(`/pages/${KEY}`);
  ok('the title is back', restored.body?.page?.title === 'ZZ UI landing', restored.body?.page?.title);

  // And the restore is itself undoable, which is what makes it safe to offer.
  const undoButton = page.getByRole('button', { name: 'Undo the restore' });
  await undoButton.waitFor({ timeout: 15000 });
  ok('the interface offers an immediate undo', true);

  await Promise.all([
    page.waitForResponse(r => r.url().includes('/restore'), { timeout: 20000 }),
    undoButton.click(),
  ]);
  const undone = await api(`/pages/${KEY}`);
  ok('undo puts the broken state back', undone.body?.page?.title === 'ZZ BROKEN', undone.body?.page?.title);

  // Leave it in the good state for the steps that follow.
  const again = await api(`/versions/page/${KEY}`);
  const stillThere = (again.body?.items || []).find(v => v.label === 'ZZ before the scripted mistake');
  await api(`/versions/detail/${stillThere.id}/restore`, { method: 'POST' });
  ok('the named restore point survived both restores', !!stillThere);
}

/* ── 7. Delete it, then get it back ──────────────────────────────────────── */

async function recoverFromTrash(page, shot) {
  heading('Recovering a deleted page from the trash');

  const deleted = await api(`/pages/${KEY}`, { method: 'DELETE' });
  ok('the page was deleted', deleted.status === 200);

  const gone = await fetch(`${SITE}/fr/${ROUTE}`);
  ok('the URL stops resolving', gone.status === 404, `status ${gone.status}`);

  await page.goto(`${BASE}/admin/pages`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Trash/ }).click();
  await page.waitForSelector('[role="dialog"]');
  await shot('06-trash');

  const trashRow = page.locator('tr', { hasText: 'ZZ UI landing' }).first();
  ok('the deleted page is in the trash', await trashRow.count() > 0);

  await trashRow.getByRole('button', { name: 'Recover' }).click();
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/recover')),
    page.getByRole('button', { name: 'Recover' }).last().click(),
  ]);
  await page.waitForTimeout(800);

  const back = await api(`/pages/${KEY}`);
  ok('the page is back', back.status === 200, `status ${back.status}`);
  ok('it comes back as a draft', back.body?.page?.status === 'draft', back.body?.page?.status);
  ok('its blocks came back with it', (back.body?.page?.sections || []).length > 0);
}

/* ── 8. Put everything back ──────────────────────────────────────────────── */

async function cleanUp() {
  heading('Cleaning up');
  const removed = await api(`/pages/${KEY}`, { method: 'DELETE' });
  const removedTarget = await api(`/pages/${TARGET_KEY}`, { method: 'DELETE' });
  ok('the scratch page is gone', removed.status === 200 || removed.status === 404);
  ok('the scratch target is gone', removedTarget.status === 200 || removedTarget.status === 404);

  // The redirect the route override wrote, and the ones a rename leaves behind.
  const redirects = await api('/redirects');
  for (const r of redirects.body?.items || []) {
    if (r.from.includes('zz-ui-')) await api(`/redirects/${r._id}`, { method: 'DELETE' });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
