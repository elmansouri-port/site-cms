/*
 * dashboard.js — the overview.
 *
 * Weighted towards the questions somebody doing marketing actually opens the
 * CMS with — did anything break, is anything waiting to go live, how many leads
 * came in, what is running — rather than row counts, which answer nothing.
 */
import { Router } from 'express';
import {
  AuditLog, BlogPost, ContentString, Experiment, Integration, Lead, Media, Page,
} from '../../models/index.js';
import { asyncHandler } from '../../middleware/error.js';
import { requireAuth } from '../../middleware/auth.js';
import { redisHealthy, revision } from '../../lib/redis.js';
import { translationCoverage } from '../../services/catalogue.js';
import { getSettings } from '../../services/content.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

const DAY = 24 * 3600 * 1000;

dashboardRouter.get('/', asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  const locales = (settings.locales || []).filter(l => l.active).map(l => l.code);

  const now = Date.now();
  const weekAgo = new Date(now - 7 * DAY);
  const fortnightAgo = new Date(now - 14 * DAY);

  const [
    pages, drafts, posts, postDrafts, leads, newLeads, strings, media, coverage, recent,
    leadsThisWeek, leadsLastWeek, leadsByType, runningTests, brokenIntegrations, unpublished,
  ] = await Promise.all([
    Page.countDocuments({}),
    Page.countDocuments({ status: 'draft' }),
    BlogPost.countDocuments({}),
    BlogPost.countDocuments({ status: 'draft' }),
    Lead.countDocuments({}),
    Lead.countDocuments({ status: 'new' }),
    ContentString.countDocuments({}),
    Media.countDocuments({}),
    translationCoverage(locales.length ? locales : ['fr']),
    AuditLog.find({}).sort({ createdAt: -1 }).limit(12).lean(),
    Lead.countDocuments({ createdAt: { $gte: weekAgo } }),
    Lead.countDocuments({ createdAt: { $gte: fortnightAgo, $lt: weekAgo } }),
    Lead.aggregate([
      { $match: { createdAt: { $gte: weekAgo } } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Experiment.find(
      { status: 'running' },
      { key: 1, name: 1, scope: 1, variants: 1, startedAt: 1, _id: 0 },
    ).lean(),
    Integration.find(
      { enabled: true, lastError: { $ne: '' } },
      { slug: 1, label: 1, lastError: 1, lastCallAt: 1, _id: 0 },
    ).lean(),
    // Pages an editor has changed but never published: the single most common
    // way a change fails to reach the site.
    Page.find({ status: 'draft', editedInCms: true }, { key: 1, title: 1, updatedAt: 1, _id: 0 })
      .sort({ updatedAt: -1 }).limit(6).lean(),
  ]);

  res.json({
    counts: { pages, drafts, posts, postDrafts, leads, newLeads, strings, media },
    leads: {
      thisWeek: leadsThisWeek,
      lastWeek: leadsLastWeek,
      byType: leadsByType.map(r => ({ type: r._id || 'other', count: r.count })),
    },
    tests: runningTests,
    integrations: brokenIntegrations,
    unpublished,
    coverage,
    recent,
    cache: { redis: redisHealthy(), revision: await revision() },
  });
}));
