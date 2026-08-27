/*
 * llms.txt — a plain-text map of the site for language models.
 *
 * The convention (llmstxt.org) is a Markdown file at the root: a title, a
 * one-line description, then linked sections. It is read by some AI crawlers
 * and assistants when deciding what a site is and which pages are worth
 * fetching.
 *
 * Worth being straight about what this is and is not: Google Search ignores it,
 * and it is not a ranking signal anywhere. It costs one generated route and it
 * is the file an assistant looks for when it wants a summary rather than a
 * crawl, which is a growing share of how a B2B site gets read at all.
 *
 * Built from the same route index as sitemap.xml, deliberately — a hand-written
 * llms.txt is out of date the first time somebody publishes a page, and two
 * lists of the site's URLs that can disagree are worse than one.
 */
export const prerender = false;

import { routeIndex, bootstrap, baseUrlFrom, activeLocales, blogList } from '../lib/site.js';
import { pageUrl, pageUrlFor, blogSegmentFor } from '@rainbow/core/seo';

/**
 * The order pages are presented in, which is the only editorial judgement in
 * this file: an assistant reading top-down should meet the product before the
 * unsubscribe form.
 */
const KIND_ORDER = ['home', 'product', 'pricing', 'blogIndex', 'page', 'form', 'error'];

const KIND_HEADING = {
  home: 'Start here',
  product: 'Products',
  pricing: 'Pricing',
  blogIndex: 'Blog',
  page: 'Company and support',
};

/** Markdown link text must not contain unescaped brackets. */
const clean = (s) => String(s || '').replace(/[\r\n]+/g, ' ').replace(/([[\]])/g, '\\$1').trim();

export async function GET({ url }) {
  const [boot, index] = await Promise.all([bootstrap(), routeIndex()]);
  const settings = boot?.settings || {};
  const baseUrl = baseUrlFrom(settings, url);
  const locales = activeLocales(settings);

  /*
   * One locale for the body of the file.
   *
   * A single list interleaving three languages reads as three near-duplicate
   * sites, which is the opposite of what this file is for. The other languages
   * are named at the end so a reader knows they exist and how their URLs are
   * shaped.
   */
  const primary = settings.sourceLocale && locales.includes(settings.sourceLocale)
    ? settings.sourceLocale
    : locales[0];

  const lines = [];
  lines.push(`# ${clean(settings.siteName) || 'Rainbow by ALE'}`);
  lines.push('');

  const summary = clean(settings.defaultDescription) || clean(settings.organizationName);
  if (summary) {
    lines.push(`> ${summary}`);
    lines.push('');
  }

  if (settings.llmsNote) {
    lines.push(clean(settings.llmsNote));
    lines.push('');
  }

  /* ── Pages ──────────────────────────────────────────────────────────────── */

  const pages = (index?.pages || [])
    // The same exclusions as the sitemap: a page nobody should index is a page
    // nobody should be pointed at here either.
    .filter(p => !p.noindex && p.sitemap?.include !== false)
    .filter(p => (p.locales || locales).includes(primary));

  const grouped = new Map();
  for (const page of pages) {
    const kind = KIND_HEADING[page.pageKind] ? page.pageKind : 'page';
    if (!grouped.has(kind)) grouped.set(kind, []);
    grouped.get(kind).push(page);
  }

  for (const kind of KIND_ORDER) {
    const bucket = grouped.get(kind);
    if (!bucket?.length) continue;
    lines.push(`## ${KIND_HEADING[kind]}`);
    lines.push('');
    for (const page of bucket) {
      const href = pageUrlFor(baseUrl, primary, page);
      // The public SEO title, not the CMS's own label for the page: an
      // assistant should read "Rainbow pricing and plans", not "Pricing page".
      const meta = page.meta?.[primary] || {};
      const title = clean(meta.title) || clean(page.title) || href;
      const note = clean(meta.description);
      lines.push(`- [${title}](${href})${note ? `: ${note}` : ''}`);
    }
    lines.push('');
  }

  /* ── Articles ───────────────────────────────────────────────────────────── */

  /*
   * Fetched rather than taken from the route index, because the index carries
   * slugs and dates but not titles, and a list of URLs with no titles is not
   * something a model can choose from. Capped: this file is a map, and an
   * assistant that wants everything has the sitemap.
   */
  let posts = [];
  try {
    const result = await blogList(primary, { limit: '50' });
    posts = result?.items || [];
  } catch (err) {
    console.warn('[llms.txt] could not load articles:', err.message);
  }

  if (posts.length) {
    const segment = blogSegmentFor(settings, primary);
    lines.push('## Articles');
    lines.push('');
    for (const post of posts) {
      const href = pageUrl(baseUrl, primary, `${segment}/${post.slug}`);
      const note = clean(post.excerpt);
      lines.push(`- [${clean(post.title)}](${href})${note ? `: ${note}` : ''}`);
    }
    lines.push('');
  }

  /* ── The other languages ────────────────────────────────────────────────── */

  const others = locales.filter(l => l !== primary);
  if (others.length) {
    lines.push('## Other languages');
    lines.push('');
    lines.push(`This site is published in ${locales.join(', ')}. Each language has its own`);
    lines.push('URLs rather than a translated copy of one path — the German pricing page is');
    lines.push('not the French path with a different prefix.');
    lines.push('');
    for (const locale of others) {
      lines.push(`- [${locale.toUpperCase()}](${pageUrl(baseUrl, locale, '')})`);
    }
    lines.push('');
  }

  lines.push('## Machine-readable');
  lines.push('');
  lines.push(`- [Sitemap](${baseUrl}/sitemap.xml): every URL, every language, with hreflang.`);
  lines.push(`- [robots.txt](${baseUrl}/robots.txt)`);
  lines.push('');

  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
}
