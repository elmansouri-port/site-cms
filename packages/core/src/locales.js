/*
 * locales.js — the one place that knows which languages exist.
 *
 * The templates are authored in French, so `fr` is the source locale: it is the
 * language whose copy sits in the markup and against which every other locale
 * is spliced. `active: false` locales are seeded in the CMS but never routed,
 * listed in the sitemap, or given an hreflang entry — an incomplete
 * translation must not advertise itself (reco.md 4.2).
 */
export const SOURCE_LOCALE = 'fr';
export const DEFAULT_LOCALE = 'fr';

export const LOCALES = [
  { code: 'fr', label: 'Francais', nativeLabel: 'Francais', active: true },
  { code: 'en', label: 'English', nativeLabel: 'English', active: true },
  { code: 'de', label: 'German', nativeLabel: 'Deutsch', active: true },
  { code: 'es', label: 'Spanish', nativeLabel: 'Espanol', active: false },
  { code: 'it', label: 'Italian', nativeLabel: 'Italiano', active: false },
];

export const activeLocales = () => LOCALES.filter(l => l.active).map(l => l.code);
