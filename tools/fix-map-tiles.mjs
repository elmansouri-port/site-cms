#!/usr/bin/env node
/*
 * fix-map-tiles.mjs — give the partner map a basemap it is allowed to load.
 *
 * The locator draws its map with Leaflet over CARTO's `light_all` basemap. CARTO
 * now requires an API key for that, and the site does not send one — so the
 * tiles still arrive with HTTP 200 and every one of them is a grey square
 * stamped **"API KEY REQUIRED · carto.com/basemaps/apikey"**. The markers, the
 * clustering and the filters all work; the map behind them is a watermark.
 *
 * It fails in the worst possible way: no console error, no broken image, no
 * failed request. Just a map that looks like a placeholder, which is exactly what
 * it is.
 *
 * The fix is a provider that does not need a key, with its attribution. And
 * because the next provider may also change its terms, the URL is read from the
 * page's own translation branch first — `mapTileUrl` in
 * `trouver-un-partenaire.js` — so somebody with a CARTO or Mapbox key can point
 * it wherever they like from **Copy & languages**, without a deploy.
 *
 *   node tools/fix-map-tiles.mjs                 # dry run
 *   node tools/fix-map-tiles.mjs --confirm       # source files + database
 *   node tools/fix-map-tiles.mjs --source-only --confirm
 *
 * Re-runnable: a second pass finds nothing and writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, credentials } from './lib/env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGES_DIR = path.join(ROOT, 'content-source', 'pages');

const args = process.argv.slice(2);
const DRY = !args.includes('--confirm');
const SOURCE_ONLY = args.includes('--source-only');
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

/* The tile layer as it stands, and as it should be. */
const FROM = `        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
            subdomains:'abcd', maxZoom:19
        }).addTo(leafMap);`;

/*
 * OpenStreetMap's own tiles: no key, no sign-up, and the attribution their usage
 * policy requires. `t()` comes from the page's translation branch, so the URL and
 * the credit are both editable in the CMS — which is the point, because the
 * reason this file exists is that a tile provider changed its terms.
 */
const TO = `        L.tileLayer(t('mapTileUrl', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'), {
            attribution: t('mapAttribution', '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'),
            maxZoom:19
        }).addTo(leafMap);`;

/** Has this markup already been through the tool? */
const DONE = /t\('mapTileUrl'/;

function rewrite(source) {
  if (DONE.test(source)) return null;
  // Matched with the file's own line endings rather than assuming LF.
  const eol = /\r\n/.test(source) ? '\r\n' : '\n';
  const from = FROM.split('\n').join(eol);
  if (!source.includes(from)) return null;
  return { text: source.replace(from, TO.split('\n').join(eol)) };
}

/* ── The authored files ───────────────────────────────────────────────────── */

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function fixSource() {
  let files = 0;
  for (const file of walk(PAGES_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    const next = rewrite(source);
    if (!next) continue;
    files++;
    console.log(`  ${DRY ? c.yellow('would repoint') : c.green('repointed')}  ${path.relative(ROOT, file)}`);
    if (!DRY) fs.writeFileSync(file, next.text);
  }
  return files;
}

/* ── The database ─────────────────────────────────────────────────────────── */

const env = loadEnv(ROOT);
const API = flag('api', env.API_BASE || 'http://localhost:8080/api/v1');

let token = null;
async function call(method, endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`${method} ${endpoint} → ${res.status} ${json?.error || text.slice(0, 200)}`);
  return json;
}

async function fixDatabase() {
  ({ token } = await call('POST', '/auth/login', credentials(env)));
  const { items } = await call('GET', '/pages?includeArticles=1');
  let blocks = 0;
  for (const summary of items) {
    const { page } = await call('GET', `/pages/${summary.key}`);
    for (const section of page.sections || []) {
      const next = rewrite(section.html || '');
      if (!next) continue;
      blocks++;
      console.log(`  ${DRY ? c.yellow('would repoint') : c.green('repointed')}  ${page.key} → "${section.key}"`);
      if (!DRY) {
        await call('PATCH', `/pages/${page.key}/sections/${section.key}`, { html: next.text });
      }
    }
  }
  return blocks;
}

/* ── Run ──────────────────────────────────────────────────────────────────── */

async function main() {
  console.log(c.bold('\nThe partner map\'s basemap'));
  console.log(DRY
    ? c.yellow('DRY RUN — nothing will be written. Re-run with --confirm to apply.\n')
    : c.green('Applying.\n'));

  const files = fixSource();
  console.log(`\n  source: ${files} file(s)`);

  if (SOURCE_ONLY) {
    console.log(c.dim('\n  --source-only: the database was not touched.\n'));
    return;
  }

  try {
    console.log(`  database: ${await fixDatabase()} block(s)`);
  } catch (err) {
    console.log(c.red(`  database: ${err.message}`));
    console.log(c.dim('  (the source files above were still handled)'));
    process.exitCode = 1;
    return;
  }

  console.log(c.dim(
    '\n  The URL and the credit are now read from `mapTileUrl` and `mapAttribution`'
    + '\n  in the trouver-un-partenaire.js branch under Copy & languages, so a paid'
    + '\n  provider can be set there rather than in the markup.',
  ));
  if (!DRY) {
    console.log(c.dim('\n  Next: `npm run verify -- --write-hashes`, then `npm run verify:live`.\n'));
  } else {
    console.log('');
  }
}

main().catch((err) => {
  console.error(c.red(`\n${err.message}\n`));
  process.exit(1);
});
