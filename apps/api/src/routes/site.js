/*
 * site.js — the public content API the Astro frontend reads.
 *
 * Read-only, unauthenticated, cached. The one exception is preview: a request
 * carrying the shared preview secret sees drafts and bypasses the cache, which
 * is how the CMS shows an editor their unpublished work on the real site.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, notFoundError } from '../middleware/error.js';
import { formIndex, formsFor } from '../services/forms.js';
import { validate, q } from '../middleware/validate.js';
import { allowPreview } from '../middleware/auth.js';
import { catalogueFor } from '../services/catalogue.js';
import { countryNames } from '../services/countries.js';
import {
  settingsCached, navigationCached, routeIndexCached, getPagePayload, getPageByKey,
  redirectsCached, experimentsCached, activeLocaleCodes, chromeCached, integrationsCached,
  assetsCached,
} from '../services/content.js';
import { config } from '../config.js';
import { BlogPost, Partner, Redirect } from '../models/index.js';

export const siteRouter = Router();

siteRouter.use(allowPreview);

const localeParam = z.string().min(2).max(5).regex(/^[a-z]{2}(-[A-Z]{2})?$/);

/** Public projection of the settings: never leak internals to the browser. */
function publicSettings(s) {
  return {
    siteName: s.siteName,
    baseUrl: s.baseUrl,
    defaultLocale: s.defaultLocale,
    sourceLocale: s.sourceLocale,
    locales: (s.locales || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    blogSegment: s.blogSegment || {},
    defaultTitle: s.defaultTitle,
    defaultDescription: s.defaultDescription,
    defaultOgTitle: s.defaultOgTitle,
    defaultOgDescription: s.defaultOgDescription,
    defaultOgImage: s.defaultOgImage,
    organizationName: s.organizationName,
    organizationLogo: s.organizationLogo,
    socialProfiles: s.socialProfiles,
    analytics: s.analytics,
    robotsExtra: s.robotsExtra,
    maintenanceMode: s.maintenanceMode,
    /*
     * Whether a submission will be kept, and nothing else about it.
     *
     * The retention period is an internal policy and stays internal; whether
     * anything is stored at all is something a form is entitled to say out loud,
     * and a consent notice that promises the opposite of what happens is worse
     * than no notice.
     */
    leads: { store: s.leads?.store !== false },
  };
}

siteRouter.get('/bootstrap', asyncHandler(async (req, res) => {
  const [settings, nav, experiments, redirects, chrome, assets] = await Promise.all([
    settingsCached(), navigationCached('main'), experimentsCached(), redirectsCached(),
    chromeCached(), assetsCached(),
  ]);
  res.set('cache-control', 'public, max-age=30');
  res.json({
    settings: publicSettings(settings),
    navigation: nav,
    experiments,
    redirects,
    // The header and footer every page renders. This endpoint is public, so it
    // carries only what ends up in the HTML anyway.
    chrome,
    // Named image assets, so the renderer can resolve `/media/a/<slug>`.
    assets,
  });
}));

/**
 * The endpoint map the renderer needs, for the frontend server only.
 *
 * Upstream URLs are exactly what the proxy exists to keep out of the browser,
 * so unlike everything else under /site this route is gated. The frontend
 * already shares the revalidate secret with the API; a browser has no way to
 * present it.
 */
siteRouter.get('/integrations', asyncHandler(async (req, res) => {
  const presented = req.get('x-cms-secret');
  if (!presented || presented !== config.revalidateSecret) {
    throw notFoundError('No such route');
  }
  res.set('cache-control', 'no-store');
  res.json({ items: await integrationsCached() });
}));

siteRouter.get('/catalogue/:locale', asyncHandler(async (req, res) => {
  const locale = localeParam.parse(req.params.locale);
  const catalogue = await catalogueFor(locale);
  res.set('cache-control', 'public, max-age=60');
  res.json({ locale, catalogue });
}));

const pageQuery = z.object({
  route: z.string().max(300).optional(),
  // The article template is fetched by key, since its own route is the one
  // authored article rather than the URL being served.
  key: z.string().max(80).optional(),
  locale: localeParam,
  preview: z.coerce.boolean().optional(),
  // The visitor's A/B assignments, as `experiment=arm` pairs: `hero=B,cta=A`.
  // Passed rather than resolved here because assignment belongs to the request,
  // and the frontend middleware has already done it.
  variants: z.string().max(400).optional(),
});

siteRouter.get('/page', validate(pageQuery, 'query'), asyncHandler(async (req, res) => {
  const { route, key, locale, preview, variants } = q(req);
  const wantsDraft = !!preview && req.previewAllowed;
  const page = key
    ? await getPageByKey(key, locale, { preview: wantsDraft })
    : await getPagePayload(normaliseRoute(route || ''), locale, {
      preview: wantsDraft,
      variants: parseVariants(variants),
    });
  if (!page) throw notFoundError('No page for that route');

  // Which locales this page actually exists in — the frontend turns this into
  // hreflang and never points at a locale that has no translation.
  res.set('cache-control', wantsDraft ? 'no-store' : 'public, max-age=30');
  res.json({ page });
}));

/**
 * The fallback for an asset reference the renderer did not resolve.
 *
 * A reference can escape the render pass — inside a JavaScript string, in copy
 * an editor pasted, in a feed somebody built against the site. Rather than
 * 404ing, the reference resolves here with a redirect to the current file, so a
 * managed image works everywhere even when the fast path missed it.
 */
siteRouter.get('/asset/:slug', asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const assets = await assetsCached();
  const hit = assets.find(a => a.slug === slug)
    || assets.find(a => (a.aliases || []).includes(slug));
  if (!hit) throw notFoundError('No such asset');
  // Short-lived: the target changes when somebody replaces the image, and the
  // file it points at is itself immutable and cached for a month.
  res.set('cache-control', 'public, max-age=60');
  res.redirect(302, hit.url);
}));

