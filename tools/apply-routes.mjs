#!/usr/bin/env node
/*
 * apply-routes.mjs — give every page its own path in every language.
 *
 * The per-locale URL machinery already existed end to end: `routes` on the page
 * document, `routeFor()` in the resolver, the canonical tag, hreflang, the
 * sitemap and the 301 from an untranslated path. What it never had was data, so
 * a German visitor read German copy at a French address
 * (`/de/rainbow-donnees-hebergees-en-france`), which is the one thing localized
 * URLs exist to prevent.
 *
 * This applies content-source/routes.i18n.json through the admin API rather
 * than writing to Mongo, deliberately: PATCH /pages/:key already writes the 301
 * for a renamed path, repoints anything aimed at the old one so no chain builds
 * up, snapshots the page first, and bumps the site revision. Reaching past all
 * of that to save a field would mean reimplementing four things that are
 * already correct.
 *
 *   node tools/apply-routes.mjs                    # dry run: what would change
 *   node tools/apply-routes.mjs --confirm          # apply it
 *   node tools/apply-routes.mjs --api http://localhost:8080/api/v1 --confirm
 *
 * Idempotent. A second run reports "already correct" for every page and writes
 * nothing, so it is safe to re-run after editing the table.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = path.join(ROOT, 'content-source', 'routes.i18n.json');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY = !args.includes('--confirm');

/* The .env the docker stack already reads, so the tool needs no arguments in
 * the normal case. Values on the command line still win. */
function dotenv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env: fall back to the environment */ }
  return out;
}
const env = { ...dotenv(), ...process.env };

const API = flag('api', env.API_BASE || 'http://localhost:8080/api/v1');
const EMAIL = flag('email', env.ADMIN_EMAIL);
const PASSWORD = flag('password', env.ADMIN_PASSWORD);

const table = JSON.parse(fs.readFileSync(TABLE, 'utf8'));
const SOURCE = table.sourceLocale || 'fr';

let token = null;
async function call(method, endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const detail = json?.error || json?.message || text.slice(0, 200);
    throw new Error(`${method} ${endpoint} → ${res.status} ${detail}`);
  }
  return json;
}

const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

const clean = (s) => String(s ?? '').replace(/^\/+|\/+$/g, '');

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error(c.red('No admin credentials.') + ' Set ADMIN_EMAIL and ADMIN_PASSWORD in .env, '
      + 'or pass --email and --password.');
    process.exit(2);
  }

  console.log(c.bold(`\nLocalized URLs → ${API}`));
  console.log(DRY ? c.yellow('DRY RUN — nothing will be written. Re-run with --confirm to apply.\n')
    : c.green('Applying.\n'));

  ({ token } = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD }));

  const { items: pages } = await call('GET', '/pages');
  const byKey = new Map(pages.map(p => [p.key, p]));

  let changed = 0; let same = 0; let missing = 0;
  const redirects = [];
  const failures = [];

  for (const [key, wanted] of Object.entries(table.routes)) {
    const page = byKey.get(key);
    if (!page) {
      console.log(`  ${c.yellow('skip')}  ${key.padEnd(38)} ${c.dim('no such page')}`);
      missing++;
      continue;
    }

    /* The source locale owns the base `route`; every other locale is an entry in
     * `routes`. Keeping the source out of the override map means one path is
     * stored once, and `routeFor()` falls back to it for any locale nobody has
     * translated yet. */
    const baseWanted = clean(wanted[SOURCE]);
    const baseNow = clean(page.route);
    const patch = {};
    if (baseWanted !== baseNow) patch.route = baseWanted;

    const routesNow = page.routes || {};
    const routesPatch = {};
    for (const [locale, value] of Object.entries(wanted)) {
      if (locale === SOURCE) continue;
      const want = clean(value);
      // Same as the base route means no override: storing it would be a second
      // copy of the same string that can later disagree with the first.
      const target = want === baseWanted ? '' : want;
      if (clean(routesNow[locale]) !== target) routesPatch[locale] = target;
    }
    if (Object.keys(routesPatch).length) patch.routes = routesPatch;

    if (!Object.keys(patch).length) {
      same++;
      console.log(`  ${c.dim('ok')}    ${key.padEnd(38)} ${c.dim('already correct')}`);
      continue;
    }

    const preview = Object.entries(wanted)
      .map(([l, v]) => `/${l}/${clean(v)}`)
      .join('  ');
    console.log(`  ${DRY ? c.yellow('would') : c.green('set')}   ${key.padEnd(38)} ${preview}`);

    if (DRY) { changed++; continue; }

    try {
      const result = await call('PATCH', `/pages/${key}`, patch);
      changed++;
      for (const r of result.redirects || []) {
        redirects.push(r);
        console.log(`        ${c.dim(`301  ${r.from}  →  ${r.to}`)}`);
      }
    } catch (err) {
      failures.push({ key, message: err.message });
      console.log(`        ${c.red(err.message)}`);
    }
  }

  console.log(`\n  ${changed} page(s) ${DRY ? 'would change' : 'changed'}, ${same} already correct`
    + (missing ? `, ${missing} not found` : ''));
  if (redirects.length) console.log(`  ${redirects.length} redirect(s) written`);

  if (failures.length) {
    console.log(c.red(`\n  ${failures.length} failed:`));
    for (const f of failures) console.log(`    ${f.key}: ${f.message}`);
    process.exit(1);
  }

  if (!DRY) {
    console.log(c.dim('\n  Publish is not implied: pages already published serve the new path now,'));
    console.log(c.dim('  and the old path 301s to it. Check tools/verify-live.mjs before announcing.\n'));
  } else {
    console.log('');
  }
}

main().catch(err => {
  console.error(c.red(`\n${err.message}\n`));
  process.exit(1);
});
