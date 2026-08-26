/*
 * chrome.js — the site's header and footer, edited once.
 *
 * Before this they lived eighteen times over, one copy per migrated page, which
 * is how the German footer ended up saying different things depending on which
 * page you were reading. Now there is one document, and a page carries only a
 * placeholder saying where the header goes.
 *
 * `authoredHtml` is the copy taken from the homepage at migration time. It is
 * never written again, so "restore the original" always works — which is what
 * makes it reasonable to let a marketer edit the header at all.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Chrome } from '../../models/index.js';
import { asyncHandler, notFoundError, badRequest } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { snapshot, audit, publishChanged } from '../../services/publish.js';
import { slugify } from '@rainbow/core/html';

export const chromeRouter = Router();

chromeRouter.use(requireAuth);

const asJson = (doc) => doc.toObject({ flattenMaps: true });

const partBody = z.object({
  html: z.string().max(2_000_000).optional(),
  css: z.string().max(200_000).optional(),
  js: z.string().max(200_000).optional(),
  visible: z.boolean().optional(),
  experiment: z.object({
    key: z.string().max(80).nullable().optional(),
    variants: z.array(z.object({
      key: z.string().max(20),
      label: z.string().max(80).optional(),
      html: z.string().max(2_000_000).optional(),
      css: z.string().max(200_000).optional(),
      js: z.string().max(200_000).optional(),
    })).max(6).optional(),
  }).optional(),
}).strict();

const addInExperiment = z.object({
  key: z.string().max(80).nullable().optional(),
  variants: z.array(z.object({
    key: z.string().max(20),
    label: z.string().max(80).optional(),
    html: z.string().max(200_000).optional(),
  })).max(6).optional(),
});

const addInBody = z.object({
  key: z.string().max(80).optional(),
  label: z.string().max(120),
  note: z.string().max(1000).optional(),
  zone: z.enum(['head', 'bodyStart', 'bodyEnd']).default('bodyEnd'),
  html: z.string().max(200_000).default(''),
  enabled: z.boolean().default(false),
  order: z.number().int().min(0).max(999).optional(),
  pages: z.array(z.string().max(80)).max(200).optional(),
  experiment: addInExperiment.optional(),
}).strict();

/**
 * The patch schema is written out rather than derived with `.partial()`.
 *
 * `.partial()` makes every field optional but leaves its `.default()` in place,
 * so parsing `{ enabled: true }` returns `{ enabled: true, html: '' }` — and a
 * handler that assigns whatever it is given would blank the add-in's markup
 * while apparently just switching it on. Only the fields the caller actually
 * sent may reach the document.
 */
const addInPatch = z.object({
  label: z.string().max(120).optional(),
  note: z.string().max(1000).optional(),
  zone: z.enum(['head', 'bodyStart', 'bodyEnd']).optional(),
  html: z.string().max(200_000).optional(),
  enabled: z.boolean().optional(),
  order: z.number().int().min(0).max(999).optional(),
  pages: z.array(z.string().max(80)).max(200).optional(),
  experiment: addInExperiment.optional(),
}).strict();

async function load(key = 'default') {
  const doc = await Chrome.findOne({ key });
  if (!doc) throw notFoundError('The site header and footer have not been set up — run the seed');
  return doc;
}

chromeRouter.get('/', asyncHandler(async (_req, res) => {
  const doc = await Chrome.findOne({ key: 'default' }).lean();
  res.json({ chrome: doc || null });
}));

chromeRouter.patch('/:part', requireRole('admin'), validate(partBody), asyncHandler(async (req, res) => {
  const part = req.params.part;
  if (part !== 'navbar' && part !== 'footer') throw badRequest('Expected navbar or footer');

  const doc = await load();
  await snapshot('chrome', 'default', asJson(doc), req.user, `before editing the ${part}`);

  for (const field of ['html', 'css', 'js', 'visible']) {
    if (req.body[field] !== undefined) doc[part][field] = req.body[field];
  }
  if (req.body.experiment) {
    const current = doc[part].experiment?.toObject?.() ?? doc[part].experiment ?? {};
    doc[part].experiment = { ...current, ...req.body.experiment };
    doc.markModified(`${part}.experiment`);
  }
  if (req.body.html !== undefined) {
    doc[part].edited = req.body.html !== doc[part].authoredHtml;
  }
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, 'chrome.update', 'chrome', part, { fields: Object.keys(req.body) });
  // Every page renders this, so the whole cache generation has to retire.
  await publishChanged(`${part} updated`);
  res.json({ chrome: asJson(doc) });
}));

/**
 * Put a part back to the markup the site was migrated with.
 *
 * The escape hatch that makes the header safe to hand to a non-developer: the
 * worst case is one click away from being undone.
 */
chromeRouter.post('/:part/restore', requireRole('admin'), asyncHandler(async (req, res) => {
  const part = req.params.part;
  if (part !== 'navbar' && part !== 'footer') throw badRequest('Expected navbar or footer');

  const doc = await load();
  if (!doc[part].authoredHtml) throw badRequest('There is no original recorded for this part');

  await snapshot('chrome', 'default', asJson(doc), req.user, `before restoring the ${part}`);
  doc[part].html = doc[part].authoredHtml;
  doc[part].css = '';
  doc[part].js = '';
  doc[part].edited = false;
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, 'chrome.restore', 'chrome', part);
  await publishChanged(`${part} restored`);
  res.json({ chrome: asJson(doc) });
}));

/* ── Add-ins ──────────────────────────────────────────────────────────────── */

chromeRouter.post('/add-ins', requireRole('admin'), validate(addInBody), asyncHandler(async (req, res) => {
  const doc = await load();
  const base = slugify(req.body.key || req.body.label, 48) || 'add-in';
  let key = base;
  let n = 1;
  while (doc.addIns.some(a => a.key === key)) key = `${base}-${++n}`;

  doc.addIns.push({
    ...req.body,
    key,
    order: req.body.order ?? doc.addIns.length,
  });
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, 'chrome.addin.create', 'chrome', key);
  await publishChanged('add-in created');
  res.status(201).json({ chrome: asJson(doc) });
}));

chromeRouter.patch('/add-ins/:key', requireRole('admin'), validate(addInPatch), asyncHandler(async (req, res) => {
  const doc = await load();
  const addIn = doc.addIns.find(a => a.key === req.params.key);
  if (!addIn) throw notFoundError('No such add-in');

  await snapshot('chrome', 'default', asJson(doc), req.user, `before editing add-in "${addIn.label}"`);
  for (const [field, value] of Object.entries(req.body)) {
    if (value === undefined) continue;
    addIn[field] = value;
  }
  doc.markModified('addIns');
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, 'chrome.addin.update', 'chrome', addIn.key, { enabled: addIn.enabled });
  await publishChanged('add-in updated');
  res.json({ chrome: asJson(doc) });
}));

chromeRouter.delete('/add-ins/:key', requireRole('admin'), asyncHandler(async (req, res) => {
  const doc = await load();
  const at = doc.addIns.findIndex(a => a.key === req.params.key);
  if (at < 0) throw notFoundError('No such add-in');

  await snapshot('chrome', 'default', asJson(doc), req.user, 'before deleting an add-in');
  doc.addIns.splice(at, 1);
  doc.addIns.forEach((a, i) => { a.order = i; });
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, 'chrome.addin.delete', 'chrome', req.params.key);
  await publishChanged('add-in deleted');
  res.json({ chrome: asJson(doc) });
}));
