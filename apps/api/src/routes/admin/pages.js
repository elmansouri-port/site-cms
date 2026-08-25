/*
 * pages.js — the page manager.
 *
 * A page is metadata plus an ordered list of section blocks. The endpoints here
 * are deliberately granular — reorder, toggle, duplicate, edit one block —
 * because that is how the block manager in the CMS actually behaves, and
 * because sending a 130 kB page document back for every checkbox would make
 * concurrent editing much worse than it needs to be.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Page } from '../../models/index.js';
import { asyncHandler, notFoundError, badRequest, conflict } from '../../middleware/error.js';
import { validate, q } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { snapshot, audit, publishChanged } from '../../services/publish.js';
import { keysIn } from '@rainbow/core/ingest';
import { slugify } from '@rainbow/core/html';
import { config } from '../../config.js';

export const pagesRouter = Router();

pagesRouter.use(requireAuth);

const seoSchema = z.object({
  title: z.string().max(300).optional(),
  description: z.string().max(1000).optional(),
  keywords: z.string().max(500).optional(),
  robots: z.string().max(120).optional(),
  canonical: z.string().max(500).optional(),
  ogType: z.string().max(60).optional(),
  ogTitle: z.string().max(300).optional(),
  ogDescription: z.string().max(1000).optional(),
  ogImage: z.string().max(500).optional(),
  twitterCard: z.string().max(60).optional(),
  twitterTitle: z.string().max(300).optional(),
  twitterDescription: z.string().max(1000).optional(),
  twitterImage: z.string().max(500).optional(),
  jsonLdOverride: z.string().max(20000).optional(),
  replaceAutoLd: z.boolean().optional(),
}).strict();

const listQuery = z.object({
  status: z.enum(['published', 'draft']).optional(),
  kind: z.string().max(40).optional(),
  q: z.string().max(120).optional(),
});

pagesRouter.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const { status, kind, q: search } = q(req);
  const filter = {};
  if (status) filter.status = status;
  if (kind) filter.pageKind = kind;
  if (search) filter.$or = [
    { title: { $regex: search, $options: 'i' } },
    { route: { $regex: search, $options: 'i' } },
    { key: { $regex: search, $options: 'i' } },
  ];

  const pages = await Page.find(filter, {
    key: 1, route: 1, title: 1, pageKind: 1, type: 1, status: 1, locales: 1,
    noindex: 1, updatedAt: 1, publishedAt: 1, editedInCms: 1,
    sectionCount: { $size: '$sections' },
  }).sort({ route: 1 }).lean();

  res.json({ items: pages });
}));

pagesRouter.get('/:key', asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key }).lean();
  if (!page) throw notFoundError('No such page');
  res.json({ page });
}));

/** The block list without the HTML — what the block manager renders. */
pagesRouter.get('/:key/sections', asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key }, { sections: 1, key: 1 }).lean();
  if (!page) throw notFoundError('No such page');
  res.json({
    items: (page.sections || []).map(s => ({
      key: s.key,
      label: s.label,
      type: s.type,
      anchorId: s.anchorId,
      order: s.order,
      visible: s.visible,
      locked: s.locked,
      componentKey: s.componentKey,
      layout: s.layout,
      experiment: s.experiment,
      keyCount: (s.keys || []).length,
      bytes: (s.html || '').length,
    })),
  });
}));

pagesRouter.get('/:key/sections/:sectionKey', asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key }, { sections: 1 }).lean();
  if (!page) throw notFoundError('No such page');
  const section = (page.sections || []).find(s => s.key === req.params.sectionKey);
  if (!section) throw notFoundError('No such section');
  res.json({ section });
}));

const metaPatch = z.object({
  title: z.string().min(1).max(200).optional(),
  route: z.string().max(300).optional(),
  pageKind: z.enum(['home', 'product', 'pricing', 'blogIndex', 'blogPost', 'page', 'form', 'error']).optional(),
  type: z.enum(['static', 'hybrid', 'dynamic']).optional(),
  status: z.enum(['published', 'draft']).optional(),
  locales: z.array(z.string().max(5)).optional(),
  noindex: z.boolean().optional(),
  sitemap: z.object({
    include: z.boolean().optional(),
    priority: z.number().min(0).max(1).optional(),
    changefreq: z.string().max(20).optional(),
  }).optional(),
  snippets: z.object({
    head: z.string().max(50000).optional(),
    body: z.string().max(50000).optional(),
    footer: z.string().max(50000).optional(),
  }).optional(),
  seo: z.record(z.string().max(5), seoSchema).optional(),
}).strict();

