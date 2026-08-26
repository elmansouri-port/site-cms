/*
 * strings.js — the translation surface.
 *
 * 1521 strings in five languages is a spreadsheet, not a form, so the endpoints
 * are built for that: filter by page/zone/missing, patch many rows in one
 * request, and import/export a whole locale as JSON for an outside translator.
 */
import { Router } from 'express';
import { z } from 'zod';
import { ContentString, Page } from '../../models/index.js';
import { asyncHandler, notFoundError, badRequest } from '../../middleware/error.js';
import { validate, q } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { audit, publishChanged } from '../../services/publish.js';
import { compileCatalogue, translationCoverage } from '../../services/catalogue.js';
import { flatten, unflatten } from '@rainbow/core/html';
import { settingsCached } from '../../services/content.js';

export const stringsRouter = Router();

stringsRouter.use(requireAuth);

const listQuery = z.object({
  page: z.string().max(80).optional(),
  zone: z.string().max(80).optional(),
  owner: z.enum(['content', 'seo', 'all']).default('content'),
  missing: z.string().max(5).optional(),
  q: z.string().max(200).optional(),
  keys: z.string().max(8000).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

stringsRouter.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const { page, zone, owner, missing, q: search, keys, limit, offset } = q(req);
  const filter = {};
  if (page) filter.page = page;
  if (zone) filter.zone = zone;
  if (owner !== 'all') filter.owner = owner;
  if (keys) filter.key = { $in: keys.split(',').map(s => s.trim()).filter(Boolean) };
  if (search) {
    const rx = { $regex: escapeRegex(search), $options: 'i' };
    filter.$or = [{ key: rx }, { 'values.fr': rx }, { 'values.en': rx }, { 'values.de': rx }];
  }
  if (missing) filter[`values.${missing}`] = { $in: [null, ''] };

  const [items, total] = await Promise.all([
    ContentString.find(filter).sort({ key: 1 }).skip(offset).limit(limit).lean(),
    ContentString.countDocuments(filter),
  ]);
  res.json({ items, total, limit, offset });
}));

/** Page / zone tree for the sidebar. */
stringsRouter.get('/tree', asyncHandler(async (_req, res) => {
  const rows = await ContentString.aggregate([
    { $group: { _id: { page: '$page', zone: '$zone' }, count: { $sum: 1 } } },
    { $sort: { '_id.page': 1, '_id.zone': 1 } },
  ]);
  const tree = {};
  for (const r of rows) {
    const page = r._id.page || 'common';
    tree[page] = tree[page] || { page, total: 0, zones: [] };
    tree[page].zones.push({ zone: r._id.zone || 'body', count: r.count });
    tree[page].total += r.count;
  }
  res.json({ items: Object.values(tree) });
}));

stringsRouter.get('/coverage', asyncHandler(async (_req, res) => {
  const settings = await settingsCached();
  const locales = (settings.locales || []).map(l => l.code);
  res.json({ coverage: await translationCoverage(locales.length ? locales : ['fr']) });
}));

const patchOne = z.object({
  values: z.record(z.string().max(5), z.union([z.string().max(20000), z.array(z.string().max(2000)), z.null()])),
  notes: z.string().max(2000).optional(),
});

stringsRouter.patch('/:key', requireRole('editor'), validate(patchOne), asyncHandler(async (req, res) => {
  const row = await ContentString.findOne({ key: req.params.key });
  if (!row) throw notFoundError('No such string');
  for (const [locale, value] of Object.entries(req.body.values)) {
    if (value === null) row.values.delete(locale);
    else row.values.set(locale, value);
  }
  if (req.body.notes !== undefined) row.notes = req.body.notes;
  row.updatedBy = req.user._id;
  await row.save();

  await audit(req, 'string.update', 'string', row.key, { locales: Object.keys(req.body.values) });
  await publishChanged('copy updated');
  res.json({ item: row.toObject() });
}));

const patchMany = z.object({
  items: z.array(z.object({
    key: z.string().max(300),
    values: z.record(z.string().max(5), z.union([z.string().max(20000), z.array(z.string().max(2000)), z.null()])),
  })).min(1).max(500),
});

