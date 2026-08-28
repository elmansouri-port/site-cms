#!/usr/bin/env node
/*
 * decode-entities.mjs — `&eacute;` becomes `é`, everywhere at once.
 *
 * The static site was authored with HTML entities for every accented letter.
 * Everything here is UTF-8 and has been since the migration, so the escaping
 * buys nothing and makes the CMS hard to use: the copy editor shows
 * `L'&eacute;diteur fran&ccedil;ais`, the page builder labels a block
 * "Footer: La prochaine conversation de votre &eacute;quipe m&eacute;rite", and
 * searching the strings for "équipe" matches nothing.
 *
 * Which entities are decoded, and which four are deliberately not, is decided
 * and explained in tools/lib/entities.mjs.
 *
 * ── Why the source files and the database together ──────────────────────────
 *
 * `verify-live` proves the running site still ships the bytes the pages were
 * authored with, by rendering the authored template against the authored
 * catalogue and diffing. Decoding one side and not the other would make that
 * check fail on every page — and it would be right to. So both sides move in the
 * same pass, with the same function, and the fidelity hashes are re-pinned
 * afterwards. The guarantee is not weakened; the baseline is corrected.
 *
 *   node tools/decode-entities.mjs                 # dry run, with a report
 *   node tools/decode-entities.mjs --confirm       # source files + database
 *   node tools/decode-entities.mjs --source-only --confirm
 *
 * Re-runnable: a second pass finds nothing and writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, credentials } from './lib/env.mjs';
import { decodeEntities, decodeDeep, entitiesIn } from './lib/entities.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'content-source');

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

const tally = new Map();
function record(entities) {
  for (const [entity, n] of entities) tally.set(entity, (tally.get(entity) || 0) + n);
}

/* ── The authored files ───────────────────────────────────────────────────── */

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function decodeSource() {
  let files = 0;
  let replacements = 0;

  for (const file of walk(SRC)) {
    const ext = path.extname(file);
    if (ext !== '.html' && ext !== '.json') continue;

    const before = fs.readFileSync(file, 'utf8');
    let after;

    if (ext === '.json') {
      /*
       * Parsed and re-serialised, not string-replaced.
       *
       * A catalogue's *keys* carry the same entity-derived spelling as its
       * values (`l-diteur-fran-ais-des`), and a blind text replace would leave
       * them alone only by luck. Walking the parsed value makes "values only"
       * a property of the code rather than of the file's punctuation.
       */
      let parsed;
      try {
        parsed = JSON.parse(before);
      } catch (err) {
        console.log(`  ${c.red('skipped')}     ${path.relative(ROOT, file)}: ${err.message}`);
        continue;
      }
      const decoded = decodeDeep(parsed);
      if (decoded === parsed) continue;
      record(entitiesIn(before));
      // Two-space JSON, and a trailing newline, which is how these files are
      // written. Re-serialising with different formatting would show up as a
      // whole-file diff and hide what actually changed.
      after = `${JSON.stringify(decoded, null, 2)}\n`;
    } else {
      after = decodeEntities(before);
      if (after === before) continue;
      record(entitiesIn(before));
    }

    const n = [...entitiesIn(before).values()].reduce((a, b) => a + b, 0);
    files++;
    replacements += n;
    console.log(`  ${DRY ? c.yellow('would decode') : c.green('decoded')}  `
      + `${path.relative(ROOT, file)}: ${n}`);
    if (!DRY) fs.writeFileSync(file, after);
  }

  return { files, replacements };
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

/** The strings, in batches, through the endpoint that already guards rich text. */
async function decodeStrings() {
  let changed = 0;
  const LIMIT = 500;
  for (let offset = 0; ; offset += LIMIT) {
    const { items, total } = await call('GET', `/strings?owner=all&limit=${LIMIT}&offset=${offset}`);
    if (!items.length) break;

    const batch = [];
    for (const row of items) {
      const values = {};
      for (const [locale, value] of Object.entries(row.values || {})) {
        const next = decodeDeep(value);
        if (next !== value) values[locale] = next;
      }
      if (Object.keys(values).length) {
        record(entitiesIn(JSON.stringify(row.values)));
        batch.push({ key: row.key, values });
      }
    }
    if (batch.length) {
      changed += batch.length;
      console.log(`  ${DRY ? c.yellow('would decode') : c.green('decoded')}  `
        + `${batch.length} string(s) at offset ${offset}`);
      // 500 rows a request, which is what the endpoint accepts.
      if (!DRY) await call('POST', '/strings/bulk', { items: batch });
    }
    if (offset + LIMIT >= total) break;
  }
  return changed;
}

/** Page blocks: the markup itself, and the label the builder shows. */
async function decodePages() {
  const { items } = await call('GET', '/pages?includeArticles=1');
  let blocks = 0;

  for (const summary of items) {
    const { page } = await call('GET', `/pages/${summary.key}`);
    for (const section of page.sections || []) {
      const html = decodeEntities(section.html || '');
      const label = decodeEntities(section.label || '');
      if (html === (section.html || '') && label === (section.label || '')) continue;
      record(entitiesIn(section.html || ''));
      record(entitiesIn(section.label || ''));
      blocks++;
      console.log(`  ${DRY ? c.yellow('would decode') : c.green('decoded')}  `
        + `${page.key} → "${section.key}"`);
      if (!DRY) {
        await call('PATCH', `/pages/${page.key}/sections/${section.key}`, {
          ...(html !== (section.html || '') ? { html } : {}),
          ...(label !== (section.label || '') ? { label } : {}),
        });
      }
    }

    /*
     * The head, which the section loop does not reach.
     *
     * `headRaw` holds the authored <head> minus the SEO tags, and the pages carry
     * `&eacute;` in their inline styles' content properties and their meta
     * fallbacks. It is not editable through the section endpoints, so it goes
     * through the page's own patch.
     */
    const headRaw = decodeEntities(page.headRaw || '');
    if (headRaw !== (page.headRaw || '')) {
      record(entitiesIn(page.headRaw || ''));
      console.log(`  ${DRY ? c.yellow('would decode') : c.green('decoded')}  ${page.key} → head`);
      if (!DRY) await call('PATCH', `/pages/${page.key}`, { headRaw });
    }
  }
  return blocks;
}

/** The header and the footer, including the copies "restore original" reads. */
async function decodeChrome() {
  const { chrome } = await call('GET', '/chrome');
  if (!chrome) return 0;
  let parts = 0;
  for (const part of ['navbar', 'footer']) {
    const slot = chrome[part] || {};
    const html = decodeEntities(slot.html || '');
    if (html === (slot.html || '')) continue;
    record(entitiesIn(slot.html || ''));
    parts++;
    console.log(`  ${DRY ? c.yellow('would decode') : c.green('decoded')}  chrome → ${part}`);
    if (!DRY) {
      /*
       * No `locale`, deliberately.
       *
       * The chrome patch works out which marked strings an edit changed and
       * writes them to the catalogue for the language given. Here the strings are
       * being decoded in the catalogue too, by `decodeStrings`, and letting the
       * markup pass write them as well would race with that — same value from two
       * directions, and the audit trail would blame the header for a change to
       * the copy. Omitting the locale leaves the markup's own fallback text
       * decoded and the catalogue to its own pass.
       */
      await call('PATCH', `/chrome/${part}`, { html });
    }
  }
  return parts;
}

/** Navigation labels and megamenu copy, which are per-locale maps. */
async function decodeNavigation() {
  const { navigation } = await call('GET', '/navigation/main').catch(() => ({ navigation: null }));
  if (!navigation) return 0;
  const items = decodeDeep(navigation.items || []);
  if (items === (navigation.items || [])) return 0;
  record(entitiesIn(JSON.stringify(navigation.items)));
  console.log(`  ${DRY ? c.yellow('would decode') : c.green('decoded')}  navigation → main`);
  if (!DRY) await call('PATCH', '/navigation/main', { items });
  return 1;
}

/** Articles: title, excerpt, the body and every section. */
async function decodeArticles() {
  const { items } = await call('GET', '/blog?limit=500');
  let posts = 0;
  for (const summary of items) {
    const { post } = await call('GET', `/blog/${summary._id}`);
    const patch = {};
    for (const field of ['title', 'excerpt', 'category', 'coverAlt', 'authorName', 'authorRole', 'bodyHtml']) {
      const next = decodeEntities(post[field] || '');
      if (next !== (post[field] || '')) patch[field] = next;
    }
    const sections = decodeDeep(post.sections || []);
    if (sections !== (post.sections || [])) patch.sections = sections;
    const seo = decodeDeep(post.seo || {});
    if (seo !== (post.seo || {})) patch.seo = seo;

    if (!Object.keys(patch).length) continue;
    record(entitiesIn(JSON.stringify(post)));
    posts++;
    console.log(`  ${DRY ? c.yellow('would decode') : c.green('decoded')}  article "${post.slug}" [${post.locale}]`);
    if (!DRY) await call('PATCH', `/blog/${summary._id}`, patch);
  }
  return posts;
}

/**
 * The locale labels in Settings.
 *
 * Not entity-encoded — worse. They had the accents *stripped*: "Francais",
 * "Espanol". Whoever seeded them avoided the encoding problem by avoiding the
 * characters, and the language switcher has said "Francais" ever since.
 */
const LOCALE_LABELS = {
  fr: { label: 'French', nativeLabel: 'Français' },
  en: { label: 'English', nativeLabel: 'English' },
  de: { label: 'German', nativeLabel: 'Deutsch' },
  es: { label: 'Spanish', nativeLabel: 'Español' },
  it: { label: 'Italian', nativeLabel: 'Italiano' },
  nl: { label: 'Dutch', nativeLabel: 'Nederlands' },
  pt: { label: 'Portuguese', nativeLabel: 'Português' },
};

async function decodeSettings() {
  const { settings } = await call('GET', '/settings');
  if (!settings) return 0;
  const locales = (settings.locales || []).map((l) => {
    const known = LOCALE_LABELS[l.code];
    const decoded = { ...l, label: decodeEntities(l.label || ''), nativeLabel: decodeEntities(l.nativeLabel || '') };
    if (!known) return decoded;
    // Only where the stored value is the accent-stripped spelling of the right
    // word: a label somebody deliberately renamed is left as they left it.
    const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
    return {
      ...decoded,
      label: strip(decoded.label) === strip(known.label) ? known.label : decoded.label,
      nativeLabel: strip(decoded.nativeLabel) === strip(known.nativeLabel)
        ? known.nativeLabel
        : decoded.nativeLabel,
    };
  });
  if (JSON.stringify(locales) === JSON.stringify(settings.locales)) return 0;
  const changed = locales
    .filter((l, i) => JSON.stringify(l) !== JSON.stringify(settings.locales[i]))
    .map(l => `${l.code}: ${l.nativeLabel}`);
  console.log(`  ${DRY ? c.yellow('would fix') : c.green('fixed')}     locale labels — ${changed.join(', ')}`);
  if (!DRY) await call('PUT', '/settings', { locales });
  return 1;
}

/* ── Run ──────────────────────────────────────────────────────────────────── */

async function main() {
  console.log(c.bold('\nHTML entities in the content'));
  console.log(DRY
    ? c.yellow('DRY RUN — nothing will be written. Re-run with --confirm to apply.\n')
    : c.green('Applying.\n'));

  console.log(c.dim('  the authored files'));
  const source = decodeSource();
  console.log(`  ${source.replacements} entity/entities in ${source.files} file(s)\n`);

  if (SOURCE_ONLY) {
    console.log(c.dim('  --source-only: the database was not touched.\n'));
    return;
  }

  try {
    ({ token } = await call('POST', '/auth/login', credentials(env)));
    console.log(c.dim('  the database'));
    await decodeStrings();
    await decodePages();
    await decodeChrome();
    await decodeNavigation();
    await decodeArticles();
    await decodeSettings();
  } catch (err) {
    console.log(c.red(`\n  database: ${err.message}`));
    console.log(c.dim('  (the source files above were still handled)'));
    process.exitCode = 1;
    return;
  }

  if (tally.size) {
    console.log(c.dim('\n  what was decoded'));
    const rows = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    for (const [entity, n] of rows) console.log(`    ${entity.padEnd(12)} ${n}`);
    if (tally.size > rows.length) console.log(c.dim(`    …and ${tally.size - rows.length} more kinds`));
  }

  if (!DRY) {
    console.log(c.dim('\n  Next: `npm run verify -- --write-hashes` to re-pin the fidelity baseline,'));
    console.log(c.dim('  then `npm run verify:live` against a running server.\n'));
  } else {
    console.log('');
  }
}

main().catch((err) => {
  console.error(c.red(`\n${err.message}\n`));
  process.exit(1);
});
