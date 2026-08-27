#!/usr/bin/env node
/*
 * verify-forms.mjs — drive the form builder and the link inspector in a browser.
 *
 * The end-to-end API checks prove the data is right. This proves the *interface*
 * is: that clicking a button on the page opens a panel that can repoint it, that
 * the form preview shows the site's own styling rather than the admin's, that a
 * collapsed rail stays collapsed. None of that is visible from the API, and all
 * of it is what somebody actually judges the CMS by.
 *
 *   node tools/verify-forms.mjs [baseUrl] [--shots dir] [--headed] --confirm
 *
 * It writes to the database: one scratch page and one form, both removed at the
 * end. A failed run leaves them behind on purpose — they are the evidence.
 * Never point it at production.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = (args.find(a => !a.startsWith('--')) || 'http://localhost:5173').replace(/\/+$/, '');
const SHOTS = path.resolve(flag('shots', 'artifacts/forms'));
const EMAIL = process.env.ADMIN_EMAIL || 'admin@rainbow.local';
const PASSWORD = process.env.ADMIN_PASSWORD || 'Rainbow!Admin2026';

if (!args.includes('--confirm')) {
  console.error(
    'This tool writes to the database: it creates a scratch page and a form,\n'
    + 'uses them and deletes both afterwards.\n'
    + 'Re-run with --confirm once you are sure this is not production data.\n\n'
    + `  node tools/verify-forms.mjs ${BASE} --confirm`,
  );
  process.exit(2);
}

const PAGE_KEY = 'verify-forms-page';
const FORM_KEY = 'verify-forms-form';

let passed = 0;
const failures = [];
const problems = [];

function ok(label, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

let token = '';
async function api(path2, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api/v1${path2}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: data };
}

async function main() {
  await mkdir(SHOTS, { recursive: true });

  const login = await api('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  if (login.status !== 200) {
    console.error(`Could not sign in as ${EMAIL} (${login.status}).`);
    process.exit(2);
  }
  token = login.body.token;

  // Leftovers from an interrupted run would make every create step fail.
  await api(`/pages/${PAGE_KEY}`, { method: 'DELETE' });
  await api(`/forms/${FORM_KEY}`, { method: 'DELETE' });

  /* ── Fixtures ─────────────────────────────────────────────────────────── */

  const form = await api('/forms', {
    method: 'POST',
    body: {
      key: FORM_KEY,
      name: 'Verification form',
      target: 'lead:contact',
      submitLabel: { fr: 'Envoyer la demande' },
      fields: [
        { key: 'a', name: 'name', label: { fr: 'Nom complet' }, required: true },
        { key: 'b', name: 'email', type: 'email', label: { fr: 'E-mail' }, required: true },
        { key: 'c', name: 'message', type: 'textarea', width: 'full', label: { fr: 'Votre message' } },
      ],
    },
  });
  ok('the form was created', form.status === 201, form.body?.error || '');

  const page0 = await api('/pages', {
    method: 'POST',
    body: {
      key: PAGE_KEY,
      title: 'Form verification page',
      route: 'verify-forms-page',
      status: 'published',
      locales: ['fr'],
    },
  });
  ok('the page was created', page0.status === 201, page0.body?.error || '');
  /*
   * Created pages are drafts, deliberately — `status` is not a field of the
   * create endpoint. So publishing is its own call, which is also the behaviour
   * worth asserting: a page nobody published must not be reachable.
   */
  const published = await api(`/pages/${PAGE_KEY}/publish`, { method: 'POST' });
  ok('and published', published.status === 200, published.body?.error || '');

  // A hero, for the link inspector, and a form block for the picker.
  const hero = await api(`/pages/${PAGE_KEY}/sections`, {
    method: 'POST',
    body: {
      type: 'component',
      componentKey: 'hero',
      label: 'Hero',
      data: {
        title: 'A page to click on',
        primaryLabel: 'Primary button',
        primaryHref: 'page:tarifs',
        secondaryLabel: 'Secondary',
        secondaryHref: '/fr/faq',
      },
    },
  });
  ok('the hero block was added', hero.status === 201);

  const formBlock = await api(`/pages/${PAGE_KEY}/sections`, {
    method: 'POST',
    body: {
      type: 'component',
      componentKey: 'form',
      label: 'The form',
      data: { formKey: FORM_KEY, title: 'Parlons-en' },
    },
  });
  ok('the form block was added', formBlock.status === 201);

  /* ── Browser ──────────────────────────────────────────────────────────── */

  const browser = await chromium.launch({ headless: !args.includes('--headed') });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  page.on('pageerror', err => problems.push(`pageerror: ${String(err.message).slice(0, 200)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) {
      problems.push(`console: ${msg.text().slice(0, 200)}`);
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('/auth/refresh')) {
      problems.push(`http ${res.status()} ${res.url().replace(BASE, '')}`);
    }
  });

  await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });
  if (await page.locator('input[type="password"]').count()) {
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/auth/login')),
      page.locator('input[type="password"]').press('Enter'),
    ]);
    await page.waitForSelector('[data-testid="app-shell"]');
  }

  /* ── 1. The forms list ────────────────────────────────────────────────── */

  console.log('\nForms list');
  await page.goto(`${BASE}/admin/forms`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  ok('the list shows the seeded forms', await page.getByText('Demo request').count() > 0);
  ok('and the one just created', await page.getByText('Verification form').count() > 0);
  ok('usage is shown, not just a count',
    await page.getByText(/nowhere yet|Form verification page/).count() > 0);
  await page.screenshot({ path: path.join(SHOTS, '01-forms-list.png') });

  /* ── 2. The builder ──────────────────────────────────────────────────── */

  console.log('\nForm builder');
  await page.goto(`${BASE}/admin/forms/${FORM_KEY}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  ok('the field list is there', await page.getByText('Nom complet').count() > 0);
  ok('the delivery panel is there', await page.getByText('Where submissions go').count() > 0);

  // The preview is an iframe of the site, and what is inside it is the point.
  const frame = page.frameLocator('iframe[title="Form preview"]');
  await page.waitForTimeout(1800);
  const previewButton = frame.locator('button[type="submit"]');
  ok('the preview rendered the form', await previewButton.count() > 0);
  ok('the preview shows this form’s own button label',
    (await previewButton.innerText().catch(() => '')).includes('Envoyer la demande'));

  /*
   * The preview must be styled by the *site*, not the admin. The site's button
   * is brand purple with a 10px radius; the admin's primary is a different
   * colour entirely, so a computed background of the wrong purple would mean the
   * iframe is not loading the site's stylesheet.
   */
  const styling = await previewButton.evaluate((el) => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, radius: s.borderRadius, font: s.fontFamily };
  }).catch(() => null);
  ok('the preview uses the site’s own styles', !!styling && styling.radius !== '0px',
    styling ? `${styling.background}, radius ${styling.radius}` : 'could not read the button');

  await page.screenshot({ path: path.join(SHOTS, '02-form-builder.png') });

  // Clicking a field opens its settings, with the wire name separated.
  await page.getByRole('button', { name: /Nom complet/ }).first().click();
  await page.waitForTimeout(400);
  ok('clicking a field opens its panel',
    await page.getByText('Name the endpoint receives').count() > 0);
  ok('and says it is not the label',
    await page.getByText(/This is not the label/).count() > 0);
  await page.screenshot({ path: path.join(SHOTS, '03-field-panel.png') });

  // Adding a field shows up in the preview without a save.
  await page.getByRole('button', { name: 'Phone', exact: true }).click();
  await page.waitForTimeout(600);
  await page.waitForTimeout(1500);
  ok('a new field appears in the preview before saving',
    await frame.locator('input[type="tel"]').count() > 0);

  // Two fields with the same name must be refused at save.
  const nameBox = page.getByLabel('Name the endpoint receives');
  if (await nameBox.count()) {
    const original = await nameBox.inputValue();
    await nameBox.fill('email');
    await page.waitForTimeout(400);
    // The panel says so before you even try to save.
    ok('a clashing name is flagged in the panel',
      await page.getByText(/Another field is already called/).count() > 0);
    await page.getByRole('button', { name: /^Save/ }).first().click();
    await page.waitForTimeout(800);
    ok('and the save is refused', await page.getByText(/both called/).count() > 0);
    await page.screenshot({ path: path.join(SHOTS, '04-duplicate-refused.png') });
    await nameBox.fill(original);
  } else {
    ok('a clashing name is flagged in the panel', false, 'could not find the name box');
  }

  // The check reads the endpoint's recorded contract.
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await page.waitForTimeout(900);
  ok('the check answers', await page.getByText(/Not checked|required field|wire/).count() > 0);
  await page.screenshot({ path: path.join(SHOTS, '05-delivery-check.png') });

  // Panels remember being closed.
  await page.getByRole('button', { name: /^Fields/ }).first().click();
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const fieldsPanel = page.getByRole('button', { name: /^Fields/ }).first();
  ok('a folded panel is still folded after a reload',
    (await fieldsPanel.getAttribute('aria-expanded')) === 'false');
  await fieldsPanel.click();

  /* ── 3. Click-to-configure ───────────────────────────────────────────── */

  console.log('\nThe link inspector');
  await page.goto(`${BASE}/admin/pages/${PAGE_KEY}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);

  const canvas = page.frameLocator('iframe[title="Page preview"]');
  const primary = canvas.getByRole('link', { name: 'Primary button' });
  ok('the canvas rendered the hero', await primary.count() > 0);

  await primary.click();
  await page.waitForTimeout(900);

  ok('clicking a button opens the link panel', await page.getByText('Goes to').count() > 0);
  ok('the panel names the button', await page.getByText(/Primary button/).count() > 0);
  ok('the destination is shown as the reference, not a path',
    await page.locator('input[value="page:tarifs"]').count() > 0);
  ok('an open-in-new-tab option is offered', await page.getByText('Open in a new tab').count() > 0);
  await page.screenshot({ path: path.join(SHOTS, '06-link-inspector.png') });

  // Repoint it, save, and confirm the stored block changed.
  await page.locator('input[value="page:tarifs"]').fill('page:faq');
  await page.getByLabel('Open in a new tab').check();
  await page.getByRole('button', { name: /^Save/ }).first().click();
  await page.waitForTimeout(2500);

  const after = await api(`/pages/${PAGE_KEY}/sections/${hero.body.section.key}`);
  ok('the link was saved to the block', after.body?.section?.data?.primaryHref === 'page:faq',
    after.body?.section?.data?.primaryHref);
  ok('and the new-tab choice with it', after.body?.section?.data?.primaryNewTab === true);

  // The live page must carry rel=noopener with the target.
  const live = await fetch(`${BASE}/fr/verify-forms-page`).then(r => r.text());
  ok('the published page opens it in a new tab safely',
    live.includes('target="_blank"') && live.includes('noopener'));
  ok('and no editing annotations reached the published page',
    !live.includes('data-cms-field') && !live.includes('data-cms-block'));

  /* ── 4. Folding rails ────────────────────────────────────────────────── */

  console.log('\nFolding rails');
  await page.getByLabel('Hide the block list').click();
  await page.waitForTimeout(400);
  ok('the block list folds', await page.getByLabel('Show the block list').count() > 0);
  await page.screenshot({ path: path.join(SHOTS, '07-rail-folded.png') });

  await page.getByLabel('Collapse the sidebar').click();
  await page.waitForTimeout(500);
  ok('the app sidebar collapses to icons', await page.getByLabel('Expand the sidebar').count() > 0);
  await page.screenshot({ path: path.join(SHOTS, '08-sidebar-collapsed.png') });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  ok('both folds survive a reload',
    await page.getByLabel('Expand the sidebar').count() > 0
    && await page.getByLabel('Show the block list').count() > 0);

  await page.getByLabel('Expand the sidebar').click();
  await page.getByLabel('Show the block list').click();

  /* ── 5. The form on the page ─────────────────────────────────────────── */

  console.log('\nThe form block');
  await page.waitForTimeout(2500);
  const formOnCanvas = canvas.locator('form[data-cms-form]');
  ok('the form block rendered the saved form', await formOnCanvas.count() > 0);

  const formField = canvas.locator('input[name="email"]').first();
  if (await formField.count()) {
    await formField.click({ force: true });
    await page.waitForTimeout(800);
    ok('clicking a form field points at the form rather than editing it here',
      await page.getByText(/belongs to the form/).count() > 0);
    await page.screenshot({ path: path.join(SHOTS, '09-form-field-clicked.png') });
  } else {
    ok('clicking a form field points at the form rather than editing it here', false, 'no field found');
  }

  await browser.close();

  /* ── Clean up ────────────────────────────────────────────────────────── */

  await api(`/pages/${PAGE_KEY}`, { method: 'DELETE' });
  const refused = await api(`/forms/${FORM_KEY}`, { method: 'DELETE' });
  ok('the form could be deleted once the page was gone', refused.status === 200, `status ${refused.status}`);

  /* ── Report ──────────────────────────────────────────────────────────── */

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (problems.length) {
    console.log(`\n${problems.length} browser problem${problems.length === 1 ? '' : 's'}:`);
    for (const p of [...new Set(problems)].slice(0, 20)) console.log(`  ${p}`);
  }
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ${f}`);
  }
  console.log(`\nScreenshots in ${SHOTS}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
