/*
 * chrome.js — the site's header and footer, edited once.
 *
 * Before this they lived eighteen times over, one copy per migrated page, which
 * is how the German footer ended up saying different things depending on which
 * page you were reading. Now there is one document, and a page carries only a
 * placeholder saying where the header goes.
 *
 * `authoredHtml` is the copy taken from the homepage at migration time. It is
 * never written again, so "restore the original" always works — which is what
 * makes it reasonable to let a marketer edit the header at all.
 *
 * ── Why the markup alone was not enough ──────────────────────────────────────
 *
 * Every visible word in the header is marked with a translation key, and the
 * renderer splices the catalogue's value over the marked range. So editing the
 * words in the markup and saving did *nothing*: the markup changed, the render
 * put the old catalogue value straight back over it, and the person editing was
 * left concluding the CMS did not work. It didn't.
 *
 * Three routes fix that, and they are the header's real editing surface:
 *
 *   PATCH /:part          takes `locale` alongside `html`, works out which
 *                         marked strings the edit changed, and writes them to
 *                         the catalogue for that language. Editing text in the
 *                         markup now does what it looks like it does.
 *   GET/PATCH /:part/copy  every string in the part, in every language, as a
 *                         list — which is how somebody who wants to change a
 *                         word should have to do it, rather than hunting through
 *                         sixty lines of Tailwind for it.
 *   GET/PATCH /:part/links every href, listed, so a link is repointed without a
 *                         text editor.
 */
import { Router } from 'express';
import { z } from 'zod';
import { Chrome } from '../../models/index.js';
import { asyncHandler, notFoundError, badRequest } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { snapshot, audit, publishChanged } from '../../services/publish.js';
import { slugify } from '@rainbow/core/html';
import {
  copyUnits, copyEdits, linkTargets, replaceLink, matchLineEndings, structurallyEqual,
} from '@rainbow/core/copy';
import { writeCopy, readCopy } from '../../services/copy.js';
import { activeLocaleCodes } from '../../services/content.js';

export const chromeRouter = Router();

chromeRouter.use(requireAuth);

const asJson = (doc) => doc.toObject({ flattenMaps: true });

const PARTS = new Set(['navbar', 'footer']);
function partOf(req) {
  if (!PARTS.has(req.params.part)) throw badRequest('Expected navbar or footer');
  return req.params.part;
}

const partBody = z.object({
  html: z.string().max(2_000_000).optional(),
  css: z.string().max(200_000).optional(),
  js: z.string().max(200_000).optional(),
  visible: z.boolean().optional(),
  /**
   * Which language the markup was being looked at in.
   *
   * The words in the markup are one language's worth of a three-language
   * template, so a change to them is a change to *that* language's copy. The
   * editor says which one it was showing.
   *
   * **Required for a copy change to be written at all.** Defaulting to the source
   * language looked harmless and was not: a script that decodes the markup, or a
   * migration that reformats it, would have every string it touched promoted into
   * the French catalogue as a deliberate edit — which is exactly what happened
   * the first time, and it overwrote a footer string with a differently-wrapped
   * copy of itself. A caller that does not say which language it means gets its
   * markup saved and its copy left alone, and the response says so.
   */
  locale: z.string().min(2).max(5).optional(),
  experiment: z.object({
    key: z.string().max(80).nullable().optional(),
    variants: z.array(z.object({
      key: z.string().max(20),
      label: z.string().max(80).optional(),
      html: z.string().max(2_000_000).optional(),
      css: z.string().max(200_000).optional(),
      js: z.string().max(200_000).optional(),
    })).max(6).optional(),
  }).optional(),
}).strict();

const addInExperiment = z.object({
  key: z.string().max(80).nullable().optional(),
  variants: z.array(z.object({
    key: z.string().max(20),
    label: z.string().max(80).optional(),
    html: z.string().max(200_000).optional(),
  })).max(6).optional(),
});

const addInBody = z.object({
  key: z.string().max(80).optional(),
  label: z.string().max(120),
  note: z.string().max(1000).optional(),
  zone: z.enum(['head', 'bodyStart', 'bodyEnd']).default('bodyEnd'),
  html: z.string().max(200_000).default(''),
  enabled: z.boolean().default(false),
  order: z.number().int().min(0).max(999).optional(),
  pages: z.array(z.string().max(80)).max(200).optional(),
  experiment: addInExperiment.optional(),
}).strict();

