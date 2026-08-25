/*
 * navigation.js — navbar and megamenu.
 *
 * Item order is user-defined and persisted on save (reco.md 10.1), and each
 * megamenu zone is independently optional (10.2): an empty `features` or
 * `footer` zone is stored as empty and the frontend renders no container for
 * it, so `main` fills the width with no leftover border or padding.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Navigation } from '../../models/index.js';
import { asyncHandler, notFoundError } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { snapshot, audit, publishChanged } from '../../services/publish.js';

export const navRouter = Router();

navRouter.use(requireAuth);

const localised = z.record(z.string().max(5), z.string().max(500));

const megaLink = z.object({
  label: localised.default({}),
  description: localised.default({}),
  mobileDescription: localised.default({}),
  href: z.string().max(500).default(''),
  icon: z.string().max(60).default(''),
  badge: localised.default({}),
  column: z.number().int().min(1).max(2).default(1),
  variant: z.enum(['item', 'showcase', 'cta']).default('item'),
});

const megamenu = z.object({
  enabled: z.boolean().default(false),
  main: z.object({
    title: localised.default({}),
    links: z.array(megaLink).default([]),
    seeAll: localised.default({}),
    seeAllHref: z.string().max(500).default(''),
  }).default({}),
  features: z.object({
    title: localised.default({}),
    links: z.array(megaLink).default([]),
  }).default({}),
  footer: z.object({
    text: localised.default({}),
    primaryLabel: localised.default({}),
    primaryHref: z.string().max(500).default(''),
    secondaryLabel: localised.default({}),
    secondaryHref: z.string().max(500).default(''),
  }).default({}),
});

const navItem = z.object({
  key: z.string().min(1).max(80),
  label: localised.default({}),
  href: z.string().max(500).default(''),
  visible: z.boolean().default(true),
  target: z.enum(['_self', '_blank']).default('_self'),
  megamenu: megamenu.default({}),
});

const navBody = z.object({
  label: z.string().max(120).optional(),
  items: z.array(navItem).max(20),
});

navRouter.get('/', asyncHandler(async (_req, res) => {
  const menus = await Navigation.find({}, { key: 1, label: 1, items: 1 }).lean();
  res.json({ items: menus });
}));

navRouter.get('/:key', asyncHandler(async (req, res) => {
  const menu = await Navigation.findOne({ key: req.params.key }).lean();
  if (!menu) throw notFoundError('No such menu');
  res.json({ menu });
}));

navRouter.put('/:key', requireRole('editor'), validate(navBody), asyncHandler(async (req, res) => {
  const existing = await Navigation.findOne({ key: req.params.key });
  if (existing) await snapshot('navigation', existing.key, existing.toObject(), req.user, 'before edit');

  // The array order the client sends is the order visitors see; store it as an
  // explicit index so nothing depends on Mongo preserving array order.
  const items = req.body.items.map((item, i) => ({ ...item, order: i }));

  const menu = await Navigation.findOneAndUpdate(
    { key: req.params.key },
    { $set: { items, label: req.body.label ?? existing?.label ?? req.params.key } },
    { new: true, upsert: true },
  );

  await audit(req, 'navigation.update', 'navigation', menu.key, { items: items.length });
  await publishChanged('navigation updated');
  res.json({ menu: menu.toObject() });
}));
