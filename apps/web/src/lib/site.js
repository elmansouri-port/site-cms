/*
 * site.js — content lookups, expressed the way a page render needs them.
 */
import { apiGet } from './api.js';
import { config } from './config.js';
import { pageUrl } from '@rainbow/core/seo';

export const bootstrap = () => apiGet('/api/v1/site/bootstrap', { ttl: 30 });
export const routeIndex = () => apiGet('/api/v1/site/routes', { ttl: 60 });
export const catalogue = (locale) => apiGet(`/api/v1/site/catalogue/${locale}`, { ttl: 120 })
  .then(r => r?.catalogue || {});

export function pagePayload(route, locale, preview = false) {
  const qs = new URLSearchParams({ route, locale });
  if (preview) qs.set('preview', '1');
  return apiGet(`/api/v1/site/page?${qs}`, { preview, ttl: 30 }).then(r => r?.page || null);
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
  return available.map(locale => ({ locale, url: pageUrl(baseUrl, locale, page.route) }));
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