/**
 * Record that a redirect was followed.
 *
 * Called by the frontend middleware, server to server, immediately after it
 * matches one — fire-and-forget, so a visitor's redirect never waits for this.
 * Gated on the shared secret for the same reason the integration map is: a
 * counter anybody can drive is a counter nobody can read.
 *
 * The write is a bare `$inc`, with no read first, so concurrent hits cannot lose
 * each other.
 */
siteRouter.post('/redirect-hit', asyncHandler(async (req, res) => {
  if (req.get('x-cms-secret') !== config.revalidateSecret) throw notFoundError('No such route');
  const from = String(req.body?.from || '').slice(0, 500);
  if (!from) return res.status(204).end();
  await Redirect.updateOne({ from }, { $inc: { hits: 1 }, $set: { lastHitAt: new Date() } });
  res.status(204).end();
}));

siteRouter.get('/routes', asyncHandler(async (req, res) => {
  const [index, locales] = await Promise.all([routeIndexCached(), activeLocaleCodes()]);
  res.set('cache-control', 'public, max-age=60');
  res.json({ ...index, locales });
}));

const listQuery = z.object({
  locale: localeParam,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  category: z.string().max(80).optional(),
  tag: z.string().max(80).optional(),
  q: z.string().max(120).optional(),
  /**
   * Ask for the category and tag lists alongside the page of articles.
   *
   * The blog index needs both to draw its filter pills, and it needs them
   * computed over *every* published article rather than the twelve on this page
   * — a pill for a category is only worth showing if something is in it. Two
   * round trips for one screen is worse than one flag.
   */
  facets: z.coerce.boolean().optional(),
  // Leave one article out by slug. The blog index shows its lead article as a
  // large featured card and the rest as a grid; without this the featured one
  // appears twice on the first page.
  exclude: z.string().max(200).optional(),
});

siteRouter.get('/blog', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const { locale, page, limit, category, tag, q: search, facets, exclude } = q(req);
  const filter = { locale, status: 'published', publishedAt: { $lte: new Date() } };
  if (category) filter.category = category;
  if (tag) filter.tags = tag;
  if (exclude) filter.slug = { $ne: exclude };
  if (search) filter.$or = [
    { title: { $regex: escapeRegex(search), $options: 'i' } },
    { excerpt: { $regex: escapeRegex(search), $options: 'i' } },
  ];

  const published = { locale, status: 'published', publishedAt: { $lte: new Date() } };
  const [items, total, categories, tags] = await Promise.all([
    BlogPost.find(filter, { bodyHtml: 0, sections: 0 })
      .sort({ featured: -1, publishedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    BlogPost.countDocuments(filter),
    // Counted, not just listed: a pill saying how many articles are behind it is
    // the difference between a filter and a guess.
    facets
      ? BlogPost.aggregate([
        { $match: published },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ])
      : Promise.resolve(null),
    facets ? BlogPost.distinct('tags', published) : Promise.resolve(null),
  ]);

  res.set('cache-control', 'public, max-age=60');
  res.json({
    items,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    ...(facets ? {
      categories: (categories || [])
        .filter(c => c._id)
        .map(c => ({ name: c._id, count: c.count })),
      tags: (tags || []).filter(Boolean).sort(),
    } : {}),
  });
}));

