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
import { Page, Redirect, Experiment } from '../../models/index.js';
import { asyncHandler, notFoundError, badRequest, conflict } from '../../middleware/error.js';
import { validate, q } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { snapshot, audit, publishChanged } from '../../services/publish.js';
import { deletedPages, recoverPage } from '../../services/history.js';
import { keysIn } from '@rainbow/core/ingest';
import { firstHeading, slugify } from '@rainbow/core/html';
import { routeFor } from '@rainbow/core/seo';
import { config } from '../../config.js';

export const pagesRouter = Router();

pagesRouter.use(requireAuth);

/**
 * A page document as JSON.
 *
 * `routes` and `seo` are Mongoose Maps, and `JSON.stringify` renders a Map as
 * `{}` — so a response built from a plain `toObject()` silently drops both.
 * Flattening them is what the `.lean()` reads elsewhere already do.
 */
const asJson = (doc) => doc.toObject({ flattenMaps: true });

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

/* ── Trash ────────────────────────────────────────────────────────────────── */

/**
 * Pages that were deleted and can still be brought back.
 *
 * Declared before `/:key` so the literal path is not read as a page key.
 *
 * There is no separate bin collection: a delete always writes a restore point
 * first, so that snapshot *is* the bin. One source of truth, and no way for the
 * two to disagree about what exists.
 */
pagesRouter.get('/trash', requireRole('editor'), asyncHandler(async (_req, res) => {
  res.json({ items: await deletedPages() });
}));

pagesRouter.post('/trash/:key/recover', requireRole('editor'), asyncHandler(async (req, res) => {
  const result = await recoverPage(req.params.key, req.user);
  if (result.error === 'notFound') throw notFoundError('Nothing in the trash under that key');
  if (result.error === 'exists') throw conflict('A page with that key already exists');

  await audit(req, 'page.recover', 'page', req.params.key);
  await publishChanged('page recovered');
  res.json({ ok: true, key: req.params.key });
}));

/* ── One page ─────────────────────────────────────────────────────────────── */

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
      // The block manager filters the shared header and footer out by this, so
      // omitting it silently showed them again in the Blocks tab.
      role: s.role || null,
      anchorId: s.anchorId,
      order: s.order,
      visible: s.visible,
      locked: s.locked,
      componentKey: s.componentKey,
      convertedFrom: s.convertedFrom,
      layout: s.layout,
      experiment: s.experiment,
      keyCount: (s.keys || []).length,
      bytes: (s.html || '').length,
      // The block's own first heading. Sent because the migrated labels name a
      // CSS class rather than the content; the CMS prefers this when they do.
      heading: firstHeading(s.html),
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

const routeSegment = z.string().max(300).regex(
  /^$|^[a-z0-9]+(?:[-_a-z0-9]*[a-z0-9])?(?:\/[a-z0-9]+(?:[-_a-z0-9]*[a-z0-9])?)*$/,
  'Use lowercase words separated by - or /, with no leading or trailing slash',
);

const metaPatch = z.object({
  title: z.string().min(1).max(200).optional(),
  route: z.string().max(300).optional(),
  // Per-locale route overrides. An empty string clears the override, which puts
  // that locale back on the base route rather than leaving it on a stale path.
  routes: z.record(z.string().max(5), routeSegment).optional(),
  pageKind: z.enum(['home', 'product', 'pricing', 'blogIndex', 'blogPost', 'page', 'form', 'error']).optional(),
  type: z.enum(['static', 'hybrid', 'dynamic']).optional(),
  status: z.enum(['published', 'draft']).optional(),
  locales: z.array(z.string().max(5)).optional(),
  noindex: z.boolean().optional(),
  // Whether this page shows the shared header and footer.
  chrome: z.object({
    navbar: z.boolean().optional(),
    footer: z.boolean().optional(),
  }).optional(),
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

  // Every path this page answered to before the edit, per locale. Comparing it
  // with the paths after tells us exactly which redirects to write, so an
  // editor who renames a URL never silently breaks the links pointing at it.
  const before = routeMapOf(page);

  if (req.body.route !== undefined) {
    const route = normaliseRoute(req.body.route);
    const clash = await Page.findOne({ route, key: { $ne: page.key } }).lean();
    if (clash) throw conflict(`Route already used by "${clash.key}"`);
    page.route = route;
  }

  if (req.body.routes) {
    for (const [locale, value] of Object.entries(req.body.routes)) {
      const localised = normaliseRoute(value);
      if (!localised) { page.routes.delete(locale); continue; }
      await assertRouteFree(localised, locale, page.key);
      page.routes.set(locale, localised);
    }
    page.markModified('routes');
  }

  await snapshot('page', page.key, page.toObject(), req.user, 'before metadata edit');

  for (const field of ['title', 'pageKind', 'type', 'status', 'locales', 'noindex']) {
    if (req.body[field] !== undefined) page[field] = req.body[field];
  }
  if (req.body.chrome) page.chrome = { ...page.chrome?.toObject?.() ?? page.chrome, ...req.body.chrome };
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

  const redirects = await syncRouteRedirects(page, before);

  await audit(req, 'page.update', 'page', page.key, {
    fields: Object.keys(req.body),
    ...(redirects.length ? { redirects } : {}),
  });
  await publishChanged('page updated', [{ route: page.route }]);
  res.json({ page: asJson(page), redirects });
}));

