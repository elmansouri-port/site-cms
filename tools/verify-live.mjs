#!/usr/bin/env node
/*
 * verify-live.mjs — compare the running site against the authored files.
 *
 * verify-fidelity.mjs proves the transformation is lossless on paper. This
 * proves the deployed stack is: it fetches every page in every locale from a
 * running server and diffs the <body> against the same page rendered straight
 * from the source template and its catalogue.
 *
 * The <head> is expected to differ (the CMS re-emits SEO tags in a fixed order
 * and adds hreflang, JSON-LD and the runtime object), so it is reported
 * separately as a summary rather than diffed.
 *
 *   node tools/verify-live.mjs [http://localhost:3000]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render } from '../packages/core/src/render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'content-source');
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');

const registry = JSON.parse(fs.readFileSync(path.join(SRC, 'pages.registry.json'), 'utf8'));
const catalogues = {};
for (const locale of registry.locales) {
  const file = path.join(SRC, 'i18n', `${locale}.json`);
  if (fs.existsSync(file)) catalogues[locale] = JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Injected by the CMS and expected in the live output but not in the source:
// the runtime object the browser reads for locale, navigation and A/B variant.
const RUNTIME_RE = /\s*<script>window\.__CMS__=[\s\S]*?<\/script>/;

let failures = 0;
let checked = 0;

for (const spec of registry.pages) {
  const file = path.join(SRC, 'pages', spec.file);
  if (!fs.existsSync(file) || spec.route === '404') continue;
  const source = fs.readFileSync(file, 'utf8');

  for (const locale of registry.routedLocales) {
    const url = `${BASE}/${locale}${spec.route ? `/${spec.route}` : ''}`;
    let live;
    try {
      const res = await fetch(url, { headers: { 'accept-language': locale } });
      if (!res.ok) {
        console.log(`FAIL  ${spec.key} [${locale}]: HTTP ${res.status} at ${url}`);
        failures++;
        continue;
      }
      live = await res.text();
    } catch (err) {
      console.log(`FAIL  ${spec.key} [${locale}]: ${err.message}`);
      failures++;
      continue;
    }

    const expected = bodyOf(render(source, catalogues[locale] || {}, locale, { sourceLocale: registry.sourceLocale }));
    const actual = bodyOf(live).replace(RUNTIME_RE, '');

    checked++;
    if (expected === actual) continue;

    failures++;
    console.log(`FAIL  ${spec.key} [${locale}]: body differs (${expected.length} expected vs ${actual.length} live)`);
    console.log('      ' + firstDiff(expected, actual));
  }
}

console.log(`\n${checked} page renders compared against the authored source, ${failures} difference(s)`);
process.exit(failures ? 1 : 0);

function bodyOf(html) {
  const open = html.indexOf('<body');
  const openEnd = html.indexOf('>', open) + 1;
  const close = html.lastIndexOf('</body>');
  return html.slice(openEnd, close);
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return `at byte ${i}\n      expected: ${JSON.stringify(a.slice(i, i + 110))}\n      live:     ${JSON.stringify(b.slice(i, i + 110))}`;
}
