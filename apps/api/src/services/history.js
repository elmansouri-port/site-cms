/*
 * history.js — restore points, and what it takes to make them trustworthy.
 *
 * A CMS that can be edited by somebody who is not a developer needs an undo of
 * last resort, and the version history only counts as one if three things hold:
 *
 *   1. A snapshot exists before every destructive change, taken by the API
 *      rather than remembered by the editor.
 *   2. The list is readable without loading the snapshots. A page document
 *      carries every block's markup — a few hundred kilobytes — so thirty of
 *      them is a slow screen and a big response. Each version therefore stores a
 *      small `digest` describing itself, written once at snapshot time.
 *   3. Restoring is itself undoable. The state being replaced is snapshotted
 *      first, so "I restored the wrong one" is one more click and not a
 *      catastrophe.
 *
 * Everything an entity needs to take part is declared in ENTITIES below: how to
 * load the current document, how to write one back, and how to describe it.
 */
import { BlogPost, Chrome, Form, Navigation, Page, Settings, Version } from '../models/index.js';
import { logger } from '../lib/log.js';

/** How close two automatic snapshots of the same item can be before the second is skipped. */
const SNAPSHOT_DEBOUNCE_MS = 60_000;

/** How many restore points to keep per item. */
export const HISTORY_LIMIT = 40;

const bytesOf = (value) => (typeof value === 'string' ? value.length : 0);

/**
 * The entities that have a history.
 *
 * `load` returns the current document, `write` puts a snapshot back, and
 * `digest` reduces a document to the handful of facts a history list shows. A
 * digest must stay small: it is read on every listing and never trimmed.
 */
const ENTITIES = {
  page: {
    label: 'page',
    load: (id) => Page.findOne({ key: id }),
    async write(id, snapshot) {
      // A restore must be able to bring back a deleted page, so this upserts —
      // that is what makes the trash work without a second collection.
      await Page.findOneAndUpdate({ key: id }, { $set: snapshot }, { upsert: true, new: true });
    },
    digest: (doc) => ({
      title: doc.title,
      route: doc.route,
      status: doc.status,
      // Body blocks only: the header and footer placeholders are not this
      // page's content, and counting them makes every page look two bigger.
      blocks: (doc.sections || []).filter(s => !s.role && s.type !== 'script' && s.type !== 'style').length,
      chrome: { navbar: doc.chrome?.navbar !== false, footer: doc.chrome?.footer !== false },
      locales: doc.locales || [],
      bytes: (doc.sections || []).reduce((sum, s) => sum + bytesOf(s.html), 0),
    }),
  },

  post: {
    label: 'article',
    load: (id) => BlogPost.findById(id),
    write: (id, snapshot) => BlogPost.findByIdAndUpdate(id, { $set: snapshot }),
    digest: (doc) => ({
      title: doc.title,
      route: doc.slug,
      status: doc.status,
      blocks: (doc.sections || []).length,
      locales: doc.locale ? [doc.locale] : [],
      bytes: bytesOf(doc.bodyHtml),
    }),
  },

  chrome: {
    label: 'header & footer',
    load: (id) => Chrome.findOne({ key: id }),
    write: (id, snapshot) => Chrome.findOneAndUpdate({ key: id }, { $set: snapshot }, { upsert: true }),
    digest: (doc) => ({
      title: doc.label || 'Site header & footer',
      navbarBytes: bytesOf(doc.navbar?.html),
      footerBytes: bytesOf(doc.footer?.html),
      addIns: (doc.addIns || []).length,
      bytes: bytesOf(doc.navbar?.html) + bytesOf(doc.footer?.html),
    }),
  },

  navigation: {
    label: 'menu',
    load: (id) => Navigation.findOne({ key: id }),
    write: (id, snapshot) => Navigation.findOneAndUpdate({ key: id }, { $set: snapshot }, { upsert: true }),
    digest: (doc) => ({
      title: doc.label || doc.key,
      items: (doc.items || []).length,
      megamenus: (doc.items || []).filter(i => i.megamenu?.enabled).length,
    }),
  },

  form: {
    label: 'form',
    load: (id) => Form.findOne({ key: id }),
    // Upserts for the same reason a page does: restoring a deleted form has to
    // bring it back, not fail because the row is gone.
    write: (id, snap) => Form.findOneAndUpdate({ key: id }, { $set: snap }, { upsert: true }),
    digest: (doc) => ({
      title: doc.name || doc.key,
      fields: (doc.fields || []).length,
      target: doc.target,
      required: (doc.fields || []).filter(f => f.required).length,
    }),
  },

  settings: {
    label: 'settings',
    load: (id) => Settings.findOne({ key: id }),
    write: (id, snapshot) => Settings.findOneAndUpdate({ key: id }, { $set: snapshot }, { upsert: true }),
    digest: (doc) => ({
      title: doc.siteName || 'Site settings',
      locales: (doc.locales || []).filter(l => l.active).map(l => l.code),
    }),
  },
};

