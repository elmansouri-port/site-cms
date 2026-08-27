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
import { Media, Page, BlogPost, Chrome } from '../../models/index.js';
import { asyncHandler, notFoundError, badRequest } from '../../middleware/error.js';
import { validate, q } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { audit, publishChanged } from '../../services/publish.js';
import { slugify } from '@rainbow/core/html';
import { assetRef } from '@rainbow/core/assets';

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
    { name: { $regex: search, $options: 'i' } },
    { slug: { $regex: search, $options: 'i' } },
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
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    docs.push({
      filename: file.filename,
      originalName: file.originalname,
      url: `${config.uploads.publicPath}/${file.filename}`,
      mime: file.mimetype,
      size: file.size,
      folder,
      source: 'upload',
      uploadedBy: req.user._id,
      // Every upload is a named asset from the first second, because retrofitting
      // a name onto an image already used on nine pages means editing nine pages.
      name: base.replace(/[-_]+/g, ' ').trim() || file.filename,
      slug: await freeSlug(base),
    });
  }
  const created = await Media.insertMany(docs);
  await audit(req, 'media.upload', 'media', '', { count: created.length });
  res.status(201).json({ items: created });
}));

/** A slug nothing else answers to, derived from a name. */
async function freeSlug(from, ownId = null) {
  const base = slugify(String(from || 'image'), 60) || 'image';
  let slug = base;
  let n = 1;
  for (;;) {
    const clash = await Media.findOne({
      $or: [{ slug }, { aliases: slug }],
      ...(ownId ? { _id: { $ne: ownId } } : {}),
    }).lean();
    if (!clash) return slug;
    slug = `${base}-${++n}`;
  }
}

const patchMedia = z.object({
  name: z.string().max(200).optional(),
  slug: z.string().max(80).regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, numbers and hyphens').optional(),
  alt: z.record(z.string().max(5), z.string().max(500)).optional(),
  folder: z.string().max(120).optional(),
}).strict();

mediaRouter.patch('/:id', requireRole('editor'), validate(patchMedia), asyncHandler(async (req, res) => {
  const item = await Media.findById(req.params.id);
  if (!item) throw notFoundError('No such media item');

  if (req.body.name !== undefined) item.name = req.body.name;
  if (req.body.folder !== undefined) item.folder = req.body.folder;
  if (req.body.alt) for (const [k, v] of Object.entries(req.body.alt)) item.alt.set(k, v);

  if (req.body.slug !== undefined && req.body.slug !== item.slug) {
    const taken = await Media.findOne({
      _id: { $ne: item._id },
      $or: [{ slug: req.body.slug }, { aliases: req.body.slug }],
    }).lean();
    if (taken) throw badRequest(`"${req.body.slug}" is already used by another image`);
    /*
     * The old reference keeps working.
     *
     * Renaming is the moment a managed asset would otherwise betray you: every
     * page still says the old reference, and a rename that broke them is a
     * rename nobody dares perform. Keeping the alias makes the tidy-up optional.
     */
    if (item.slug) item.aliases = [...new Set([...(item.aliases || []), item.slug])];
    item.slug = req.body.slug;
  }

  await item.save();
  await audit(req, 'media.update', 'media', item._id, { fields: Object.keys(req.body) });
  await publishChanged('media updated');
  res.json({ item: item.toObject({ flattenMaps: true }) });
}));

/**
 * Swap the file behind an asset, keeping its reference.
 *
 * This is the point of the whole mechanism: one upload, and every page using
 * this image shows the new one. The old file goes to history rather than being
 * unlinked, because a page rendered a second ago may still point at it.
 */
