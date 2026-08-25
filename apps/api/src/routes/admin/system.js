/*
 * system.js — the parts of the admin that are not one content type: users,
 * leads, redirects, experiments, version history, the dashboard and cache
 * control.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  User, Lead, Redirect, Experiment, Version, AuditLog, Page, BlogPost, ContentString, Media,
} from '../../models/index.js';
import { asyncHandler, notFoundError, badRequest, conflict } from '../../middleware/error.js';
import { validate, q } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { audit, publishChanged } from '../../services/publish.js';
import { publicUser } from './auth.js';
import { bumpRevision, redisHealthy, revision } from '../../lib/redis.js';
import { translationCoverage } from '../../services/catalogue.js';
import { getSettings } from '../../services/content.js';

export const systemRouter = Router();

systemRouter.use(requireAuth);

/* ── Dashboard ────────────────────────────────────────────────────────────── */

systemRouter.get('/dashboard', asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  const locales = (settings.locales || []).filter(l => l.active).map(l => l.code);

  const [pages, drafts, posts, postDrafts, leads, newLeads, strings, media, coverage, recent] = await Promise.all([
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
  ]);

  res.json({
    counts: { pages, drafts, posts, postDrafts, leads, newLeads, strings, media },
    coverage,
    recent,
    cache: { redis: redisHealthy(), revision: await revision() },
  });
}));

/* ── Users ────────────────────────────────────────────────────────────────── */

systemRouter.get('/users', requireRole('admin'), asyncHandler(async (_req, res) => {
  const users = await User.find({}).sort({ createdAt: 1 }).lean();
  res.json({ items: users.map(publicUser) });
}));

const newUser = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(10).max(200),
  role: z.enum(['admin', 'editor', 'viewer']).default('editor'),
});

systemRouter.post('/users', requireRole('admin'), validate(newUser), asyncHandler(async (req, res) => {
  if (await User.findOne({ email: req.body.email.toLowerCase() }).lean()) throw conflict('That address already has an account');
  const user = await User.create({
    email: req.body.email.toLowerCase(),
    name: req.body.name,
    role: req.body.role,
    passwordHash: await bcrypt.hash(req.body.password, 12),
  });
  await audit(req, 'user.create', 'user', user._id, { role: user.role });
  res.status(201).json({ user: publicUser(user) });
}));

const patchUser = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.enum(['admin', 'editor', 'viewer']).optional(),
  active: z.boolean().optional(),
  password: z.string().min(10).max(200).optional(),
});

systemRouter.patch('/users/:id', requireRole('admin'), validate(patchUser), asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFoundError('No such user');

  // An admin locking themselves out is a support ticket, so refuse it here.
  if (String(user._id) === String(req.user._id) && (req.body.active === false || (req.body.role && req.body.role !== 'admin'))) {
    throw badRequest('You cannot remove your own access');
  }
  if (req.body.name !== undefined) user.name = req.body.name;
  if (req.body.role !== undefined) user.role = req.body.role;
  if (req.body.active !== undefined) user.active = req.body.active;
  if (req.body.password) {
    user.passwordHash = await bcrypt.hash(req.body.password, 12);
    user.tokenVersion += 1;
  }
  await user.save();
  await audit(req, 'user.update', 'user', user._id, { fields: Object.keys(req.body) });
  res.json({ user: publicUser(user) });
}));

systemRouter.delete('/users/:id', requireRole('admin'), asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) throw badRequest('You cannot delete your own account');
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) throw notFoundError('No such user');
  await audit(req, 'user.delete', 'user', req.params.id);
  res.json({ ok: true });
}));

/* ── Leads ────────────────────────────────────────────────────────────────── */