/** Every locale's current path for a page, as a plain object. */
function routeMapOf(page) {
  const locales = page.locales?.length ? page.locales : ['fr'];
  const out = {};
  for (const locale of locales) out[locale] = routeFor(page, locale);
  return out;
}

/** Refuse a localized path another page already answers to in that locale. */
async function assertRouteFree(route, locale, ownKey) {
  const others = await Page.find(
    { key: { $ne: ownKey } },
    { key: 1, route: 1, routes: 1, locales: 1, _id: 0 },
  ).lean();
  for (const other of others) {
    const otherLocales = other.locales?.length ? other.locales : ['fr'];
    if (!otherLocales.includes(locale)) continue;
    if (routeFor(other, locale) === route) {
      throw conflict(`"${other.key}" already answers to /${locale}/${route}`);
    }
  }
}

/**
 * Write a 301 for every locale whose path changed.
 *
 * A renamed URL without a redirect throws away whatever ranking and inbound
 * links the old one had, which is the single most expensive mistake available
 * in a CMS. Doing it here means an editor cannot forget. An existing redirect
 * for the same source is updated rather than duplicated, and a redirect that
 * would point a path at itself is skipped.
 */
async function syncRouteRedirects(page, before) {
  const after = routeMapOf(page);
  const written = [];
  for (const [locale, oldRoute] of Object.entries(before)) {
    const newRoute = after[locale];
    if (newRoute === undefined || newRoute === oldRoute) continue;
    const from = `/${locale}${oldRoute ? `/${oldRoute}` : ''}`;
    const to = `/${locale}${newRoute ? `/${newRoute}` : ''}`;
    if (from === to) continue;
    await Redirect.findOneAndUpdate(
      { from },
      { from, to, status: 301, active: true, note: `Route change on "${page.key}"` },
      { upsert: true, new: true },
    );
    // A chain (old → older → newest) costs a hop and loses a little authority
    // each time, so anything that pointed at the old path is repointed.
    await Redirect.updateMany({ to: from }, { $set: { to } });
    // Repointing can leave a redirect aimed at itself — it happens whenever a
    // path is renamed and then renamed back — and a self-redirect is an
    // infinite loop, not a redirect. Drop those rather than serving them.
    await Redirect.deleteMany({ $expr: { $eq: ['$from', '$to'] } });
    written.push({ from, to });
  }
  return written;
}

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
      // Authored and custom blocks vary by markup; component blocks vary by
      // field overrides. A variant supplies whichever fits its block.
      html: z.string().max(2_000_000).optional(),
      data: z.record(z.string(), z.any()).optional(),
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
  if (req.body.experiment) {
    const current = section.experiment?.toObject?.() ?? section.experiment ?? {};
    section.experiment = { ...current, ...req.body.experiment };
    section.markModified('experiment');
  }

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

  if (req.body.afterKey) {
    const at = page.sections.findIndex(s => s.key === req.body.afterKey);
    if (at >= 0) page.sections.splice(at + 1, 0, section);
    else page.sections.push(section);
  } else {
    // Content belongs above the footer and the closing scripts. Appending to
    // the very end would put a new hero underneath the footer, which is never
    // what an editor means by "add a block".
    const tail = page.sections.findIndex(s => s.tag === 'footer' || s.type === 'script' || s.type === 'style');
    if (tail >= 0) page.sections.splice(tail, 0, section);
    else page.sections.push(section);
  }
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

