/*
 * copy.js — the copy a fragment owns, and what changing the markup means for it.
 *
 * Every visible string in the header, the footer and the migrated pages is
 * marked with a translation key. The renderer *splices the catalogue value over
 * the marked range*, which is what makes one template serve three languages —
 * and what made the header editor a trap: an editor changed "Produits" to
 * "Nos produits" in the markup, saved, and the site kept saying "Produits",
 * because the catalogue still did.
 *
 * Two functions fix that, and both work on the stored bytes rather than a parse
 * tree, so nothing is re-serialized:
 *
 *   copyUnits(html)     every marked string in document order, in the exact
 *                       shape the catalogue stores it — so it can be listed and
 *                       edited directly.
 *   copyEdits(a, b)     what changed between two versions of the same markup,
 *                       as `{key, from, to}`. The caller writes those to the
 *                       catalogue, so editing text in the markup does what it
 *                       looks like it does.
 *
 * `linkTargets` is the same idea for `href` and `action`: a header's links are
 * the other thing an editor comes here to change, and they should not need a
 * text editor to do it.
 */
import * as L from './html.js';
import { collectUnits } from './units.js';

/** The marker attribute a unit of this type reads its key from. */
const MARKER = { text: 'data-i18n', rich: 'data-i18n-rich', raw: 'data-i18n-raw' };

/**
 * Which key an `attr` unit belongs to.
 *
 * `data-i18n-attr` holds one or more `attribute:key` pairs joined by `|`, and a
 * key may itself contain colons, so the split is on the first one only.
 */
function attrKeyFor(spec, attrName) {
  for (const pair of String(spec || '').split('|')) {
    const at = pair.indexOf(':');
    if (at < 0) continue;
    if (pair.slice(0, at) === attrName) return pair.slice(at + 1);
  }
  return null;
}

/**
 * Every marked string in `html`, in document order.
 *
 * `value` is the string as the catalogue stores it: plain text for a text unit,
 * the numbered-placeholder form for a rich one (`Welcome to <0>Rainbow</0>`),
 * the attribute's value for an attribute unit. That equivalence is the point —
 * it is what lets the same list be used to read the catalogue, to write it, and
 * to work out what an edit to the markup meant.
 *
 * A `data-i18n` marker on an element the extractor produces no unit for (one
 * that contains block children, or no translatable text at all) is reported
 * with `orphan: true` rather than dropped, because the renderer will not splice
 * it either and an editor is entitled to know that.
 */
export function copyUnits(html) {
  const source = String(html || '');
  const { order } = collectUnits(source);
  const out = [];
  const claimed = new Set();

  for (const unit of order) {
    const raw = source.slice(unit.tagStart, unit.tagEnd);

    if (unit.type === 'attr') {
      const key = attrKeyFor(L.attr(raw, 'data-i18n-attr'), unit.attrName);
      if (!key) continue;
      claimed.add(key);
      out.push({
        key,
        kind: 'attr',
        value: unit.value,
        tag: unit.tag,
        attrName: unit.attrName,
        zone: unit.zone,
        at: unit.tagStart,
      });
      continue;
    }

    const key = L.attr(raw, MARKER[unit.type] || 'data-i18n');
    if (!key) continue;
    claimed.add(key);
    out.push({
      key,
      kind: unit.type,
      value: unit.value,
      tag: unit.tag,
      zone: unit.zone,
      at: unit.tagStart,
    });
  }

  // Markers the extractor produced nothing for. Reported, never silently lost.
  for (const m of source.matchAll(/\sdata-i18n(-rich|-raw)?="([^"]+)"/g)) {
    const key = m[2];
    if (claimed.has(key)) continue;
    claimed.add(key);
    out.push({ key, kind: m[1] === '-rich' ? 'rich' : m[1] === '-raw' ? 'raw' : 'text', value: '', tag: '', zone: '', at: m.index, orphan: true });
  }
  for (const m of source.matchAll(/\sdata-i18n-js="([^"]+)"/g)) {
    if (claimed.has(m[1])) continue;
    claimed.add(m[1]);
    out.push({ key: m[1], kind: 'js', value: '', tag: 'script', zone: 'meta', at: m.index, orphan: true });
  }

  return out.sort((a, b) => a.at - b.at);
}

/**
 * What an edit to the markup did to the copy.
 *
 * Compares the marked strings in `before` with those in `after` and returns the
 * ones that changed, as `{key, kind, from, to}`. Keys that only exist in one
 * version are ignored: a marker that was added or removed is a change to the
 * template, and inventing a catalogue entry for it (or deleting one) is not
 * what the person editing asked for.
 *
 * Orphaned markers are skipped — their value is not readable from the markup,
 * so any comparison would be between two empty strings.
 *
 * One key may be marked in several places — a header links the same page from
 * the desktop bar and the mobile drawer, both marked `common.nav.tarifs` — and
 * the catalogue holds one value for it, which both then render. So the edits are
 * deduplicated by key: the last version of the string in the document wins, and
 * `alsoAt` says how many other places carry the same key, which is what a
 * caller needs to tell the editor that their one change moved two things.
 */