/**
 * Placeholder-bearing values describe structure, not just words.
 *
 * A rich string reads `Welcome to <0>Rainbow</0>`, where the numbered
 * placeholders stand in for the inline children of the element it fills — a
 * link, an emphasis, a styled span. Writing a value with no placeholders over
 * one that had them deletes that structure, and the element renders as bare
 * text from then on.
 *
 * This refuses that write whatever asked for it. It cost the homepage headline
 * its word rotator once; a guard at the layer that owns the data is the only
 * place it cannot happen again.
 */
const PLACEHOLDER = /<\d+(?:\/>|>)/;

function wouldFlatten(existing, next) {
  if (typeof existing !== 'string' || typeof next !== 'string') return false;
  return PLACEHOLDER.test(existing) && !PLACEHOLDER.test(next);
}

stringsRouter.post('/bulk', requireRole('editor'), validate(patchMany), asyncHandler(async (req, res) => {
  const keys = req.body.items.map(i => i.key);
  const current = new Map(
    (await ContentString.find({ key: { $in: keys } }, { key: 1, values: 1, _id: 0 }).lean())
      .map(r => [r.key, r.values || {}]),
  );

  const refused = [];
  for (const item of req.body.items) {
    const existing = current.get(item.key) || {};
    for (const [locale, value] of Object.entries(item.values)) {
      if (wouldFlatten(existing[locale], value)) {
        refused.push({ key: item.key, locale });
        delete item.values[locale];
      }
    }
  }
  const items = req.body.items.filter(i => Object.keys(i.values).length);

  if (refused.length && !items.length) {
    throw badRequest(
      'That would remove the inline markup from a rich text string. Edit it in the copy editor, '
      + 'where the placeholders are visible.',
      refused,
    );
  }

  const ops = [];
  for (const item of items) {
    const set = {};
    const unset = {};
    for (const [locale, value] of Object.entries(item.values)) {
      if (value === null) unset[`values.${locale}`] = '';
      else set[`values.${locale}`] = value;
    }
    // A key a template references but the catalogue has never held is created
    // on first save; the page and zone come from the key itself, the way the
    // import does it.
    const [page, zone] = item.key.split('.');
    ops.push({
      updateOne: {
        filter: { key: item.key },
        update: {
          ...(Object.keys(set).length ? { $set: set } : {}),
          ...(Object.keys(unset).length ? { $unset: unset } : {}),
          $setOnInsert: { page: page || 'common', zone: zone || 'body', owner: 'content', type: 'text' },
        },
        upsert: true,
      },
    });
  }
  const result = await ContentString.bulkWrite(ops, { ordered: false });
  // The keys, not just how many. A count answers nothing: tracing a changed
  // string back to who changed it needs the key, and the single-item saves the
  // visual editor makes are exactly the case where that matters.
  await audit(req, 'string.bulk_update', 'string', items.length === 1 ? items[0].key : '', {
    count: items.length,
    keys: items.slice(0, 50).map(i => i.key),
    ...(refused.length ? { refused } : {}),
  });
  await publishChanged('copy bulk updated');
  res.json({
    ok: true,
    matched: result.matchedCount,
    modified: result.modifiedCount,
    // Named rather than swallowed: a partial save that says nothing is how an
    // editor comes to believe a change went in when it did not.
    ...(refused.length ? {
      refused,
      warning: 'Some values were not saved because they would have removed inline markup.',
    } : {}),
  });
}));

const createString = z.object({
  key: z.string().min(3).max(300).regex(/^[a-z0-9][a-z0-9._-]*$/i, 'Use dot notation, e.g. page.zone.name'),
  values: z.record(z.string().max(5), z.string().max(20000)).default({}),
  type: z.enum(['text', 'rich', 'list']).default('text'),
});

stringsRouter.post('/', requireRole('editor'), validate(createString), asyncHandler(async (req, res) => {
  const [page, zone] = req.body.key.split('.');
  const row = await ContentString.create({
    key: req.body.key,
    page: page || 'common',
    zone: zone || 'body',
    type: req.body.type,
    owner: 'content',
    values: req.body.values,
    updatedBy: req.user._id,
  });
  await audit(req, 'string.create', 'string', row.key);
  await publishChanged('copy added');
  res.status(201).json({ item: row.toObject() });
}));

