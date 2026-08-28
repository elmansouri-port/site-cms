/*
 * partners.js — the partner directory behind the "find a partner" locator.
 *
 * The locator page fetches its dataset from a fixed URL and renders the map
 * client-side. Keeping that URL while moving the data into MongoDB is what lets
 * the page stay untouched and the directory become editable.
 *
 * ── What the locator actually reads ─────────────────────────────────────────
 *
 * `raw` is the object the page receives, one per partner, and the page reads
 * `name`, `country`, `hq`, `lat`, `lng`, `phone`, `website` and `keywords` from
 * it. Two of those — `hq` and `keywords` — were not fields on the model and were
 * not in `buildRaw`, so saving a partner from the CMS **deleted them**: the
 * partner moved to the wrong filter, lost its head-office marker on the map, and
 * stopped matching the search terms it used to.
 *
 * So `buildRaw` now carries them, and anything else the source data supplied is
 * preserved rather than rebuilt from a fixed list of fields.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Partner } from '../../models/index.js';
import { asyncHandler, notFoundError, badRequest } from '../../middleware/error.js';
import { validate, q } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { audit, publishChanged } from '../../services/publish.js';
import { logger } from '../../lib/log.js';

export const partnersRouter = Router();

partnersRouter.use(requireAuth);

const listQuery = z.object({
  country: z.string().max(80).optional(),
  q: z.string().max(120).optional(),
  active: z.enum(['true', 'false']).optional(),
  hq: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

partnersRouter.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const { country, q: search, active, hq, limit, offset } = q(req);
  const filter = {};
  if (country) filter.country = country;
  if (active) filter.active = active === 'true';
  if (hq) filter.hq = hq === 'true';
  if (search) {
    const rx = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    // The locator searches name, country and keywords together, so the admin
    // list finding fewer partners than the public page would be confusing.
    filter.$or = [{ name: rx }, { country: rx }, { keywords: rx }];
  }

  const [items, total, countries, withCoords, headOffices] = await Promise.all([
    Partner.find(filter, { raw: 0 }).sort({ name: 1 }).skip(offset).limit(limit).lean(),
    Partner.countDocuments(filter),
    Partner.distinct('country'),
    // The two numbers that decide whether the map works. A partner with no
    // coordinates is in the list and not on the map, which is the failure mode
    // nobody notices until somebody asks why the map looks empty.
    Partner.countDocuments({ active: true, lat: { $ne: null }, lng: { $ne: null } }),
    Partner.countDocuments({ active: true, hq: true }),
  ]);

  res.json({
    items,
    total,
    countries: countries.filter(Boolean).sort(),
    stats: { withCoords, headOffices },
  });
}));

const partnerBody = z.object({
  name: z.string().min(1, 'A partner needs a name').max(200),
  country: z.string().max(80).optional(),
  city: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  postalCode: z.string().max(30).optional(),
  website: z.string().max(300).optional(),
  phone: z.string().max(60).optional(),
  email: z.string().max(200).optional(),
  level: z.string().max(60).optional(),
  specialties: z.array(z.string().max(80)).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  // Read by the locator's filter buttons and its map markers.
  hq: z.boolean().optional(),
  keywords: z.string().max(2000).optional(),
  active: z.boolean().optional(),
});

partnersRouter.post('/', requireRole('editor'), validate(partnerBody), asyncHandler(async (req, res) => {
  const partner = await Partner.create({ ...req.body, raw: buildRaw(req.body) });
  await audit(req, 'partner.create', 'partner', partner._id, { name: partner.name });
  await publishChanged('partner added');
  res.status(201).json({ item: partner.toObject() });
}));

partnersRouter.patch('/:id', requireRole('editor'), validate(partnerBody.partial()), asyncHandler(async (req, res) => {
  const partner = await Partner.findById(req.params.id);
  if (!partner) throw notFoundError('No such partner');
  Object.assign(partner, req.body);
  // The locator reads `raw`, so keep it in step with the structured fields —
  // merged over whatever the import supplied, never rebuilt from scratch, so a
  // field the CMS does not model is not silently dropped by an edit.
  partner.raw = { ...(partner.raw || {}), ...buildRaw(partner.toObject()) };
  partner.markModified('raw');
  await partner.save();
  await audit(req, 'partner.update', 'partner', partner._id);
  await publishChanged('partner updated');
  res.json({ item: partner.toObject() });
}));

partnersRouter.delete('/:id', requireRole('editor'), asyncHandler(async (req, res) => {
  const partner = await Partner.findByIdAndDelete(req.params.id);
  if (!partner) throw notFoundError('No such partner');
  await audit(req, 'partner.delete', 'partner', req.params.id);
  await publishChanged('partner removed');
  res.json({ ok: true });
}));

/* ── Import ───────────────────────────────────────────────────────────────── */

/**
 * The shape the source export uses, and every reasonable spelling of it.
 *
 * The directory is 1,130 rows maintained somewhere else and exported as JSON, so
 * "load this file" is the normal way it gets updated — not "type 1,130 partners
 * into a form". The alternative was a route that takes one partner at a time and
 * a script that calls it 1,130 times, which is 1,130 audit entries and 1,130
 * cache invalidations for one logical change.
 */
