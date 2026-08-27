/*
 * experiments.js — the A/B tests a block, a page or the chrome can opt into.
 *
 * The record here holds the split and the assignment rule; what actually varies
 * is named by whatever opts in (a section's `experiment.key`, a page's, a chrome
 * part's). Two modes, as described in reco.md 3: a cookie-assigned split that
 * persists for a fortnight, and a URL-parameter variant for ad campaigns that is
 * never indexed and never remembered.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Experiment } from '../../models/index.js';
import { asyncHandler, conflict, notFoundError } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { audit, publishChanged } from '../../services/publish.js';

export const experimentsRouter = Router();

experimentsRouter.use(requireAuth);

experimentsRouter.get('/', asyncHandler(async (_req, res) => {
  res.json({ items: await Experiment.find({}).sort({ createdAt: -1 }).lean() });
}));

const experimentBody = z.object({
  key: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(['draft', 'running', 'paused', 'finished']).default('draft'),
  pageKey: z.string().max(80).nullable().optional(),
  // `block` varies one section; `page` serves a whole alternative page document
  // at the control's URL.
  scope: z.enum(['block', 'page']).default('block'),
  mode: z.enum(['cookie', 'param']).default('cookie'),
  paramName: z.string().max(40).default('version'),
  cookieDays: z.number().int().min(1).max(365).default(14),
  variants: z.array(z.object({
    key: z.string().min(1).max(20),
    label: z.string().max(80).optional(),
    weight: z.number().int().min(0).max(100).default(50),
  })).min(2).max(6),
});

experimentsRouter.post('/', requireRole('editor'), validate(experimentBody), asyncHandler(async (req, res) => {
  if (await Experiment.exists({ key: req.body.key })) throw conflict('A test with that key already exists');
  const item = await Experiment.create({
    ...req.body,
    startedAt: req.body.status === 'running' ? new Date() : null,
  });
  await audit(req, 'experiment.create', 'experiment', item.key, { scope: item.scope });
  await publishChanged('experiment created');
  res.status(201).json({ item: item.toObject() });
}));

experimentsRouter.patch('/:key', requireRole('editor'), validate(experimentBody.partial()), asyncHandler(async (req, res) => {
  const item = await Experiment.findOne({ key: req.params.key });
  if (!item) throw notFoundError('No such experiment');

  // The key is in cookies and in whatever read the results; changing it would
  // orphan both, and every block that named it.
  const { key: _ignored, ...changes } = req.body;
  Object.assign(item, changes);
  if (changes.status === 'running' && !item.startedAt) item.startedAt = new Date();
  if (changes.status === 'finished') item.endedAt = new Date();
  await item.save();

  await audit(req, 'experiment.update', 'experiment', item.key, { status: item.status });
  await publishChanged('experiment updated');
  res.json({ item: item.toObject() });
}));

experimentsRouter.delete('/:key', requireRole('editor'), asyncHandler(async (req, res) => {
  const item = await Experiment.findOneAndDelete({ key: req.params.key });
  if (!item) throw notFoundError('No such experiment');
  // Blocks still naming this key fall back to their control markup, so deleting
  // a test cannot break a page.
  await audit(req, 'experiment.delete', 'experiment', req.params.key);
  await publishChanged('experiment deleted');
  res.json({ ok: true });
}));