mediaRouter.post('/:id/replace', requireRole('editor'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('No file received');
  const item = await Media.findById(req.params.id);
  if (!item) throw notFoundError('No such media item');
  if (!item.slug) item.slug = await freeSlug(item.name || item.originalName || item.filename, item._id);

  /*
   * A bundled image can be replaced too — it is the common case.
   *
   * "Swap the hero photo the site shipped with" is the first thing anybody wants
   * from a media library, and refusing it because the original lives in the build
   * would have made the feature useless for 160 of the site's 160 images. The
   * build directory is still never written to: the new file goes to the uploads
   * volume and the asset points there instead, so the original stays on disk and
   * the change is reversible from history.
   */
  const wasBundled = item.source === 'bundled';
  if (wasBundled) item.source = 'upload';

  item.history = [{
    filename: item.filename,
    url: item.url,
    size: item.size,
    width: item.width,
    height: item.height,
    replacedAt: new Date(),
  }, ...(item.history || [])].slice(0, 10);

  item.filename = req.file.filename;
  item.url = `${config.uploads.publicPath}/${req.file.filename}`;
  item.mime = req.file.mimetype;
  item.size = req.file.size;
  item.width = null;
  item.height = null;
  await item.save();

  const usage = await usageOf(item);
  await audit(req, 'media.replace', 'media', item._id, {
    filename: item.filename,
    uses: usage.total,
    ...(wasBundled ? { wasBundled: true } : {}),
  });
  // Every page referencing this asset re-renders with the new file.
  await publishChanged('image replaced');
  res.json({
    item: item.toObject({ flattenMaps: true }),
    usage,
    note: usage.byReference
      ? `Updated in ${usage.byReference} place${usage.byReference === 1 ? '' : 's'} that reference it by name.`
      : (usage.byUrl
        ? `${usage.byUrl} place${usage.byUrl === 1 ? '' : 's'} still point at the old filename. `
          + 'Use "Make it managed" so they follow the next replacement.'
        : 'Nothing references this image yet.'),
  });
}));

/**
 * Where an asset is used.
 *
 * Reported two ways on purpose. A **reference** follows a replacement; a raw
 * **URL** does not. The migrated pages hard-code filenames, so an editor needs
 * to see which uses are managed and which are still pinned to a file — the
 * second kind are exactly the ones that will not update.
 */
async function usageOf(item) {
  const refs = [item.slug, ...(item.aliases || [])].filter(Boolean).map(assetRef);
  const needles = [...refs, item.url].filter(Boolean);
  if (!needles.length) return { total: 0, byReference: 0, byUrl: 0, places: [] };

  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const any = new RegExp(needles.map(escape).join('|'));
  const managed = refs.length ? new RegExp(refs.map(escape).join('|')) : null;
  const classify = (haystack) => (managed && managed.test(haystack) ? 'reference' : 'url');

  const places = [];

  for (const page of await Page.find({}, { key: 1, title: 1, sections: 1, _id: 0 }).lean()) {
    for (const section of page.sections || []) {
      const haystack = `${section.html || ''}${JSON.stringify(section.data || {})}`;
      if (!any.test(haystack)) continue;
      places.push({
        kind: 'page',
        key: page.key,
        title: page.title,
        where: section.label || section.key,
        via: classify(haystack),
      });
    }
  }

  const postFields = { slug: 1, locale: 1, title: 1, bodyHtml: 1, sections: 1, coverImage: 1 };
  for (const post of await BlogPost.find({}, postFields).lean()) {
    const haystack = `${post.bodyHtml || ''}${JSON.stringify(post.sections || [])}${post.coverImage || ''}`;
    if (!any.test(haystack)) continue;
    places.push({
      kind: 'article',
      key: String(post._id),
      title: post.title,
      where: post.locale,
      via: classify(haystack),
    });
  }

  const chrome = await Chrome.findOne({ key: 'default' }).lean();
  for (const part of ['navbar', 'footer']) {
    const haystack = `${chrome?.[part]?.html || ''}${chrome?.[part]?.css || ''}`;
    if (!any.test(haystack)) continue;
    places.push({
      kind: 'chrome',
      key: part,
      title: part === 'navbar' ? 'Site header' : 'Site footer',
      where: 'every page',
      via: classify(haystack),
    });
  }

  return {
    total: places.length,
    byReference: places.filter(place => place.via === 'reference').length,
    byUrl: places.filter(place => place.via === 'url').length,
    places: places.slice(0, 60),
  };
}

/**
 * Put the previous file back.
 *
 * `history` exists so a replacement is reversible; without a way to act on it,
 * that was a claim rather than a feature. Restoring is itself recorded as a
 * replacement, so the file you just undid is still one click away.
 */
mediaRouter.post('/:id/restore', requireRole('editor'), asyncHandler(async (req, res) => {
  const item = await Media.findById(req.params.id);
  if (!item) throw notFoundError('No such media item');
  const previous = (item.history || [])[0];
  if (!previous) throw badRequest('There is no earlier version of this image');

  item.history = [{
    filename: item.filename,
    url: item.url,
    size: item.size,
    width: item.width,
    height: item.height,
    replacedAt: new Date(),
  }, ...item.history.slice(1)].slice(0, 10);

  item.filename = previous.filename;
  item.url = previous.url;
  item.size = previous.size || 0;
  item.width = previous.width ?? null;
  item.height = previous.height ?? null;
  await item.save();

  await audit(req, 'media.restore', 'media', item._id, { filename: item.filename });
  await publishChanged('image restored');
  const usage = await usageOf(item);
  res.json({
    item: item.toObject({ flattenMaps: true }),
    usage,
    note: `Back to ${previous.filename}.`
      + (usage.byReference ? ` ${usage.byReference} place${usage.byReference === 1 ? '' : 's'} updated.` : ''),
  });
}));

