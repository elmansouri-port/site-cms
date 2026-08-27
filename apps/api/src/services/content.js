/*
 * content.js — everything the frontend needs to render one request.
 *
 * The public surface is deliberately small: a bootstrap payload (settings,
 * locales, navigation), a page payload, and the compiled catalogue. Each is
 * cached under the site revision, so a publish invalidates all three at once
 * and the frontend never has to know which key to purge.
 */
import {
  Page, Settings, Navigation, BlogPost, Redirect, Experiment, Chrome, Integration, Media,
} from '../models/index.js';
import { cached } from '../lib/redis.js';
import { LOCALES } from '@rainbow/core/locales';
import { routeFor } from '@rainbow/core/seo';
import { leadingTrivia } from '@rainbow/core/compose';
import { attachForms, formIndex } from './forms.js';

const CACHE_TTL = 300;

export async function getSettings() {
  const doc = await Settings.findOne({ key: 'global' }).lean();
  if (doc) return doc;
  return Settings.create({ key: 'global', locales: LOCALES.map((l, i) => ({ ...l, order: i })) }).then(d => d.toObject());
}

export function settingsCached() {
  return cached('settings', CACHE_TTL, getSettings);
}

/** Locales that are routed and indexed. */
export async function activeLocaleCodes() {
  const s = await settingsCached();
  const list = (s.locales || []).filter(l => l.active).map(l => l.code);
  return list.length ? list : ['fr'];
}

/**
 * The site's header and footer, and its add-ins.
 *
 * One document for the whole site, so it is read once per revision and shared
 * by every page render — which is also why consolidating it was worth doing:
 * eighteen copies of a footer were eighteen things to keep in step.
 */
export function chromeCached(key = 'default') {
  return cached(`chrome:${key}`, CACHE_TTL, async () => {
    const doc = await Chrome.findOne({ key }).lean();
    return doc || null;
  });
}

/**
 * The outbound endpoints the renderer has to repoint, as `{slug, url}`.
 *
 * Never exposed on a public route: the whole point of the proxy is that the
 * automation host does not reach the browser. The frontend reads this over the
 * server-only endpoint, authenticated with the shared revalidate secret.
 */
export function integrationsCached() {
  return cached('integrations', CACHE_TTL, async () => {
    const rows = await Integration.find({ enabled: true }, { slug: 1, url: 1, _id: 0 }).lean();
    return rows;
  });
}

/**
 * Named image assets, as `{slug, url, aliases}`.
 *
 * Read once per revision and handed to the renderer, which turns every
 * `/media/a/<slug>` in the markup into the file the asset currently holds. That
 * is what makes replacing one image update every page that uses it.
 *
 * Unlike the endpoint map this is safe to expose: it contains only URLs that
 * already appear in the rendered HTML.
 */
export function assetsCached() {
  return cached('assets', CACHE_TTL, async () => {
    const rows = await Media.find(
      { slug: { $nin: [null, ''] } },
      { slug: 1, url: 1, aliases: 1, _id: 0 },
    ).lean();
    return rows;
  });
}

export function navigationCached(key = 'main') {
  return cached(`nav:${key}`, CACHE_TTL, async () => {
    const doc = await Navigation.findOne({ key }).lean();
    return doc || { key, items: [] };
  });
}

/**
 * Every routable page, with the locales it exists in — the frontend builds
 * hreflang, the language switcher and the sitemap from this one payload.
 */
export function routeIndexCached() {
  return cached('routes', CACHE_TTL, async () => {
    const pages = await Page.find({ status: 'published' },
      {
        key: 1, route: 1, routes: 1, locales: 1, noindex: 1, sitemap: 1, pageKind: 1,
        updatedAt: 1, experiment: 1, _id: 0,
      }).lean();
    const posts = await BlogPost.find({ status: 'published' },
      { slug: 1, locale: 1, groupId: 1, updatedAt: 1, publishedAt: 1, pageKey: 1, _id: 0 }).lean();
    // A page serving as somebody else's variant arm is not a URL of its own.
    const routable = pages.filter(p => !p.experiment?.variantOf);
    return { pages: routable, posts };
  });
}

/**
 * Localized route → page key, for every locale.
 *
 * Built once per revision because resolving an incoming URL cannot afford a
 * scan: a request for `/de/preise` has to become a page key before anything
 * else happens. Base routes are indexed too, under a flag, so a visitor who
 * arrives on the untranslated path can be redirected to the localized one
 * rather than served a second copy of the page.
 */