/**
 * Turn an authored HTML block into an editable custom block.
 *
 * The imported pages are stored as the exact bytes they were written with, and
 * `verify-fidelity` / `verify-live` prove that what a visitor receives is
 * unchanged. That guarantee is what this endpoint spends: the markup moves into
 * a `custom_html` component block, which renders it through Astro's block
 * wrapper instead of splicing it in verbatim. The bytes it produces are
 * equivalent, not identical — a wrapping `<section>` with the spacing classes
 * appears around it — so the section stops being covered by the fidelity check.
 *
 * In exchange the block becomes a first-class citizen of the visual editor:
 * editable markup with Tailwind, A/B variants, spacing, duplication. The
 * response says plainly what was given up, and the previous version is in the
 * page's history either way.
 */
pagesRouter.post('/:key/sections/:sectionKey/convert', requireRole('editor'), asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key });
  if (!page) throw notFoundError('No such page');
  const section = page.sections.find(s => s.key === req.params.sectionKey);
  if (!section) throw notFoundError('No such section');
  if (section.type === 'component') throw badRequest('This block is already a component block');
  if (section.locked) throw badRequest('Structural blocks hold the page\'s scripts and cannot be converted');
  if (section.type !== 'html') throw badRequest(`A ${section.type} block cannot be converted`);

  await snapshot('page', page.key, page.toObject(), req.user, `before converting "${section.label}"`);

  const markup = section.html || '';
  section.type = 'component';
  section.componentKey = 'custom_html';
  section.data = { html: markup, css: '', containerClass: '', contained: false };
  // The copy in a converted block is edited in the markup from now on: the
  // translation keys addressed the authored template, and that template is no
  // longer what renders. Keeping the list would show an editor strings that no
  // longer do anything.
  section.keys = [];
  section.html = '';
  // The authored markup carries its own padding, so the wrapper must add none
  // or the section would suddenly grow 160px taller than it was.
  section.layout = { spacingTop: 'none', spacingBottom: 'none' };
  section.convertedFrom = 'html';

  page.editedInCms = true;
  page.updatedBy = req.user._id;
  await page.save();

  await audit(req, 'page.section.convert', 'page', page.key, { section: section.key });
  await publishChanged('section converted', [{ route: page.route }]);
  res.json({
    section: section.toObject ? section.toObject() : section,
    note: 'This section is now a custom block. It no longer takes part in the byte-fidelity check.',
  });
}));

pagesRouter.delete('/:key/sections/:sectionKey', requireRole('editor'), asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key });
  if (!page) throw notFoundError('No such page');
  const at = page.sections.findIndex(s => s.key === req.params.sectionKey);
  if (at < 0) throw notFoundError('No such section');
  if (page.sections[at].locked) throw badRequest('This block is structural and cannot be deleted');

  await snapshot('page', page.key, page.toObject(), req.user,
    `before deleting "${page.sections[at].label}"`, { force: true });
  page.sections.splice(at, 1);
  page.sections.forEach((s, i) => { s.order = i; });
  page.editedInCms = true;
  await page.save();

  await audit(req, 'page.section.delete', 'page', page.key, { section: req.params.sectionKey });
  await publishChanged('section deleted', [{ route: page.route }]);
  res.json({ ok: true });
}));

/**
 * A script block is safe to carry onto a new page when it only loads files —
 * `<script src=…>` with no body. The inline blocks are page logic (the
 * homepage's counters, the FAQ's Zendesk fetch) and belong to their page.
 */
