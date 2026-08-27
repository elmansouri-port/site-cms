/*
 * site.js — content lookups, expressed the way a page render needs them.
 */
import { apiGet } from './api.js';
import { config } from './config.js';
import { pageUrlFor, routeFor, blogSegmentFor } from '@rainbow/core/seo';
import { linkTargets } from '@rainbow/core/links';

export const bootstrap = () => apiGet('/api/v1/site/bootstrap', { ttl: 30 });

/**
 * The endpoint map the renderer uses to repoint third-party calls at this
 * origin.
 *
 * Gated on the API side, because the upstream URLs are precisely what the proxy
 * keeps out of the browser. The shared secret goes in a header, server to
 * server, and never reaches a page. A failure here is not fatal: the pages then
 * render with their authored endpoints, which is what they did before — worth
 * logging, not worth a 503.
 */
export function integrationMap() {
  return apiGet('/api/v1/site/integrations', {
    ttl: 60,
    headers: { 'x-cms-secret': config.revalidateSecret },
  }).then(r => r?.items || []).catch((err) => {
    console.warn('[integrations] endpoint map unavailable:', err.message);
    return [];
  });
}
export const routeIndex = () => apiGet('/api/v1/site/routes', { ttl: 60 });
export const catalogue = (locale) => apiGet(`/api/v1/site/catalogue/${locale}`, { ttl: 120 })
  .then(r => r?.catalogue || {});

export function pagePayload(route, locale, preview = false, variants = null) {
  const qs = new URLSearchParams({ route, locale });
  if (preview) qs.set('preview', '1');
  const assigned = serialiseVariants(variants);
  if (assigned) qs.set('variants', assigned);
  return apiGet(`/api/v1/site/page?${qs}`, { preview, ttl: 30 }).then(r => r?.page || null);
}

/** `{hero:'B'}` → `hero=B`. Empty assignments produce nothing at all. */
function serialiseVariants(variants) {
  return Object.entries(variants || {})
    .filter(([, v]) => v)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

/**
 * The set of routes that exist in one locale.
 *
 * Used for breadcrumbs, where linking an intermediate path that has no page
 * would send a crawler to a 404. Cached alongside the route index it comes
 * from, so this costs nothing per request.
 */
export async function knownRoutes(locale) {
  const index = await routeIndex().catch(() => null);
  const set = new Set();
  for (const page of index?.pages || []) {
    if (page.locales?.length && !page.locales.includes(locale)) continue;
    set.add(routeFor(page, locale));
  }
  return set;
}

/**
 * Where every `page:<key>` and `post:<slug>` reference points in one locale.
 *
 * Built from the same route index the resolver uses, so a link and a canonical
 * URL cannot disagree about where a page lives. Cached with that index, so this
 * costs nothing per request.
 */
export async function linkMap(settings, locale) {
  const index = await routeIndex().catch(() => null);
  if (!index) return new Map();
  return linkTargets({
    pages: index.pages || [],
    posts: index.posts || [],
    locale,
    blogSegment: blogSegmentFor(settings, locale),
    routeFor,
  });
}

/** The blog's URL segment in this locale (`blog` unless Settings overrides it). */
export function blogSegment(settings, locale) {
  return blogSegmentFor(settings, locale);
}

export function blogList(locale, params = {}) {
  const qs = new URLSearchParams({ locale, ...params });
  return apiGet(`/api/v1/site/blog?${qs}`, { ttl: 60 });
}

export function blogPost(slug, locale, preview = false) {
  const qs = new URLSearchParams({ locale });
  if (preview) qs.set('preview', '1');
  return apiGet(`/api/v1/site/blog/${encodeURIComponent(slug)}?${qs}`, { preview, ttl: 60 });
}

/**
 * hreflang alternates for a page: only the locales the page is actually
 * available in, never a fallback pointing at another language (reco.md 4.2).
 */
export function alternatesFor(page, locales, baseUrl) {
  const available = (page.locales || []).filter(l => locales.includes(l));
  // Each locale gets its own localized path, which is the whole point of
  // hreflang: pointing every language at the French slug would tell Google the
  // German page is at a URL that redirects.
  return available.map(locale => ({ locale, url: pageUrlFor(baseUrl, locale, page) }));
}

export function baseUrlFrom(settings, requestUrl) {
  if (settings?.baseUrl) return settings.baseUrl.replace(/\/+$/, '');
  if (config.siteUrl) return config.siteUrl;
  const u = new URL(requestUrl);
  return `${u.protocol}//${u.host}`;
}

/** Locale codes that are routed and indexed. */
export function activeLocales(settings) {
  const list = (settings?.locales || []).filter(l => l.active).map(l => l.code);
  return list.length ? list : [config.defaultLocale];
}
