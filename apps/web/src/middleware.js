/*
 * middleware.js — everything that must happen before a page renders.
 *
 *   1. CMS-managed redirects
 *   2. locale routing: `/` and legacy locale-less URLs land on a prefixed URL
 *   3. A/B variant assignment, so the rendered HTML already is the variant
 *   4. preview mode, driven by a signed cookie the CMS sets
 *
 * Order matters: a redirect must not pay for an experiment lookup, and the
 * locale has to be known before anything reads content.
 */
import { defineMiddleware } from 'astro:middleware';
import { bootstrap, activeLocales } from './lib/site.js';
import { config } from './lib/config.js';
import { resolveExperiments, writeAssignments } from './lib/experiments.js';

const STATIC_PREFIX = /^\/(css|js|images|img|media|assets|favicon|_astro|_image)\b/;

// Routes that live at the root by definition: giving them a locale prefix
// would break every crawler that looks for them where the standard says.
const ROOT_ROUTES = new Set(['/robots.txt', '/sitemap.xml', '/sitemap-index.xml', '/favicon.ico', '/healthz']);

function detectLocale(request, cookies, locales) {
  const cookie = cookies.get(config.localeCookie)?.value;
  if (cookie && locales.includes(cookie)) return cookie;

  const header = request.headers.get('accept-language') || '';
  for (const part of header.split(',')) {
    const code = part.trim().split(';')[0].slice(0, 2).toLowerCase();
    if (locales.includes(code)) return code;
  }
  return locales.includes(config.defaultLocale) ? config.defaultLocale : locales[0];
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, cookies, locals } = context;

  if (STATIC_PREFIX.test(url.pathname)) return next();
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cms/')) return next();
  if (ROOT_ROUTES.has(url.pathname)) return next();

  let boot;
  try {
    boot = await bootstrap();
  } catch (err) {
    console.error('[middleware] content API unavailable:', err.message);
    return new Response('The site is temporarily unavailable.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '30' },
    });
  }

  const settings = boot?.settings || {};
  const locales = activeLocales(settings);

  // 1. Redirects managed in the CMS.
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const redirect = (boot?.redirects || []).find(r => r.from.replace(/\/+$/, '') === path);
  if (redirect) return context.redirect(redirect.to, redirect.status || 301);

  // 2. Locale prefix. Every public URL carries one (reco.md 4.1).
  const segments = url.pathname.split('/').filter(Boolean);
  const first = segments[0];
  if (!locales.includes(first)) {
    const locale = detectLocale(request, cookies, locales);
    const rest = segments.join('/');
    const target = `/${locale}${rest ? `/${rest}` : ''}${url.search}`;
    return context.redirect(target, 302);
  }
  const locale = first;

  // 3. Experiments: assigned once, then stable for the cookie's lifetime.
  const { variants, assignments, paramActive, cookieScoped } = resolveExperiments(boot?.experiments || [], {
    cookies,
    url,
  });
  writeAssignments(cookies, assignments);

  // 4. Preview: the CMS sets this cookie through /cms/preview.
  const preview = cookies.get(config.previewCookie)?.value === config.previewSecret;

  locals.locale = locale;
  locals.locales = locales;
  locals.settings = settings;
  locals.navigation = boot?.navigation || { items: [] };
  locals.experiments = boot?.experiments || [];
  locals.variants = variants;
  locals.preview = preview;
  // A campaign entry point must never be indexed (reco.md 3.2).
  locals.noindex = paramActive;

  const response = await next();
  if (paramActive) response.headers.set('x-robots-tag', 'noindex, nofollow');
  if (cookieScoped) {
    // The page is one visitor's variant. Without this a CDN would cache the
    // first response and serve that variant to everyone, which ends the
    // experiment without anyone noticing.
    response.headers.set('cache-control', 'private, no-cache, must-revalidate');
    response.headers.append('vary', 'Cookie');
  }
  if (preview) response.headers.set('cache-control', 'no-store');
  return response;
});