siteRouter.get('/blog/:slug', asyncHandler(async (req, res) => {
  const locale = localeParam.parse(req.query.locale || 'fr');
  const wantsDraft = req.query.preview && req.previewAllowed;
  const filter = { slug: req.params.slug, locale };
  if (!wantsDraft) filter.status = 'published';

  const post = await BlogPost.findOne(filter).lean();
  if (!post) throw notFoundError('No such article');

  /*
   * An article body is rendered to an HTML string, so a form inside one cannot
   * be a component — it is rendered by the same `renderForm` the page block
   * uses, from the forms sent alongside. Only the ones this article references.
   */
  const forms = formsFor(post.sections, await formIndex());

  const siblings = await BlogPost.find(
    { groupId: post.groupId, status: 'published' },
    { locale: 1, slug: 1, _id: 0 },
  ).lean();

  // Related articles: same category first — that is what "related" means to a
  // reader — then the most recent, so the section is never short of cards.
  const exclude = { bodyHtml: 0, sections: 0 };
  const sameCategory = post.category
    ? await BlogPost.find(
      { locale, status: 'published', category: post.category, _id: { $ne: post._id } },
      exclude,
    ).sort({ publishedAt: -1 }).limit(3).lean()
    : [];
  const seen = new Set(sameCategory.map(p => String(p._id)));
  const filler = sameCategory.length < 3
    ? await BlogPost.find(
      { locale, status: 'published', _id: { $nin: [post._id, ...sameCategory.map(p => p._id)] } },
      exclude,
    ).sort({ publishedAt: -1 }).limit(3 - sameCategory.length).lean()
    : [];
  const related = [...sameCategory, ...filler.filter(p => !seen.has(String(p._id)))];

  res.set('cache-control', wantsDraft ? 'no-store' : 'public, max-age=60');
  res.json({ post, forms, translations: siblings, related });
}));

/**
 * The partner locator fetches this at the same URL the static site used, so the
 * page's JavaScript is untouched while the data becomes CMS-managed.
 *
 * `?locale=` translates the country names. The directory is exported from
 * elsewhere and its country field is English, inconsistently — `USA`, `MEXICO`,
 * `Utd.Arab.Emir.` — and the locator groups its filter dropdown by that value
 * and prints it on every card. So a French visitor was reading a list of English
 * country names with two of them misspelled.
 *
 * Translated here rather than in the page, because the page's script is under
 * the byte-fidelity guarantee, and because the same table then serves anything
 * else that has to name a country.
 */
siteRouter.get('/partners', asyncHandler(async (req, res) => {
  const locale = /^[a-z]{2}$/.test(String(req.query.locale || '')) ? String(req.query.locale) : null;
  const [partners, countries] = await Promise.all([
    Partner.find({ active: true }, { raw: 1, _id: 0 }).lean(),
    locale ? countryNames(locale) : Promise.resolve(null),
  ]);
  res.set('cache-control', 'public, max-age=300');
  res.json(partners.map((p) => {
    const raw = p.raw || {};
    const translated = countries && raw.country ? countries[raw.country] : null;
    return translated ? { ...raw, country: translated } : raw;
  }));
}));

siteRouter.get('/forms/schema', asyncHandler(async (_req, res) => {
  res.json({
    types: ['whitepaper', 'demo', 'partner', 'booking', 'unsubscribe', 'contact'],
  });
}));

function normaliseRoute(route) {
  return String(route || '').replace(/^\/+|\/+$/g, '');
}

/** `hero=B,cta=A` → `{ hero: 'B', cta: 'A' }`. Malformed pairs are ignored. */
function parseVariants(raw) {
  const out = {};
  for (const pair of String(raw || '').split(',')) {
    const [key, value] = pair.split('=');
    if (key && value && /^[\w-]{1,80}$/.test(key) && /^[\w-]{1,20}$/.test(value)) out[key] = value;
  }
  return out;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
