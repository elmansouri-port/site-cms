/*
 * content.js — everything the frontend needs to render one request.
 *
 * The public surface is deliberately small: a bootstrap payload (settings,
 * locales, navigation), a page payload, and the compiled catalogue. Each is
 * cached under the site revision, so a publish invalidates all three at once
 * and the frontend never has to know which key to purge.
 */
import { Page, Settings, Navigation, BlogPost, Redirect, Experiment } from '../models/index.js';
import { cached } from '../lib/redis.js';
import { LOCALES } from '@rainbow/core/locales';

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
      { key: 1, route: 1, locales: 1, noindex: 1, sitemap: 1, pageKind: 1, updatedAt: 1, _id: 0 }).lean();
    const posts = await BlogPost.find({ status: 'published' },
      { slug: 1, locale: 1, groupId: 1, updatedAt: 1, publishedAt: 1, pageKey: 1, _id: 0 }).lean();
    return { pages, posts };
  });
}

function pageCacheKey(route, locale, preview) {
  return `page:${preview ? 'draft' : 'live'}:${locale}:${route || '_root'}`;
}

/** One page, ready to render. */
export async function getPagePayload(route, locale, { preview = false } = {}) {
  const key = pageCacheKey(route, locale, preview);
  const producer = async () => {
    const filter = preview ? { route } : { route, status: 'published' };
    const page = await Page.findOne(filter).lean();
    if (!page) return null;
    if (!preview && page.locales?.length && !page.locales.includes(locale)) return null;
    return shapePage(page, locale);
  };
  return preview ? producer() : cached(key, CACHE_TTL, producer);
}

export async function getPageByKey(key, locale, { preview = false } = {}) {
  const producer = async () => {
    const filter = preview ? { key } : { key, status: 'published' };
    const page = await Page.findOne(filter).lean();
    return page ? shapePage(page, locale) : null;
  };
  // The article template is fetched by key on every database-backed article,
  // so it earns the same cache the route lookup gets.
  return preview ? producer() : cached(`page-key:${locale}:${key}`, CACHE_TTL, producer);
}

/**
 * Reduce the stored document to the single locale being rendered: the frontend
 * should never receive four languages of metadata to throw three away.
 */
export function shapePage(page, locale) {
  const seoMap = page.seo || {};
  const seo = seoMap[locale] || seoMap[page.locales?.[0]] || {};
  return {
    key: page.key,
    route: page.route,
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
        anchorId: s.anchorId,
        visible: s.visible,
        html: s.html,
        componentKey: s.componentKey,
        data: s.data,
        layout: s.layout,
        experiment: s.experiment && s.experiment.key ? s.experiment : null,
      })),
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
      mode: e.mode,
      paramName: e.paramName,
      cookieDays: e.cookieDays,
      variants: e.variants,
    }));
  });
}
