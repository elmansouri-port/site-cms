/*
 * html.js — tokenizer + key utilities shared by the ingest pipeline, the API
 * and the Astro renderer.
 *
 * The whole content pipeline rests on one invariant: HTML is NEVER
 * re-serialized. A real parser (parse5/jsdom) would normalize attribute
 * quoting, boolean attributes and whitespace, silently reformatting every
 * page. Instead we scan the source into spans and only ever splice over the
 * exact byte ranges that hold editable text, so what the CMS stores and what
 * the browser receives is byte-for-byte the authored markup.
 */

/** Elements whose contents are raw text, not markup — never translate inside. */
export const RAW_TEXT = new Set(['script', 'style']);

/** Attributes holding user-visible copy. */
export const ATTR_WHITELIST = new Set(['alt', 'placeholder', 'aria-label', 'title']);

/** <meta content=""> is only copy for these; the rest is machine metadata. */
export const META_TRANSLATABLE = new Set([
  'description', 'keywords',
  'og:title', 'og:description',
  'twitter:title', 'twitter:description',
]);

export const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Treated as part of a sentence rather than as page structure. */
export const INLINE = new Set(['span', 'strong', 'em', 'b', 'i', 'a', 'br', 'small', 'sup',
  'sub', 'u', 'code', 'mark', 'abbr', 'svg', 'img', 'picture', 'wbr',
  'time', 'cite', 'q', 's', 'del', 'ins', 'kbd', 'samp', 'var', 'data',
  'bdi', 'bdo', 'dfn', 'ruby', 'output']);

/**
 * Scan HTML into an ordered list of spans.
 * Quote-aware: `>` inside an attribute value (common in inline JS like `x => y`)
 * does not terminate a tag, which a naive /<[^>]+>/ split gets wrong.
 */
export function scan(html) {
  const spans = [];
  let i = 0;
  const n = html.length;

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      if (i < n) spans.push({ kind: 'text', start: i, end: n, raw: html.slice(i) });
      break;
    }
    if (lt > i) spans.push({ kind: 'text', start: i, end: lt, raw: html.slice(i, lt) });

    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      const end = close === -1 ? n : close + 3;
      spans.push({ kind: 'comment', start: lt, end, raw: html.slice(lt, end) });
      i = end;
      continue;
    }
    if (html[lt + 1] === '!') {
      const close = html.indexOf('>', lt);
      const end = close === -1 ? n : close + 1;
      spans.push({ kind: 'comment', start: lt, end, raw: html.slice(lt, end) });
      i = end;
      continue;
    }

    let j = lt + 1;
    let quote = null;
    while (j < n) {
      const c = html[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    const end = j < n ? j + 1 : n;
    const raw = html.slice(lt, end);
    const nameMatch = /^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(raw);
    const name = nameMatch ? nameMatch[1].toLowerCase() : '';
    const closing = raw[1] === '/';
    spans.push({ kind: 'tag', start: lt, end, raw, name, closing });
    i = end;

    if (!closing && RAW_TEXT.has(name) && !/\/>$/.test(raw)) {
      const closeRe = new RegExp('</\\s*' + name + '\\s*>', 'i');
      const rest = html.slice(i);
      const m = closeRe.exec(rest);
      const bodyEnd = m ? i + m.index : n;
      if (bodyEnd > i) spans.push({ kind: 'raw', start: i, end: bodyEnd, raw: html.slice(i, bodyEnd) });
      i = bodyEnd;
    }
  }
  return spans;
}

/** Parse an opening tag's attributes into [{name, value, valueStart, valueEnd}]. */
export function parseAttrs(span, html) {
  const out = [];
  const inner = span.raw;
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    const quoted = m[2];
    const value = m[3] !== undefined ? m[3] : m[4];
    const valueStart = span.start + m.index + m[0].length - quoted.length + 1;
    out.push({ name: m[1].toLowerCase(), value, valueStart, valueEnd: valueStart + value.length });
  }
  return out;
}

