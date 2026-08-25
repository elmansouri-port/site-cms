/*
 * seo.js — turn a page document plus the site settings into the exact tag
 * sequence that goes into <head>.
 *
 * Rules (from reco.md sections 5 and 9):
 *   - canonical is always the current locale's URL, never cross-locale
 *   - x-default always points at the English version
 *   - a locale with no translation gets no hreflang entry at all
 *   - a page reached with ?version= emits noindex, nofollow
 *   - empty fields emit no tag: never content=""
 *   - OG falls back to the global defaults from the CMS settings
 *   - JSON-LD is server rendered, auto-generated per page type, and can be
 *     extended or replaced from the CMS
 */
import { escapeAttr } from './html.js';

const trimSlash = (s) => String(s || '').replace(/\/+$/, '');

export function absoluteUrl(baseUrl, path) {
  if (!path) return trimSlash(baseUrl) + '/';
  if (/^https?:\/\//i.test(path)) return path;
  return trimSlash(baseUrl) + (path.startsWith('/') ? path : '/' + path);
}

/** Public URL of a page in a given locale. */
export function pageUrl(baseUrl, locale, route) {
  const clean = String(route || '').replace(/^\/+|\/+$/g, '');
  const path = clean ? `/${locale}/${clean}/` : `/${locale}/`;
  return trimSlash(baseUrl) + path;
}

function tag(name, attrs) {
  const parts = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
    .map(([k, v]) => `${k}="${escapeAttr(v)}"`);
  if (!parts.length) return '';
  return `<${name} ${parts.join(' ')}>`;
}

/**
 * Build the <head> metadata block.
 *
 * page      { route, seo: {...per locale resolved}, type }
 * ctx       { baseUrl, locale, locales:[{code, active}], translations:{locale:route},
 *             settings, noindex }
 */
export function buildHead(page, ctx) {
  const s = page.seo || {};
  const g = ctx.settings || {};
  const out = [];
  const url = pageUrl(ctx.baseUrl, ctx.locale, page.route);

  const title = s.title || g.defaultTitle || '';
  const description = s.description || g.defaultDescription || '';

  if (title) out.push(`<title>${escapeAttr(title)}</title>`);
  if (description) out.push(tag('meta', { name: 'description', content: description }));
  if (s.keywords) out.push(tag('meta', { name: 'keywords', content: s.keywords }));

  const robots = ctx.noindex ? 'noindex, nofollow' : (s.robots || 'index, follow');
  out.push(tag('meta', { name: 'robots', content: robots }));

  if (!ctx.noindex) {
    out.push(tag('link', { rel: 'canonical', href: s.canonical || url }));
    for (const alt of ctx.translations || []) {
      out.push(tag('link', { rel: 'alternate', hreflang: alt.locale, href: alt.url }));
    }
    const en = (ctx.translations || []).find(t => t.locale === 'en');
    if (en) out.push(tag('link', { rel: 'alternate', hreflang: 'x-default', href: en.url }));
  }

  // Open Graph — per-page values win, global defaults fill the gaps, empty
  // fields emit nothing at all.
  const ogTitle = s.ogTitle || g.defaultOgTitle || title;
  const ogDescription = s.ogDescription || g.defaultOgDescription || description;
  const ogImage = s.ogImage || g.defaultOgImage;
  out.push(tag('meta', { property: 'og:type', content: s.ogType || 'website' }));
  if (ogTitle) out.push(tag('meta', { property: 'og:title', content: ogTitle }));
  if (ogDescription) out.push(tag('meta', { property: 'og:description', content: ogDescription }));
  out.push(tag('meta', { property: 'og:url', content: url }));
  if (g.siteName) out.push(tag('meta', { property: 'og:site_name', content: g.siteName }));
  out.push(tag('meta', { property: 'og:locale', content: ctx.locale }));
  if (ogImage) out.push(tag('meta', { property: 'og:image', content: absoluteUrl(ctx.baseUrl, ogImage) }));

  const twitterCard = s.twitterCard || (ogImage ? 'summary_large_image' : 'summary');
  out.push(tag('meta', { name: 'twitter:card', content: twitterCard }));
  if (s.twitterTitle || ogTitle) out.push(tag('meta', { name: 'twitter:title', content: s.twitterTitle || ogTitle }));
  if (s.twitterDescription || ogDescription) out.push(tag('meta', { name: 'twitter:description', content: s.twitterDescription || ogDescription }));
  if (s.twitterImage || ogImage) out.push(tag('meta', { name: 'twitter:image', content: absoluteUrl(ctx.baseUrl, s.twitterImage || ogImage) }));

  return out.filter(Boolean).map(t => '    ' + t).join('\n');
}

/** Wrap a JSON-LD payload in a script tag. Arrays are emitted one tag each. */
export function jsonLdTag(payload) {
  if (!payload) return '';
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  if (!body.trim()) return '';
  return `    <script type="application/ld+json">\n${body}\n    </script>`;
}

/**
 * Auto-generated structured data per page type (reco.md 5.2), plus whatever the
 * editor added. `replaceAutoLd` swaps the auto block out entirely.
 */
export function buildJsonLd(page, ctx) {
  const s = page.seo || {};
  const g = ctx.settings || {};
  const url = pageUrl(ctx.baseUrl, ctx.locale, page.route);
  const org = {
    '@type': 'Organization',
    name: g.organizationName || g.siteName || 'Rainbow by ALE',
    url: trimSlash(ctx.baseUrl) + '/',
    ...(g.organizationLogo ? { logo: absoluteUrl(ctx.baseUrl, g.organizationLogo) } : {}),
    ...(Array.isArray(g.socialProfiles) && g.socialProfiles.length ? { sameAs: g.socialProfiles } : {}),
  };

  const blocks = [];
  const kind = page.schemaType || page.pageKind || 'page';

  if (kind === 'home') {
    blocks.push({ '@context': 'https://schema.org', ...org });
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: g.siteName || org.name,
      url: trimSlash(ctx.baseUrl) + `/${ctx.locale}/`,
      inLanguage: ctx.locale,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${trimSlash(ctx.baseUrl)}/${ctx.locale}/blog/?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    });
  } else if (kind === 'product') {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: s.title || page.title,
      description: s.description,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, Windows, macOS, iOS, Android',
      url,
      ...(g.organizationName ? { publisher: { '@type': 'Organization', name: g.organizationName } } : {}),
    });
  } else if (kind === 'blogIndex') {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: s.title || page.title,
      description: s.description,
      url,
      inLanguage: ctx.locale,
      publisher: org,
    });
  } else if (kind === 'blogPost') {
    const post = ctx.post || {};
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: s.title || post.title,
      description: s.description || post.excerpt,
      ...(post.coverImage ? { image: [absoluteUrl(ctx.baseUrl, post.coverImage)] } : {}),
      datePublished: post.publishedAt,
      dateModified: post.updatedAt || post.publishedAt,
      author: { '@type': 'Person', name: post.authorName || org.name },
      publisher: org,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      inLanguage: ctx.locale,
    });
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${trimSlash(ctx.baseUrl)}/${ctx.locale}/` },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${trimSlash(ctx.baseUrl)}/${ctx.locale}/blog/` },
        { '@type': 'ListItem', position: 3, name: s.title || post.title, item: url },
      ],
    });
  }

  const tags = [];
  if (!s.replaceAutoLd) {
    for (const b of blocks) tags.push(jsonLdTag(b));
    // Structured data authored inside the original template (kept translatable).
    for (const raw of page.jsonLd || []) tags.push(jsonLdTag(raw));
  }
  if (s.jsonLdOverride) tags.push(jsonLdTag(s.jsonLdOverride));
  return tags.filter(Boolean).join('\n');
}
