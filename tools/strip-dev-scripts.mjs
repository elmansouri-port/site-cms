#!/usr/bin/env node
/*
 * strip-dev-scripts.mjs — remove the live-reload tag the authored pages shipped
 * with.
 *
 * Eleven of the authored pages end with:
 *
 *   <script src="http://localhost:8400/live.js?token=…"></script>
 *
 * left behind by whatever editor built the static site. It is still being
 * served, and it is not a cosmetic problem:
 *
 *   - **It executes code from the visitor's own machine.** `localhost` resolves
 *     on the client, so the page tells every browser to fetch and run
 *     JavaScript from port 8400 *on the computer reading the page*. Anyone
 *     running anything on that port — a dev server, a local tool, a hostile
 *     process — has their script running with the site's origin. That is the
 *     whole of same-origin policy handed away in one tag.
 *   - **It is mixed content.** Over HTTPS the browser blocks it and logs an
 *     error on every page load, which is the first thing anybody auditing the
 *     site will see.
 *   - **It costs a connection attempt** on every page view, before anything
 *     else in the footer runs.
 *
 * The tag is its own top-level block, so removing it is a clean block removal
 * rather than a rewrite of any authored markup: everything under the fidelity
 * guarantee stays byte-identical.
 *
 *   node tools/strip-dev-scripts.mjs                 # dry run
 *   node tools/strip-dev-scripts.mjs --confirm       # source files + database
 *   node tools/strip-dev-scripts.mjs --source-only --confirm
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

/**
 * What counts as a development-only script.
 *
 * Deliberately narrow. A pattern broad enough to catch "anything that looks
 * like a dev tool" would eventually delete a legitimate third-party tag, and
 * this runs against the pages the whole site is built from. Loopback hosts and
 * the known live-reload filenames only; anything else is reported, not removed.
 */
const DEV_SCRIPT = /^\s*<script\b[^>]*\bsrc=["'](?:https?:)?\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?\/[^"']*["'][^>]*>\s*<\/script>\s*$/i;

/*
 * The wrapper the same tool left around it.
 *
 * `<!-- impeccable-live-start -->` / `-end` bracket the injected script. They
 * have to go with it: the markers are trivia attached to the script block, so
 * leaving them in the authored source while the block itself is hidden makes
 * the source and the live page disagree — which is precisely what
 * `verify-live` exists to catch, and it would report a difference on eleven
 * pages forever.
 */
