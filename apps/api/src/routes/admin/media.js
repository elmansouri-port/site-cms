/*
 * media.js — the media library.
 *
 * Uploads land on a volume the frontend serves under /media, so an image an
 * editor adds today is reachable at a stable URL forever. The images that ship
 * with the site are indexed as `bundled` entries: they are pickable in the CMS
 * but cannot be deleted, because a build owns those files, not the database.
 */
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { z } from 'zod';
import { config } from '../../config.js';
import { Media } from '../../models/index.js';
import { asyncHandler, notFoundError, badRequest } from '../../middleware/error.js';
import { validate, q } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { audit, publishChanged } from '../../services/publish.js';
import { slugify } from '@rainbow/core/html';

export const mediaRouter = Router();

mediaRouter.use(requireAuth);

const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml',
  'video/mp4', 'video/webm', 'application/pdf',
]);

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    await fs.mkdir(config.uploads.dir, { recursive: true });
    cb(null, config.uploads.dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
    const base = slugify(path.basename(file.originalname, ext), 60) || 'file';
    cb(null, `${base}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxBytes, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(new Error(`Unsupported file type: ${file.mimetype}`));
    cb(null, true);
  },
});

const listQuery = z.object({
  folder: z.string().max(120).optional(),
  q: z.string().max(120).optional(),
  source: z.enum(['upload', 'bundled', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  offset: z.coerce.number().int().min(0).default(0),
});

mediaRouter.get('/', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const { folder, q: search, source, limit, offset } = q(req);
  const filter = {};
  if (folder) filter.folder = folder;
  if (source !== 'all') filter.source = source;
  if (search) filter.$or = [
    { filename: { $regex: search, $options: 'i' } },
    { originalName: { $regex: search, $options: 'i' } },
  ];

  const [items, total, folders] = await Promise.all([
    Media.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
    Media.countDocuments(filter),
    Media.distinct('folder'),
  ]);
  res.json({ items, total, folders: folders.filter(Boolean).sort() });
}));

mediaRouter.post('/', requireRole('editor'), upload.array('files', 10), asyncHandler(async (req, res) => {
  if (!req.files?.length) throw badRequest('No file received');
  const folder = String(req.body.folder || '').replace(/[^a-z0-9/_-]/gi, '');

  const docs = [];
  for (const file of req.files) {
    docs.push({
      filename: file.filename,
      originalName: file.originalname,
      url: `${config.uploads.publicPath}/${file.filename}`,
      mime: file.mimetype,
      size: file.size,
      folder,
      source: 'upload',
      uploadedBy: req.user._id,
    });
  }
  const created = await Media.insertMany(docs);
  await audit(req, 'media.upload', 'media', '', { count: created.length });
  res.status(201).json({ items: created });
}));

const patchMedia = z.object({
  alt: z.record(z.string().max(5), z.string().max(500)).optional(),
  folder: z.string().max(120).optional(),
});

mediaRouter.patch('/:id', requireRole('editor'), validate(patchMedia), asyncHandler(async (req, res) => {
  const item = await Media.findById(req.params.id);
  if (!item) throw notFoundError('No such media item');
  if (req.body.folder !== undefined) item.folder = req.body.folder;
  if (req.body.alt) for (const [k, v] of Object.entries(req.body.alt)) item.alt.set(k, v);
  await item.save();
  await audit(req, 'media.update', 'media', item._id);
  await publishChanged('media updated');
  res.json({ item: item.toObject() });
}));

mediaRouter.delete('/:id', requireRole('editor'), asyncHandler(async (req, res) => {
  const item = await Media.findById(req.params.id);
  if (!item) throw notFoundError('No such media item');
  if (item.source === 'bundled') throw badRequest('Bundled assets ship with the site and cannot be deleted here');

  await item.deleteOne();
  try {
    await fs.unlink(path.join(config.uploads.dir, item.filename));
  } catch { /* the row is gone either way */ }

  await audit(req, 'media.delete', 'media', req.params.id, { filename: item.filename });
  res.json({ ok: true });
}));