export const historyEntities = Object.keys(ENTITIES);
export const supportsHistory = (entity) => entity in ENTITIES;
export const entityLabel = (entity) => ENTITIES[entity]?.label || entity;

/** The live document behind a history, so a listing can say what the newest snapshot was replaced by. */
export const loadCurrent = (entity, entityId) => ENTITIES[entity]?.load(entityId) ?? null;

/** Strip the fields that belong to the document's identity, not its content. */
function withoutIdentity(snapshot) {
  const { _id, __v, createdAt, updatedAt, ...rest } = snapshot || {};
  return rest;
}

const plain = (doc) => (doc?.toObject ? doc.toObject({ flattenMaps: true }) : doc);

function digestOf(entity, snapshot) {
  try {
    return ENTITIES[entity]?.digest(snapshot) || {};
  } catch (err) {
    logger.warn({ err: err.message, entity }, 'could not summarise a snapshot');
    return {};
  }
}

/**
 * Record the state of something before it is changed.
 *
 * `force` skips the debounce. Automatic snapshots are debounced so that editing
 * three fields in a row leaves one restore point rather than three; a snapshot
 * somebody asked for, or one taken before a delete or a publish, must never be
 * the one that gets skipped.
 *
 * Never throws: a history write failing must not fail the edit it was
 * protecting. Losing a restore point is bad, losing the editor's work is worse.
 */
export async function snapshot(entity, entityId, doc, user, label = '', { force = false, kind = 'auto' } = {}) {
  try {
    if (!doc) return null;
    if (!force) {
      const recent = await Version.findOne(
        { entity, entityId: String(entityId), createdAt: { $gt: new Date(Date.now() - SNAPSHOT_DEBOUNCE_MS) } },
        { _id: 1 },
      ).lean();
      if (recent) return null;
    }

    const snap = plain(doc);
    const created = await Version.create({
      entity,
      entityId: String(entityId),
      label,
      kind,
      digest: digestOf(entity, snap),
      snapshot: snap,
      createdBy: user?._id || null,
    });

    await trim(entity, entityId);
    return created;
  } catch (err) {
    logger.warn({ err: err.message, entity, entityId }, 'could not store version snapshot');
    return null;
  }
}

/**
 * Keep the history readable and the collection bounded.
 *
 * Restore points somebody named are kept regardless of age: they exist because
 * a human said "this is the state I want to be able to get back to", and
 * expiring one because twenty automatic snapshots happened afterwards would
 * defeat the only reason to make one.
 */
async function trim(entity, entityId) {
  const surplus = await Version.find({ entity, entityId: String(entityId), kind: { $ne: 'manual' } })
    .sort({ createdAt: -1 })
    .skip(HISTORY_LIMIT)
    .select('_id')
    .lean();
  if (surplus.length) await Version.deleteMany({ _id: { $in: surplus.map(v => v._id) } });
}

/** Snapshot the current state of something on request, with a name. */
export async function snapshotCurrent(entity, entityId, user, label) {
  const config = ENTITIES[entity];
  if (!config) return null;
  const doc = await config.load(entityId);
  if (!doc) return null;
  return snapshot(entity, entityId, doc, user, label, { force: true, kind: 'manual' });
}

/**
 * The restore points for one item, newest first, with what changed at each step.
 *
 * The digest of a version is the state *before* that edit, so what a row is
 * really telling you is "restore this and the title goes back to X". The change
 * summary compares each digest with the one after it in time — which is the next
 * row up, or the live document for the newest.
 */
export async function listVersions(entity, entityId, { current } = {}) {
  const rows = await Version.find(
    { entity, entityId: String(entityId) },
    { snapshot: 0 },
  ).sort({ createdAt: -1 }).limit(HISTORY_LIMIT).populate('createdBy', 'name email').lean();

  await backfillDigests(rows);

  const liveDigest = current ? digestOf(entity, plain(current)) : null;

  return rows.map((row, i) => {
    // What this snapshot was replaced by: the previous row in time, or the live
    // document when this is the newest snapshot there is.
    const after = i === 0 ? liveDigest : rows[i - 1].digest;
    return {
      id: String(row._id),
      label: row.label,
      kind: row.kind || 'auto',
      createdAt: row.createdAt,
      by: row.createdBy ? { name: row.createdBy.name, email: row.createdBy.email } : null,
      digest: row.digest || {},
      changes: describeChanges(row.digest || {}, after),
    };
  });
}

/**
 * Give a digest to any row written before digests existed.
 *
 * Reading the snapshot is the expensive thing this design exists to avoid, so
 * it happens once per row, ever, and the result is stored. The alternative —
 * "no summary available" on every snapshot older than this feature — would make
 * exactly the restore points somebody kept the least legible.
 */