/** Read one attribute's value off a raw opening tag string. */
export function attr(rawTag, name) {
  const re = new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i');
  const m = re.exec(rawTag);
  if (!m) return null;
  return m[2] !== undefined ? m[2] : m[3];
}

/** True when a text run is real copy rather than whitespace/markup noise. */
export function isTranslatableText(s) {
  const t = s.trim();
  if (t.length < 2) return false;
  if (!/[A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]/.test(t)) return false;
  if (/^&[a-z]+;$/i.test(t)) return false;
  return true;
}

/** Decide whether a given attribute on a given tag carries translatable copy. */
export function isTranslatableAttr(tagName, attrName, attrs) {
  if (ATTR_WHITELIST.has(attrName)) return true;
  if (tagName === 'meta' && attrName === 'content') {
    const key = (attrs.find(a => a.name === 'name' || a.name === 'property') || {}).value;
    return !!key && META_TRANSLATABLE.has(key.toLowerCase());
  }
  return false;
}

const SLUG_MAX = 34;

/** Human-readable, stable-ish key fragment derived from the source copy. */
export function slugify(text, max = SLUG_MAX) {
  const s = String(text)
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#\d+;/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) return 'txt';
  const words = s.split('-').filter(Boolean);
  let out = '';
  for (const w of words) {
    if (out && (out.length + 1 + w.length) > max) break;
    out = out ? out + '-' + w : w;
  }
  return out || 'txt';
}

/** Splice replacements into source. edits = [{start, end, text}] — non-overlapping. */
export function applyEdits(src, edits) {
  const sorted = edits.slice().sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const e of sorted) {
    if (e.start < cursor) throw new Error('overlapping edit at ' + e.start);
    out += src.slice(cursor, e.start) + e.text;
    cursor = e.end;
  }
  return out + src.slice(cursor);
}

export function getKey(obj, key) {
  return String(key).split('.').reduce((a, k) => (a == null ? a : a[k]), obj);
}

export function setKey(obj, key, value) {
  const parts = String(key).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/** Flatten a nested catalogue into { 'a.b.c': value } pairs. */
export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

/** Rebuild a nested catalogue from flat dot-notation pairs. */
export function unflatten(pairs) {
  const out = {};
  for (const [k, v] of Object.entries(pairs || {})) setKey(out, k, v);
  return out;
}

/** Minimal HTML-attribute escaping for values the CMS emits into tags. */
export function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape a string for safe inclusion in a text node. */
export function escapeHtml(s) {
  return escapeAttr(s).replace(/'/g, '&#39;');
}

/**
 * Replace the contents of the first element whose opening tag matches
 * `openTagPattern` (a regex source fragment, typically an attribute).
 *
 * The closing tag is found by walking the tag stream and counting depth. A
 * lazy `[\s\S]*?</div>` would stop at the first nested close — which, on a
 * container full of nested elements like an article body, silently leaves the
 * tail of the old content behind.
 *
 * The same microdata attribute often appears on a <meta> as well as on the
 * element that displays it, so void tags are skipped and the search continues.
 */
export function replaceElementInner(html, openTagPattern, value) {
  const re = new RegExp(`<([a-zA-Z0-9-]+)[^>]*${openTagPattern}[^>]*>`, 'gi');

  for (const opening of html.matchAll(re)) {
    const tag = opening[1].toLowerCase();
    if (VOID.has(tag) || /\/>$/.test(opening[0])) continue;

    const innerStart = opening.index + opening[0].length;
    let depth = 1;
    for (const span of scan(html.slice(innerStart))) {
      if (span.kind !== 'tag' || span.name !== tag) continue;
      if (span.closing) {
        depth--;
        if (depth === 0) {
          return html.slice(0, innerStart) + value + html.slice(innerStart + span.start);
        }
      } else if (!/\/>$/.test(span.raw)) {
        depth++;
      }
    }
  }
  return html; // no balanced match: leave the markup alone rather than corrupt it
}
