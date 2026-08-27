/*
 * redirects.js — old URLs kept alive.
 *
 * Matched in the frontend's middleware before anything else runs, so a redirect
 * costs one lookup and never a rendered page. Renaming a page writes these
 * automatically (see `pages.js`); this is the manual door for paths that were
 * never in the CMS.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Redirect } from '../../models/index.js';
import { asyncHandler, badRequest, notFoundError } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { audit, publishChanged } from '../../services/publish.js';

export const redirectsRouter = Router();

redirectsRouter.use(requireAuth);

redirectsRouter.get('/', asyncHandler(async (_req, res) => {
  res.json({ items: await Redirect.find({}).sort({ from: 1 }).lean() });
}));

const redirectBody = z.object({
  from: z.string().min(1).max(500),
  to: z.string().min(1).max(500),
  status: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).default(301),
  active: z.boolean().default(true),
  note: z.string().max(500).optional(),
});

/**
 * A redirect that points at itself is an infinite loop, not a redirect.
 *
 * It happens by hand and it also happens by accident: rename a path, rename it
 * back, and the automatic repointing can leave one behind. Refusing it here is
 * cheaper than diagnosing a redirect loop in production.
 */
const assertNotALoop = ({ from, to }) => {
  if (from !== undefined && to !== undefined && from === to) {
    throw badRequest('A redirect cannot point at itself');
  }
};

redirectsRouter.post('/', requireRole('editor'), validate(redirectBody), asyncHandler(async (req, res) => {
  assertNotALoop(req.body);
  const item = await Redirect.create(req.body);
  await audit(req, 'redirect.create', 'redirect', item._id, { from: item.from, to: item.to });
  await publishChanged('redirect added');
  res.status(201).json({ item: item.toObject() });
}));

redirectsRouter.patch('/:id', requireRole('editor'), validate(redirectBody.partial()), asyncHandler(async (req, res) => {
  const existing = await Redirect.findById(req.params.id).lean();
  if (!existing) throw notFoundError('No such redirect');
  assertNotALoop({ ...existing, ...req.body });

  const item = await Redirect.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
  await audit(req, 'redirect.update', 'redirect', item._id, { fields: Object.keys(req.body) });
  await publishChanged('redirect updated');
  res.json({ item: item.toObject() });
}));

redirectsRouter.delete('/:id', requireRole('editor'), asyncHandler(async (req, res) => {
  const item = await Redirect.findByIdAndDelete(req.params.id);
  if (!item) throw notFoundError('No such redirect');
  await audit(req, 'redirect.delete', 'redirect', req.params.id, { from: item.from });
  await publishChanged('redirect deleted');
  res.json({ ok: true });
}));
