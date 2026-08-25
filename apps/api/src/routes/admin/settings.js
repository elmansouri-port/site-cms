/*
 * settings.js — global site configuration.
 *
 * Includes the three site-wide snippet zones (reco.md 9.1). They accept
 * arbitrary HTML on purpose: tracking tags, verification meta, extra JSON-LD.
 * The frontend injects them as markup, never as escaped text.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Settings } from '../../models/index.js';
import { asyncHandler } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { snapshot, audit, publishChanged } from '../../services/publish.js';
import { getSettings } from '../../services/content.js';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

const localeEntry = z.object({
  code: z.string().min(2).max(5),
  label: z.string().max(60).optional(),
  nativeLabel: z.string().max(60).optional(),
  active: z.boolean().default(true),
  order: z.number().int().min(0).max(99).optional(),
});

const settingsBody = z.object({
  siteName: z.string().max(200).optional(),
  baseUrl: z.string().max(300).optional(),
  defaultLocale: z.string().max(5).optional(),
  sourceLocale: z.string().max(5).optional(),
  locales: z.array(localeEntry).max(30).optional(),
  defaultTitle: z.string().max(300).optional(),
  defaultDescription: z.string().max(1000).optional(),
  defaultOgTitle: z.string().max(300).optional(),
  defaultOgDescription: z.string().max(1000).optional(),
  defaultOgImage: z.string().max(500).optional(),
  organizationName: z.string().max(200).optional(),
  organizationLogo: z.string().max(500).optional(),
  socialProfiles: z.array(z.string().max(300)).max(20).optional(),
  globalHeadSnippet: z.string().max(100000).optional(),
  globalBodySnippet: z.string().max(100000).optional(),
  globalFooterSnippet: z.string().max(100000).optional(),
  analytics: z.object({
    matomoUrl: z.string().max(300).optional(),
    matomoSiteId: z.string().max(20).optional(),
    hotjarId: z.string().max(20).optional(),
    variantDimensionId: z.string().max(10).optional(),
  }).optional(),
  robotsExtra: z.string().max(10000).optional(),
  maintenanceMode: z.boolean().optional(),
}).strict();

settingsRouter.get('/', asyncHandler(async (_req, res) => {
  res.json({ settings: await getSettings() });
}));

settingsRouter.put('/', requireRole('admin'), validate(settingsBody), asyncHandler(async (req, res) => {
  const current = await Settings.findOne({ key: 'global' });
  if (current) await snapshot('settings', 'global', current.toObject(), req.user, 'before edit');

  const patch = { ...req.body };
  if (patch.locales) {
    patch.locales = patch.locales.map((l, i) => ({ ...l, order: l.order ?? i }));
  }

  const settings = await Settings.findOneAndUpdate(
    { key: 'global' },
    { $set: patch },
    { new: true, upsert: true },
  );

  await audit(req, 'settings.update', 'settings', 'global', { fields: Object.keys(req.body) });
  await publishChanged('settings updated');
  res.json({ settings: settings.toObject() });
}));