pagesRouter.patch('/:key', requireRole('editor'), validate(metaPatch), asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key });
  if (!page) throw notFoundError('No such page');

  if (req.body.route !== undefined) {
    const route = normaliseRoute(req.body.route);
    const clash = await Page.findOne({ route, key: { $ne: page.key } }).lean();
    if (clash) throw conflict(`Route already used by "${clash.key}"`);
    page.route = route;
  }

  await snapshot('page', page.key, page.toObject(), req.user, 'before metadata edit');

  for (const field of ['title', 'pageKind', 'type', 'status', 'locales', 'noindex']) {
    if (req.body[field] !== undefined) page[field] = req.body[field];
  }
  if (req.body.sitemap) page.sitemap = { ...page.sitemap?.toObject?.() ?? page.sitemap, ...req.body.sitemap };
  if (req.body.snippets) page.snippets = { ...page.snippets?.toObject?.() ?? page.snippets, ...req.body.snippets };
  if (req.body.seo) {
    for (const [locale, values] of Object.entries(req.body.seo)) {
      // The map holds subdocuments; spreading one copies Mongoose internals
      // rather than the fields, so it has to be flattened first.
      const current = page.seo.get(locale);
      const base = current?.toObject ? current.toObject() : (current || {});
      page.seo.set(locale, { ...base, ...values });
    }
    page.markModified('seo');
  }
  page.editedInCms = true;
  page.updatedBy = req.user._id;
  if (req.body.status === 'published') page.publishedAt = new Date();
  await page.save();

  await audit(req, 'page.update', 'page', page.key, { fields: Object.keys(req.body) });
  await publishChanged('page updated', [{ route: page.route }]);
  res.json({ page: page.toObject() });
}));

const sectionPatch = z.object({
  label: z.string().max(120).optional(),
  visible: z.boolean().optional(),
  anchorId: z.string().max(80).nullable().optional(),
  html: z.string().max(2_000_000).optional(),
  componentKey: z.string().max(80).nullable().optional(),
  data: z.record(z.string(), z.any()).optional(),
  layout: z.object({
    spacingTop: z.string().max(10).nullable().optional(),
    spacingBottom: z.string().max(10).nullable().optional(),
  }).optional(),
  experiment: z.object({
    key: z.string().max(80).nullable().optional(),
    variants: z.array(z.object({
      key: z.string().max(20),
      label: z.string().max(80).optional(),
      html: z.string().max(2_000_000),
    })).optional(),
  }).optional(),
}).strict();

pagesRouter.patch('/:key/sections/:sectionKey', requireRole('editor'), validate(sectionPatch), asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key });
  if (!page) throw notFoundError('No such page');
  const section = page.sections.find(s => s.key === req.params.sectionKey);
  if (!section) throw notFoundError('No such section');

  await snapshot('page', page.key, page.toObject(), req.user, `before editing "${section.label}"`);

  for (const field of ['label', 'visible', 'anchorId', 'componentKey', 'data']) {
    if (req.body[field] !== undefined) section[field] = req.body[field];
  }
  if (req.body.html !== undefined) {
    section.html = req.body.html;
    // The key list drives "edit this section's copy", so it has to follow the markup.
    section.keys = keysIn(req.body.html);
  }
  if (req.body.layout) section.layout = { ...section.layout, ...req.body.layout };
  if (req.body.experiment) section.experiment = { ...section.experiment, ...req.body.experiment };

  page.editedInCms = true;
  page.updatedBy = req.user._id;
  await page.save();

  await audit(req, 'page.section.update', 'page', page.key, { section: section.key });
  await publishChanged('section updated', [{ route: page.route }]);
  res.json({ section: section.toObject ? section.toObject() : section });
}));

