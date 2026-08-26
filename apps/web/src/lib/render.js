/*
 * render.js — turn a page payload into the parts Astro emits.
 */
import { composeParts } from '@rainbow/core/compose';
import { getKey } from '@rainbow/core/html';
import {
  catalogue as loadCatalogue, alternatesFor, baseUrlFrom, activeLocales, knownRoutes,
  integrationMap,
} from './site.js';
import { navRuntime } from './nav.js';
import { config } from './config.js';

/**
 * Structured data authored inside the template stays translatable: the block
 * carries the i18n key it was marked with, so the locale's version is used.
 */
function resolveJsonLd(page, catalogue) {
  return (page.jsonLd || []).map((entry) => {
    if (entry.i18nKey) {
      const translated = getKey(catalogue, entry.i18nKey);
      if (translated !== undefined) return String(translated);
    }
    return entry.value;
  }).filter(Boolean);
}

/** The object the browser reads as window.__CMS__. */
function runtimeFor({ locale, locales, page, settings, navigation, variants }) {
  return {
    locale,
    locales,
    page: {
      key: page.key,
      route: page.route,
      kind: page.pageKind,
      // Which arm of a page-scoped test produced this document, so session
      // recording and analytics can segment on it the same way they do blocks.
      variant: page.variantKey || null,
    },
    variants,
    // Reshaped into what the shipped megamenu script expects, so the menu is
    // CMS-driven without its markup changing.
    nav: navRuntime(navigation, locale),
    analytics: {
      matomoUrl: settings.analytics?.matomoUrl || '',
      matomoSiteId: settings.analytics?.matomoSiteId || '',
      hotjarId: settings.analytics?.hotjarId || '',
      variantDimensionId: settings.analytics?.variantDimensionId || '1',
    },
  };
}

/**
 * Build the document parts for one request.
 * `astro` is the Astro global (locals, url); `page` is the API payload.
 */
export async function renderPage(astro, page, extra = {}) {
  const { locals, url } = astro;
  const locale = locals.locale;
  const settings = locals.settings || {};
  const locales = activeLocales(settings);
  const baseUrl = baseUrlFrom(settings, url);
  const [catalogue, integrations] = await Promise.all([
    loadCatalogue(locale),
    integrationMap(),
  ]);

  const ctx = {
    locale,
    sourceLocale: settings.sourceLocale || config.sourceLocale,
    baseUrl,
    settings,
    catalogue,
    translations: alternatesFor(page, locales, baseUrl),
    noindex: locals.noindex || page.noindex || locals.preview,
    variants: locals.variants || {},
    // The shared header and footer, and the add-ins, for every page.
    chrome: locals.chrome || null,
    // Third-party endpoints, repointed at this origin by the renderer.
    integrations,
    // Named images, resolved to the file each asset currently holds.
    assets: locals.assets || [],
    // Copy is annotated for inline editing whenever a draft is being previewed;
    // the block overlay and its bridge script are added only in edit mode.
    editMode: !!locals.editMode,
    annotateStrings: !!locals.preview,
    // Which routes actually exist in this locale, so a breadcrumb never links a
    // crawler at an intermediate path that would 404.
    knownRoutes: await knownRoutes(locale),
    runtime: runtimeFor({
      locale,
      locales,
      page,
      settings,
      navigation: locals.navigation,
      variants: locals.variants || {},
    }),
    ...extra,
  };

  const pageForCompose = { ...page, jsonLd: resolveJsonLd(page, catalogue) };
  return composeParts(pageForCompose, ctx);
}