stringsRouter.delete('/:key', requireRole('admin'), asyncHandler(async (req, res) => {
  const row = await ContentString.findOneAndDelete({ key: req.params.key });
  if (!row) throw notFoundError('No such string');
  await audit(req, 'string.delete', 'string', req.params.key);
  await publishChanged('copy removed');
  res.json({ ok: true });
}));

/** Export one locale as the nested JSON catalogue translators are used to. */
stringsRouter.get('/export/:locale', asyncHandler(async (req, res) => {
  const catalogue = await compileCatalogue(req.params.locale);
  res.set('content-disposition', `attachment; filename="${req.params.locale}.json"`);
  res.json(catalogue);
}));

const importBody = z.object({
  catalogue: z.record(z.string(), z.any()),
  createMissing: z.boolean().default(false),
  overwrite: z.boolean().default(true),
});

stringsRouter.post('/import/:locale', requireRole('editor'), validate(importBody), asyncHandler(async (req, res) => {
  const locale = req.params.locale;
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) throw badRequest('Not a locale code');
  const pairs = flatten(req.body.catalogue);

  const existing = new Set((await ContentString.find({}, { key: 1, _id: 0 }).lean()).map(r => r.key));
  const ops = [];
  let created = 0;
  let updated = 0;

  for (const [key, value] of Object.entries(pairs)) {
    if (typeof value !== 'string' && !Array.isArray(value)) continue;
    if (!existing.has(key)) {
      if (!req.body.createMissing) continue;
      const [page, zone] = key.split('.');
      ops.push({
        insertOne: {
          document: {
            key, page: page || 'common', zone: zone || 'body', owner: 'content',
            type: Array.isArray(value) ? 'list' : 'text', values: { [locale]: value },
          },
        },
      });
      created++;
    } else {
      ops.push({
        updateOne: {
          filter: req.body.overwrite ? { key } : { key, [`values.${locale}`]: { $in: [null, ''] } },
          update: { $set: { [`values.${locale}`]: value } },
        },
      });
      updated++;
    }
  }
  if (ops.length) await ContentString.bulkWrite(ops, { ordered: false });

  await audit(req, 'string.import', 'string', locale, { created, updated });
  await publishChanged('catalogue imported');
  res.json({ ok: true, created, updated });
}));

/** Every string a given page's blocks reference, in document order. */
stringsRouter.get('/for-page/:pageKey', asyncHandler(async (req, res) => {
  const page = await Page.findOne({ key: req.params.pageKey }, { sections: 1, seoKeys: 1 }).lean();
  if (!page) throw notFoundError('No such page');
  const bySection = (page.sections || []).map(s => ({ section: s.key, label: s.label, keys: s.keys || [] }));
  const all = [...new Set(bySection.flatMap(s => s.keys))];
  const rows = await ContentString.find({ key: { $in: all } }).lean();
  const index = Object.fromEntries(rows.map(r => [r.key, r]));

  // A developer can add a marker to a template before any copy exists for it.
  // Returning a stub means the editor can see the key and fill it in, instead
  // of the string being invisible in the CMS and untranslated on the site.
  for (const key of all) {
    if (index[key]) continue;
    const [page_, zone] = key.split('.');
    index[key] = {
      key, page: page_ || 'common', zone: zone || 'body',
      owner: 'content', type: 'text', values: {}, missing: true,
    };
  }

  res.json({ sections: bySection, strings: index, seoKeys: page.seoKeys || [] });
}));

/** Round trip check used by the CMS "preview compiled catalogue" action. */
stringsRouter.get('/compiled/:locale', asyncHandler(async (req, res) => {
  const catalogue = await compileCatalogue(req.params.locale);
  res.json({ locale: req.params.locale, keys: Object.keys(flatten(catalogue)).length, catalogue: unflatten(flatten(catalogue)) });
}));

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
