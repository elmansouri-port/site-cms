/*
 * versions.js — the history, and getting out of trouble with it.
 *
 * The endpoints are deliberately uniform across entity types: a page, an
 * article, the header and footer, a menu and the settings all answer to the
 * same four calls, so the CMS has one History panel rather than five. What each
 * entity contributes — how to load it, how to write it back, how to describe it
 * — lives in `services/history.js`.
 *
 * The `/detail/…` routes are declared before `/:entity/:entityId`, because
 * Express matches in declaration order and the two-segment pattern would
 * otherwise swallow them with `entity: 'detail'`.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Version } from '../../models/index.js';
import { asyncHandler, badRequest, notFoundError } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { audit, publishChanged } from '../../services/publish.js';
import {
  HISTORY_LIMIT, entityLabel, historyEntities, listVersions, loadCurrent, restoreVersion,
  snapshotCurrent, supportsHistory,
} from '../../services/history.js';

export const versionsRouter = Router();

versionsRouter.use(requireAuth);

/** Reject an unknown entity here so every handler below can assume a good one. */
function assertEntity(entity) {
  if (!supportsHistory(entity)) {
    throw badRequest(`"${entity}" has no history`, [`Known: ${historyEntities.join(', ')}`]);
  }
}

/* ── One version ──────────────────────────────────────────────────────────── */

versionsRouter.get('/detail/:id', asyncHandler(async (req, res) => {
  const version = await Version.findById(req.params.id).populate('createdBy', 'name email').lean();
  if (!version) throw notFoundError('No such version');
  res.json({ version });
}));

/**
 * Put a version back.
 *
 * The state being replaced is snapshotted first, so restoring the wrong one is
 * one more click rather than a second mistake. The response names that restore
 * point as `undo`.
 */
versionsRouter.post('/detail/:id/restore', requireRole('editor'), asyncHandler(async (req, res) => {
  const result = await restoreVersion(req.params.id, req.user);
  if (result.error === 'notFound') throw notFoundError('No such version');
  if (result.error === 'unsupported') throw badRequest(`Restoring ${result.entity} is not supported`);

  await audit(req, 'version.restore', result.entity, result.entityId, { versionId: req.params.id });
  await publishChanged('version restored');
  res.json({ ok: true, ...result });
}));

/**
 * Forget a restore point.
 *
 * Admin only, and there is no bulk form: the whole value of a history is that
 * nobody can quietly tidy it away.
 */
versionsRouter.delete('/detail/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  const version = await Version.findByIdAndDelete(req.params.id);
  if (!version) throw notFoundError('No such version');
  await audit(req, 'version.delete', version.entity, version.entityId, { versionId: req.params.id });
  res.json({ ok: true });
}));

/* ── One item's history ───────────────────────────────────────────────────── */

versionsRouter.get('/:entity/:entityId', asyncHandler(async (req, res) => {
  const { entity, entityId } = req.params;
  assertEntity(entity);
  // The live document, so the newest snapshot can say what replaced it.
  const current = await loadCurrent(entity, entityId);
  const items = await listVersions(entity, entityId, { current });
  res.json({ items, limit: HISTORY_LIMIT, exists: !!current });
}));

const newRestorePoint = z.object({
  label: z.string().min(1).max(120).default('Restore point'),
});

/**
 * Save the current state under a name.
 *
 * The one an editor actually reaches for: "I am about to rewrite the pricing
 * page and I want a way back". Automatic snapshots cover the accidents; this
 * covers the deliberate risks, which are the ones taken on a Friday afternoon.
 */
versionsRouter.post(
  '/:entity/:entityId',
  requireRole('editor'),
  validate(newRestorePoint),
  asyncHandler(async (req, res) => {
    const { entity, entityId } = req.params;
    assertEntity(entity);
    const created = await snapshotCurrent(entity, entityId, req.user, req.body.label);
    if (!created) throw notFoundError(`No such ${entityLabel(entity)}`);

    await audit(req, 'version.create', entity, entityId, { label: req.body.label });
    res.status(201).json({ id: String(created._id), label: created.label, createdAt: created.createdAt });
  }),
);
