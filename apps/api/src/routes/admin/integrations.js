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
import { VERDICTS, probeIntegration } from '../../services/integrationProbe.js';
import { config } from '../../config.js';

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
    queryFields: row.queryFields || [],
    // What the endpoint said about itself when it was last probed. Admin-only.
    contract: row.contract || {},
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
  queryFields: z.array(z.string().max(60)).max(30).optional(),
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
 * Ask the endpoint what it expects, and record the answer.
 *
 * The old version reported a status code and nothing else, which answered "did
 * something respond" and no other question. A 404 from n8n can mean the method
 * is wrong or the workflow is switched off — two different faults with two
 * different fixes, indistinguishable in a number. A 400 usually means the
 * endpoint is healthy and named the fields it wanted.
 *
 * So the probe reads what the endpoint says and stores it on the record, which
 * is what lets the form builder warn that a form does not collect a field its
 * endpoint requires. Admin only, because the upstream's own words are exactly
 * what the proxy keeps away from visitors.
 */
integrationsRouter.post('/:slug/test', requireRole('admin'), asyncHandler(async (req, res) => {
  const row = await Integration.findOne({ slug: req.params.slug });
  if (!row) throw notFoundError('No such integration');

  const result = await probeIntegration(row);

  row.contract = {
    probedAt: new Date(),
    detectedMethod: result.detectedMethod || '',
    requiredFields: result.requiredFields,
    knownFields: result.knownFields,
    verdict: result.verdict,
    message: result.message,
  };
  // The probe is a real call, so the health counters should reflect it — but a
  // deliberately invalid payload being rejected is not a failure of the
  // integration, and counting it as one would make every healthy endpoint look
  // broken after somebody pressed Test.
  row.lastCallAt = new Date();
  row.lastStatus = result.status;
  row.lastError = ['ok', 'validation'].includes(result.verdict) ? '' : (VERDICTS[result.verdict] || '');
  await row.save();

  await audit(req, 'integration.test', 'integration', row.slug, {
    verdict: result.verdict,
    status: result.status,
    detectedMethod: result.detectedMethod || undefined,
  });

  res.json({
    ok: result.reachable,
    verdict: result.verdict,
    explanation: VERDICTS[result.verdict] || '',
    status: result.status,
    ms: result.ms,
    detectedMethod: result.detectedMethod || null,
    requiredFields: result.requiredFields,
    knownFields: result.knownFields,
    // The endpoint's own words, for an administrator only.
    message: result.message,
    // The one-click fix, when the endpoint told us what is wrong.
    fix: result.verdict === 'method-mismatch' && result.detectedMethod
      ? { field: 'method', value: result.detectedMethod }
      : null,
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
 *
 * `INTEGRATION_ALLOWED_HOSTS` is the exception, and it exists because this
 * deployment needs one: the automation platform is on the company network, so
 * its hostname resolves to a 10.x address. Without an allowlist, an
 * administrator could not edit the very integrations the site depends on — and
 * the honest way to permit that is a named host in the environment, which is
 * auditable and cannot be widened from inside the CMS.
 *
 * Note what the check can and cannot do: it inspects the hostname, not the
 * address it resolves to. A public name pointing at a private address gets
 * through, which is why the allowlist is a list of names rather than a switch,
 * and why the proxy refuses redirects and copies out only named fields.
 */
function assertSafeUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw conflict('That is not a valid URL'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw conflict('Only http and https endpoints are allowed');
  }
  const host = url.hostname.toLowerCase();
  if (config.integrations.allowedHosts.includes(host)) return;

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
  if (blocked) {
    throw conflict(
      `${host} is inside the network. An endpoint must be a public URL, or its host `
      + 'must be listed in INTEGRATION_ALLOWED_HOSTS.',
    );
  }
}
