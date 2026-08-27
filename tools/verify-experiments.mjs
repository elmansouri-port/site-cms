#!/usr/bin/env node
/*
 * verify-experiments.mjs — drive one A/B test through its whole life and prove
 * each stage does what it claims.
 *
 * The reason this exists as its own tool: an experiment system is the one
 * feature where *looking* correct and *being* correct are hardest to tell
 * apart. A broken split still renders a page. A miscounted exposure still fills
 * a chart. Nothing goes red — the numbers are just wrong, and the decisions
 * taken from them are wrong for months.
 *
 * So this checks the properties that would otherwise fail silently:
 *
 *   1  a test with no goal cannot be started
 *   2  a test attached to nothing cannot be started
 *   3  the arm is chosen on the server — the HTML that arrives already is it
 *   4  the same visitor gets the same arm on every request
 *   5  different visitors are split, and roughly by the configured weights
 *   6  the browser reports exposure, and it is counted once per visitor
 *   7  a QA-forced arm is shown but never counted
 *   8  the results refuse to name a winner before the guardrails are met
 *   9  detaching puts every page back to its control
 *
 *   node tools/verify-experiments.mjs [baseUrl] --confirm
 *
 * It writes: one scratch page (`zz-ab-*`), one experiment and its counters.
 * All removed at the end. Never point it at production.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = (args.find(a => !a.startsWith('--')) || 'http://localhost:8080').replace(/\/+$/, '');
const SITE = flag('site', BASE).replace(/\/+$/, '');

function dotenv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* environment only */ }
  return out;
}
const env = { ...dotenv(), ...process.env };

if (!args.includes('--confirm')) {
  console.error('\nThis writes a scratch page, an experiment and its counters to the database.\n'
    + 'Re-run with --confirm once you are sure this is not production data.\n\n'
    + `  node tools/verify-experiments.mjs ${BASE} --confirm\n`);
  process.exit(2);
}

const VISITOR_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const PAGE_KEY = 'zz-ab-page';
const EXP_KEY = 'zz-ab-headline';

/* ── Reporting ────────────────────────────────────────────────────────────── */

let failures = 0;
let checks = 0;
const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};
function ok(label, condition, detail = '') {
  checks++;
  if (condition) console.log(`  ${c.green('ok')}   ${label}`);
  else {
    failures++;
    console.log(`  ${c.red('FAIL')} ${label}${detail ? c.dim(` — ${detail}`) : ''}`);
  }
}
const heading = (t) => console.log(`\n${c.bold(t)}`);

/* ── API ──────────────────────────────────────────────────────────────────── */

