#!/usr/bin/env node
/*
 * verify-megamenu.mjs — prove the CMS-driven navigation renders the same menu.
 *
 * js/mega-menu.js builds its markup as strings before touching the DOM, so the
 * comparison does not need a browser: the module body is evaluated twice, once
 * with no CMS data (the shipped copy) and once with the payload the frontend
 * injects, and the six generated HTML strings are diffed.
 *
 * A difference here means an editor changed the navigation — expected once
 * they do. Run it against a freshly seeded database, where the CMS content is
 * the shipped copy, and the two must match exactly.
 *
 *   node tools/verify-megamenu.mjs [http://localhost:4000]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { navRuntime } from '../apps/web/src/lib/nav.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = (process.argv[2] || 'http://localhost:4000').replace(/\/+$/, '');
const FILE = path.join(ROOT, 'apps', 'web', 'public', 'js', 'mega-menu.js');

const source = fs.readFileSync(FILE, 'utf8');
const bodyStart = source.indexOf('{', source.indexOf('(function ()')) + 1;
const bodyEnd = source.lastIndexOf('})();');
const body = source.slice(bodyStart, bodyEnd);

const OUTPUTS = ['productsHTML', 'ressourcesHTML', 'tarifsHTML',
  'productsMobileHTML', 'ressourcesMobileHTML', 'tarifsMobileHTML'];

/** Evaluate the module body far enough to collect the markup it builds. */
function build(nav, locale) {
  const stub = {
    location: { pathname: `/${locale}/` },
    window: { __CMS__: nav ? { nav } : undefined, innerWidth: 1400, addEventListener() {} },
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], readyState: 'loading' },
  };
  const runnable = body.slice(0, body.indexOf('function setupDropdown'))
    + `\n;return {${OUTPUTS.map(k => `${k}: typeof ${k} !== 'undefined' ? ${k} : null`).join(', ')}};`;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'document', 'location', runnable);
  return fn(stub.window, stub.document, stub.location);
}

const bootstrap = await fetch(`${API}/api/v1/site/bootstrap`).then(r => r.json());

let failures = 0;
for (const locale of ['fr', 'en', 'de']) {
  const shipped = build(null, locale);
  const fromCms = build(navRuntime(bootstrap.navigation, locale), locale);

  for (const key of OUTPUTS) {
    if (shipped[key] === fromCms[key]) continue;
    failures++;
    console.log(`DIFF  ${key} [${locale}]`);
    const a = shipped[key] || '';
    const b = fromCms[key] || '';
    let i = 0;
    while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
    console.log(`      shipped: ${JSON.stringify(a.slice(i, i + 120))}`);
    console.log(`      cms:     ${JSON.stringify(b.slice(i, i + 120))}`);
  }
}

console.log(`\n${OUTPUTS.length * 3} menu renders compared, ${failures} difference(s)`);
process.exit(failures ? 1 : 0);
