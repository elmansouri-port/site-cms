#!/usr/bin/env node
/*
 * blog-index.mjs — turn the static blog page into the blog.
 *
 * The blog index shipped as three authored sections: a hero with nine
 * hard-coded category pills, a featured card about a webinar guide, and twelve
 * article cards. Every one of them was a placeholder. Publishing an article in
 * the CMS changed nothing on this page, two of the cards linked to articles that
 * were never written, and the filter script filtered the placeholders.
 *
 * This replaces those three sections with one `blog_index` component block,
 * which reads the articles that exist (see
 * apps/web/src/components/blocks/BlogIndex.astro). The wording is carried across
 * from the translation catalogue, in all three languages, so the page reads the
 * same the moment it stops being a lie.
 *
 * It also drops the page's category-filter script. That script hid DOM nodes to
 * filter, which is why page two did not exist; filtering is now a URL the server
 * resolves. Its language-switcher half is kept, because that is still needed.
 *
 *   node tools/blog-index.mjs                 # dry run
 *   node tools/blog-index.mjs --confirm       # apply
 *
 * Re-runnable: a second pass finds the block already there and writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, credentials } from './lib/env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'content-source');

const args = process.argv.slice(2);
const DRY = !args.includes('--confirm');
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

/* ── The API ──────────────────────────────────────────────────────────────── */

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

/* ── The copy, from the catalogue the static page used ────────────────────── */

const LOCALES = ['fr', 'en', 'de'];
const catalogues = {};
for (const locale of LOCALES) {
  const file = path.join(SRC, 'i18n', `${locale}.json`);
  if (fs.existsSync(file)) catalogues[locale] = JSON.parse(fs.readFileSync(file, 'utf8'));
}

const at = (obj, key) => String(key).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/**
 * One translated field, built from a catalogue key.
 *
 * Some of the source strings are "rich": the words plus numbered placeholders
 * standing in for an inline `<svg>`. The block draws its own icons, so the
 * placeholders are stripped and only the words are carried over — otherwise the
 * "Read more" button would read `Learn more <0><path …/></0>`.
 */
