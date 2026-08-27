/*
 * hooks.js — the browser's only door to an outbound integration.
 *
 * The authored pages called their automation platform straight from the
 * browser. That published, in the page source of a public marketing site: which
 * platform runs the lead flow, the exact webhook path of every form, and an
 * endpoint anyone could post to a million times without ever loading the site.
 * It also meant the platform's raw reply — internal ids, execution URLs, error
 * text — was handed to whoever opened the network tab.
 *
 * Here the browser posts to `/api/v1/hooks/<slug>`. The server looks the slug
 * up, stores the submission, makes the call itself, and answers with the
 * smallest true thing it can:
 *
 *   responseMode 'ok'      whether it worked
 *   responseMode 'fields'  that, plus an allowlist of keys copied out
 *
 * There is no pass-everything mode. If a form needs a value from upstream, the
 * key is named in the integration, which is a decision somebody makes once
 * rather than a default nobody reviews.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Integration, Lead } from '../models/index.js';
import { asyncHandler, badRequest, notFoundError } from '../middleware/error.js';
import { logger } from '../lib/log.js';
import { sendsBody, withQuery } from '../services/integrationProbe.js';

export const hooksRouter = Router();

/*
 * One limiter for the whole surface, sized to the most generous integration.
 * Per-integration limits are applied on top, from the record itself, so a
 * chatty availability lookup and a once-per-visitor form do not have to share
 * a budget.
 */
const gateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests, please try again shortly' },
});

/** Per-slug, per-IP counters for the limits stored on each integration. */
const buckets = new Map();

function withinLimit(slug, ip, { windowMs, max }) {
  if (!max) return true;
  const now = Date.now();
  const id = `${slug}:${ip}`;
  const bucket = buckets.get(id);
  if (!bucket || now - bucket.start > windowMs) {
    buckets.set(id, { start: now, count: 1 });
    return true;
  }
  bucket.count++;
  return bucket.count <= max;
}

// The map would otherwise grow one entry per IP per integration, forever.
const SWEEP_EVERY = 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, bucket] of buckets) {
    if (now - bucket.start > SWEEP_EVERY) buckets.delete(id);
  }
}, SWEEP_EVERY).unref();

const body = z.object({
  // A real visitor never fills this in. Kept out of what is forwarded.
  website: z.string().max(200).optional(),
  email: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  company: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  locale: z.string().max(5).optional(),
  page: z.string().max(300).optional(),
  variant: z.string().max(60).optional(),
  utm: z.record(z.string(), z.string().max(200)).optional(),
}).passthrough();

/** Copy out only the keys the integration names. Nothing else travels. */
function pickFields(payload, fields) {
  const out = {};
  if (!payload || typeof payload !== 'object') return out;
  for (const field of fields || []) {
    if (Object.hasOwn(payload, field)) out[field] = payload[field];
  }
  return out;
}

hooksRouter.post('/:slug', gateLimiter, asyncHandler(async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const integration = await Integration.findOne({ slug, enabled: true });
  // A disabled or unknown slug is a plain 404: the response must not reveal
  // which slugs exist but are switched off.
  if (!integration) throw notFoundError('No such endpoint');

  const parsed = body.safeParse(req.body || {});
  if (!parsed.success) throw badRequest('Invalid submission');
  const submitted = parsed.data;

  if (submitted.website) {
    // Honeypot tripped. Accept quietly so the bot learns nothing, and do not
    // spend an upstream call on it.
    logger.debug({ slug, ip: req.ip }, 'honeypot submission dropped');
    return res.status(202).json({ ok: true });
  }

  if (!withinLimit(slug, req.ip, integration.rateLimit || {})) {
    return res.status(429).json({ ok: false, error: 'Too many requests, please try again shortly' });
  }

  const { website, ...forward } = submitted;

  // Store first. An automation platform that is down, misconfigured or halfway
  // through a migration must not cost a lead.
  let leadId = null;
  if (integration.captureLead) {
    const name = forward.name || [forward.firstName, forward.lastName].filter(Boolean).join(' ');
    const lead = await Lead.create({
      type: integration.leadType || 'other',
      locale: forward.locale || 'fr',
      page: forward.page || req.get('referer') || '',
      email: String(forward.email || '').toLowerCase(),
      name,
      company: forward.company || '',
      phone: forward.phone || '',
      variant: forward.variant || '',
      utm: forward.utm || {},
      payload: forward,
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
    });
    leadId = String(lead._id);
  }

  const headers = { 'content-type': 'application/json' };
  for (const [name, value] of (integration.headers || new Map()).entries()) headers[name] = value;

  let status = null;
  let upstream = null;
  let failure = '';

  const method = integration.method || 'POST';
  /*
   * A GET webhook cannot read a JSON body.
   *
   * This used to send one anyway, so the two lookups registered for GET — the
   * booking calendar's availability and the "find my booking" form — received
   * nothing at all and answered every visitor with "no reference supplied".
   * `queryFields` names what belongs in the URL; empty means everything scalar
   * the submission carries.
   */
  const target = sendsBody(method)
    ? integration.url
    : withQuery(integration.url, forward, integration.queryFields);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), integration.timeoutMs || 10000);
  try {
    const res2 = await fetch(target, {
      method,
      headers,
      body: sendsBody(method) ? JSON.stringify(forward) : undefined,
      signal: controller.signal,
      redirect: 'error',
    });
    status = res2.status;
    const text = await res2.text();
    try { upstream = text ? JSON.parse(text) : null; } catch { upstream = null; }
    if (!res2.ok) failure = `upstream ${res2.status}`;
  } catch (err) {
    failure = err.name === 'AbortError' ? 'upstream timed out' : `upstream unreachable: ${err.message}`;
  } finally {
    clearTimeout(timer);
  }

  // Counters, so "is this form working?" is answerable in the CMS rather than
  // by logging into the automation tool.
  await Integration.updateOne({ _id: integration._id }, {
    $inc: { calls: 1, ...(failure ? { failures: 1 } : {}) },
    $set: { lastCallAt: new Date(), lastStatus: status, lastError: failure },
  });

  if (failure) {
    logger.warn({ slug, status, failure, leadId }, 'integration call failed');
    // The submission is safe if we stored it, and saying so is the difference
    // between a visitor retrying pointlessly and a visitor moving on.
    return res.status(502).json({
      ok: false,
      stored: !!leadId,
      error: leadId
        ? 'We have your details — the confirmation may take a few minutes.'
        : 'That did not go through. Please try again in a moment.',
    });
  }

  logger.info({ slug, status, leadId }, 'integration call forwarded');

  if (integration.responseMode === 'fields') {
    return res.json({ ok: true, ...pickFields(upstream, integration.responseFields) });
  }
  res.json({ ok: true });
}));