function isSharedScript(html) {
  const withoutComments = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  const scripts = [...withoutComments.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  return scripts.length > 0 && scripts.every(s => /\ssrc\s*=/i.test(s[1]) && !s[2].trim());
}

const isChromeBlock = (s) => (
  (s.tag === 'nav' && (s.anchorId === 'navbar' || s.key === 'navbar'))
  || s.tag === 'footer'
  || (s.type === 'script' && isSharedScript(s.html))
);

/**
 * What a new page starts as: the site's own shell.
 *
 * An empty page would have no stylesheets, no fonts and no Tailwind config,
 * so every block dropped onto it would render unstyled and nothing like the
 * rest of the site. Taking the head scaffolding, the navbar, the footer and
 * the shared scripts from the homepage means a new page looks like a Rainbow
 * page from the first save, with an empty middle for the editor to fill.
 */
async function siteChrome() {
  const home = await Page.findOne({ pageKind: 'home' }).lean()
    || await Page.findOne({ route: '' }).lean();
  if (!home) return null;

  const sections = (home.sections || [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter(isChromeBlock)
    .map((s, i) => ({ ...s, order: i }));

  return {
    doctype: home.doctype,
    htmlOpen: home.htmlOpen,
    bodyOpen: home.bodyOpen,
    headRaw: home.headRaw,
    sections,
  };
}

const createPage = z.object({
  key: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  route: routeSegment,
  title: z.string().min(1).max(200),
  pageKind: z.enum(['home', 'product', 'pricing', 'blogIndex', 'blogPost', 'page', 'form', 'error']).default('page'),
  type: z.enum(['static', 'hybrid', 'dynamic']).default('hybrid'),
  /**
   * Whether the new page shows the shared header and footer.
   *
   * Settable here because a landing page is a *kind of page*, not a page
   * somebody afterwards remembers to strip: paid traffic arrives before anybody
   * checks, and a navigation bar on a landing page is a way to leave before
   * converting.
   */
  chrome: z.object({
    navbar: z.boolean().optional(),
    footer: z.boolean().optional(),
  }).optional(),
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

  const chrome = base ? null : await siteChrome();
  const doc = base
    ? { ...base, _id: undefined, createdAt: undefined, updatedAt: undefined, publishedAt: null }
    : chrome || {
      // Only reachable before the site has been seeded.
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
    // A copy inherits content, not identity. Carrying the source's localized
    // routes over would give two pages the same URL in those languages, and
    // carrying its experiment would make the copy a second arm of a running
    // test. Both belong only to the page they were set on.
    routes: {},
    experiment: { key: null, variant: null, variantOf: null },
    sourceFile: null,
    sourceHash: null,
    title: req.body.title,
    pageKind: req.body.pageKind,
    type: req.body.type,
    chrome: {
      navbar: req.body.chrome?.navbar !== false,
      footer: req.body.chrome?.footer !== false,
    },
    status: 'draft',
    editedInCms: true,
    updatedBy: req.user._id,
  });

  await audit(req, 'page.create', 'page', page.key, {
    copiedFrom: req.body.copyFrom || null,
    ...(req.body.chrome ? { chrome: req.body.chrome } : {}),
  });
  res.status(201).json({ page: asJson(page) });
}));

/* ── Whole-page A/B variants ──────────────────────────────────────────────── */

/**
 * The arms of a page-scoped experiment, control first.
 *
 * A variant arm is a full page document with the same experiment key. It has no
 * URL of its own: visitors assigned to it are served its sections at the
 * control's address, which is what keeps one canonical URL and nothing
 * duplicate in the index.
 */
pagesRouter.get('/:key/variants', asyncHandler(async (req, res) => {
  const control = await Page.findOne({ key: req.params.key }, { key: 1, experiment: 1, title: 1 }).lean();
  if (!control) throw notFoundError('No such page');
  if (!control.experiment?.key) return res.json({ experiment: null, items: [] });

  const arms = await Page.find(
    { 'experiment.key': control.experiment.key },
    { key: 1, title: 1, status: 1, experiment: 1, updatedAt: 1, sections: { $slice: 0 } },
  ).lean();

  const experiment = await Experiment.findOne({ key: control.experiment.key }).lean();
  res.json({
    experiment: experiment || null,
    items: arms
      .map(a => ({
        key: a.key,
        title: a.title,
        status: a.status,
        variant: a.experiment?.variant || 'A',
        isControl: !a.experiment?.variantOf,
        updatedAt: a.updatedAt,
      }))
      .sort((a, b) => (a.variant < b.variant ? -1 : 1)),
  });
}));

const newVariant = z.object({
  experimentKey: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  variant: z.string().min(1).max(20).regex(/^[A-Za-z0-9-]+$/),
  label: z.string().max(80).optional(),
  // Start the arm as a copy of the control (the usual case: change one thing),
  // or empty apart from the site chrome.
  copyControl: z.boolean().default(true),
});

pagesRouter.post('/:key/variants', requireRole('editor'), validate(newVariant), asyncHandler(async (req, res) => {
  const control = await Page.findOne({ key: req.params.key });
  if (!control) throw notFoundError('No such page');
  if (control.experiment?.variantOf) throw badRequest('This page is itself a variant arm');

  const { experimentKey, variant, copyControl } = req.body;
  if (control.experiment?.key && control.experiment.key !== experimentKey) {
    throw conflict(`This page is already the control of "${control.experiment.key}"`);
  }
  if ((control.experiment?.variant || 'A') === variant) {
    throw badRequest(`"${variant}" is the control arm — pick another letter`);
  }
  const exists = await Page.findOne({ 'experiment.key': experimentKey, 'experiment.variant': variant }).lean();
  if (exists) throw conflict(`Variant "${variant}" already exists as "${exists.key}"`);

  // The experiment record holds the split; create it paused so no traffic moves
  // until an editor deliberately starts it.
  await Experiment.findOneAndUpdate(
    { key: experimentKey },
    {
      // `scope` and `pageKey` are in $set only: naming a field in both $set and
      // $setOnInsert is a conflicting update, and these two want to be correct
      // on an existing record as well as a new one.
      $set: { scope: 'page', pageKey: control.key },
      $setOnInsert: {
        key: experimentKey,
        name: req.body.label || `${control.title} test`,
        status: 'draft',
        mode: 'cookie',
        variants: [
          { key: control.experiment?.variant || 'A', label: 'Control', weight: 50 },
          { key: variant, label: req.body.label || `Variant ${variant}`, weight: 50 },
        ],
      },
    },
    { upsert: true, new: true },
  );

  if (!control.experiment?.key) {
    control.experiment = { key: experimentKey, variant: control.experiment?.variant || 'A', variantOf: null };
    await control.save();
  }

  const source = control.toObject();
  const armKey = `${control.key}-${variant.toLowerCase()}`;
  if (await Page.findOne({ key: armKey }).lean()) throw conflict(`A page keyed "${armKey}" already exists`);

  const arm = await Page.create({
    ...source,
    _id: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    key: armKey,
    // An arm is never routed: the route field only has to be unique, and this
    // value is never turned into a URL. Excluding it from the sitemap and
    // marking it noindex is belt and braces for the same reason.
    route: `__variant/${armKey}`,
    routes: {},
    title: `${control.title} — ${req.body.label || `Variant ${variant}`}`,
    status: 'draft',
    noindex: true,
    sitemap: { include: false, priority: 0, changefreq: 'never' },
    sections: copyControl ? source.sections : (source.sections || []).filter(isChromeBlock),
    experiment: { key: experimentKey, variant, variantOf: control.key },
    editedInCms: true,
    publishedAt: null,
    updatedBy: req.user._id,
  });

  await audit(req, 'page.variant.create', 'page', control.key, { arm: armKey, variant });
  res.status(201).json({ page: asJson(arm) });
}));

pagesRouter.delete('/:key', requireRole('admin'), asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key });
  if (!page) throw notFoundError('No such page');
  // Forced: this snapshot is the page's only remaining copy, and the delete
  // usually follows an edit — exactly when the debounce would drop it.
  await snapshot('page', page.key, page.toObject(), req.user, 'before delete', { force: true });
  await page.deleteOne();
  await audit(req, 'page.delete', 'page', req.params.key);
  await publishChanged('page deleted');
  res.json({ ok: true });
}));

pagesRouter.post('/:key/publish', requireRole('editor'), asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.key });
  if (!page) throw notFoundError('No such page');

  // The last published state, kept deliberately: "put back what was live before
  // I published this" is the request that arrives when a publish goes wrong, and
  // an automatic snapshot from the edit before it is not the same thing.
  if (page.publishedAt) {
    await snapshot('page', page.key, page.toObject(), req.user,
      'the version that was live before this publish', { force: true });
  }

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
  const page = await Page.findOne({ key: req.params.key }, { route: 1, routes: 1, locales: 1 }).lean();
  if (!page) throw notFoundError('No such page');
  const locale = String(req.query.locale || page.locales?.[0] || 'fr');
  // The locale's own path, so the editor opens the URL the visitor would.
  const route = routeFor(page, locale);
  const target = `/${locale}${route ? `/${route}` : ''}`;
  // `edit=1` additionally turns on the visual editor's block annotations and
  // its bridge script. Plain preview renders the draft as a visitor would see it.
  const edit = req.query.edit ? '&edit=1' : '';
  const url = `${config.siteUrl}/cms/preview?secret=${encodeURIComponent(config.previewSecret)}`
    + `&redirect=${encodeURIComponent(target)}${edit}`;
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