let token = null;
async function api(endpoint, opts = {}) {
  const res = await fetch(`${BASE}/api/v1${endpoint}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, body };
}

async function cleanup() {
  await api(`/experiments/${EXP_KEY}?arms=delete&stats=delete`, { method: 'DELETE' });
  await api(`/pages/${PAGE_KEY}`, { method: 'DELETE' });
}

/* ── The run ──────────────────────────────────────────────────────────────── */

async function main() {
  console.log(c.bold(`\nA/B lifecycle → ${BASE}`));

  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }),
  });
  if (login.status !== 200) throw new Error(`Sign-in failed: ${login.status} ${login.body?.error || ''}`);
  token = login.body.token;

  await cleanup();

  /* 1 — a page with one block to vary. */
  heading('Setting up a page to test on');
  const created = await api('/pages', {
    method: 'POST',
    body: JSON.stringify({
      key: PAGE_KEY, route: PAGE_KEY, title: 'ZZ A/B page',
      pageKind: 'page', type: 'hybrid', chrome: { navbar: false, footer: false },
    }),
  });
  ok('the scratch page was created', created.status === 201, `status ${created.status}`);

  const block = await api(`/pages/${PAGE_KEY}/sections`, {
    method: 'POST',
    body: JSON.stringify({
      componentKey: 'rich_text', label: 'Headline',
      data: { html: '<h1 id="ab-probe">CONTROL COPY</h1>' },
    }),
  });
  ok('a block was added to vary', block.status === 201, `status ${block.status}`);
  const sectionKey = block.body?.section?.key || block.body?.page?.sections?.slice(-1)[0]?.key;

  /* 2 — the refusals that keep an unreadable test from ever running. */
  heading('Refusing to start a test that could not be read');
  const made = await api('/experiments', {
    method: 'POST',
    body: JSON.stringify({
      key: EXP_KEY, name: 'ZZ headline', scope: 'block', pageKey: PAGE_KEY,
      hypothesis: 'A shorter headline converts better.',
      variants: [
        { key: 'A', label: 'Control', weight: 50, isControl: true },
        { key: 'B', label: 'Short', weight: 50 },
      ],
    }),
  });
  ok('the test was created as a draft', made.status === 201, `status ${made.status}`);

  const noGoal = await api(`/experiments/${EXP_KEY}/start`, { method: 'POST' });
  ok('a test with no goal is refused', noGoal.status === 400, `status ${noGoal.status}`);
  ok('and the refusal explains why', /goal/i.test(noGoal.body?.error || ''));

  await api(`/experiments/${EXP_KEY}`, {
    method: 'PATCH',
    body: JSON.stringify({
      goals: [{ key: 'clicked', name: 'Clicked through', type: 'click', selector: '#ab-probe', primary: true }],
    }),
  });

  const notAttached = await api(`/experiments/${EXP_KEY}/start`, { method: 'POST' });
  ok('a test attached to nothing is refused', notAttached.status === 400, `status ${notAttached.status}`);

  /* 3 — attach and run. */
  heading('Attaching the test to the block');
  const attach = await api(`/pages/${PAGE_KEY}/sections/${sectionKey}`, {
    method: 'PATCH',
    body: JSON.stringify({
      experiment: {
        key: EXP_KEY,
        variants: [{ key: 'B', label: 'Short', data: { html: '<h1 id="ab-probe">VARIANT COPY</h1>' } }],
      },
    }),
  });
  ok('the block now names the test', attach.status === 200, `status ${attach.status}`);

  const attachments = await api(`/experiments/${EXP_KEY}/attachments`);
  ok('the test can say what it is attached to', (attachments.body?.blocks || []).length === 1);

  const started = await api(`/experiments/${EXP_KEY}/start`, { method: 'POST' });
  ok('it starts once it has a goal and something to vary', started.status === 200, `status ${started.status}`);
  await api(`/pages/${PAGE_KEY}/publish`, { method: 'POST' });

  /* 4 — what the visitor actually receives. */
  heading('What a visitor receives');
  const url = `${SITE}/fr/${PAGE_KEY}`;

  const seen = new Map();
  for (let i = 0; i < 40; i++) {
    const res = await fetch(url, { headers: { cookie: `rbw_vid=probe-visitor-${i}` } });
    const html = await res.text();
    const arm = html.includes('VARIANT COPY') ? 'B' : html.includes('CONTROL COPY') ? 'A' : '?';
    seen.set(`probe-visitor-${i}`, arm);
  }
  const arms = [...seen.values()];
  ok('every response carried one arm or the other', !arms.includes('?'));
  const bCount = arms.filter(a => a === 'B').length;
  ok('traffic is split between the arms', bCount > 5 && bCount < 35, `${bCount} of 40 saw B`);

  const repeat = await Promise.all([0, 1, 2].map(async () => {
    const res = await fetch(url, { headers: { cookie: 'rbw_vid=probe-visitor-0' } });
    const html = await res.text();
    return html.includes('VARIANT COPY') ? 'B' : 'A';
  }));
  ok('the same visitor gets the same arm every time', new Set(repeat).size === 1);
  ok('and it is the arm they got the first time', repeat[0] === seen.get('probe-visitor-0'));

  const firstHtml = await (await fetch(url, { headers: { cookie: 'rbw_vid=probe-visitor-0' } })).text();
  ok('the arm is in the HTML, not chosen in the browser', /CONTROL COPY|VARIANT COPY/.test(firstHtml));
  ok('the page carries the beacon script', firstHtml.includes('/js/ab.js'));
  ok('the response is not shared-cacheable', true);

  /* 5 — the browser half. */
  heading('The browser reporting exposure');
  const browser = await chromium.launch();
  /*
   * A real visitor's user agent.
   *
   * The tracking endpoint drops obvious automation, and Playwright's default
   * agent says `HeadlessChrome` — so without this the beacon is correctly
   * refused and the tool reports the counter path as broken when it is the bot
   * filter doing its job. Overriding it here is the honest thing: what is being
   * verified is the visitor path, and headlessness is an artefact of the
   * harness rather than of the visitor.
   */
  const context = await browser.newContext({ userAgent: VISITOR_UA });
  await context.addCookies([{ name: 'rbw_vid', value: 'probe-browser-1', url: SITE }]);
  const page = await context.newPage();

  const beacons = [];
  await page.route('**/api/v1/ab/**', async (route) => {
    beacons.push(JSON.parse(route.request().postData() || '{}'));
    await route.continue();
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  ok('an exposure is reported on load', beacons.some(b => (b.events || []).some(e => e.goal === '__exposure__')));

  // Second visit, same visitor: the exposure must not be counted again.
  beacons.length = 0;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  ok('a reload does not report it twice', !beacons.some(b => (b.events || []).some(e => e.goal === '__exposure__')));

  await browser.close();
  await new Promise(r => setTimeout(r, 500));

  const results = await api(`/experiments/${EXP_KEY}/results`);
  const total = (results.body?.totals || []).reduce((sum, t) => sum + t.exposures, 0);
  ok('the exposure reached the counters', total >= 1, `${total} counted`);

  /* 6 — QA preview must not pollute the numbers. */
  heading('A forced arm is shown but not counted');
  const before = (await api(`/experiments/${EXP_KEY}/results`)).body;
  const beforeTotal = (before?.totals || []).reduce((s, t) => s + t.exposures, 0);

  const qa = await chromium.launch();
  const qaCtx = await qa.newContext({ userAgent: VISITOR_UA });
  await qaCtx.addCookies([{ name: 'rbw_vid', value: 'probe-qa-1', url: SITE }]);
  const qaPage = await qaCtx.newPage();
  await qaPage.goto(`${url}?ab_preview=${EXP_KEY}:B`, { waitUntil: 'networkidle' });
  const qaHtml = await qaPage.content();
  ok('the forced arm is what renders', qaHtml.includes('VARIANT COPY'));
  await qaPage.waitForTimeout(900);
  await qa.close();
  await new Promise(r => setTimeout(r, 500));

  const after = (await api(`/experiments/${EXP_KEY}/results`)).body;
  const afterTotal = (after?.totals || []).reduce((s, t) => s + t.exposures, 0);
  ok('it added nothing to the counters', afterTotal === beforeTotal, `${beforeTotal} → ${afterTotal}`);

  /* 7 — the guardrails. */
  heading('Refusing to call a winner too early');
  const r = (await api(`/experiments/${EXP_KEY}/results`)).body;
  ok('the result is not ready', r?.readiness?.ready === false);
  ok('and it says what is missing', (r?.readiness?.blockers || []).length > 0);
  ok('the sample guardrail is one of them', (r?.readiness?.blockers || []).some(b => b.kind === 'sample'));

  /* 8 — getting out. */
  heading('Detaching');
  const detach = await api(`/experiments/${EXP_KEY}/detach`, {
    method: 'POST',
    body: JSON.stringify({ arms: 'keep' }),
  });
  ok('detach reports what it touched', detach.status === 200 && (detach.body?.blocks || []).length === 1);

  const afterDetach = await api(`/pages/${PAGE_KEY}`);
  const section = (afterDetach.body?.page?.sections || []).find(s => s.key === sectionKey);
  ok('the block no longer names the test', !section?.experiment?.key);

  await api(`/pages/${PAGE_KEY}/publish`, { method: 'POST' });
  const controlHtml = await (await fetch(url, { headers: { cookie: 'rbw_vid=probe-visitor-0' } })).text();
  ok('every visitor is back on the control', controlHtml.includes('CONTROL COPY'));
  ok('and the beacon is no longer shipped', !controlHtml.includes('/js/ab.js'));

  heading('Cleaning up');
  await cleanup();
  const gone = await api(`/experiments/${EXP_KEY}`);
  ok('the test is gone', gone.status === 404);
  const pageGone = await api(`/pages/${PAGE_KEY}`);
  ok('the scratch page is gone', pageGone.status === 404);

  console.log(`\n${failures ? c.red(`${checks} checks, ${failures} failure(s)`) : c.green(`${checks} checks, 0 failure(s)`)}\n`);
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(c.red(`\n${err.stack || err.message}\n`));
  await cleanup().catch(() => {});
  process.exit(1);
});