function i18n(key, fallback = {}) {
  const out = { __i18n: true };
  for (const locale of LOCALES) {
    const raw = at(catalogues[locale], key);
    const value = raw === undefined ? fallback[locale] : raw;
    if (value === undefined || value === null) continue;
    const words = String(value)
      .replace(/<\d+(?:\/>|>[\s\S]*?<\/\d+>)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (words) out[locale] = words;
  }
  return out;
}

/** Literal text, the same in every language (used where no key exists). */
const same = (values) => ({ __i18n: true, ...values });

const BLOCK_DATA = {
  title: i18n('blog.body.blog-rainbow'),
  searchPlaceholder: i18n('blog.body.rechercher-un-article_placeholder'),
  allLabel: i18n('blog.body.toutes-les-categories'),
  recentTitle: i18n('blog.body.articles-recents'),
  recentIntro: i18n('blog.body.consultez-nos-derniers-articles'),
  readMoreLabel: i18n('blog.body.en-savoir-plus-path-stroke-linecap'),
  moreLabel: i18n('blog.body.voir-plus-d-articles'),
  perPage: 12,
  // The static page had no empty state — it could not have one, because its
  // articles were in the markup. A dynamic index needs one for the day a
  // category is emptied or somebody searches for a word nobody wrote.
  emptyTitle: same({
    fr: 'Aucun article trouvé',
    en: 'No articles found',
    de: 'Keine Artikel gefunden',
  }),
  emptyHint: same({
    fr: 'Essayez un autre mot-clé, ou retirez le filtre de catégorie.',
    en: 'Try another keyword, or clear the category filter.',
    de: 'Versuchen Sie ein anderes Stichwort oder entfernen Sie den Kategoriefilter.',
  }),
  /*
   * The promo card, carried over from the authored page.
   *
   * It was a hard-coded "Guide pratique" card next to the featured article, and
   * its download link pointed at `#`. Kept as an editable slot with the same
   * words, and the dead link left empty rather than shipped: an empty href
   * hides the button, which is honest, and `#` is a click that does nothing.
   */
  promo: {
    badge: i18n('blog.body.path-stroke-linecap-round-stroke'),
    title: i18n('blog.body.souverainete-numerique-le-guide'),
    text: i18n('blog.body.donnees-hebergees-en-france'),
    overlay: i18n('blog.body.rainbow-ale-l-avenir-de-la'),
    ctaLabel: i18n('blog.body.telecharger-path-stroke-linecap'),
    href: '',
    image: '',
    imageAlt: i18n('blog.body.guide-rainbow-collaboration_alt'),
  },
};

/* ── What the page should end up as ───────────────────────────────────────── */

// The three authored sections this block replaces, by key.
const REPLACES = ['blog-hero', 'featured-section', 'articles-section'];

/**
 * The page's own filter script, with the article filtering taken out.
 *
 * Its first half closes the language switcher on an outside click and is still
 * needed. Its second half filtered article cards by hiding them, which is not
 * how filtering works any more — and, left in place, it would throw on
 * `getElementById('blog-search-input').addEventListener` the moment the search
 * box moved into a form.
 */
const KEEP_SCRIPT = `
    <script>
        document.addEventListener('click', function (e) {
            var sw = document.getElementById('lang-switcher');
            if (sw && !sw.contains(e.target)) sw.classList.remove('open');
        });
    </script>`;

async function main() {
  console.log(c.bold('\nThe blog index'));
  console.log(DRY
    ? c.yellow('DRY RUN — nothing will be written. Re-run with --confirm to apply.\n')
    : c.green('Applying.\n'));

  ({ token } = await call('POST', '/auth/login', credentials(env)));

  const pageKey = flag('page', 'blog');
  const { page } = await call('GET', `/pages/${pageKey}`);
  const sections = page.sections || [];

  const existing = sections.find(s => s.componentKey === 'blog_index');
  if (existing) {
    console.log(c.dim(`  "${pageKey}" already has a blog_index block ("${existing.key}").`));
    if (!DRY) {
      // Re-running is how the copy is refreshed after the catalogue changes, so
      // the data is written again rather than skipped.
      await call('PATCH', `/pages/${pageKey}/sections/${existing.key}`, { data: BLOCK_DATA });
      console.log(`  ${c.green('refreshed')}   its copy from the catalogue`);
    }
  } else {
    const present = REPLACES.filter(k => sections.some(s => s.key === k));
    if (!present.length) {
      console.log(c.red(`  none of ${REPLACES.join(', ')} are on "${pageKey}" — nothing to replace.`));
      console.log(c.dim('  Pass --page <key> if the blog index lives somewhere else.\n'));
      process.exit(1);
    }

    console.log(`  ${DRY ? c.yellow('would replace') : c.green('replacing')}   ${present.join(', ')}`);
    console.log(`  ${DRY ? c.yellow('would add') : c.green('adding')}       one blog_index block reading the live articles`);

    if (!DRY) {
      // Inserted where the hero was, so the block lands between the navbar and
      // the footer rather than at the end of the document.
      const anchorKey = sections.find(s => s.role === 'navbar')?.key;
      const { section } = await call('POST', `/pages/${pageKey}/sections`, {
        label: 'Blog index',
        type: 'component',
        componentKey: 'blog_index',
        data: BLOCK_DATA,
        ...(anchorKey ? { afterKey: anchorKey } : {}),
      });
      // The authored markup carries its own vertical rhythm, and so does this
      // block: a wrapper adding 80px top and bottom would push the hero away
      // from the header it is supposed to sit under.
      await call('PATCH', `/pages/${pageKey}/sections/${section.key}`, {
        layout: { spacingTop: 'none', spacingBottom: 'none' },
      });
      console.log(`  ${c.green('added')}       "${section.key}"`);

      for (const key of present) {
        await call('DELETE', `/pages/${pageKey}/sections/${key}`);
        console.log(`  ${c.green('removed')}     "${key}"`);
      }
    }
  }

  /* ── The scripts ──────────────────────────────────────────────────────── */

  for (const s of sections) {
    if (s.type !== 'script') continue;
    const html = String(s.html || '');

    // The dead filter script.
    if (html.includes('blog-search-input') || html.includes('.cat-pill')) {
      console.log(`  ${DRY ? c.yellow('would trim') : c.green('trimmed')}    "${s.key}" — the DOM-hiding filter is now a URL`);
      if (!DRY) await call('PATCH', `/pages/${pageKey}/sections/${s.key}`, { html: KEEP_SCRIPT });
      continue;
    }
  }

  /* ── Metadata ─────────────────────────────────────────────────────────── */

  if (page.pageKind !== 'blogIndex' && !DRY) {
    await call('PATCH', `/pages/${pageKey}`, { pageKind: 'blogIndex', type: 'dynamic' });
    console.log(`  ${c.green('marked')}      the page as the blog index`);
  }

  console.log(DRY ? '' : c.dim('\n  Next: check /fr/blog, then `npm run verify:live`.\n'));
}

main().catch((err) => {
  console.error(c.red(`\n${err.message}\n`));
  process.exit(1);
});
