/*
 * blog.js — the dynamic content type.
 *
 * Blog posts are the "Dynamic page" of reco.md 2.2: one template, content
 * entirely from the database, published without a deploy. Each locale is its
 * own document tied to its siblings by groupId, which is what lets hreflang
 * list only the translations that exist.
 */
import { Router } from 'express';
import { z } from 'zod';
import { BlogPost } from '../../models/index.js';
import { asyncHandler, notFoundError, conflict } from '../../middleware/error.js';
import { validate, q } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { snapshot, audit, publishChanged } from '../../services/publish.js';
import { slugify } from '@rainbow/core/html';
import { blogSegmentFor } from '@rainbow/core/seo';
import { settingsCached } from '../../services/content.js';
import { config } from '../../config.js';

export const blogRouter = Router();

blogRouter.use(requireAuth);

const listQuery = z.object({
  locale: z.string().max(5).optional(),
  status: z.enum(['published', 'draft', 'scheduled']).optional(),
  q: z.string().max(120).optional(),
  /*
   * 500, because the link picker asks for every article at once.
   *
   * It was 100, and the picker asked for 200 — so the request was rejected and
   * the picker's article list was silently empty. The rows exclude the body and
   * the sections, so a few hundred of them is a small payload; a cap below what
   * the CMS itself asks for is not a limit, it is a bug.
   */
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

blogRouter.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const { locale, status, q: search, limit, offset } = q(req);
  const filter = {};
  if (locale) filter.locale = locale;
  if (status) filter.status = status;
  if (search) filter.title = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

  const [items, total] = await Promise.all([
    BlogPost.find(filter, { bodyHtml: 0, sections: 0 }).sort({ publishedAt: -1, updatedAt: -1 }).skip(offset).limit(limit).lean(),
    BlogPost.countDocuments(filter),
  ]);
  res.json({ items, total });
}));

blogRouter.get('/:id', asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.id).lean();
  if (!post) throw notFoundError('No such article');
  const translations = await BlogPost.find({ groupId: post.groupId }, { locale: 1, slug: 1, status: 1, title: 1 }).lean();
  res.json({ post, translations });
}));

const postBody = z.object({
  slug: z.string().max(200).optional(),
  locale: z.string().max(5),
  groupId: z.string().max(80).optional(),
  title: z.string().min(1).max(300),
  excerpt: z.string().max(2000).optional(),
  category: z.string().max(80).optional(),
  tags: z.array(z.string().max(60)).optional(),
  coverImage: z.string().max(500).optional(),
  coverAlt: z.string().max(300).optional(),
  authorName: z.string().max(120).optional(),
  authorRole: z.string().max(120).optional(),
  authorAvatar: z.string().max(500).optional(),
  readingMinutes: z.number().int().min(0).max(300).optional(),
  featured: z.boolean().optional(),
  bodyHtml: z.string().max(2_000_000).optional(),
  // The body as an ordered list of sections. Takes precedence over bodyHtml.
  sections: z.array(z.object({
    key: z.string().max(80).optional(),
    type: z.enum(['heading', 'rich', 'keyPoints', 'image', 'quote', 'callout', 'embed', 'form', 'custom']),
    data: z.record(z.string(), z.any()).default({}),
    anchorId: z.string().max(80).nullable().optional(),
    inToc: z.boolean().nullable().optional(),
    tocLabel: z.string().max(200).optional(),
    visible: z.boolean().default(true),
    order: z.number().int().min(0).max(999).optional(),
  })).max(200).optional(),
  status: z.enum(['published', 'draft', 'scheduled']).optional(),
  publishedAt: z.coerce.date().nullable().optional(),
  seo: z.record(z.string(), z.any()).optional(),
  snippets: z.object({
    head: z.string().max(50000).optional(),
    body: z.string().max(50000).optional(),
    footer: z.string().max(50000).optional(),
  }).optional(),
});

/** This locale's blog segment, for revalidation paths. */
async function segmentFor(locale) {
  return blogSegmentFor(await settingsCached(), locale);
}

/**
 * Give every section a stable key.
 *
 * The key is what the anchor and the contents entry are derived from, and what
 * the editor's drag-and-drop reorders by, so it has to survive a save. Sections
 * arriving without one are new; keys already set are left alone.
 */
function withSectionKeys(sections) {
  const taken = new Set((sections || []).map(s => s.key).filter(Boolean));
  return (sections || []).map((section, i) => {
    if (section.key) return { ...section, order: section.order ?? i };
    const base = slugify(section.type || 'section', 24) || 'section';
    let key = `${base}-${i + 1}`;
    let n = i + 1;
    while (taken.has(key)) key = `${base}-${++n}`;
    taken.add(key);
    return { ...section, key, order: section.order ?? i };
  });
}