export function routeLookupCached() {
  return cached('route-lookup', CACHE_TTL, async () => {
    const pages = await Page.find({ 'experiment.variantOf': null },
      { key: 1, route: 1, routes: 1, locales: 1, status: 1, _id: 0 }).lean();
    /** @type {Record<string, {key: string, canonical: boolean}>} */
    const table = {};
    for (const page of pages) {
      const locales = page.locales?.length ? page.locales : ['fr'];
      for (const locale of locales) {
        const localized = routeFor(page, locale);
        table[`${locale}:${localized}`] = { key: page.key, canonical: true };
        const base = String(page.route || '').replace(/^\/+|\/+$/g, '');
        // Only claim the base route when it is not already this locale's route,
        // and never over another page's canonical entry.
        const baseSlot = `${locale}:${base}`;
        if (base !== localized && !table[baseSlot]) {
          table[baseSlot] = { key: page.key, canonical: false };
        }
      }
    }
    return table;
  });
}

function pageCacheKey(route, locale, preview, variantTag) {
  const arm = variantTag ? `:v=${variantTag}` : '';
  return `page:${preview ? 'draft' : 'live'}:${locale}:${route || '_root'}${arm}`;
}

/**
 * One page, ready to render.
 *
 * `route` is the path as requested. It may be this locale's localized route or
 * the untranslated base route; both resolve to the page, and the payload says
 * which one is canonical so the frontend can redirect the second case rather
 * than serve the same content at two URLs.
 *
 * `variants` is the visitor's assignment for every running experiment. When the
 * page is the control arm of a page-scoped test and the visitor was assigned a
 * different arm, that arm's content is served here — at this URL, with this
 * page's metadata.
 */
export async function getPagePayload(route, locale, { preview = false, variants = {} } = {}) {
  const lookup = await routeLookupCached();
  const hit = lookup[`${locale}:${route}`];

  const producer = async () => {
    // The lookup table is the authority; the raw-route fallback only covers a
    // table that has gone stale. Either way a variant arm is excluded: an arm
    // has content but no address, and its stored `route` is a placeholder that
    // must never resolve.
    const filter = hit ? { key: hit.key } : { route };
    filter['experiment.variantOf'] = null;
    if (!preview) filter.status = 'published';
    const page = await Page.findOne(filter).lean();
    if (!page) return null;
    if (!preview && page.locales?.length && !page.locales.includes(locale)) return null;
    const served = await withPageVariant(page, variants, preview);
    const shaped = shapePage(served.page, locale, {
      requestedRoute: route,
      variantKey: served.variantKey,
    });
    // A block stores which form to show, not the form. Resolving here rather
    // than in the frontend means the block component receives plain data and
    // the article renderer, which cannot mount a component at all, receives the
    // same thing. See services/forms.js.
    shaped.sections = attachForms(shaped.sections, await formIndex());
    return shaped;
  };

  // The assigned arm is part of the identity of the response, so it is part of
  // the cache key: without it the first visitor's variant would be handed to
  // everyone until the revision changed.
  const tag = variantTag(variants);
  return preview ? producer() : cached(pageCacheKey(route, locale, preview, tag), CACHE_TTL, producer);
}

/** A stable, short representation of the assignment set, for cache keys. */
function variantTag(variants) {
  const entries = Object.entries(variants || {}).filter(([, v]) => v);
  if (!entries.length) return '';
  return entries.sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(',');
}

/**
 * Swap in a page-scoped variant when the visitor is assigned to one.
 *
 * Only the content moves: route, SEO, locales and sitemap settings stay the
 * control's, so the variant is invisible in the index and the canonical URL
 * never changes. A variant page that has been deleted or unpublished falls
 * back to the control rather than 404ing mid-experiment.
 */
async function withPageVariant(page, variants, preview) {
  const key = page.experiment?.key;
  if (!key) return { page, variantKey: null };
  const assigned = variants?.[key];
  const own = page.experiment?.variant || 'A';
  if (!assigned || assigned === own) return { page, variantKey: own };

  const filter = { 'experiment.key': key, 'experiment.variant': assigned, 'experiment.variantOf': page.key };
  if (!preview) filter.status = 'published';
  const arm = await Page.findOne(filter).lean();
  if (!arm) return { page, variantKey: own };

  return {
    variantKey: assigned,
    page: {
      ...page,
      doctype: arm.doctype,
      htmlOpen: arm.htmlOpen,
      bodyOpen: arm.bodyOpen,
      bodyOpenRaw: arm.bodyOpenRaw,
      headRaw: arm.headRaw,
      sections: arm.sections,
      snippets: arm.snippets,
      jsonLd: arm.jsonLd,
    },
  };
}