const reorder = z.object({ order: z.array(z.string().max(120)).min(1) });

pagesRouter.post('/:key/sections/reorder', requireRole('editor'), validate(reorder), asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key });
  if (!page) throw notFoundError('No such page');

  const known = new Set(page.sections.map(s => s.key));
  const unknown = req.body.order.filter(k => !known.has(k));
  if (unknown.length) throw badRequest('Unknown section keys', unknown);

  await snapshot('page', page.key, page.toObject(), req.user, 'before reorder');

  const position = new Map(req.body.order.map((k, i) => [k, i]));
  // Anything the client did not mention keeps its relative place at the end.
  let tail = req.body.order.length;
  for (const s of page.sections) {
    s.order = position.has(s.key) ? position.get(s.key) : tail++;
  }
  page.sections.sort((a, b) => a.order - b.order);
  page.editedInCms = true;
  page.updatedBy = req.user._id;
  await page.save();

  await audit(req, 'page.section.reorder', 'page', page.key);
  await publishChanged('sections reordered', [{ route: page.route }]);
  res.json({ ok: true, order: page.sections.map(s => s.key) });
}));

const newSection = z.object({
  label: z.string().max(120).default('New section'),
  type: z.enum(['html', 'component']).default('component'),
  componentKey: z.string().max(80).optional(),
  html: z.string().max(2_000_000).optional(),
  data: z.record(z.string(), z.any()).optional(),
  afterKey: z.string().max(120).optional(),
});

pagesRouter.post('/:key/sections', requireRole('editor'), validate(newSection), asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key });
  if (!page) throw notFoundError('No such page');

  const base = slugify(req.body.label || req.body.componentKey || 'section', 48) || 'section';
  let key = base;
  let n = 1;
  while (page.sections.some(s => s.key === key)) key = `${base}-${++n}`;

  const section = {
    key,
    label: req.body.label,
    type: req.body.type,
    componentKey: req.body.componentKey || null,
    html: req.body.html || '',
    keys: req.body.html ? keysIn(req.body.html) : [],
    data: req.body.data || {},
    visible: true,
    locked: false,
    layout: { spacingTop: 'lg', spacingBottom: 'lg' },
    experiment: { key: null, variants: [] },
    order: page.sections.length,
  };

  const at = req.body.afterKey ? page.sections.findIndex(s => s.key === req.body.afterKey) : -1;
  if (at >= 0) page.sections.splice(at + 1, 0, section);
  else page.sections.push(section);
  page.sections.forEach((s, i) => { s.order = i; });

  page.editedInCms = true;
  page.updatedBy = req.user._id;
  await page.save();

  await audit(req, 'page.section.create', 'page', page.key, { section: key });
  await publishChanged('section added', [{ route: page.route }]);
  res.status(201).json({ section });
}));

pagesRouter.post('/:key/sections/:sectionKey/duplicate', requireRole('editor'), asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key });
  if (!page) throw notFoundError('No such page');
  const at = page.sections.findIndex(s => s.key === req.params.sectionKey);
  if (at < 0) throw notFoundError('No such section');

  const src = page.sections[at].toObject();
  let key = `${src.key}-copy`;
  let n = 1;
  while (page.sections.some(s => s.key === key)) key = `${src.key}-copy-${++n}`;

  page.sections.splice(at + 1, 0, { ...src, key, label: `${src.label} (copy)` });
  page.sections.forEach((s, i) => { s.order = i; });
  page.editedInCms = true;
  await page.save();

  await audit(req, 'page.section.duplicate', 'page', page.key, { from: src.key, to: key });
  await publishChanged('section duplicated', [{ route: page.route }]);
  res.status(201).json({ key });
}));

