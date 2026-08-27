/*
 * integrations.js — managing the outbound endpoints the site calls.
 *
 * Two rules shape this file:
 *
 *   1. The upstream URL and any headers are write-only from the browser's point
 *      of view. The list and detail responses report whether a secret header is
 *      set, never what it is, and the URL is shown only as its host so an
 *      administrator can tell two integrations apart without the value being
 *      copyable out of the admin.
 *   2. Changing an integration is a publish: the renderer repoints the authored
 *      endpoints at render time, so the cache generation has to retire.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Integration } from '../../models/index.js';
import { asyncHandler, notFoundError, conflict } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { audit, publishChanged } from '../../services/publish.js';
import { proxyPath } from '@rainbow/core/endpoints';

export const integrationsRouter = Router();

integrationsRouter.use(requireAuth);

/**
 * What an administrator is allowed to see.
 *
 * The host, so two records are distinguishable. The path length, so a
 * mistyped URL is visible as "the path changed". Never the URL itself, and
 * never a header value — an admin session on a marketing CMS should not be a
 * way to walk off with the automation platform's credentials.
 */
function publicView(row) {
  let host;
  let pathHint = '';
  try {
    const url = new URL(row.url);
    host = url.host;
    pathHint = url.pathname.length > 1 ? `…${url.pathname.slice(-14)}` : '/';
  } catch {
    host = 'invalid URL';
  }
  const headerNames = row.headers
    ? [...(row.headers instanceof Map ? row.headers.keys() : Object.keys(row.headers))]
    : [];

  return {
    slug: row.slug,
    label: row.label,
    note: row.note,
    method: row.method,
    enabled: row.enabled,
    upstreamHost: host,
    upstreamPathHint: pathHint,
    headerNames,
    timeoutMs: row.timeoutMs,
    responseMode: row.responseMode,
    responseFields: row.responseFields,
    captureLead: row.captureLead,
    leadType: row.leadType,
    rateLimit: row.rateLimit,
    calls: row.calls,
    failures: row.failures,
    lastCallAt: row.lastCallAt,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
    // What the pages actually call. Safe, and the useful thing to copy.
    publicPath: proxyPath(row.slug),
    updatedAt: row.updatedAt,
  };
}

const upsert = z.object({
  slug: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, numbers and hyphens'),
  label: z.string().max(120).optional(),
  note: z.string().max(1000).optional(),
  url: z.string().url().max(600),
  method: z.enum(['POST', 'GET', 'PUT', 'PATCH']).default('POST'),
  headers: z.record(z.string().max(60), z.string().max(600)).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  enabled: z.boolean().optional(),
  responseMode: z.enum(['ok', 'fields']).default('ok'),
  responseFields: z.array(z.string().max(60)).max(30).optional(),
  captureLead: z.boolean().optional(),
  leadType: z.enum(['whitepaper', 'demo', 'partner', 'booking', 'unsubscribe', 'contact', 'other']).optional(),
  rateLimit: z.object({
    windowMs: z.number().int().min(1000).max(24 * 3600 * 1000).optional(),
    max: z.number().int().min(0).max(10000).optional(),
  }).optional(),
});

integrationsRouter.get('/', asyncHandler(async (_req, res) => {
  const rows = await Integration.find({}).sort({ slug: 1 }).lean();
  res.json({ items: rows.map(publicView) });
}));

integrationsRouter.post('/', requireRole('admin'), validate(upsert), asyncHandler(async (req, res) => {
  if (await Integration.findOne({ slug: req.body.slug }).lean()) {
    throw conflict('An integration with that name already exists');
  }
  assertSafeUrl(req.body.url);
  const row = await Integration.create({ ...req.body, updatedBy: req.user._id });
  await audit(req, 'integration.create', 'integration', row.slug, { host: hostOf(row.url) });
  await publishChanged('integration created');
  res.status(201).json({ item: publicView(row.toObject({ flattenMaps: true })) });
}));

integrationsRouter.patch('/:slug', requireRole('admin'), validate(upsert.partial()), asyncHandler(async (req, res) => {
  const row = await Integration.findOne({ slug: req.params.slug });
  if (!row) throw notFoundError('No such integration');
  if (req.body.url) assertSafeUrl(req.body.url);

  for (const [field, value] of Object.entries(req.body)) {
    if (field === 'slug') continue; // the slug is the public path; renaming it breaks the pages
    if (field === 'headers') { row.headers = new Map(Object.entries(value)); continue; }
    row[field] = value;
  }
  row.updatedBy = req.user._id;
  await row.save();

  await audit(req, 'integration.update', 'integration', row.slug, { fields: Object.keys(req.body) });
  await publishChanged('integration updated');
  res.json({ item: publicView(row.toObject({ flattenMaps: true })) });
}));

integrationsRouter.delete('/:slug', requireRole('admin'), asyncHandler(async (req, res) => {
  const row = await Integration.findOneAndDelete({ slug: req.params.slug });
  if (!row) throw notFoundError('No such integration');
  await audit(req, 'integration.delete', 'integration', req.params.slug);
  // The pages stop being repointed, so they go back to calling the authored URL
  // directly. Worth knowing.
  await publishChanged('integration deleted');
  res.json({ ok: true, warning: 'Pages that called this endpoint now call the authored URL directly again.' });
}));

/**
 * Call the upstream once and report only whether it answered.
 *
 * "Is the form wired up?" without opening the automation tool, and without the
 * upstream's reply reaching the browser — a test that leaked the response would
 * defeat the point of the proxy.
 */
integrationsRouter.post('/:slug/test', requireRole('admin'), asyncHandler(async (req, res) => {
  const row = await Integration.findOne({ slug: req.params.slug });
  if (!row) throw notFoundError('No such integration');

  const headers = { 'content-type': 'application/json' };
  for (const [name, value] of (row.headers || new Map()).entries()) headers[name] = value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), row.timeoutMs || 10000);
  const startedAt = Date.now();
  let status = null;
  let error = '';
  try {
    const upstream = await fetch(row.url, {
      method: row.method || 'POST',
      headers,
      body: row.method === 'GET' ? undefined : JSON.stringify({ test: true, source: 'rainbow-cms' }),
      signal: controller.signal,
      redirect: 'error',
    });
    status = upstream.status;
    await upstream.text();
  } catch (err) {
    error = err.name === 'AbortError' ? 'timed out' : 'unreachable';
  } finally {
    clearTimeout(timer);
  }

  await audit(req, 'integration.test', 'integration', row.slug, { status, error });
  res.json({
    ok: !error && status >= 200 && status < 400,
    status,
    error,
    ms: Date.now() - startedAt,
    note: 'The upstream reply is deliberately not shown here.',
  });
}));

const hostOf = (url) => { try { return new URL(url).host; } catch { return 'invalid'; } };

/**
 * Refuse an endpoint that points back inside the network.
 *
 * Without this, anyone who can edit an integration can turn the public
 * `/api/v1/hooks/<slug>` route into a probe for the private network the API
 * sits in — the database, the cache, a cloud metadata service. The proxy is
 * meant to reach the internet on the browser's behalf, and nothing else.
 */
function assertSafeUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw conflict('That is not a valid URL'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw conflict('Only http and https endpoints are allowed');
  }
  const host = url.hostname.toLowerCase();
  const blocked = host === 'localhost'
    || host === '::1'
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host === 'mongo' || host === 'redis' || host === 'api' || host === 'web' || host === 'cms'
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw conflict('That address is inside the network — an endpoint must be a public URL');
}
