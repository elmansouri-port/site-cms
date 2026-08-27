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
import { resolveExperiments, writeVisitor, visitorId } from './lib/experiments.js';

const STATIC_PREFIX = /^\/(css|js|images|img|media|assets|favicon|_astro|_image)\b/;

// Routes that live at the root by definition: giving them a locale prefix
// would break every crawler that looks for them where the standard says.
const ROOT_ROUTES = new Set([
  '/robots.txt', '/sitemap.xml', '/sitemap-index.xml', '/favicon.ico', '/healthz',
  // Conventionally at the root, like the two above it: an assistant looks for
  // `/llms.txt` and will not follow a redirect into `/fr/llms.txt`.
  '/llms.txt',
]);

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

  /*
   * 2b. One page, one URL: `/fr/tarifs/` and `/fr/tarifs` may not both answer.
   *
   * Astro's `trailingSlash: 'ignore'` serves both, which is convenient and is
   * duplicate content: two URLs, identical bytes, and every internal link in
   * the authored pages pointing at one of them while the canonical tag named
   * the other. The canonical form is the one without the slash, because the
   * authored `href="/fr/tarifs"` bytes are under the fidelity guarantee and
   * cannot be changed to agree with anything else.
   *
   * A locale root keeps its slash — `/fr/` is the language's home, and
   * `/fr` redirecting to it is the wrong way round.
   */
  if (url.pathname.endsWith('/') && segments.length > 1) {
    return context.redirect(`/${segments.join('/')}${url.search}`, 301);
  }

  // 3. Experiments.
  //
  // The visitor id is minted here and written unconditionally, before any test
  // needs it. Writing it lazily — only once a test was assigned — meant every
  // visitor already on the site was minted fresh on the day a test launched, so
  // its first day was drawn from a different population than the rest of it.
  //
  // Assignment itself is a pure function of that id and the test's salt, so it
  // costs nothing to compute for every running test on every request and there
  // is no per-test cookie to write afterwards.
  const visitor = visitorId(cookies);
  writeVisitor(cookies, visitor);

  const { variants, reasons, paramActive, modes } = resolveExperiments(boot?.experiments || [], {
    url,
    locale,
    visitor: visitor.id,
  });

  // 4. Preview: the CMS sets this cookie through /cms/preview.
  const preview = cookies.get(config.previewCookie)?.value === config.previewSecret;
  // Edit mode only ever follows preview — the annotations are meaningless on a
  // published page and must never reach one.
  const editMode = preview && cookies.get(config.editCookie)?.value === '1';

  locals.locale = locale;
  locals.locales = locales;
  locals.settings = settings;
  locals.navigation = boot?.navigation || { items: [] };
  // One header and footer for the whole site, fetched with the bootstrap so a
  // page render costs no extra round trip.
  locals.chrome = boot?.chrome || null;
  // Named image assets, so `/media/a/<slug>` resolves to the current file.
  locals.assets = boot?.assets || [];
  locals.experiments = boot?.experiments || [];
  locals.variants = variants;
  // Why each arm was chosen — assigned, forced for QA, or held back by the
  // allocation. The page reports only genuinely assigned arms as exposures.
  locals.variantReasons = reasons;
  locals.visitorId = visitor.id;
  locals.preview = preview;
  locals.editMode = editMode;
  // The page route fills this in with the experiments its content depended on.
  locals.usedExperiments = new Set();
  // A campaign entry point must never be indexed (reco.md 3.2).
  locals.noindex = paramActive;

  const response = await next();

  const used = locals.usedExperiments;

  if (paramActive) response.headers.set('x-robots-tag', 'noindex, nofollow');

  const cookieScoped = [...used].some(key => modes[key] !== 'param');
  if (cookieScoped) {
    // This page is one visitor's variant. Without this a CDN would cache the
    // first response and serve that variant to everyone, which ends the
    // experiment without anyone noticing.
    response.headers.set('cache-control', 'private, no-cache, must-revalidate');
    response.headers.append('vary', 'Cookie');
  }
  if (preview) response.headers.set('cache-control', 'no-store');
  return response;
});