async function backfillDigests(rows) {
  const stale = rows.filter(r => !r.digest || !Object.keys(r.digest).length);
  if (!stale.length) return;

  await Promise.all(stale.map(async (row) => {
    const full = await Version.findById(row._id, { snapshot: 1, entity: 1 }).lean();
    if (!full?.snapshot) return;
    const digest = digestOf(full.entity, full.snapshot);
    if (!Object.keys(digest).length) return;
    row.digest = digest;
    await Version.updateOne({ _id: row._id }, { $set: { digest } });
  }));
}

/**
 * What differs between two digests, as short phrases.
 *
 * "title, 2 blocks removed" tells an editor which restore point they want.
 * A list of timestamps does not.
 */
function describeChanges(before, after) {
  // Nothing to compare against — the newest snapshot of something that has
  // since been deleted, or a digest that could not be computed.
  if (!after || !Object.keys(after).length || !before || !Object.keys(before).length) return [];
  const out = [];
  const changed = (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]);

  if (before.title !== undefined && changed('title')) out.push('title');
  if (before.route !== undefined && changed('route')) out.push('URL');
  if (before.status && after.status && before.status !== after.status) {
    out.push(`${before.status} → ${after.status}`);
  }

  if (before.blocks !== undefined && after.blocks !== undefined && before.blocks !== after.blocks) {
    const delta = after.blocks - before.blocks;
    out.push(`${Math.abs(delta)} block${Math.abs(delta) === 1 ? '' : 's'} ${delta > 0 ? 'added' : 'removed'}`);
  }
  if (before.chrome && after.chrome && changed('chrome')) {
    const off = [
      after.chrome?.navbar === false && 'header',
      after.chrome?.footer === false && 'footer',
    ].filter(Boolean);
    out.push(off.length ? `${off.join(' and ')} turned off` : 'header and footer turned back on');
  }
  if (before.locales && after.locales && changed('locales')) out.push('languages');
  if (before.addIns !== undefined && changed('addIns')) out.push('add-ins');
  if (before.items !== undefined && changed('items')) out.push('menu items');

  // Content edits that changed no metadata still changed something; say so
  // rather than showing a blank row.
  if (!out.length && before.bytes !== undefined && before.bytes !== after.bytes) {
    const delta = after.bytes - before.bytes;
    out.push(`content ${delta > 0 ? 'grew' : 'shrank'} by ${Math.abs(delta).toLocaleString()} bytes`);
  }
  return out;
}

/**
 * Put a version back, having first recorded what it replaces.
 *
 * Returns `{ entity, entityId, undo }` — `undo` is the restore point for the
 * state that was just replaced, so the caller can offer to reverse it.
 */
export async function restoreVersion(versionId, user) {
  const version = await Version.findById(versionId).lean();
  if (!version) return { error: 'notFound' };

  const config = ENTITIES[version.entity];
  if (!config) return { error: 'unsupported', entity: version.entity };

  const before = await config.load(version.entityId);
  const undo = await snapshot(
    version.entity,
    version.entityId,
    before,
    user,
    `before restoring the version from ${new Date(version.createdAt).toISOString().slice(0, 16).replace('T', ' ')}`,
    { force: true, kind: 'auto' },
  );

  await config.write(version.entityId, withoutIdentity(version.snapshot));

  return {
    entity: version.entity,
    entityId: version.entityId,
    restoredFrom: version.createdAt,
    undo: undo ? String(undo._id) : null,
  };
}

/**
 * Pages that were deleted and can still be brought back.
 *
 * A delete always writes a restore point first, so that snapshot *is* the bin —
 * no second collection, and no way for the two to disagree about what exists.
 */
export async function deletedPages() {
  const rows = await Version.find({ entity: 'page' }, { entityId: 1, digest: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .limit(400)
    .lean();

  const newest = new Map();
  for (const row of rows) if (!newest.has(row.entityId)) newest.set(row.entityId, row);
  if (!newest.size) return [];

  const alive = new Set(
    (await Page.find({ key: { $in: [...newest.keys()] } }, { key: 1, _id: 0 }).lean()).map(p => p.key),
  );

  return [...newest.entries()]
    .filter(([key]) => !alive.has(key))
    .map(([key, row]) => ({
      key,
      title: row.digest?.title || key,
      route: row.digest?.route || '',
      deletedAt: row.createdAt,
      versionId: String(row._id),
    }));
}

/** The newest restore point for a page that no longer exists. */
export async function recoverPage(key, user) {
  const row = await Version.findOne({ entity: 'page', entityId: String(key) })
    .sort({ createdAt: -1 })
    .select('_id')
    .lean();
  if (!row) return { error: 'notFound' };
  if (await Page.exists({ key })) return { error: 'exists' };

  const result = await restoreVersion(row._id, user);
  if (result.error) return result;

  // A page nobody expected to be live again comes back as a draft: recovering
  // it is a decision to look at it, not a decision to publish it.
  await Page.findOneAndUpdate({ key }, { $set: { status: 'draft', editedInCms: true } });
  return result;
}
