/*
 * partners.js — the partner directory behind the "find a partner" locator.
 *
 * The locator page fetches its dataset from a fixed URL and renders the map
 * client-side. Keeping that URL while moving the data into MongoDB is what lets
 * the page stay untouched and the directory become editable.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Partner } from '../../models/index.js';
import { asyncHandler, notFoundError } from '../../middleware/error.js';
import { validate, q } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { audit, publishChanged } from '../../services/publish.js';

export const partnersRouter = Router();

partnersRouter.use(requireAuth);

const listQuery = z.object({
  country: z.string().max(80).optional(),
  q: z.string().max(120).optional(),
  active: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

partnersRouter.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const { country, q: search, active, limit, offset } = q(req);
  const filter = {};
  if (country) filter.country = country;
  if (active) filter.active = active === 'true';
  if (search) filter.name = { $regex: String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };

  const [items, total, countries] = await Promise.all([
    Partner.find(filter, { raw: 0 }).sort({ name: 1 }).skip(offset).limit(limit).lean(),
    Partner.countDocuments(filter),
    Partner.distinct('country'),
  ]);
  res.json({ items, total, countries: countries.filter(Boolean).sort() });
}));

const partnerBody = z.object({
  name: z.string().min(1).max(200),
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
  // The locator reads `raw`, so keep it in step with the structured fields.
  partner.raw = { ...(partner.raw || {}), ...buildRaw(partner.toObject()) };
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

function buildRaw(p) {
  const raw = {};
  const map = {
    name: 'name', country: 'country', city: 'city', address: 'address',
    postalCode: 'zip', website: 'website', phone: 'phone', email: 'email',
    level: 'level', lat: 'lat', lng: 'lng',
  };
  for (const [field, key] of Object.entries(map)) {
    if (p[field] !== undefined && p[field] !== null && p[field] !== '') raw[key] = p[field];
  }
  if (p.specialties?.length) raw.specialties = p.specialties;
  return raw;
}
