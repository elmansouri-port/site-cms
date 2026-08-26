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
 * Two transformations are applied to the expected side, because the CMS applies
 * them too and both are deliberate:
 *
 *   - the header and footer are shared. Every page carried its own copy at
 *     migration time; they are now one document, seeded from the homepage's
 *     pair, which is what CMS_PAGE_SECTIONS.md names as canonical. So each
 *     page's own copy is replaced with the homepage's before diffing. The check
 *     that survives is stronger than the one it replaces: the body must match
 *     its authored source byte for byte, *and* the chrome must be identical on
 *     every page in every language.
 *   - third-party endpoints are repointed at this origin, from
 *     content-source/integrations.json. Same class of rewrite as the locale
 *     prefix on internal links, and reproducible here without any credential
 *     because only the slug reaches the output.
 *
 *   node tools/verify-live.mjs [http://localhost:3000]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { render } from '../packages/core/src/render.js';
import { CHROME_PATTERNS } from '../packages/core/src/compose.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'content-source');
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');

const registry = JSON.parse(fs.readFileSync(path.join(SRC, 'pages.registry.json'), 'utf8'));
const catalogues = {};
for (const locale of registry.locales) {
  const file = path.join(SRC, 'i18n', `${locale}.json`);
  if (fs.existsSync(file)) catalogues[locale] = JSON.parse(fs.readFileSync(file, 'utf8'));
}

const integrationsFile = path.join(SRC, 'integrations.json');
const integrations = fs.existsSync(integrationsFile)
  ? (JSON.parse(fs.readFileSync(integrationsFile, 'utf8')).integrations || [])
  : [];

// The same patterns the renderer uses, imported rather than restated so the
// tool and the thing it checks cannot drift apart.
const { navbar: NAV_RE, footer: FOOTER_RE } = CHROME_PATTERNS;

// The canonical pair, from the homepage.
const homeSource = fs.readFileSync(path.join(SRC, 'pages', 'index.html'), 'utf8');
const sharedNav = (NAV_RE.exec(homeSource) || [])[0] || null;
const sharedFooter = (FOOTER_RE.exec(homeSource) || [])[0] || null;

/** Swap a page's own header and footer for the shared ones. */
function withSharedChrome(source) {
  let out = source;
  if (sharedNav && NAV_RE.test(out)) out = out.replace(NAV_RE, () => sharedNav);
  if (sharedFooter && FOOTER_RE.test(out)) out = out.replace(FOOTER_RE, () => sharedFooter);
  return out;
}

// Injected by the CMS and expected in the live output but not in the source:
// the runtime object the browser reads for locale, navigation and A/B variant.
const RUNTIME_RE = /\s*<script>window\.__CMS__=[\s\S]*?<\/script>/;

/*
 * Copy edited in the CMS is not a migration failure.
 *
 * This tool renders the authored template with the authored catalogue and
 * compares. The moment an editor changes a word — which is the entire purpose of
 * the CMS — that comparison differs, and a tool that called every content edit a
 * failure would be switched off within a week.
 *
 * So a difference is diagnosed rather than just reported: re-render the same
 * template with the catalogue the CMS is actually serving. If that matches, the
 * markup is intact and somebody simply edited the copy. If it still differs, the
 * markup itself has diverged, which is what this tool exists to catch.
 */
const liveCatalogues = {};
async function liveCatalogue(locale) {
  if (liveCatalogues[locale] !== undefined) return liveCatalogues[locale];
  try {
    const res = await fetch(`${BASE}/api/v1/site/catalogue/${locale}`);
    liveCatalogues[locale] = res.ok ? (await res.json()).catalogue || null : null;
  } catch {
    liveCatalogues[locale] = null;
  }
  return liveCatalogues[locale];
}

let failures = 0;
let checked = 0;
let edited = 0;

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

    const expected = bodyOf(render(withSharedChrome(source), catalogues[locale] || {}, locale, {
      sourceLocale: registry.sourceLocale,
      integrations,
    }));
    const actual = bodyOf(live).replace(RUNTIME_RE, '');

    checked++;
    if (expected === actual) continue;

    // Same markup, different words? Then the copy was edited in the CMS.
    const cms = await liveCatalogue(locale);
    if (cms) {
      const withCmsCopy = bodyOf(render(withSharedChrome(source), cms, locale, {
        sourceLocale: registry.sourceLocale,
        integrations,
      }));
      if (withCmsCopy === actual) {
        edited++;
        console.log(`EDIT  ${spec.key} [${locale}]: markup intact, copy edited in the CMS`);
        continue;
      }
    }

    failures++;
    console.log(`FAIL  ${spec.key} [${locale}]: body differs (${expected.length} expected vs ${actual.length} live)`);
    if (!cms) {
      // Without the CMS catalogue there is no way to tell an edited word from
      // broken markup, so this fails — but say why, or the next person spends an
      // afternoon looking for a markup bug that is not there.
      console.log('      (the CMS catalogue was unreachable, so an edited-copy difference cannot be ruled out)');
    }
    console.log('      ' + firstDiff(expected, actual));
  }
}

console.log(`\n${checked} page renders compared against the authored source, ${failures} difference(s)`);
console.log(`  body: byte-for-byte against its own template`);
console.log(`  header and footer: the homepage's pair, shared by every page`);
if (edited) {
  console.log(`  ${edited} render(s) had copy edited in the CMS — markup verified against it instead`);
}
if (integrations.length) {
  console.log(`  ${integrations.length} third-party endpoints repointed at this origin`);
}
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