export function copyEdits(before, after) {
  const was = new Map();
  for (const u of copyUnits(before)) if (!u.orphan) was.set(u.key, u);

  const counts = new Map();
  const byKey = new Map();
  for (const u of copyUnits(after)) {
    if (u.orphan) continue;
    counts.set(u.key, (counts.get(u.key) || 0) + 1);
    const prev = was.get(u.key);
    if (!prev || prev.value === u.value) continue;
    byKey.set(u.key, { key: u.key, kind: u.kind, from: prev.value, to: u.value });
  }
  return [...byKey.values()].map(e => ({ ...e, alsoAt: (counts.get(e.key) || 1) - 1 }));
}

/*
 * Where a fragment points.
 *
 * `href` and `action` only. `src` is deliberately excluded: an image reference
 * is the media library's business and has its own picker, and repointing a
 * script tag from a list of links is not something anybody means to do.
 */
const LINK_ATTR = /\s(href|action)\s*=\s*"([^"]*)"/g;

/** Anchor text for a link, so a list of them is readable. */
function labelNear(html, at) {
  const close = html.indexOf('>', at);
  if (close < 0) return '';
  const slice = html.slice(close + 1, close + 400);
  const end = slice.indexOf('</a>');
  const text = (end < 0 ? slice : slice.slice(0, end))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 80);
}

/**
 * Every `href`/`action` in a fragment, with enough context to be listed.
 *
 * Offsets are into the string handed in, so a caller can splice a replacement
 * over exactly one occurrence — which matters, because a header links the same
 * page from both the desktop bar and the mobile drawer and changing one should
 * not silently change the other.
 */
export function linkTargets(html) {
  const source = String(html || '');
  const out = [];
  for (const m of source.matchAll(LINK_ATTR)) {
    const value = m[2];
    // Anchors and empty targets are not destinations anybody repoints.
    if (!value || value.startsWith('#')) continue;
    const attrName = m[1];
    const valueStart = m.index + m[0].indexOf('"', m[0].indexOf(attrName)) + 1;
    out.push({
      attrName,
      value,
      label: attrName === 'href' ? labelNear(source, m.index) : '',
      external: /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(value) || value.startsWith('mailto:') || value.startsWith('tel:'),
      start: valueStart,
      end: valueStart + value.length,
    });
  }
  return out;
}

/** Replace one link, addressed by the offsets `linkTargets` reported. */
export function replaceLink(html, target, next) {
  const source = String(html || '');
  if (source.slice(target.start, target.end) !== target.value) {
    throw new Error('the markup changed underneath this link — reload and try again');
  }
  return source.slice(0, target.start) + L.escapeAttr(next) + source.slice(target.end);
}

/**
 * The markup with every translated string blanked out.
 *
 * Used to answer "has the *structure* been edited", which is a different
 * question from "has anything changed". Changing a word inside a marked element
 * does not change what the page emits — the renderer splices the catalogue over
 * that range either way — so counting it as an edit lit the header's "edited"
 * badge and offered Restore original for a change that had not touched the
 * markup in any sense that matters.
 */
export function skeleton(html) {
  const source = String(html || '');
  const { order } = collectUnits(source);
  const edits = [];
  for (const unit of order) {
    const raw = source.slice(unit.tagStart, unit.tagEnd);
    if (unit.type === 'attr') {
      if (!attrKeyFor(L.attr(raw, 'data-i18n-attr'), unit.attrName)) continue;
      const attrs = L.parseAttrs({ raw, start: unit.tagStart });
      const a = attrs.find(x => x.name === unit.attrName);
      if (a) edits.push({ start: a.valueStart, end: a.valueEnd, text: '' });
      continue;
    }
    if (!L.attr(raw, MARKER[unit.type] || 'data-i18n')) continue;
    edits.push({ start: unit.innerStart, end: unit.innerEnd, text: '' });
  }
  if (!edits.length) return source;
  // Nested ranges cannot both be blanked; the outer one wins, as in the renderer.
  const sorted = edits.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  let last = null;
  for (const e of sorted) {
    if (last && e.start < last.end) continue;
    kept.push(e);
    last = e;
  }
  return L.applyEdits(source, kept);
}

/** Do two versions of a fragment differ in anything but their translated copy? */
export function structurallyEqual(a, b) {
  if (a === b) return true;
  return skeleton(a) === skeleton(b);
}

/*
 * Line endings.
 *
 * The markup editor is a textarea, and a textarea normalises every CRLF in it
 * to LF the moment it is focused. The authored pages are CRLF, so saving the
 * header without changing a character rewrote all sixty of its lines: the diff
 * was unreadable, the "edited" badge came on for no reason, and `verify-live`
 * reported the whole site as drifted. Incoming markup is put back into the
 * convention the stored copy uses, so a save that changed nothing changes
 * nothing.
 */
export function matchLineEndings(next, reference) {
  const wantsCrlf = /\r\n/.test(String(reference || ''));
  const normalised = String(next || '').replace(/\r\n/g, '\n');
  return wantsCrlf ? normalised.replace(/\n/g, '\r\n') : normalised;
}
