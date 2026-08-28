#!/usr/bin/env node
/*
 * strip-legacy-seo.mjs — remove the in-page SEO script the static site needed.
 *
 * The article template ends with an IIFE headed "Dynamic SEO: canonical, OG,
 * Twitter, share URLs, JSON-LD". On the static site it was the only way to give
 * a page a canonical URL that matched wherever it was deployed. Under the CMS it
 * is worse than redundant — it is broken, and it has been on every article view
 * since the migration:
 *
 *   1. **It throws on line one.** Its first statement is
 *      `document.getElementById('meta-canonical').href = url`, and there is no
 *      such element any more: the CMS lifts the SEO tags out of the authored
 *      <head> and re-emits them itself. So the browser logs
 *      "Cannot set properties of null" on every article and *everything after
 *      that line never runs*.
 *   2. **Which is why the share buttons on the article template are dead.** They
 *      were assigned three statements later. `/fr/blog/the-power-of-rainbow`
 *      ships LinkedIn and X buttons whose href is `#`.
 *   3. **And if it had run, it would have been wrong.** The `@graph` it builds
 *      is hard-coded to the article the template shipped with — the headline
 *      "The Power of Rainbow", Marie Hillion as author, 1 July 2026, category
 *      Collaboration. Every article published through the CMS would have told
 *      search engines it was that one.
 *
 * The CMS owns almost all of it now: `buildHead` emits canonical, OG and Twitter
 * per locale, and `buildJsonLd` emits Article and BreadcrumbList from the post.
 * Those parts are deleted rather than repaired.
 *
 * The share buttons are the exception and are kept, as nine lines instead of
 * eighty. A share URL is genuinely a client-side value here: the authored article
 * is served as a *page*, not through the article renderer, so `withShareLinks`
 * never touches it — which is why its LinkedIn and X buttons still point at `#`
 * today. They now point at the page they are on.
 *
 * The three behaviours above the block — the contents toggle, the scroll spy and
 * the copy-link button — are page behaviour and are kept untouched.
 *
 *   node tools/strip-legacy-seo.mjs                 # dry run
 *   node tools/strip-legacy-seo.mjs --confirm       # source files + database
 *   node tools/strip-legacy-seo.mjs --source-only --confirm
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

/*
 * The block to remove, found by its own comment and closed by brace depth.
 *
 * A regular expression spanning eighty lines of JavaScript with nested objects
 * and strings full of braces would be a guess. The comment that heads the block
 * is unambiguous in this site, and from there the end of the IIFE is found by
 * counting — ignoring braces inside strings and comments, which is the part a
 * naive counter gets wrong on `'{'` and on the JSON-LD's `'@type'`.
 */
const HEAD = /^[ \t]*\/\/[ \t]*──[ \t]*Dynamic SEO:.*$/m;

function findBlock(source) {
  const head = HEAD.exec(source);
  if (!head) return null;

  const openParen = source.indexOf('(function', head.index);
  if (openParen < 0) return null;
  const firstBrace = source.indexOf('{', openParen);
  if (firstBrace < 0) return null;

  let depth = 0;
  let i = firstBrace;
  let quote = null;
  for (; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];

    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && next === '/') { const nl = source.indexOf('\n', i); i = nl < 0 ? source.length : nl; continue; }
    if (ch === '/' && next === '*') { const end = source.indexOf('*/', i); i = end < 0 ? source.length : end + 1; continue; }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;

  // Past the closing brace: `})();` and the newline after it.
  let end = i + 1;
  const tail = /^\s*\)\s*\(\s*\)\s*;?[ \t]*\r?\n?/.exec(source.slice(end));
  if (!tail) return null;
  end += tail[0].length;

  // Take the blank line that separated it from the block above, so removing it
  // does not leave a double gap.
  let start = head.index;
  while (start > 0 && /[ \t]/.test(source[start - 1])) start--;
  const before = source.lastIndexOf('\n', start - 1);
  if (before >= 0) start = before + 1;

  return { start, end, text: source.slice(start, end) };
}

/*
 * What replaces it.
 *
 * Only the share URLs, and only because they depend on the address bar. Indented
 * to match the block it replaces so the authored file still reads as one piece,
 * and guarded on both elements so it cannot become the next script that throws
 * and takes the rest of the file's behaviour down with it.
 */
const REPLACEMENT = `        // ── Share URLs: the one thing here that needs the address bar ──
        (function () {
            var url = location.href;
            var title = document.title;
            var li = document.getElementById('share-linkedin');
            var x = document.getElementById('share-x');
            if (li) li.href = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(url);
            if (x) x.href = 'https://twitter.com/intent/tweet?url=' + encodeURIComponent(url)
                + '&text=' + encodeURIComponent(title);
        })();
`;

/** Has this markup already been through the tool? */
const DONE = /Share URLs: the one thing here that needs the address bar/;

/** The markup with the legacy block swapped for the replacement, or null. */
function rewrite(source) {
  if (DONE.test(source)) return null;
  const block = findBlock(source);
  if (!block) return null;
  // The line endings of the file it is going into, not this tool's.
  const eol = /\r\n/.test(source) ? '\r\n' : '\n';
  const replacement = REPLACEMENT.split('\n').join(eol);
  return {
    text: source.slice(0, block.start) + replacement + source.slice(block.end),
    removed: block.text.split('\n').length - 1,
  };
}

/* ── The authored files ───────────────────────────────────────────────────── */

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function stripSource() {
  let files = 0;
  let lines = 0;
  for (const file of walk(PAGES_DIR)) {
    const source = fs.readFileSync(file, 'utf8');
    const next = rewrite(source);
    if (!next) continue;
    files++;
    lines += next.removed;
    console.log(`  ${DRY ? c.yellow('would replace') : c.green('replaced')}  `
      + `${path.relative(ROOT, file)}: ${next.removed} dead lines of in-page SEO`);
    if (!DRY) fs.writeFileSync(file, next.text);
  }
  return { files, lines };
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

async function stripDatabase() {
  ({ token } = await call('POST', '/auth/login', credentials(env)));
  const { items } = await call('GET', '/pages?includeArticles=1');
  let blocks = 0;

  for (const summary of items) {
    const { page } = await call('GET', `/pages/${summary.key}`);
    for (const section of page.sections || []) {
      const next = rewrite(section.html || '');
      if (!next) continue;
      blocks++;
      console.log(`  ${DRY ? c.yellow('would replace') : c.green('replaced')}  `
        + `${page.key} → block "${section.key}"`);
      if (!DRY) {
        await call('PATCH', `/pages/${page.key}/sections/${section.key}`, { html: next.text });
      }
    }
  }
  return blocks;
}

/* ── Run ──────────────────────────────────────────────────────────────────── */

async function main() {
  console.log(c.bold('\nThe static site\'s in-page SEO script'));
  console.log(DRY
    ? c.yellow('DRY RUN — nothing will be written. Re-run with --confirm to apply.\n')
    : c.green('Applying.\n'));

  const source = stripSource();
  console.log(`\n  source: ${source.lines} dead line(s) removed from ${source.files} file(s)`);

  if (SOURCE_ONLY) {
    console.log(c.dim('\n  --source-only: the database was not touched.\n'));
    return;
  }

  try {
    const blocks = await stripDatabase();
    console.log(`  database: ${blocks} block(s)`);
  } catch (err) {
    console.log(c.red(`  database: ${err.message}`));
    console.log(c.dim('  (the source files above were still handled)'));
  }

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