export async function getPageByKey(key, locale, { preview = false } = {}) {
  const producer = async () => {
    const filter = preview ? { key } : { key, status: 'published' };
    const page = await Page.findOne(filter).lean();
    if (!page) return null;
    const shaped = shapePage(page, locale);
    shaped.sections = attachForms(shaped.sections, await formIndex());
    return shaped;
  };
  // The article template is fetched by key on every database-backed article,
  // so it earns the same cache the route lookup gets.
  return preview ? producer() : cached(`page-key:${locale}:${key}`, CACHE_TTL, producer);
}

/**
 * Reduce the stored document to the single locale being rendered: the frontend
 * should never receive four languages of metadata to throw three away.
 */
export function shapePage(page, locale, { requestedRoute = null, variantKey = null } = {}) {
  const seoMap = page.seo || {};
  const seo = seoMap[locale] || seoMap[page.locales?.[0]] || {};
  const localised = routeFor(page, locale);
  const locales = page.locales?.length ? page.locales : [locale];
  // Every locale's own route, so the frontend can build hreflang without
  // needing the whole route table.
  const routes = {};
  for (const code of locales) routes[code] = routeFor(page, code);

  return {
    key: page.key,
    // The route this page answers to in the locale being rendered. Canonical
    // URLs, OG tags and hreflang are all built from it.
    route: localised,
    // The untranslated route, kept so the CMS and the redirect logic can tell
    // an override from the original.
    baseRoute: String(page.route || '').replace(/^\/+|\/+$/g, ''),
    routes,
    // Set when the visitor arrived on a path that is not this locale's route:
    // the frontend answers with a 301 to `route` instead of rendering.
    redirectFrom: requestedRoute !== null && requestedRoute !== localised ? requestedRoute : null,
    // Which A/B arm produced the sections below — exposed to analytics through
    // window.__CMS__ — and the experiment it belongs to, so the frontend knows
    // this page's response actually depends on an assignment.
    variantKey,
    experimentKey: page.experiment?.key || null,
    title: page.title,
    pageKind: page.pageKind,
    type: page.type,
    status: page.status,
    locales: page.locales,
    noindex: page.noindex,
    sitemap: page.sitemap,
    doctype: page.doctype,
    htmlOpen: page.htmlOpen,
    bodyOpen: page.bodyOpen,
    bodyOpenRaw: page.bodyOpenRaw,
    headRaw: page.headRaw,
    seo,
    jsonLd: page.jsonLd || [],
    snippets: page.snippets || {},
    sections: (page.sections || [])
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(s => ({
        key: s.key,
        label: s.label,
        type: s.type,
        role: s.role || null,
        anchorId: s.anchorId,
        visible: s.visible,
        // A chrome placeholder's own markup is history, not content: sending it
        // would put a second copy of the footer in every page payload. Its
        // leading whitespace and comment do travel, because the authored page
        // owns those and the rendered bytes have to keep them.
        html: s.role ? '' : s.html,
        ...(s.role ? { trivia: leadingTrivia(s.html) } : {}),
        componentKey: s.componentKey,
        data: s.data,
        layout: s.layout,
        experiment: s.experiment && s.experiment.key ? s.experiment : null,
      })),
    chrome: {
      navbar: page.chrome?.navbar !== false,
      footer: page.chrome?.footer !== false,
    },
    updatedAt: page.updatedAt,
  };
}

export function redirectsCached() {
  return cached('redirects', CACHE_TTL, async () => {
    const rows = await Redirect.find({ active: true }, { from: 1, to: 1, status: 1, _id: 0 }).lean();
    return rows;
  });
}

export function experimentsCached() {
  return cached('experiments', CACHE_TTL, async () => {
    const rows = await Experiment.find({ status: 'running' }).lean();
    return rows.map(e => ({
      key: e.key,
      pageKey: e.pageKey,
      scope: e.scope || 'block',
      mode: e.mode,
      paramName: e.paramName,
      cookieDays: e.cookieDays,
      variants: e.variants,
    }));
  });
}