pagesRouter.delete('/:key/sections/:sectionKey', requireRole('editor'), asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key });
  if (!page) throw notFoundError('No such page');
  const at = page.sections.findIndex(s => s.key === req.params.sectionKey);
  if (at < 0) throw notFoundError('No such section');
  if (page.sections[at].locked) throw badRequest('This block is structural and cannot be deleted');

  await snapshot('page', page.key, page.toObject(), req.user, `before deleting "${page.sections[at].label}"`);
  page.sections.splice(at, 1);
  page.sections.forEach((s, i) => { s.order = i; });
  page.editedInCms = true;
  await page.save();

  await audit(req, 'page.section.delete', 'page', page.key, { section: req.params.sectionKey });
  await publishChanged('section deleted', [{ route: page.route }]);
  res.json({ ok: true });
}));

const createPage = z.object({
  key: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  route: z.string().max(300),
  title: z.string().min(1).max(200),
  pageKind: z.enum(['home', 'product', 'pricing', 'blogIndex', 'blogPost', 'page', 'form', 'error']).default('page'),
  type: z.enum(['static', 'hybrid', 'dynamic']).default('hybrid'),
  copyFrom: z.string().max(80).optional(),
});

pagesRouter.post('/', requireRole('editor'), validate(createPage), asyncHandler(async (req, res) => {
  const route = normaliseRoute(req.body.route);
  if (await Page.findOne({ $or: [{ key: req.body.key }, { route }] }).lean()) {
    throw conflict('A page with that key or route already exists');
  }

  let base = null;
  if (req.body.copyFrom) {
    base = await Page.findOne({ key: req.body.copyFrom }).lean();
    if (!base) throw badRequest('The page to copy does not exist');
  }

  const doc = base
    ? { ...base, _id: undefined, createdAt: undefined, updatedAt: undefined, publishedAt: null }
    : {
      doctype: '<!DOCTYPE html>\n',
      htmlOpen: '<html lang="fr">',
      bodyOpen: '<body class="font-sans text-gray-600 antialiased bg-white">',
      headRaw: '',
      sections: [],
    };

  const page = await Page.create({
    ...doc,
    key: req.body.key,
    route,
    title: req.body.title,
    pageKind: req.body.pageKind,
    type: req.body.type,
    status: 'draft',
    editedInCms: true,
    updatedBy: req.user._id,
  });

  await audit(req, 'page.create', 'page', page.key, { copiedFrom: req.body.copyFrom || null });
  res.status(201).json({ page: page.toObject() });
}));

pagesRouter.delete('/:key', requireRole('admin'), asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key });
  if (!page) throw notFoundError('No such page');
  await snapshot('page', page.key, page.toObject(), req.user, 'before delete');
  await page.deleteOne();
  await audit(req, 'page.delete', 'page', req.params.key);
  await publishChanged('page deleted');
  res.json({ ok: true });
}));

pagesRouter.post('/:key/publish', requireRole('editor'), asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key });
  if (!page) throw notFoundError('No such page');
  page.status = 'published';
  page.publishedAt = new Date();
  page.updatedBy = req.user._id;
  await page.save();

  await audit(req, 'page.publish', 'page', page.key);
  const result = await publishChanged('page published', page.locales.map(locale => ({ locale, slug: page.route })));
  res.json({ ok: true, ...result });
}));

/**
 * A one-click link into preview mode on the live frontend.
 *
 * The preview secret never reaches the browser as a stored value: it is used
 * once in this URL, exchanged for an http-only cookie by the frontend, and the
 * link itself is only ever handed to a signed-in editor.
 */
pagesRouter.get('/:key/preview-url', asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key }, { route: 1, locales: 1 }).lean();
  if (!page) throw notFoundError('No such page');
  const locale = String(req.query.locale || page.locales?.[0] || 'fr');
  const target = `/${locale}${page.route ? `/${page.route}` : ''}`;
  const url = `${config.siteUrl}/api/preview?secret=${encodeURIComponent(config.previewSecret)}&redirect=${encodeURIComponent(target)}`;
  res.json({ url, target });
}));

pagesRouter.post('/:key/unpublish', requireRole('editor'), asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key });
  if (!page) throw notFoundError('No such page');
  page.status = 'draft';
  await page.save();
  await audit(req, 'page.unpublish', 'page', page.key);
  await publishChanged('page unpublished', [{ route: page.route }]);
  res.json({ ok: true });
}));

function normaliseRoute(route) {
  return String(route || '').replace(/^\/+|\/+$/g, '');
}
