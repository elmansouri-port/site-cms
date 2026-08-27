/*
 * Configuration is read at RUNTIME, not at build time.
 *
 * Vite inlines `import.meta.env` when it builds, so anything read from it is
 * frozen to whatever the build machine had — which is both wrong (the
 * container's API_URL would be ignored) and unsafe (a build-time secret would
 * be baked into the bundle). process.env therefore wins, and import.meta.env
 * is only a fallback for `astro dev`, where there is no separate runtime.
 */
const env = (key, fallback = '') => {
  const v = process.env?.[key] ?? import.meta.env?.[key];
  return v === undefined || v === '' ? fallback : v;
};

export const config = {
  apiUrl: String(env('API_URL', 'http://localhost:4000')).replace(/\/+$/, ''),
  siteUrl: String(env('SITE_URL', 'http://localhost:3000')).replace(/\/+$/, ''),
  previewSecret: env('PREVIEW_SECRET', 'dev-preview-secret'),
  revalidateSecret: env('REVALIDATE_SECRET', 'dev-revalidate-secret'),
  // Seconds the frontend keeps a content payload before asking the API again.
  cacheTtl: Number(env('WEB_CACHE_TTL', 30)),
  defaultLocale: env('DEFAULT_LOCALE', 'fr'),
  sourceLocale: env('SOURCE_LOCALE', 'fr'),
  // One id for the whole site. Assignment is a pure function of it, so there
  // is no longer a cookie per test.
  visitorCookie: 'rbw_vid',
  localeCookie: 'lang',
  previewCookie: 'rbw_preview',
  // Preview plus the visual editor's block annotations and bridge script.
  editCookie: 'rbw_edit',
};