const leadQuery = z.object({
  type: z.string().max(30).optional(),
  status: z.enum(['new', 'read', 'archived', 'spam']).optional(),
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

systemRouter.get('/leads', validate(leadQuery, 'query'), asyncHandler(async (req, res) => {
  const { type, status, q: search, limit, offset } = q(req);
  const filter = {};
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (search) filter.$or = [
    { email: { $regex: search, $options: 'i' } },
    { name: { $regex: search, $options: 'i' } },
    { company: { $regex: search, $options: 'i' } },
  ];
  const [items, total, byType] = await Promise.all([
    Lead.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
    Lead.countDocuments(filter),
    Lead.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
  ]);
  res.json({ items, total, byType });
}));

systemRouter.patch('/leads/:id', requireRole('editor'), validate(z.object({
  status: z.enum(['new', 'read', 'archived', 'spam']).optional(),
  notes: z.string().max(5000).optional(),
})), asyncHandler(async (req, res) => {
  const lead = await Lead.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
  if (!lead) throw notFoundError('No such lead');
  res.json({ lead: lead.toObject() });
}));

systemRouter.get('/leads/export.csv', asyncHandler(async (req, res) => {
  const rows = await Lead.find(req.query.type ? { type: String(req.query.type) } : {}).sort({ createdAt: -1 }).limit(5000).lean();
  const cols = ['createdAt', 'type', 'locale', 'email', 'name', 'company', 'phone', 'page', 'status'];
  const csv = [cols.join(',')]
    .concat(rows.map(r => cols.map(c => csvCell(r[c])).join(',')))
    .join('\n');
  res.set('content-type', 'text/csv; charset=utf-8');
  res.set('content-disposition', 'attachment; filename="leads.csv"');
  res.send(csv);
}));

/* ── Redirects ────────────────────────────────────────────────────────────── */

systemRouter.get('/redirects', asyncHandler(async (_req, res) => {
  res.json({ items: await Redirect.find({}).sort({ from: 1 }).lean() });
}));

const redirectBody = z.object({
  from: z.string().min(1).max(500),
  to: z.string().min(1).max(500),
  status: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).default(301),
  active: z.boolean().default(true),
  note: z.string().max(500).optional(),
});

systemRouter.post('/redirects', requireRole('editor'), validate(redirectBody), asyncHandler(async (req, res) => {
  const item = await Redirect.create(req.body);
  await audit(req, 'redirect.create', 'redirect', item._id, { from: item.from });
  await publishChanged('redirect added');
  res.status(201).json({ item: item.toObject() });
}));

systemRouter.patch('/redirects/:id', requireRole('editor'), validate(redirectBody.partial()), asyncHandler(async (req, res) => {
  const item = await Redirect.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
  if (!item) throw notFoundError('No such redirect');
  await publishChanged('redirect updated');
  res.json({ item: item.toObject() });
}));

systemRouter.delete('/redirects/:id', requireRole('editor'), asyncHandler(async (req, res) => {
  const item = await Redirect.findByIdAndDelete(req.params.id);
  if (!item) throw notFoundError('No such redirect');
  await publishChanged('redirect deleted');
  res.json({ ok: true });
}));

/* ── Experiments ──────────────────────────────────────────────────────────── */

systemRouter.get('/experiments', asyncHandler(async (_req, res) => {
  res.json({ items: await Experiment.find({}).sort({ createdAt: -1 }).lean() });
}));

const experimentBody = z.object({
  key: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  status: z.enum(['draft', 'running', 'paused', 'finished']).default('draft'),
  pageKey: z.string().max(80).nullable().optional(),
  mode: z.enum(['cookie', 'param']).default('cookie'),
  paramName: z.string().max(40).default('version'),
  cookieDays: z.number().int().min(1).max(365).default(14),
  variants: z.array(z.object({
    key: z.string().min(1).max(20),
    label: z.string().max(80).optional(),
    weight: z.number().int().min(0).max(100).default(50),
  })).min(2).max(6),
});

systemRouter.post('/experiments', requireRole('editor'), validate(experimentBody), asyncHandler(async (req, res) => {
  const item = await Experiment.create({
    ...req.body,
    startedAt: req.body.status === 'running' ? new Date() : null,
  });
  await audit(req, 'experiment.create', 'experiment', item.key);
  await publishChanged('experiment created');
  res.status(201).json({ item: item.toObject() });
}));

systemRouter.patch('/experiments/:key', requireRole('editor'), validate(experimentBody.partial()), asyncHandler(async (req, res) => {
  const item = await Experiment.findOne({ key: req.params.key });
  if (!item) throw notFoundError('No such experiment');
  Object.assign(item, req.body);
  if (req.body.status === 'running' && !item.startedAt) item.startedAt = new Date();
  if (req.body.status === 'finished') item.endedAt = new Date();
  await item.save();
  await audit(req, 'experiment.update', 'experiment', item.key, { status: item.status });
  await publishChanged('experiment updated');
  res.json({ item: item.toObject() });
}));

systemRouter.delete('/experiments/:key', requireRole('editor'), asyncHandler(async (req, res) => {
  const item = await Experiment.findOneAndDelete({ key: req.params.key });
  if (!item) throw notFoundError('No such experiment');
  await publishChanged('experiment deleted');
  res.json({ ok: true });
}));

/* ── Version history ──────────────────────────────────────────────────────── */

systemRouter.get('/versions/:entity/:entityId', asyncHandler(async (req, res) => {
  const items = await Version.find({ entity: req.params.entity, entityId: req.params.entityId },
    { snapshot: 0 }).sort({ createdAt: -1 }).limit(30).lean();
  res.json({ items });
}));

systemRouter.get('/versions/detail/:id', asyncHandler(async (req, res) => {
  const version = await Version.findById(req.params.id).lean();
  if (!version) throw notFoundError('No such version');
  res.json({ version });
}));

systemRouter.post('/versions/detail/:id/restore', requireRole('editor'), asyncHandler(async (req, res) => {
  const version = await Version.findById(req.params.id).lean();
  if (!version) throw notFoundError('No such version');

  if (version.entity === 'page') {
    const snap = { ...version.snapshot };
    delete snap._id;
    await Page.findOneAndUpdate({ key: version.entityId }, { $set: snap }, { upsert: true });
  } else if (version.entity === 'post') {
    const snap = { ...version.snapshot };
    delete snap._id;
    await BlogPost.findByIdAndUpdate(version.entityId, { $set: snap });
  } else {
    throw badRequest(`Restoring ${version.entity} is not supported`);
  }

  await audit(req, 'version.restore', version.entity, version.entityId, { versionId: req.params.id });
  await publishChanged('version restored');
  res.json({ ok: true });
}));

/* ── Cache ────────────────────────────────────────────────────────────────── */

systemRouter.post('/cache/purge', requireRole('editor'), asyncHandler(async (req, res) => {
  const rev = await bumpRevision('manual purge');
  const result = await publishChanged('manual purge');
  await audit(req, 'cache.purge', 'cache', '');
  res.json({ ok: true, revision: rev, ...result });
}));

systemRouter.get('/audit', requireRole('admin'), asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const items = await AuditLog.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ items });
}));

function csvCell(value) {
  if (value === undefined || value === null) return '';
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