const DEV_MARKER = /^\s*<!--\s*impeccable-live-(?:start|end)\s*-->\s*$/i;
const LOOPBACK_SRC = /\bsrc=["'](?:https?:)?\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?\//i;

const c = {
  dim: s => `\x1b[2m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

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
  let removed = 0;

  for (const file of walk(PAGES_DIR)) {
    const original = fs.readFileSync(file, 'utf8');
    const lines = original.split('\n');
    const kept = lines.filter((line) => {
      if (!DEV_SCRIPT.test(line) && !DEV_MARKER.test(line)) return true;
      removed++;
      console.log(`  ${DRY ? c.yellow('would strip') : c.green('stripped')}  `
        + `${path.relative(ROOT, file)}: ${line.trim().slice(0, 76)}`);
      return false;
    });

    /*
     * Anything on a loopback host the narrow pattern did not match — a tag
     * spread over several lines, or an inline script pointing at one. Checked
     * against the *stripped* content rather than by re-reading the file, so a
     * dry run reports the same thing an applied run would instead of listing
     * every file it is about to fix.
     */
    const after = kept.join('\n');
    if (LOOPBACK_SRC.test(after)) {
      console.log(`  ${c.yellow('review')}      ${path.relative(ROOT, file)} still references a loopback host`);
    }

    if (kept.length === lines.length) continue;
    files++;
    if (!DRY) fs.writeFileSync(file, after);
  }

  return { files, removed };
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
  if (!res.ok) throw new Error(`${method} ${endpoint} → ${res.status} ${json?.error || text.slice(0, 160)}`);
  return json;
}

async function stripDatabase() {
  ({ token } = await call('POST', '/auth/login', credentials(env)));

  const { items } = await call('GET', '/pages?includeArticles=1');
  let emptied = 0;
  let deleted = 0;

  for (const summary of items) {
    const { page } = await call('GET', `/pages/${summary.key}`);

    /*
     * Pass one: take the tag out, leaving the block's own whitespace.
     *
     * The block cannot simply be deleted here — the slicer attaches the trivia
     * preceding an element to the block that follows it, so that newline is part
     * of the authored body and dropping it makes the live page two bytes shorter
     * than the file it came from. `verify-live` reports that as a difference for
     * ever, on eleven pages.
     */
    for (const section of (page.sections || []).filter(s => LOOPBACK_SRC.test(s.html || ''))) {
      const trivia = /^s*/.exec(section.html || '')[0];
      if (section.html === trivia) continue;   // already dealt with
      console.log(`  ${DRY ? c.yellow('would empty') : c.green('emptied')}  `
        + `${page.key} → block "${section.key}"`);
      emptied++;
      if (!DRY) {
        await call('PATCH', `/pages/${page.key}/sections/${section.key}`, {
          html: trivia,
          // Undo the hide from an earlier run of this tool, if there was one:
          // the block now renders the right thing and should be doing so.
          visible: true,
        });
      }
    }

    /*
     * Pass two: and now take the block itself.
     *
     * The blocks pass one leaves behind are the reason this tool used to finish
     * with the job half done. Twelve pages carried a "Script" block whose whole
     * content was a newline — visible in the page builder, impossible to open,
     * impossible to delete, and doing nothing.
     *
     * The delete endpoint now accepts an emptied script block and moves its
     * whitespace onto the block before it, so the page still emits the same
     * bytes. Which is what made this possible; the constraint was never that the
     * block had to exist, only that its newline did.
     *
     * Read fresh, because pass one has just changed what is there.
     */
    const { page: current } = DRY ? { page } : await call('GET', `/pages/${summary.key}`);
    const residue = (current.sections || []).filter((s, at) => (
      at > 0
      && (s.type === 'script' || s.type === 'style')
      && !String(s.html || '').trim()
    ));
    for (const section of residue) {
      console.log(`  ${DRY ? c.yellow('would delete') : c.green('deleted')}  `
        + `${current.key} → the empty block "${section.key}" it left behind`);
      deleted++;
      if (!DRY) await call('DELETE', `/pages/${current.key}/sections/${section.key}`);
    }
  }
  return { emptied, deleted };
}

/* ── Run ──────────────────────────────────────────────────────────────────── */

async function main() {
  console.log(c.bold('\nDevelopment scripts in the authored pages'));
  console.log(DRY
    ? c.yellow('DRY RUN — nothing will be written. Re-run with --confirm to apply.\n')
    : c.green('Applying.\n'));

  const source = stripSource();
  console.log(`\n  source: ${source.removed} tag(s) in ${source.files} file(s)`);

  if (SOURCE_ONLY) {
    console.log(c.dim('\n  --source-only: the database was not touched.\n'));
    return;
  }

  let dbRemoved = 0;
  try {
    const db = await stripDatabase();
    dbRemoved = db.emptied + db.deleted;
    console.log(`  database: ${db.emptied} tag(s) removed, ${db.deleted} empty block(s) deleted`);
  } catch (err) {
    console.log(c.red(`  database: ${err.message}`));
    console.log(c.dim('  (the source files above were still handled)'));
  }

  if (!DRY && (source.removed || dbRemoved)) {
    console.log(c.dim('\n  Next: `npm run verify -- --write-hashes` to re-pin the fidelity hashes,'));
    console.log(c.dim('  then `npm run verify:live` against a running server.\n'));
  } else {
    console.log('');
  }
}

main().catch((err) => {
  console.error(c.red(`\n${err.message}\n`));
  process.exit(1);
});