/**
 * The patch schema is written out rather than derived with `.partial()`.
 *
 * `.partial()` makes every field optional but leaves its `.default()` in place,
 * so parsing `{ enabled: true }` returns `{ enabled: true, html: '' }` — and a
 * handler that assigns whatever it is given would blank the add-in's markup
 * while apparently just switching it on. Only the fields the caller actually
 * sent may reach the document.
 */
const addInPatch = z.object({
  label: z.string().max(120).optional(),
  note: z.string().max(1000).optional(),
  zone: z.enum(['head', 'bodyStart', 'bodyEnd']).optional(),
  html: z.string().max(200_000).optional(),
  enabled: z.boolean().optional(),
  order: z.number().int().min(0).max(999).optional(),
  pages: z.array(z.string().max(80)).max(200).optional(),
  experiment: addInExperiment.optional(),
}).strict();

async function load(key = 'default') {
  const doc = await Chrome.findOne({ key });
  if (!doc) throw notFoundError('The site header and footer have not been set up — run the seed');
  return doc;
}

chromeRouter.get('/', asyncHandler(async (_req, res) => {
  const doc = await Chrome.findOne({ key: 'default' }).lean();
  res.json({ chrome: doc || null });
}));

chromeRouter.patch('/:part', requireRole('admin'), validate(partBody), asyncHandler(async (req, res) => {
  const part = partOf(req);
  const doc = await load();
  await snapshot('chrome', 'default', asJson(doc), req.user, `before editing the ${part}`);

  const before = doc[part].html || '';
  let copyResult = { written: [], refused: [] };
  let copyEditList = [];

  if (req.body.html !== undefined) {
    /*
     * Put the line endings back the way the stored copy has them.
     *
     * The markup editor is a textarea, and a textarea normalises CRLF to LF the
     * moment it is focused. The authored pages are CRLF, so opening the header,
     * changing one word and saving rewrote all sixty lines: the history entry
     * was unreadable, the "edited" badge came on when nothing had been edited,
     * and `verify-live` reported the entire site as drifted from its source.
     */
    req.body.html = matchLineEndings(req.body.html, doc[part].authoredHtml || before);
  }

  for (const field of ['html', 'css', 'js', 'visible']) {
    if (req.body[field] !== undefined) doc[part][field] = req.body[field];
  }
  if (req.body.experiment) {
    const current = doc[part].experiment?.toObject?.() ?? doc[part].experiment ?? {};
    doc[part].experiment = { ...current, ...req.body.experiment };
    doc.markModified(`${part}.experiment`);
  }

  if (req.body.html !== undefined) {
    /*
     * The words in the markup are the catalogue's, so a change to them is a
     * change to the catalogue. Work out which marked strings moved and write
     * them, in the language the editor was looking at.
     *
     * Done after the markup is assigned and before the save, so one request is
     * one change: the markup and the copy it implies land together or not at
     * all, and history has a single point to go back to.
     */
    copyEditList = copyEdits(before, req.body.html);
    if (copyEditList.length && req.body.locale) {
      copyResult = await writeCopy(
        Object.fromEntries(copyEditList.map(e => [e.key, e.to])),
        req.body.locale,
        req.user,
      );
      copyResult.locale = req.body.locale;
    }
    /*
     * "Edited" means the *markup* differs from the original, not the words.
     *
     * A word inside a marked element is spliced over by the catalogue on every
     * render, so changing it emits exactly the same bytes. Counting that as an
     * edit lit the header's "edited" badge and offered Restore original — which
     * would have thrown away the structure to undo a change to the structure
     * that never happened.
     */
    doc[part].edited = !structurallyEqual(req.body.html, doc[part].authoredHtml || '');
  }

  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, 'chrome.update', 'chrome', part, {
    fields: Object.keys(req.body),
    ...(copyResult.written.length ? { copyKeys: copyResult.written, locale: copyResult.locale } : {}),
  });
  // Every page renders this, so the whole cache generation has to retire.
  await publishChanged(`${part} updated`);
  res.json({
    chrome: asJson(doc),
    /*
     * What the edit did to the copy, reported rather than assumed.
     *
     * The interface says "3 texts updated in French" instead of leaving the
     * editor to check the site and wonder. `refused` names the rich strings that
     * could not be written from markup, which is the one case where the change
     * really did not go in.
     */
    copy: {
      changed: copyEditList.map(e => ({ key: e.key, to: e.to, alsoAt: e.alsoAt })),
      written: copyResult.written,
      refused: copyResult.refused,
      locale: copyResult.locale || null,
      // Named rather than silent: a caller that changed words without saying
      // which language it meant needs to know the words did not move.
      ...(copyEditList.length && !req.body.locale
        ? { skipped: 'No locale was given, so the copy was left as it is. Send `locale` to write it.' }
        : {}),
    },
  });
}));

