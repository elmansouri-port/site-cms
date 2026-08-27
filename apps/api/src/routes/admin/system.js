/*
 * system.js — the operational surface: the cache and the audit log.
 *
 * Everything that is a content type has its own router. This is what is left:
 * the two levers an operator pulls, and the record of what everybody else did.
 */
import { Router } from 'express';
import { z } from 'zod';
import { AuditLog } from '../../models/index.js';
import { asyncHandler } from '../../middleware/error.js';
import { q, validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { audit, publishChanged } from '../../services/publish.js';
import { bumpRevision } from '../../lib/redis.js';

export const systemRouter = Router();

systemRouter.use(requireAuth);

/**
 * Retire every cached page at once.
 *
 * Publishing does this on its own, so reaching for it means something got out
 * of step — a direct database change, a restored backup, a deploy of the
 * frontend. Worth having, not worth needing.
 */
systemRouter.post('/cache/purge', requireRole('editor'), asyncHandler(async (req, res) => {
  const rev = await bumpRevision('manual purge');
  const result = await publishChanged('manual purge');
  await audit(req, 'cache.purge', 'cache', '');
  res.json({ ok: true, revision: rev, ...result });
}));

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  entity: z.string().max(40).optional(),
  action: z.string().max(60).optional(),
});

systemRouter.get('/audit', requireRole('admin'), validate(auditQuery, 'query'), asyncHandler(async (req, res) => {
  const { limit, entity, action } = q(req);
  const filter = {};
  if (entity) filter.entity = entity;
  if (action) filter.action = action;
  const items = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ items });
}));
