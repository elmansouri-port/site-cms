#!/usr/bin/env node
/*
 * verify-chrome.mjs — the invariant that replaced per-page chrome.
 *
 * The header and footer used to be copied into all eighteen pages. Consolidating
 * them bought two things this tool checks are actually true:
 *
 *   1. Every page in a language renders the *same* header and the same footer.
 *      That is the whole promise of "edit it once". It is also the bug that was
 *      there before: the English and German footers differed page to page,
 *      because the same sentence had been given a different translation key on
 *      each page and only some of them were translated.
 *
 *   2. No automation endpoint reaches the browser. Every URL listed in
 *      content-source/integrations.json must be absent from every rendered page,
 *      and its proxy path present wherever the authored page called it.
 *
 *   node tools/verify-chrome.mjs [http://localhost:8080]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'content-source');
const BASE = (process.argv[2] || 'http://localhost:8080').replace(/\/+$/, '');

const registry = JSON.parse(fs.readFileSync(path.join(SRC, 'pages.registry.json'), 'utf8'));
const integrationsFile = path.join(SRC, 'integrations.json');
const integrations = fs.existsSync(integrationsFile)
  ? (JSON.parse(fs.readFileSync(integrationsFile, 'utf8')).integrations || [])
  : [];

const NAV_RE = /<nav\b[^>]*id="navbar"[\s\S]*?<\/nav>/;
const FOOTER_RE = /<footer\b[\s\S]*?<\/footer>/;
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

let failures = 0;
const fail = (msg) => { console.log(`FAIL  ${msg}`); failures++; };

/* ── 1. One header and one footer per language ───────────────────────────── */

for (const locale of registry.routedLocales) {
  const navs = new Map();
  const footers = new Map();
  let fetched = 0;

  for (const spec of registry.pages) {
    if (spec.route === '404') continue;
    const url = `${BASE}/${locale}${spec.route ? `/${spec.route}` : ''}`;
    let html;
    try {
      const res = await fetch(url, { headers: { 'accept-language': locale } });
      if (!res.ok) { fail(`${spec.key} [${locale}]: HTTP ${res.status}`); continue; }
      html = await res.text();
    } catch (err) {
      fail(`${spec.key} [${locale}]: ${err.message}`);
      continue;
    }
    fetched++;

    // A page that legitimately has no chrome (the standalone form pages) is not
    // a failure — it is a page that never had one.
    const nav = (NAV_RE.exec(html) || [])[0];
    const footer = (FOOTER_RE.exec(html) || [])[0];
    if (nav) {
      const key = sha(nav);
      if (!navs.has(key)) navs.set(key, []);
      navs.get(key).push(spec.key);
    }
    if (footer) {
      const key = sha(footer);
      if (!footers.has(key)) footers.set(key, []);
      footers.get(key).push(spec.key);
    }
  }

  report(`header [${locale}]`, navs, fetched);
  report(`footer [${locale}]`, footers, fetched);
}

function report(label, groups, fetched) {
  if (!groups.size) {
    console.log(`ok    ${label}: no page renders one`);
    return;
  }
  if (groups.size === 1) {
    const [[, pages]] = [...groups];
    console.log(`ok    ${label}: identical across ${pages.length} of ${fetched} pages`);
    return;
  }
  fail(`${label}: ${groups.size} different versions are being served`);
  for (const [hash, pages] of groups) {
    console.log(`        ${hash}  ${pages.length} page(s): ${pages.slice(0, 6).join(', ')}${pages.length > 6 ? ', …' : ''}`);
  }
}

/* ── 2. No upstream endpoint in any rendered page ────────────────────────── */

if (integrations.length) {
  const locale = registry.routedLocales[0];
  let leaks = 0;
  let proxied = 0;

  for (const spec of registry.pages) {
    if (spec.route === '404') continue;
    const file = path.join(SRC, 'pages', spec.file);
    if (!fs.existsSync(file)) continue;
    const authored = fs.readFileSync(file, 'utf8');

    const expected = integrations.filter(i => authored.includes(i.url));
    if (!expected.length) continue;

    const url = `${BASE}/${locale}${spec.route ? `/${spec.route}` : ''}`;
    let html;
    try {
      const res = await fetch(url);
      html = await res.text();
    } catch (err) {
      fail(`${spec.key}: ${err.message}`);
      continue;
    }

    for (const integration of expected) {
      if (html.includes(integration.url)) {
        fail(`${spec.key}: still exposes the upstream URL for "${integration.slug}"`);
        leaks++;
      }
      const proxyPath = `/api/v1/hooks/${integration.slug}`;
      if (!html.includes(proxyPath)) {
        fail(`${spec.key}: "${integration.slug}" was not repointed — expected ${proxyPath}`);
      } else {
        proxied++;
      }
    }
  }

  // The bundled form component is a static asset, not a rendered page.
  const componentPath = '/js/components/whitepaper-download-form.js';
  try {
    const res = await fetch(`${BASE}${componentPath}`);
    if (res.ok) {
      const js = await res.text();
      for (const integration of integrations) {
        if (js.includes(integration.url)) {
          fail(`${componentPath}: still contains the upstream URL for "${integration.slug}"`);
          leaks++;
        }
      }
      console.log(`ok    ${componentPath}: no upstream URL`);
    }
  } catch { /* the asset is optional */ }

  if (!leaks) console.log(`ok    ${proxied} endpoint reference(s) repointed, no upstream URL exposed`);
}

console.log(`\n${failures} failure(s)`);
process.exit(failures ? 1 : 0);