/* ── The copy inside a part ───────────────────────────────────────────────── */

/**
 * Every string the header or footer renders, in every language.
 *
 * This is the screen somebody who wants to change a word should be using. The
 * markup tab exists for structure; a list of the actual sentences, each with
 * what it says in French, English and German, is what "edit the footer" means
 * to the person asking.
 *
 * `zone` and `tag` come from the extractor, so the list can be grouped the way
 * the markup is laid out rather than alphabetically by key.
 */
chromeRouter.get('/:part/copy', asyncHandler(async (req, res) => {
  const part = partOf(req);
  const doc = await load();
  const units = copyUnits(doc[part].html || '');
  const catalogue = await readCopy(units.map(u => u.key));
  const locales = await activeLocaleCodes();

  // One row per key, not per occurrence: the catalogue holds one value, and
  // showing the same sentence three times because the header repeats it in the
  // mobile drawer would make the list twice as long and no more useful.
  const rows = new Map();
  for (const unit of units) {
    const existing = rows.get(unit.key);
    if (existing) { existing.occurrences += 1; continue; }
    const row = catalogue[unit.key];
    rows.set(unit.key, {
      key: unit.key,
      kind: unit.kind,
      tag: unit.tag,
      attrName: unit.attrName || null,
      zone: unit.zone,
      orphan: !!unit.orphan,
      occurrences: 1,
      // What the markup currently carries, which for the source language is
      // also the fallback the renderer uses when the catalogue has no entry.
      inMarkup: unit.value,
      values: row?.values || {},
      // A rich string cannot be edited as plain text without losing its inline
      // markup, so the interface sends the editor to the copy editor instead.
      rich: unit.kind === 'rich' || /<\d+(?:\/>|>)/.test(String(row?.values?.fr ?? '')),
      known: !!row,
    });
  }

  res.json({ part, locales, items: [...rows.values()] });
}));

const copyPatch = z.object({
  locale: z.string().min(2).max(5),
  values: z.record(z.string().max(300), z.string().max(20_000)).refine(
    v => Object.keys(v).length > 0 && Object.keys(v).length <= 500,
    'Between 1 and 500 strings',
  ),
}).strict();

/**
 * Write copy for one language.
 *
 * No snapshot of the chrome document: nothing in it changes. The strings are
 * the catalogue's, and the catalogue is versioned by the copy editor's own
 * history — taking a chrome restore point here would offer a way back that
 * restores markup and leaves the words where they were.
 */
chromeRouter.patch('/:part/copy', requireRole('editor'), validate(copyPatch), asyncHandler(async (req, res) => {
  const part = partOf(req);
  const doc = await load();
  const allowed = new Set(copyUnits(doc[part].html || '').map(u => u.key));

  const values = {};
  const unknown = [];
  for (const [key, value] of Object.entries(req.body.values)) {
    // Only keys this part actually renders. Without this the route is a second,
    // unaudited way to write any string in the site from a screen that claims
    // to be about the footer.
    if (allowed.has(key)) values[key] = value;
    else unknown.push(key);
  }
  if (!Object.keys(values).length) {
    throw badRequest(`None of those strings appear in the ${part}`, unknown.map(k => ({ key: k })));
  }

  const result = await writeCopy(values, req.body.locale, req.user);
  await audit(req, 'chrome.copy.update', 'chrome', part, {
    locale: req.body.locale, keys: result.written,
  });
  await publishChanged(`${part} copy updated`);
  res.json({ ok: true, ...result, unknown });
}));

/* ── The links inside a part ──────────────────────────────────────────────── */

/**
 * Every href in the part, listed.
 *
 * The other reason anybody opens the header: a link points at the wrong place.
 * Repointing it should not require finding the right one of thirteen anchors in
 * a wall of utility classes, so they are enumerated with their anchor text and
 * addressed by index.
 */
chromeRouter.get('/:part/links', asyncHandler(async (req, res) => {
  const part = partOf(req);
  const doc = await load();
  const items = linkTargets(doc[part].html || '').map((t, index) => ({
    index,
    attrName: t.attrName,
    value: t.value,
    label: t.label,
    external: t.external,
  }));
  res.json({ part, items });
}));

const linksPatch = z.object({
  links: z.array(z.object({
    index: z.number().int().min(0).max(999),
    // The value as it was read, so a concurrent edit is caught rather than
    // overwriting whatever now sits at that index.
    was: z.string().max(2000),
    value: z.string().max(2000),
  })).min(1).max(200),
}).strict();

