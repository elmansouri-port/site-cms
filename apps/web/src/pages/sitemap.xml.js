/*
 * sitemap.xml — every locale of every indexable page, plus published articles.
 *
 * Built from the API's route index, so a page published in the CMS appears
 * here on the next request. Campaign URLs (`?version=`) and noindex pages are
 * never listed (reco.md 5.4).
 */
export const prerender = false;

import { routeIndex, bootstrap, baseUrlFrom, activeLocales } from '../lib/site.js';
import { pageUrl } from '@rainbow/core/seo';

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function GET({ url }) {
  const [boot, index] = await Promise.all([bootstrap(), routeIndex()]);
  const settings = boot?.settings || {};
  const baseUrl = baseUrlFrom(settings, url);
  const locales = activeLocales(settings);

  const entries = [];

  for (const page of index?.pages || []) {
    if (page.noindex || page.sitemap?.include === false) continue;
    const pageLocales = (page.locales || locales).filter(l => locales.includes(l));
    for (const locale of pageLocales) {
      entries.push({
        loc: pageUrl(baseUrl, locale, page.route),
        lastmod: page.updatedAt,
        changefreq: page.sitemap?.changefreq || 'weekly',
        priority: page.sitemap?.priority ?? 0.7,
        alternates: pageLocales.map(l => ({ locale: l, href: pageUrl(baseUrl, l, page.route) })),
      });
    }
  }

  // Articles that render from the database. The imported one already has a
  // page entry above, so it is skipped here to avoid a duplicate URL.
  const grouped = new Map();
  for (const post of index?.posts || []) {
    if (post.pageKey) continue;
    if (!grouped.has(post.groupId)) grouped.set(post.groupId, []);
    grouped.get(post.groupId).push(post);
  }
  for (const siblings of grouped.values()) {
    for (const post of siblings) {
      if (!locales.includes(post.locale)) continue;
      entries.push({
        loc: pageUrl(baseUrl, post.locale, `blog/${post.slug}`),
        lastmod: post.updatedAt || post.publishedAt,
        changefreq: 'monthly',
        priority: 0.6,
        alternates: siblings
          .filter(s => locales.includes(s.locale))
          .map(s => ({ locale: s.locale, href: pageUrl(baseUrl, s.locale, `blog/${s.slug}`) })),
      });
    }
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.map(e => `  <url>
    <loc>${escape(e.loc)}</loc>${e.lastmod ? `
    <lastmod>${new Date(e.lastmod).toISOString().slice(0, 10)}</lastmod>` : ''}
    <changefreq>${e.changefreq}</changefreq>
    <priority>${Number(e.priority).toFixed(1)}</priority>
${e.alternates.map(a => `    <xhtml:link rel="alternate" hreflang="${a.locale}" href="${escape(a.href)}"/>`).join('\n')}
  </url>`).join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
}
