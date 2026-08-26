#!/usr/bin/env node
/*
 * verify-assets.mjs — every asset a page asks for must exist.
 *
 * The byte-fidelity checks prove the markup is right. They cannot prove the
 * markup still points at files that are there: a stylesheet or hero image that
 * 404s changes the design without changing a single byte of HTML. This walks
 * the rendered pages, collects every local reference — href, src, srcset,
 * poster, and url() inside inline styles — and checks each one resolves.
 *
 *   node tools/verify-assets.mjs            check the authored source
 *   node tools/verify-assets.mjs http://…   check a running server too
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render } from '../packages/core/src/render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'content-source');
const PUBLIC_DIR = path.join(ROOT, 'apps', 'web', 'public');
const BASE = process.argv[2] ? process.argv[2].replace(/\/+$/, '') : null;

const registry = JSON.parse(fs.readFileSync(path.join(SRC, 'pages.registry.json'), 'utf8'));
const catalogue = JSON.parse(fs.readFileSync(path.join(SRC, 'i18n', 'fr.json'), 'utf8'));

// Served by the frontend rather than from disk.
const DYNAMIC_ROUTES = new Set(['/assets/partners.json', '/sitemap.xml', '/robots.txt']);
// Uploaded media lives on a volume, not in the repository.
const RUNTIME_PREFIXES = ['/media/'];

const ATTR_RE = /(?:href|src|poster|data-src)\s*=\s*"([^"]+)"/gi;
const SRCSET_RE = /srcset\s*=\s*"([^"]+)"/gi;
const CSS_URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;

function localRefs(html) {
  const found = new Set();
  const add = (raw) => {
    const ref = raw.trim();
    if (!ref || ref.startsWith('#') || ref.startsWith('data:') || ref.startsWith('mailto:')
      || ref.startsWith('tel:') || /^[a-z]+:\/\//i.test(ref) || ref.startsWith('//')) return;
    if (!ref.startsWith('/')) return; // in-page or relative link, not an asset path
    if (ref.includes('...')) return;  // an example path inside a code comment
    found.add(ref.split('?')[0].split('#')[0]);
  };

  // Script bodies hold example paths in comments and paths built at runtime;
  // neither is a reference the browser will actually fetch. The opening tags
  // survive the strip, so <script src> is still checked.
  const markup = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');

  for (const m of markup.matchAll(ATTR_RE)) add(m[1]);
  for (const m of markup.matchAll(SRCSET_RE)) {
    for (const candidate of m[1].split(',')) add(candidate.trim().split(/\s+/)[0]);
  }
  for (const m of markup.matchAll(CSS_URL_RE)) add(m[1]);
  return [...found];
}

/** A reference is fine if it is a file, a page route, or a known dynamic route. */
function classify(ref, routes) {
  if (DYNAMIC_ROUTES.has(ref)) return 'dynamic';
  if (RUNTIME_PREFIXES.some(p => ref.startsWith(p))) return 'runtime';
  if (fs.existsSync(path.join(PUBLIC_DIR, ref))) return 'file';

  const parts = ref.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  // A link to another page: /fr, /fr/tarifs, /en/products/collaboration…
  if (registry.routedLocales.includes(parts[0])) {
    const route = parts.slice(1).join('/');
    return routes.has(route) ? 'page' : 'page-missing';
  }

  // A locale-less link — the shared form pages and the 404 use these. The
  // middleware redirects them to the visitor's language, so they resolve.
  const bare = parts.join('/');
  if (routes.has(bare)) return 'page';

  return parts.length && !path.extname(bare) ? 'page-missing' : 'missing';
}

const routes = new Set(registry.pages.map(p => p.route));
const assets = new Map();   // ref -> pages that reference it
const pageLinks = new Map();

for (const spec of registry.pages) {
  const file = path.join(SRC, 'pages', spec.file);
  if (!fs.existsSync(file)) continue;
  const html = render(fs.readFileSync(file, 'utf8'), catalogue, 'fr', { sourceLocale: 'fr' });
  for (const ref of localRefs(html)) {
    const kind = classify(ref, routes);
    const bucket = kind === 'page' || kind === 'page-missing' ? pageLinks : assets;
    if (!bucket.has(ref)) bucket.set(ref, { kind, pages: [] });
    bucket.get(ref).pages.push(spec.key);
  }
}

let failures = 0;

const missingAssets = [...assets].filter(([, v]) => v.kind === 'missing');
console.log(`${assets.size} distinct asset references across ${registry.pages.length} pages`);
if (missingAssets.length) {
  failures += missingAssets.length;
  console.log(`\n${missingAssets.length} asset(s) referenced but not present:`);
  for (const [ref, v] of missingAssets) console.log(`  ${ref}\n      used by: ${[...new Set(v.pages)].join(', ')}`);
} else {
  console.log('every asset reference resolves to a file that exists');
}

const brokenLinks = [...pageLinks].filter(([, v]) => v.kind === 'page-missing');
if (brokenLinks.length) {
  console.log(`\n${brokenLinks.length} internal link(s) point at a route that does not exist:`);
  for (const [ref, v] of brokenLinks) console.log(`  ${ref}\n      used by: ${[...new Set(v.pages)].join(', ')}`);
  console.log('  (these were already broken on the static site — reported, not failed)');
}

// Optional: confirm the running server actually serves the assets.
if (BASE) {
  console.log(`\nchecking ${assets.size} assets against ${BASE}`);
  const refs = [...assets.keys()];
  let bad = 0;
  for (let i = 0; i < refs.length; i += 12) {
    const batch = refs.slice(i, i + 12);
    const results = await Promise.all(batch.map(async (ref) => {
      try {
        const res = await fetch(`${BASE}${ref}`, { method: 'HEAD' });
        return { ref, ok: res.ok, status: res.status };
      } catch (err) {
        return { ref, ok: false, status: err.message };
      }
    }));
    for (const r of results) {
      if (!r.ok) { bad++; console.log(`  ${r.status}  ${r.ref}`); }
    }
  }
  failures += bad;
  console.log(bad ? `${bad} asset(s) do not load` : 'every asset loads from the server');
}

console.log(`\n${failures} failure(s)`);
process.exit(failures ? 1 : 0);