mediaRouter.get('/:id/usage', asyncHandler(async (req, res) => {
  const item = await Media.findById(req.params.id).lean();
  if (!item) throw notFoundError('No such media item');
  res.json({ usage: await usageOf(item), reference: item.slug ? assetRef(item.slug) : null });
}));

/**
 * Give a legacy image a name, and repoint everything at it.
 *
 * The migrated pages hard-code filenames, so those uses will not follow a
 * replacement. Adopting rewrites every occurrence of the file's URL to the
 * asset's reference across pages, articles and the chrome — after which
 * replacing the file is enough, everywhere.
 */
mediaRouter.post('/:id/adopt', requireRole('editor'), asyncHandler(async (req, res) => {
  const item = await Media.findById(req.params.id);
  if (!item) throw notFoundError('No such media item');
  if (!item.slug) {
    item.slug = await freeSlug(item.name || item.originalName || item.filename, item._id);
    if (!item.name) item.name = String(item.originalName || item.filename).replace(/\.[a-z0-9]+$/i, '');
    await item.save();
  }

  const ref = assetRef(item.slug);
  const swap = (text) => String(text || '').split(item.url).join(ref);
  let touched = 0;

  for (const page of await Page.find({})) {
    let changed = false;
    for (const section of page.sections || []) {
      if (section.html && section.html.includes(item.url)) {
        section.html = swap(section.html);
        changed = true;
      }
      if (section.data && JSON.stringify(section.data).includes(item.url)) {
        section.data = JSON.parse(swap(JSON.stringify(section.data)));
        changed = true;
      }
    }
    if (changed) { page.markModified('sections'); await page.save(); touched++; }
  }

  for (const post of await BlogPost.find({})) {
    let changed = false;
    if (post.bodyHtml && post.bodyHtml.includes(item.url)) { post.bodyHtml = swap(post.bodyHtml); changed = true; }
    if (post.coverImage === item.url) { post.coverImage = ref; changed = true; }
    if (post.sections?.length && JSON.stringify(post.sections).includes(item.url)) {
      post.sections = JSON.parse(swap(JSON.stringify(post.sections)));
      post.markModified('sections');
      changed = true;
    }
    if (changed) { await post.save(); touched++; }
  }

  const chrome = await Chrome.findOne({ key: 'default' });
  if (chrome) {
    let changed = false;
    for (const part of ['navbar', 'footer']) {
      if (chrome[part]?.html?.includes(item.url)) { chrome[part].html = swap(chrome[part].html); changed = true; }
      if (chrome[part]?.css?.includes(item.url)) { chrome[part].css = swap(chrome[part].css); changed = true; }
    }
    if (changed) { await chrome.save(); touched++; }
  }

  await audit(req, 'media.adopt', 'media', item._id, { slug: item.slug, touched });
  await publishChanged('image adopted as a managed asset');
  res.json({
    item: item.toObject({ flattenMaps: true }),
    reference: ref,
    touched,
    note: touched
      ? `Repointed ${touched} place${touched === 1 ? '' : 's'} at ${ref}. Replacing this image now updates all of them.`
      : `Nothing referenced this file directly. New uses of ${ref} will follow replacements.`,
  });
}));

mediaRouter.delete('/:id', requireRole('editor'), asyncHandler(async (req, res) => {
  const item = await Media.findById(req.params.id);
  if (!item) throw notFoundError('No such media item');
  if (item.source === 'bundled') {
    throw badRequest('This image ships with the site build, so the file is not ours to delete. Replace it instead.');
  }

  // Deleting an image that pages still use replaces it with a broken image on
  // every one of them. Refusing by default is the only kind thing to do; `force`
  // exists for when somebody has looked at the list and meant it.
  const usage = await usageOf(item);
  if (usage.total && req.query.force !== '1') {
    throw badRequest(
      `This image is used in ${usage.total} place${usage.total === 1 ? '' : 's'}. `
      + 'Replace it instead, or delete it again with force to leave those places broken.',
      usage.places,
    );
  }

  await item.deleteOne();
  try {
    await fs.unlink(path.join(config.uploads.dir, item.filename));
  } catch { /* the row is gone either way */ }

  await audit(req, 'media.delete', 'media', req.params.id, { filename: item.filename });
  res.json({ ok: true });
}));
