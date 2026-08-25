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

export const blogRouter = Router();

blogRouter.use(requireAuth);

const listQuery = z.object({
  locale: z.string().max(5).optional(),
  status: z.enum(['published', 'draft', 'scheduled']).optional(),
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

blogRouter.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const { locale, status, q: search, limit, offset } = q(req);
  const filter = {};
  if (locale) filter.locale = locale;
  if (status) filter.status = status;
  if (search) filter.title = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

  const [items, total] = await Promise.all([
    BlogPost.find(filter, { bodyHtml: 0, blocks: 0 }).sort({ publishedAt: -1, updatedAt: -1 }).skip(offset).limit(limit).lean(),
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
  blocks: z.array(z.object({
    key: z.string().max(80).optional(),
    componentKey: z.string().max(80),
    data: z.record(z.string(), z.any()).default({}),
    visible: z.boolean().default(true),
    layout: z.object({
      spacingTop: z.string().max(10).nullable().optional(),
      spacingBottom: z.string().max(10).nullable().optional(),
    }).optional(),
  })).optional(),
  status: z.enum(['published', 'draft', 'scheduled']).optional(),
  publishedAt: z.coerce.date().nullable().optional(),
  seo: z.record(z.string(), z.any()).optional(),
  snippets: z.object({
    head: z.string().max(50000).optional(),
    body: z.string().max(50000).optional(),
    footer: z.string().max(50000).optional(),
  }).optional(),
});

blogRouter.post('/', requireRole('editor'), validate(postBody), asyncHandler(async (req, res) => {
  const slug = slugify(req.body.slug || req.body.title, 120);
  if (await BlogPost.findOne({ slug, locale: req.body.locale }).lean()) {
    throw conflict('An article with that slug already exists in this language');
  }
  const post = await BlogPost.create({
    ...req.body,
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
  Object.assign(post, req.body);
  post.updatedBy = req.user._id;
  if (post.status === 'published' && !post.publishedAt) post.publishedAt = new Date();
  await post.save();

  await audit(req, 'post.update', 'post', post._id);
  await publishChanged('article updated', [{ locale: post.locale, slug: `blog/${post.slug}` }]);
  res.json({ post: post.toObject() });
}));

blogRouter.post('/:id/publish', requireRole('editor'), asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.id);
  if (!post) throw notFoundError('No such article');
  post.status = 'published';
  if (!post.publishedAt) post.publishedAt = new Date();
  await post.save();
  await audit(req, 'post.publish', 'post', post._id);
  const result = await publishChanged('article published', [{ locale: post.locale, slug: `blog/${post.slug}` }]);
  res.json({ ok: true, ...result });
}));

blogRouter.post('/:id/unpublish', requireRole('editor'), asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.id);
  if (!post) throw notFoundError('No such article');
  post.status = 'draft';
  await post.save();
  await audit(req, 'post.unpublish', 'post', post._id);
  await publishChanged('article unpublished', [{ locale: post.locale, slug: `blog/${post.slug}` }]);
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
  await snapshot('post', post._id, post.toObject(), req.user, 'before delete');
  await post.deleteOne();
  await audit(req, 'post.delete', 'post', req.params.id);
  await publishChanged('article deleted');
  res.json({ ok: true });
}));
