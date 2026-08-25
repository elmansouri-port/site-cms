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
import { validate, q } from '../middleware/validate.js';
import { allowPreview } from '../middleware/auth.js';
import { catalogueFor } from '../services/catalogue.js';
import {
  settingsCached, navigationCached, routeIndexCached, getPagePayload, getPageByKey,
  redirectsCached, experimentsCached, activeLocaleCodes,
} from '../services/content.js';
import { BlogPost, Partner } from '../models/index.js';

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
    defaultTitle: s.defaultTitle,
    defaultDescription: s.defaultDescription,
    defaultOgTitle: s.defaultOgTitle,
    defaultOgDescription: s.defaultOgDescription,
    defaultOgImage: s.defaultOgImage,
    organizationName: s.organizationName,
    organizationLogo: s.organizationLogo,
    socialProfiles: s.socialProfiles,
    globalHeadSnippet: s.globalHeadSnippet,
    globalBodySnippet: s.globalBodySnippet,
    globalFooterSnippet: s.globalFooterSnippet,
    analytics: s.analytics,
    robotsExtra: s.robotsExtra,
    maintenanceMode: s.maintenanceMode,
  };
}

siteRouter.get('/bootstrap', asyncHandler(async (req, res) => {
  const [settings, nav, experiments, redirects] = await Promise.all([
    settingsCached(), navigationCached('main'), experimentsCached(), redirectsCached(),
  ]);
  res.set('cache-control', 'public, max-age=30');
  res.json({
    settings: publicSettings(settings),
    navigation: nav,
    experiments,
    redirects,
  });
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
});

siteRouter.get('/page', validate(pageQuery, 'query'), asyncHandler(async (req, res) => {
  const { route, key, locale, preview } = q(req);
  const wantsDraft = !!preview && req.previewAllowed;
  const page = key
    ? await getPageByKey(key, locale, { preview: wantsDraft })
    : await getPagePayload(normaliseRoute(route || ''), locale, { preview: wantsDraft });
  if (!page) throw notFoundError('No page for that route');

  // Which locales this page actually exists in — the frontend turns this into
  // hreflang and never points at a locale that has no translation.
  res.set('cache-control', wantsDraft ? 'no-store' : 'public, max-age=30');
  res.json({ page });
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
});

siteRouter.get('/blog', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const { locale, page, limit, category, tag, q: search } = q(req);
  const filter = { locale, status: 'published', publishedAt: { $lte: new Date() } };
  if (category) filter.category = category;
  if (tag) filter.tags = tag;
  if (search) filter.$or = [
    { title: { $regex: escapeRegex(search), $options: 'i' } },
    { excerpt: { $regex: escapeRegex(search), $options: 'i' } },
  ];

  const [items, total] = await Promise.all([
    BlogPost.find(filter, { bodyHtml: 0, blocks: 0 })
      .sort({ featured: -1, publishedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    BlogPost.countDocuments(filter),
  ]);

  res.set('cache-control', 'public, max-age=60');
  res.json({ items, total, page, pages: Math.ceil(total / limit) || 1 });
}));

siteRouter.get('/blog/:slug', asyncHandler(async (req, res) => {
  const locale = localeParam.parse(req.query.locale || 'fr');
  const wantsDraft = req.query.preview && req.previewAllowed;
  const filter = { slug: req.params.slug, locale };
  if (!wantsDraft) filter.status = 'published';

  const post = await BlogPost.findOne(filter).lean();
  if (!post) throw notFoundError('No such article');

  const siblings = await BlogPost.find(
    { groupId: post.groupId, status: 'published' },
    { locale: 1, slug: 1, _id: 0 },
  ).lean();

  const related = await BlogPost.find(
    { locale, status: 'published', _id: { $ne: post._id } },
    { bodyHtml: 0, blocks: 0 },
  ).sort({ publishedAt: -1 }).limit(3).lean();

  res.set('cache-control', wantsDraft ? 'no-store' : 'public, max-age=60');
  res.json({ post, translations: siblings, related });
}));

/**
 * The partner locator fetches this at the same URL the static site used, so the
 * page's JavaScript is untouched while the data becomes CMS-managed.
 */
siteRouter.get('/partners', asyncHandler(async (req, res) => {
  const partners = await Partner.find({ active: true }, { raw: 1, _id: 0 }).lean();
  res.set('cache-control', 'public, max-age=300');
  res.json(partners.map(p => p.raw));
}));

siteRouter.get('/forms/schema', asyncHandler(async (_req, res) => {
  res.json({
    types: ['whitepaper', 'demo', 'partner', 'booking', 'unsubscribe', 'contact'],
  });
}));

function normaliseRoute(route) {
  return String(route || '').replace(/^\/+|\/+$/g, '');
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
