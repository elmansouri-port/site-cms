#!/usr/bin/env node
/*
 * ui-shots.mjs — drive the admin with a real browser and photograph every screen.
 *
 * Reviewing an interface by reading its JSX does not work: the things that make
 * an admin feel unfinished are spacing, alignment, contrast and empty states,
 * none of which are visible in the source. This signs in, walks the sidebar and
 * writes a PNG per screen so the result can actually be looked at.
 *
 *   node tools/ui-shots.mjs [baseUrl] [--out dir] [--width 1600]
 *
 * Read-only: it navigates and screenshots, it never submits a form.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = (args.find(a => !a.startsWith('--') && !/^\d+$/.test(a)) || 'http://localhost:5173').replace(/\/+$/, '');
const OUT = path.resolve(flag('out', 'artifacts/ui'));
// The admin ships light and dark. A pass that only ever sees one of them cannot
// catch the contrast mistakes that exist only in the other.
const THEMES = args.includes('--light-only') ? ['light'] : ['light', 'dark'];
const WIDTH = Number(flag('width', 1600));
const HEIGHT = Number(flag('height', 1000));
const EMAIL = process.env.ADMIN_EMAIL || 'admin@rainbow.local';
const PASSWORD = process.env.ADMIN_PASSWORD || 'Rainbow!Admin2026';

/** The screens worth looking at, in the order the sidebar lists them. */
const SCREENS = [
  { name: '01-overview', path: '/admin/' },
  { name: '02-pages', path: '/admin/pages' },
  { name: '03-page-design', path: '/admin/pages/index', settle: 4000 },
  { name: '04-blog', path: '/admin/blog' },
  { name: '05-media', path: '/admin/media' },
  { name: '06-chrome', path: '/admin/chrome', settle: 3000 },
  { name: '07-menus', path: '/admin/navigation' },
  { name: '08-copy', path: '/admin/content' },
  { name: '09-experiments', path: '/admin/experiments' },
  { name: '10-leads', path: '/admin/leads' },
  { name: '11-redirects', path: '/admin/redirects' },
  { name: '12-partners', path: '/admin/partners' },
  { name: '13-integrations', path: '/admin/integrations' },
  { name: '14-settings', path: '/admin/settings' },
  { name: '15-users', path: '/admin/users' },
  { name: '16-audit', path: '/admin/audit' },
];

/*
 * Screens that live behind a tab.
 *
 * Reached by clicking rather than by URL, because the page editor keeps its tab
 * in component state — the right call for an editor (a reload should not land
 * you on the SEO tab) and the reason these have to be driven.
 */
const TABS = [
  { name: '17-page-blocks', path: '/admin/pages/index', tab: /^Blocks/ },
  { name: '18-page-seo', path: '/admin/pages/index', tab: 'SEO', settle: 3500 },
  { name: '19-page-settings', path: '/admin/pages/index', tab: 'Settings' },
  { name: '20-page-history', path: '/admin/pages/index', tab: 'History' },
];

const problems = [];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  // Console messages name the document, not the resource that failed, so the
  // useful record of a bad request is the response event itself.
  page.on('pageerror', (err) => {
    problems.push({ kind: 'pageerror', where: page.url(), text: String(err.message).slice(0, 300) });
  });
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() !== 'error' || /Failed to load resource/.test(text)) return;
    problems.push({ kind: 'console', where: page.url(), text: text.slice(0, 300) });
  });
  page.on('response', (res) => {
    const status = res.status();
    // The first /auth/refresh always 401s: there is no session yet.
    if (status < 400 || res.url().includes('/auth/refresh')) return;
    problems.push({ kind: `http ${status}`, where: res.url().replace(BASE, ''), text: res.request().resourceType() });
  });

  await page.goto(`${BASE}/admin/`, { waitUntil: 'networkidle' });

  // Sign in, unless a refresh cookie already did it for us.
  if (await page.locator('input[type="password"]').count()) {
    await page.screenshot({ path: path.join(OUT, '00-login.png') });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/auth/login'), { timeout: 20000 }),
      page.locator('input[type="password"]').press('Enter'),
    ]);
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 20000 });
  }

  for (const theme of THEMES) {
    const suffix = theme === 'dark' ? '-dark' : '';
    // The same key the admin's own appearance switch writes, so the app boots
    // into the theme rather than being repainted after the first render.
    await page.evaluate((value) => {
      try { window.localStorage.setItem('rainbow-cms-theme', value); } catch { /* private mode */ }
    }, theme);

    for (const screen of SCREENS) {
      try {
        await page.goto(`${BASE}${screen.path}`, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(screen.settle || 900);
        await page.screenshot({ path: path.join(OUT, `${screen.name}${suffix}.png`), fullPage: false });
        const tall = await page.evaluate(() => document.documentElement.scrollHeight);
        if (theme === 'light' && tall > HEIGHT * 1.15) {
          await page.screenshot({ path: path.join(OUT, `${screen.name}-full.png`), fullPage: true });
        }
        console.log(`  shot  ${screen.name}${suffix}`);
      } catch (err) {
        problems.push({ where: screen.path, kind: 'navigation', text: err.message.slice(0, 200) });
        console.log(`  FAIL  ${screen.name}${suffix} — ${err.message.split('\n')[0]}`);
      }
    }

    for (const screen of TABS) {
      try {
        await page.goto(`${BASE}${screen.path}`, { waitUntil: 'networkidle', timeout: 30000 });
        await page.getByRole('tab', { name: screen.tab }).click();
        await page.waitForTimeout(screen.settle || 1200);
        await page.screenshot({ path: path.join(OUT, `${screen.name}${suffix}.png`) });
        console.log(`  shot  ${screen.name}${suffix}`);
      } catch (err) {
        problems.push({
          where: `${screen.path}#${screen.tab}`,
          kind: 'navigation',
          text: err.message.slice(0, 200),
        });
        console.log(`  FAIL  ${screen.name}${suffix} — ${err.message.split('\n')[0]}`);
      }
    }
  }

  await browser.close();

  await writeFile(path.join(OUT, 'problems.json'), JSON.stringify(problems, null, 2));
  console.log(`\n${(SCREENS.length + TABS.length) * THEMES.length} screens → ${OUT}`);
  if (!problems.length) {
    console.log('no page errors, console errors or failed requests');
    return;
  }
  // One line per distinct problem: a broken thumbnail repeated forty times is
  // one bug, and printing it forty times buries the other thirty-nine.
  const seen = new Map();
  for (const p of problems) {
    const id = `${p.kind}|${p.where}|${p.text}`;
    seen.set(id, (seen.get(id) || 0) + 1);
  }
  console.log(`${problems.length} runtime problem(s), ${seen.size} distinct:`);
  for (const [id, count] of [...seen].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    const [kind, where, text] = id.split('|');
    console.log(`  ${count > 1 ? `${count}×` : '  '} [${kind}] ${where} ${text}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
