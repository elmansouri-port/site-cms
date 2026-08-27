/*
 * publish.js — what happens around a change reaching the site.
 *
 * Three concerns, in the order they occur: record who did it, retire the cache
 * generation, and tell the frontend to drop its own copy (reco.md 7: webhook on
 * publish, secret header, {locale, slug} payload). The webhook is best-effort —
 * a frontend that is down must not make the publish fail; its cache expires on
 * its own.
 *
 * Snapshots live in `services/history.js`; `snapshot` is re-exported here
 * because every route that mutates content wants both and importing from one
 * place keeps the call sites short.
 */
import { AuditLog } from '../models/index.js';
import { bumpRevision } from '../lib/redis.js';
import { config } from '../config.js';
import { logger } from '../lib/log.js';

export { snapshot } from './history.js';

/**
 * Record a change. Never throws: an audit write failing must not fail the
 * change it was describing.
 */
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
