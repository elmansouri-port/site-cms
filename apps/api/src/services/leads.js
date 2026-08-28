/*
 * leads.js — whether a submission is kept, and for how long.
 *
 * Every marketing form on this site stores its submission before forwarding it,
 * so that an automation platform being down does not cost a lead. That is the
 * right default. It is not always the right answer:
 *
 *   - a deployment whose forms feed a CRM that is already the system of record
 *     does not want a second copy of every enquiry accumulating here;
 *   - a deployment that does not need the data should not be holding names,
 *     email addresses and IP addresses at all, because data you do not hold is
 *     data you cannot leak, cannot be asked to export, and cannot forget to
 *     delete.
 *
 * So it is a switch, and **off means not written** rather than not shown. The
 * submission is still accepted and still forwarded: nothing about the visitor's
 * experience or the integration changes.
 *
 * Read through the same settings cache every other request uses, so a form
 * submission costs no extra round trip — and a change takes effect within the
 * cache's lifetime rather than needing a restart.
 */
import { Lead } from '../models/index.js';
import { settingsCached } from './content.js';
import { logger } from '../lib/log.js';

/**
 * `{ store, retentionDays }`.
 *
 * Defaults to storing, because that is what the site did before the setting
 * existed and a migration that silently stopped recording leads would be a much
 * worse bug than the one the setting fixes.
 */
export async function leadStorage() {
  try {
    const settings = await settingsCached();
    return {
      store: settings?.leads?.store !== false,
      retentionDays: Number(settings?.leads?.retentionDays) || 0,
    };
  } catch (err) {
    // A settings read failing must not turn into a dropped lead.
    logger.warn({ err: err.message }, 'could not read lead settings — storing');
    return { store: true, retentionDays: 0 };
  }
}

/**
 * Delete stored leads older than the retention period.
 *
 * Called on boot and after the setting changes, rather than on a timer: this is
 * a marketing site, the collection is small, and a scheduler is a component to
 * operate. Returns the number removed so the interface can say what happened —
 * "retention set to 90 days, 412 older submissions deleted" is a sentence
 * somebody needs to read *before* they are surprised by it.
 */
export async function applyRetention({ dryRun = false } = {}) {
  const { retentionDays } = await leadStorage();
  if (!retentionDays) return { retentionDays: 0, deleted: 0 };

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const filter = { createdAt: { $lt: cutoff } };
  if (dryRun) return { retentionDays, cutoff, deleted: await Lead.countDocuments(filter) };

  const { deletedCount } = await Lead.deleteMany(filter);
  if (deletedCount) {
    logger.info({ deletedCount, retentionDays }, 'leads past their retention period deleted');
  }
  return { retentionDays, cutoff, deleted: deletedCount };
}
