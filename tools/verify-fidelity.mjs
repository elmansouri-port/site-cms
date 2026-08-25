#!/usr/bin/env node
/*
 * verify-fidelity.mjs — prove that going through the CMS changes nothing.
 *
 * For every page and every routed locale it compares two renders:
 *   A. the authored document rendered directly (the pipeline the static site
 *      used before the CMS existed)
 *   B. the document sliced into CMS blocks, then reassembled and rendered the
 *      way the Astro frontend does it
 *
 * The <head> legitimately differs (the CMS re-emits the SEO tags in a fixed
 * order and adds hreflang/JSON-LD), so the check is on the <body>: it must be
 * byte-for-byte identical. Any drift here means an editor would see the page
 * change just by the content moving into the database.
 *
 *   node tools/verify-fidelity.mjs [--write-hashes]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { render } from '../packages/core/src/render.js';
import { sliceDocument } from '../packages/core/src/slice.js';
import { ingestPage } from '../packages/core/src/ingest.js';
import { composeBody } from '../packages/core/src/compose.js';
import { unflatten, flatten } from '../packages/core/src/html.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'content-source');
const registry = JSON.parse(fs.readFileSync(path.join(SRC, 'pages.registry.json'), 'utf8'));
const HASH_FILE = path.join(ROOT, 'tools', 'fidelity.hashes.json');

const catalogues = {};
for (const locale of registry.locales) {
  const file = path.join(SRC, 'i18n', `${locale}.json`);
  if (fs.existsSync(file)) catalogues[locale] = JSON.parse(fs.readFileSync(file, 'utf8'));
}

// The CMS stores strings as flat rows and rebuilds the nested catalogue on
// read; run the comparison through that same round trip so a bug in it shows
// up here rather than in production.
const compiled = {};
for (const [locale, cat] of Object.entries(catalogues)) compiled[locale] = unflatten(flatten(cat));

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

let failures = 0;
let checks = 0;
const hashes = {};

for (const spec of registry.pages) {
  const file = path.join(SRC, 'pages', spec.file);
  if (!fs.existsSync(file)) {
    console.log(`SKIP  ${spec.key} (no ${spec.file})`);
    continue;
  }
  const html = fs.readFileSync(file, 'utf8');

  // 1. slicing is lossless: the blocks put the body back together exactly
  const sliced = sliceDocument(html);
  const rebuilt = sliced.blocks.map(b => b.html).join('');
  if (rebuilt !== sliced.bodyInner) {
    console.log(`FAIL  ${spec.key}: block concatenation does not reproduce <body>`);
    failures++;
  }
  checks++;

  const page = ingestPage(spec, html, catalogues, registry.locales);

  for (const locale of registry.routedLocales) {
    const catalogue = compiled[locale] || {};

    const direct = render(html, catalogue, locale, { sourceLocale: registry.sourceLocale });
    const directBody = between(direct, '<body', '</body>');

    const viaCms = composeBody(page, { catalogue, locale, sourceLocale: registry.sourceLocale });
    const cmsBody = viaCms;

    checks++;
    if (directBody !== cmsBody) {
      failures++;
      console.log(`FAIL  ${spec.key} [${locale}]: body differs (${directBody.length} vs ${cmsBody.length} bytes)`);
      console.log('      ' + firstDiff(directBody, cmsBody));
    }
    hashes[`${spec.key}:${locale}`] = sha(cmsBody);
  }
}

if (process.argv.includes('--write-hashes')) {
  fs.writeFileSync(HASH_FILE, JSON.stringify(hashes, null, 2) + '\n');
  console.log(`\nwrote ${Object.keys(hashes).length} hashes to tools/fidelity.hashes.json`);
} else if (fs.existsSync(HASH_FILE)) {
  const known = JSON.parse(fs.readFileSync(HASH_FILE, 'utf8'));
  for (const [k, v] of Object.entries(known)) {
    checks++;
    if (hashes[k] && hashes[k] !== v) {
      failures++;
      console.log(`FAIL  ${k}: output hash changed (${v} -> ${hashes[k]})`);
    }
  }
}

console.log(`\n${checks} checks, ${failures} failure(s)`);
process.exit(failures ? 1 : 0);

function between(s, openTag, closeTag) {
  const i = s.indexOf(openTag);
  const openEnd = s.indexOf('>', i) + 1;
  const j = s.lastIndexOf(closeTag);
  return s.slice(openEnd, j);
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  const ctx = 90;
  return `first difference at byte ${i}\n      A: ${JSON.stringify(a.slice(Math.max(0, i - 20), i + ctx))}\n      B: ${JSON.stringify(b.slice(Math.max(0, i - 20), i + ctx))}`;
}