const importRow = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  externalId: z.union([z.string(), z.number()]).optional(),
  name: z.string().min(1).max(200).optional(),
  company: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  country: z.string().max(80).optional(),
  pays: z.string().max(80).optional(),
  city: z.string().max(120).optional(),
  ville: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  zip: z.string().max(30).optional(),
  postalCode: z.string().max(30).optional(),
  website: z.string().max(300).optional(),
  url: z.string().max(300).optional(),
  phone: z.string().max(60).optional(),
  email: z.string().max(200).optional(),
  level: z.string().max(60).optional(),
  tier: z.string().max(60).optional(),
  hq: z.union([z.boolean(), z.string(), z.number()]).optional(),
  keywords: z.string().max(4000).optional(),
  specialties: z.array(z.string().max(80)).optional(),
  lat: z.union([z.number(), z.string()]).nullable().optional(),
  lng: z.union([z.number(), z.string()]).nullable().optional(),
  latitude: z.union([z.number(), z.string()]).nullable().optional(),
  longitude: z.union([z.number(), z.string()]).nullable().optional(),
  active: z.boolean().optional(),
}).passthrough();

const importBody = z.object({
  items: z.array(importRow).min(1, 'Nothing to import').max(20_000),
  /**
   * `replace` deletes the partners this import does not mention.
   *
   * Off by default, and it has to be: an import of one country's partners with
   * replace on would delete the other eighty-one. On, it is what makes the file
   * the source of truth — which is what somebody re-exporting the whole
   * directory actually wants.
   */
  replace: z.boolean().default(false),
}).strict();

const asNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** `true`, `"true"`, `"Y"`, `1` — an export's idea of a boolean. */
const asBool = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return /^(1|true|yes|y|oui|ja)$/i.test(value.trim());
  return false;
};

/** One row of an export, as this model stores it. */
function fromRow(raw, index) {
  const name = raw.name || raw.company || raw.title || '';
  const externalId = String(raw.id ?? raw.externalId ?? `${name}-${index}`);
  return {
    externalId,
    name: name || `Partner ${index + 1}`,
    country: raw.country || raw.pays || '',
    city: raw.city || raw.ville || '',
    address: raw.address || '',
    postalCode: raw.zip || raw.postalCode || '',
    website: raw.website || raw.url || '',
    phone: raw.phone || '',
    email: raw.email || '',
    level: raw.level || raw.tier || '',
    specialties: Array.isArray(raw.specialties) ? raw.specialties : [],
    lat: asNumber(raw.lat ?? raw.latitude),
    lng: asNumber(raw.lng ?? raw.longitude),
    hq: asBool(raw.hq),
    keywords: typeof raw.keywords === 'string' ? raw.keywords : '',
    active: raw.active !== false,
    // The row as supplied, which is what the locator receives. Kept whole so a
    // field this model does not know about still reaches the page.
    raw,
  };
}

partnersRouter.post('/import', requireRole('admin'), validate(importBody), asyncHandler(async (req, res) => {
  const rows = req.body.items.map(fromRow);

  // A duplicate id within one file would make the upsert order decide the
  // winner, which is not a decision to leave to chance.
  const seen = new Set();
  const duplicates = [];
  for (const row of rows) {
    if (seen.has(row.externalId)) duplicates.push(row.externalId);
    seen.add(row.externalId);
  }
  if (duplicates.length) {
    throw badRequest(
      `The file has ${duplicates.length} duplicate id(s), so it is ambiguous which row wins`,
      [...new Set(duplicates)].slice(0, 10).map(id => ({ path: id, message: 'appears more than once' })),
    );
  }

  const before = await Partner.countDocuments({});
  const ops = rows.map(row => ({
    updateOne: { filter: { externalId: row.externalId }, update: { $set: row }, upsert: true },
  }));
  let upserted = 0;
  let modified = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const result = await Partner.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    upserted += result.upsertedCount || 0;
    modified += result.modifiedCount || 0;
  }

  let removed = 0;
  if (req.body.replace) {
    const { deletedCount } = await Partner.deleteMany({ externalId: { $nin: [...seen] } });
    removed = deletedCount || 0;
  }

  const [total, withCoords] = await Promise.all([
    Partner.countDocuments({}),
    Partner.countDocuments({ active: true, lat: { $ne: null }, lng: { $ne: null } }),
  ]);

  logger.info({ upserted, modified, removed, total }, 'partner directory imported');
  await audit(req, 'partner.import', 'partner', '', { rows: rows.length, upserted, modified, removed });
  await publishChanged('partner directory imported');

  res.json({
    ok: true,
    read: rows.length,
    added: upserted,
    updated: modified,
    removed,
    before,
    total,
    // Said back, because a directory that imported cleanly and has no
    // coordinates is a map with no pins on it, and that is worth knowing now.
    withCoords,
    ...(withCoords < total
      ? { warning: `${total - withCoords} partner(s) have no coordinates and will not appear on the map` }
      : {}),
  });
}));

/**
 * Rebuild the `raw` object the locator reads from the structured fields.
 *
 * Only the keys the page uses, spelled the way it expects them. Merged over the
 * imported row by the callers rather than replacing it, so a field this model
 * does not know about survives an edit — which is the bug that lost `hq` and
 * `keywords` the first time.
 */
function buildRaw(p) {
  const raw = {};
  const map = {
    name: 'name', country: 'country', city: 'city', address: 'address',
    postalCode: 'zip', website: 'website', phone: 'phone', email: 'email',
    level: 'level', lat: 'lat', lng: 'lng', keywords: 'keywords',
  };
  for (const [field, key] of Object.entries(map)) {
    if (p[field] !== undefined && p[field] !== null && p[field] !== '') raw[key] = p[field];
  }
  // Written unconditionally, including when false: the locator's "subsidiaries"
  // filter tests `!p.hq`, so an absent key and `false` mean the same thing to it
  // — but an absent key also means "this partner was edited and lost its value",
  // and those two must not look alike in the data.
  raw.hq = !!p.hq;
  if (p.specialties?.length) raw.specialties = p.specialties;
  return raw;
}