chromeRouter.patch('/:part/links', requireRole('admin'), validate(linksPatch), asyncHandler(async (req, res) => {
  const part = partOf(req);
  const doc = await load();
  const html = doc[part].html || '';
  const targets = linkTargets(html);

  /*
   * Applied back-to-front.
   *
   * Every offset was measured against the string as it is now, and splicing a
   * longer URL over a shorter one moves everything after it. Working from the
   * end means no edit invalidates an offset that has not been used yet — the
   * same reason applyEdits sorts, done by hand because these are addressed by
   * index rather than collected as a set.
   */
  const ordered = req.body.links
    .map(l => ({ ...l, target: targets[l.index] }))
    .sort((a, b) => (b.target?.start ?? -1) - (a.target?.start ?? -1));

  let next = html;
  const changed = [];
  for (const { target, was, value } of ordered) {
    if (!target) throw badRequest('That link is no longer there — reload and try again');
    if (target.value !== was) {
      throw badRequest(`The ${part} changed since you opened it — reload and try again`);
    }
    if (value === was) continue;
    next = replaceLink(next, target, value);
    changed.push({ from: was, to: value });
  }

  if (!changed.length) return res.json({ ok: true, changed: [] });

  await snapshot('chrome', 'default', asJson(doc), req.user, `before repointing ${part} links`);
  doc[part].html = next;
  doc[part].edited = !structurallyEqual(next, doc[part].authoredHtml || '');
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, 'chrome.links.update', 'chrome', part, { changed });
  await publishChanged(`${part} links updated`);
  res.json({ ok: true, changed, chrome: asJson(doc) });
}));

/**
 * Put a part back to the markup the site was migrated with.
 *
 * The escape hatch that makes the header safe to hand to a non-developer: the
 * worst case is one click away from being undone.
 */
chromeRouter.post('/:part/restore', requireRole('admin'), asyncHandler(async (req, res) => {
  const part = partOf(req);
  const doc = await load();
  if (!doc[part].authoredHtml) throw badRequest('There is no original recorded for this part');

  await snapshot('chrome', 'default', asJson(doc), req.user, `before restoring the ${part}`, { force: true });
  doc[part].html = doc[part].authoredHtml;
  doc[part].css = '';
  doc[part].js = '';
  doc[part].edited = false;
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, 'chrome.restore', 'chrome', part);
  await publishChanged(`${part} restored`);
  res.json({ chrome: asJson(doc) });
}));

/* ── Add-ins ──────────────────────────────────────────────────────────────── */

chromeRouter.post('/add-ins', requireRole('admin'), validate(addInBody), asyncHandler(async (req, res) => {
  const doc = await load();
  const base = slugify(req.body.key || req.body.label, 48) || 'add-in';
  let key = base;
  let n = 1;
  while (doc.addIns.some(a => a.key === key)) key = `${base}-${++n}`;

  doc.addIns.push({
    ...req.body,
    key,
    order: req.body.order ?? doc.addIns.length,
  });
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, 'chrome.addin.create', 'chrome', key);
  await publishChanged('add-in created');
  res.status(201).json({ chrome: asJson(doc) });
}));

chromeRouter.patch('/add-ins/:key', requireRole('admin'), validate(addInPatch), asyncHandler(async (req, res) => {
  const doc = await load();
  const addIn = doc.addIns.find(a => a.key === req.params.key);
  if (!addIn) throw notFoundError('No such add-in');

  await snapshot('chrome', 'default', asJson(doc), req.user, `before editing add-in "${addIn.label}"`);
  for (const [field, value] of Object.entries(req.body)) {
    if (value === undefined) continue;
    addIn[field] = value;
  }
  doc.markModified('addIns');
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, 'chrome.addin.update', 'chrome', addIn.key, { enabled: addIn.enabled });
  await publishChanged('add-in updated');
  res.json({ chrome: asJson(doc) });
}));

chromeRouter.delete('/add-ins/:key', requireRole('admin'), asyncHandler(async (req, res) => {
  const doc = await load();
  const at = doc.addIns.findIndex(a => a.key === req.params.key);
  if (at < 0) throw notFoundError('No such add-in');

  await snapshot('chrome', 'default', asJson(doc), req.user, 'before deleting an add-in', { force: true });
  doc.addIns.splice(at, 1);
  doc.addIns.forEach((a, i) => { a.order = i; });
  doc.updatedBy = req.user._id;
  await doc.save();

  await audit(req, 'chrome.addin.delete', 'chrome', req.params.key);
  await publishChanged('add-in deleted');
  res.json({ chrome: asJson(doc) });
}));
