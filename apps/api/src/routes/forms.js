/*
 * forms.js — lead capture for the marketing forms described in FORMS_API.md.
 *
 * The static site posted these to third parties (Eloqua, n8n) or nowhere at
 * all. They now land in MongoDB first, so no lead is lost when an integration
 * is down, and are optionally forwarded on. Everything is rate limited per IP
 * and the payload is stored whole — marketing changes form fields far more
 * often than anyone changes this file.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Lead } from '../models/index.js';
import { asyncHandler, badRequest } from '../middleware/error.js';
import { logger } from '../lib/log.js';
import { leadStorage } from '../services/leads.js';

export const formsRouter = Router();

const submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many submissions, please try again later' },
});

const TYPES = ['whitepaper', 'demo', 'partner', 'booking', 'unsubscribe', 'contact', 'other'];

const submission = z.object({
  email: z.string().email().max(200).optional().or(z.literal('')),
  name: z.string().max(200).optional(),
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  company: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  locale: z.string().max(5).optional(),
  page: z.string().max(300).optional(),
  variant: z.string().max(60).optional(),
  utm: z.record(z.string(), z.string().max(200)).optional(),
  // Honeypot: a real user never fills this in.
  website: z.string().max(200).optional(),
  payload: z.record(z.string(), z.any()).optional(),
}).passthrough();

formsRouter.post('/:type', submitLimiter, asyncHandler(async (req, res) => {
  const type = TYPES.includes(req.params.type) ? req.params.type : 'other';
  const parsed = submission.safeParse(req.body || {});
  if (!parsed.success) throw badRequest('Invalid submission', parsed.error.issues.map(i => i.message));
  const body = parsed.data;

  if (body.website) {
    // Honeypot tripped: accept quietly so the bot does not learn anything.
    logger.debug({ type, ip: req.ip }, 'honeypot submission dropped');
    return res.status(202).json({ ok: true });
  }

  const { website, payload, ...rest } = body;
  const name = body.name || [body.firstName, body.lastName].filter(Boolean).join(' ');

  /*
   * Storage is a setting, and off means not written.
   *
   * A deployment whose forms feed a CRM that is already the system of record
   * does not want a second copy of every enquiry here — and one that does not
   * need the data should not be holding names, addresses and IPs at all. The
   * submission is still accepted, so the visitor's experience is identical and
   * whatever forwards it still forwards it.
   */
  const { store } = await leadStorage();
  if (!store) {
    logger.info({ type }, 'submission accepted, not stored (lead storage is off)');
    return res.status(201).json({ ok: true, id: null, stored: false });
  }

  const lead = await Lead.create({
    type,
    locale: body.locale || 'fr',
    page: body.page || req.get('referer') || '',
    email: (body.email || '').toLowerCase(),
    name,
    company: body.company || '',
    phone: body.phone || '',
    variant: body.variant || '',
    utm: body.utm || {},
    payload: { ...rest, ...(payload || {}) },
    ip: req.ip,
    userAgent: req.get('user-agent') || '',
  });

  logger.info({ type, id: String(lead._id) }, 'lead captured');
  res.status(201).json({ ok: true, id: String(lead._id), stored: true });
}));