blogRouter.post('/', requireRole('editor'), validate(postBody), asyncHandler(async (req, res) => {
  const slug = slugify(req.body.slug || req.body.title, 120);
  if (await BlogPost.findOne({ slug, locale: req.body.locale }).lean()) {
    throw conflict('An article with that slug already exists in this language');
  }
  const post = await BlogPost.create({
    ...req.body,
    ...(req.body.sections ? { sections: withSectionKeys(req.body.sections) } : {}),
    slug,
    groupId: req.body.groupId || slug,
    status: req.body.status || 'draft',
    updatedBy: req.user._id,
  });
  await audit(req, 'post.create', 'post', post._id, { slug, locale: post.locale });
  res.status(201).json({ post: post.toObject() });
}));

blogRouter.patch('/:id', requireRole('editor'), validate(postBody.partial()), asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.id);
  if (!post) throw notFoundError('No such article');
  await snapshot('post', post._id, post.toObject(), req.user, 'before edit');

  if (req.body.slug) req.body.slug = slugify(req.body.slug, 120);
  if (req.body.sections) req.body.sections = withSectionKeys(req.body.sections);
  Object.assign(post, req.body);
  post.updatedBy = req.user._id;
  if (post.status === 'published' && !post.publishedAt) post.publishedAt = new Date();
  await post.save();

  await audit(req, 'post.update', 'post', post._id);
  await publishChanged('article updated', [{ locale: post.locale, slug: `${await segmentFor(post.locale)}/${post.slug}` }]);
  res.json({ post: post.toObject() });
}));

/**
 * A one-click link into preview mode for this article.
 *
 * The same exchange the page editor uses: the shared secret travels once in the
 * URL and comes back as an http-only cookie, so an editor can look at a draft on
 * the real site before publishing it. Without this, "preview" for an article
 * meant publishing and hoping.
 */
blogRouter.get('/:id/preview-url', asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.id, { slug: 1, locale: 1 }).lean();
  if (!post) throw notFoundError('No such article');
  const settings = await settingsCached();
  const segment = blogSegmentFor(settings, post.locale);
  const target = `/${post.locale}/${segment}/${post.slug}`;
  const query = `secret=${encodeURIComponent(config.previewSecret)}`
    + `&redirect=${encodeURIComponent(target)}`;

  /*
   * A path as well as an absolute URL, for the same reason the page route gives
   * both: the editor's canvas needs the cookie planted on whichever origin is
   * serving the admin, and a relative path is that origin behind the gateway and
   * behind the admin's dev server alike. The absolute URL stays for the "open in
   * a new tab" link, which wants somewhere a person can navigate to.
   */
  res.json({
    path: `/cms/preview?${query}`,
    url: `${config.siteUrl}/cms/preview?${query}`,
    target,
  });
}));

blogRouter.post('/:id/publish', requireRole('editor'), asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.id);
  if (!post) throw notFoundError('No such article');
  post.status = 'published';
  if (!post.publishedAt) post.publishedAt = new Date();
  await post.save();
  await audit(req, 'post.publish', 'post', post._id);
  const result = await publishChanged('article published', [{ locale: post.locale, slug: `${await segmentFor(post.locale)}/${post.slug}` }]);
  res.json({ ok: true, ...result });
}));

blogRouter.post('/:id/unpublish', requireRole('editor'), asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.id);
  if (!post) throw notFoundError('No such article');
  post.status = 'draft';
  await post.save();
  await audit(req, 'post.unpublish', 'post', post._id);
  await publishChanged('article unpublished', [{ locale: post.locale, slug: `${await segmentFor(post.locale)}/${post.slug}` }]);
  res.json({ ok: true });
}));

/** Start a translation: copies the source article into another locale as a draft. */
blogRouter.post('/:id/translate/:locale', requireRole('editor'), asyncHandler(async (req, res) => {
  const source = await BlogPost.findById(req.params.id).lean();
  if (!source) throw notFoundError('No such article');
  const locale = req.params.locale;
  const existing = await BlogPost.findOne({ groupId: source.groupId, locale }).lean();
  if (existing) return res.json({ post: existing, created: false });

  const copy = await BlogPost.create({
    ...source,
    _id: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    locale,
    slug: `${source.slug}-${locale}`,
    status: 'draft',
    publishedAt: null,
    updatedBy: req.user._id,
  });
  await audit(req, 'post.translate', 'post', copy._id, { from: source._id, locale });
  res.status(201).json({ post: copy.toObject(), created: true });
}));

blogRouter.delete('/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.id);
  if (!post) throw notFoundError('No such article');
  // Forced: after this the article exists nowhere else. See pages.js.
  await snapshot('post', post._id, post.toObject(), req.user, 'before delete', { force: true });
  await post.deleteOne();
  await audit(req, 'post.delete', 'post', req.params.id);
  await publishChanged('article deleted');
  res.json({ ok: true });
}));
