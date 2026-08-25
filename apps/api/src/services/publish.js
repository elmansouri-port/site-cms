/*
 * publish.js — what happens when an editor hits Publish.
 *
 * Three things, in order: snapshot the previous state so it can be restored,
 * retire the cache generation, and tell the frontend to drop its own copy
 * (reco.md 7: webhook on publish, secret header, {locale, slug} payload).
 * The webhook is best-effort — a frontend that is down must not make the
 * publish fail; its cache expires on its own.
 */
import { Version, AuditLog } from '../models/index.js';
import { bumpRevision } from '../lib/redis.js';
import { config } from '../config.js';
import { logger } from '../lib/log.js';

export async function snapshot(entity, entityId, doc, user, label = '') {
  try {
    await Version.create({
      entity,
      entityId: String(entityId),
      label,
      snapshot: doc,
      createdBy: user?._id || null,
    });
    // Keep the history readable: the last 30 versions per entity.
    const old = await Version.find({ entity, entityId: String(entityId) })
      .sort({ createdAt: -1 }).skip(30).select('_id').lean();
    if (old.length) await Version.deleteMany({ _id: { $in: old.map(o => o._id) } });
  } catch (err) {
    logger.warn({ err: err.message, entity, entityId }, 'could not store version snapshot');
  }
}

export async function audit(req, action, entity, entityId, detail = {}) {
  try {
    await AuditLog.create({
      user: req.user?._id || null,
      userEmail: req.user?.email || '',
      action,
      entity,
      entityId: String(entityId || ''),
      detail,
      ip: req.ip,
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'could not write audit entry');
  }
}

/** Invalidate every cached read and notify the frontend. */
export async function publishChanged(reason, targets = []) {
  await bumpRevision(reason);
  if (!config.revalidateUrl) return { revalidated: false };

  const results = [];
  for (const target of targets.length ? targets : [{}]) {
    try {
      const res = await fetch(config.revalidateUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-revalidate-secret': config.revalidateSecret,
        },
        body: JSON.stringify({ reason, ...target }),
        signal: AbortSignal.timeout(4000),
      });
      results.push({ target, ok: res.ok, status: res.status });
    } catch (err) {
      logger.warn({ err: err.message, target }, 'revalidation webhook failed');
      results.push({ target, ok: false, error: err.message });
    }
  }
  return { revalidated: results.some(r => r.ok), results };
}
