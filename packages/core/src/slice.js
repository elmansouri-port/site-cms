/*
 * slice.js — cut an authored HTML document into the pieces the CMS stores.
 *
 * A page becomes:
 *   doctype        everything before <html> (kept verbatim)
 *   htmlOpen       the <html ...> tag
 *   head           the raw <head> inner HTML, minus the metadata tags the CMS
 *                  now owns (title, description, robots, canonical, OG, JSON-LD)
 *   meta           those extracted metadata tags, as structured fields
 *   bodyOpen       the <body ...> tag
 *   blocks[]       ordered top-level children of <body>, each one byte range of
 *                  the original document, so concatenating them reproduces the
 *                  body exactly
 *
 * Nothing is reformatted: every block holds the authored bytes, including the
 * whitespace that preceded it, which is why a round trip is lossless.
 */
import * as L from './html.js';

/** Locate the inner range of the first <tag ...> ... </tag> pair at top level. */
function elementRange(html, tagName) {
  const spans = L.scan(html);
  let openIdx = -1;
  let depth = 0;
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s.kind !== 'tag' || s.name !== tagName) continue;
    if (!s.closing) {
      if (openIdx === -1) openIdx = i;
      depth++;
    } else {
      depth--;
      if (depth === 0 && openIdx !== -1) {
        return {
          openTag: spans[openIdx].raw,
          openStart: spans[openIdx].start,
          innerStart: spans[openIdx].end,
          innerEnd: s.start,
          closeEnd: s.end,
          spans,
        };
      }
    }
  }
  return null;
}

const BLOCK_LABELS = [
  [/^nav\b/, 'Navigation'],
  [/^header\b/, 'Header'],
  [/^footer\b/, 'Footer'],
  [/^main\b/, 'Main'],
  [/^section\b/, 'Section'],
  [/^script\b/, 'Script'],
  [/^style\b/, 'Styles'],
  [/^div\b/, 'Block'],
];

/** Derive a readable admin label + machine key for a top-level block. */
function describeBlock(openTag, name, inner, index) {
  const id = L.attr(openTag, 'id');
  const cls = L.attr(openTag, 'class') || '';
  let base = null;

  if (id) base = id;
  else if (name === 'footer') base = 'footer';
  else if (name === 'script') base = 'script';
  else if (name === 'style') base = 'styles';
  else {
    const firstClass = cls.split(/\s+/).find(c => /^[a-z][a-z0-9-]{2,}$/i.test(c) && !/^(?:pt|pb|py|px|mt|mb|mx|my|w|h|z|bg|text|flex|grid|max|min|rounded|border|gap|relative|absolute|fixed|overflow|items|justify|hidden|block|space)-/.test(c));
    if (firstClass) base = firstClass;
  }

  // A heading inside the block usually names it better than any class does.
  const heading = /<h[1-3][^>]*>([\s\S]{0,160}?)<\/h[1-3]>/i.exec(inner || '');
  const headingText = heading
    ? heading[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    : '';

  const kindLabel = (BLOCK_LABELS.find(([re]) => re.test(name)) || [null, 'Block'])[1];
  const label = headingText || (base ? base.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : `${kindLabel} ${index + 1}`);
  const key = L.slugify(base || headingText || `${name}-${index + 1}`, 48);
  return { label: `${kindLabel}: ${label}`.slice(0, 90), key, anchorId: id || null };
}

/**
 * Split `html` into the CMS storage shape. `html` must be a full document.
 */
export function sliceDocument(html) {
  const htmlEl = elementRange(html, 'html');
  const headEl = elementRange(html, 'head');
  const bodyEl = elementRange(html, 'body');
  if (!bodyEl) throw new Error('document has no <body>');

  const doctype = htmlEl ? html.slice(0, htmlEl.openStart) : '';
  const htmlOpen = htmlEl ? htmlEl.openTag : '<html lang="fr">';
  const headRaw = headEl ? html.slice(headEl.innerStart, headEl.innerEnd) : '';
  const bodyOpen = bodyEl.openTag;
  const bodyInner = html.slice(bodyEl.innerStart, bodyEl.innerEnd);

  const blocks = sliceBody(bodyInner);
  return { doctype, htmlOpen, headRaw, bodyOpen, bodyInner, blocks };
}

/**
 * Cut the body's inner HTML into its top-level children. Whitespace and
 * comments between elements are attached to the element that follows, and any
 * trailing run is appended to the last block, so
 * `blocks.map(b => b.html).join('')` === the original body inner HTML.
 */
export function sliceBody(bodyInner) {
  const spans = L.scan(bodyInner);
  const blocks = [];
  let depth = 0;
  let start = 0;         // start of the current block, including leading trivia
  let openTag = null;
  let name = null;
  let innerStart = 0;

  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s.kind !== 'tag') continue;

    if (!s.closing) {
      const selfClosing = /\/>$/.test(s.raw) || L.VOID.has(s.name);
      if (depth === 0) {
        openTag = s.raw;
        name = s.name;
        innerStart = s.end;
        if (selfClosing) {
          blocks.push(makeBlock(bodyInner, start, s.end, openTag, name, innerStart, s.start, blocks.length));
          start = s.end;
          continue;
        }
      }
      if (!selfClosing) depth++;
    } else {
      depth--;
      if (depth === 0) {
        blocks.push(makeBlock(bodyInner, start, s.end, openTag, name, innerStart, s.start, blocks.length));
        start = s.end;
      }
      if (depth < 0) depth = 0;
    }
  }

  if (start < bodyInner.length) {
    const tail = bodyInner.slice(start);
    if (blocks.length) blocks[blocks.length - 1].html += tail;
    else blocks.push({ key: 'body', label: 'Body', type: 'html', html: tail, anchorId: null, tag: null });
  }
  return blocks;
}

function makeBlock(src, start, end, openTag, name, innerStart, innerEnd, index) {
  const inner = src.slice(innerStart, innerEnd);
  const { label, key, anchorId } = describeBlock(openTag, name, inner, index);
  return {
    key,
    label,
    tag: name,
    type: name === 'script' ? 'script' : name === 'style' ? 'style' : 'html',
    anchorId,
    html: src.slice(start, end),
  };
}

/** Make block keys unique inside one page. */
export function uniqueKeys(blocks) {
  const seen = new Map();
  return blocks.map((b) => {
    const n = (seen.get(b.key) || 0) + 1;
    seen.set(b.key, n);
    return n === 1 ? b : { ...b, key: `${b.key}-${n}` };
  });
}

/* ── head metadata extraction ─────────────────────────────────────────────── */

const HEAD_PATTERNS = [
  { field: 'title', re: /[ \t]*<title\b[^>]*>[\s\S]*?<\/title>\s*\n?/i },
  { field: 'description', re: /[ \t]*<meta\s+name="description"[^>]*>\s*\n?/i },
  { field: 'keywords', re: /[ \t]*<meta\s+name="keywords"[^>]*>\s*\n?/i },
  { field: 'robots', re: /[ \t]*<meta\s+name="robots"[^>]*>\s*\n?/i },
  { field: 'canonical', re: /[ \t]*<link\s+rel="canonical"[^>]*>\s*\n?/i },
  { field: 'ogType', re: /[ \t]*<meta\s+property="og:type"[^>]*>\s*\n?/i },
  { field: 'ogTitle', re: /[ \t]*<meta\s+property="og:title"[^>]*>\s*\n?/i },
  { field: 'ogDescription', re: /[ \t]*<meta\s+property="og:description"[^>]*>\s*\n?/i },
  { field: 'ogUrl', re: /[ \t]*<meta\s+property="og:url"[^>]*>\s*\n?/i },
  { field: 'ogImage', re: /[ \t]*<meta\s+property="og:image"[^>]*>\s*\n?/i },
  { field: 'twitterCard', re: /[ \t]*<meta\s+name="twitter:card"[^>]*>\s*\n?/i },
  { field: 'twitterTitle', re: /[ \t]*<meta\s+name="twitter:title"[^>]*>\s*\n?/i },
  { field: 'twitterDescription', re: /[ \t]*<meta\s+name="twitter:description"[^>]*>\s*\n?/i },
  { field: 'twitterImage', re: /[ \t]*<meta\s+name="twitter:image"[^>]*>\s*\n?/i },
];

/**
 * Pull the SEO tags the CMS owns out of the raw head, returning the structured
 * values (including the i18n key each tag carried, so the string stays
 * translatable) plus the head remainder that still ships verbatim.
 */
export function extractHeadMeta(headRaw) {
  let rest = headRaw;
  const meta = {};

  for (const { field, re } of HEAD_PATTERNS) {
    const m = re.exec(rest);
    if (!m) continue;
    const tag = m[0];
    const value = field === 'title'
      ? (/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(tag) || ['', ''])[1].trim()
      : (L.attr(tag, field === 'canonical' ? 'href' : 'content') || '').trim();
    const i18nKey = L.attr(tag, 'data-i18n')
      || (L.attr(tag, 'data-i18n-attr') || '').split(':').slice(1).join(':')
      || null;
    meta[field] = { value, i18nKey: i18nKey || null };
    rest = rest.replace(re, '');
  }

  /*
   * JSON-LD blocks: the page may carry several.
   *
   * The type attribute is matched anywhere in the tag, not immediately after
   * `<script `. It used to be anchored there, so the article template's
   * `<script id="json-ld-main" type="application/ld+json" …>` was never
   * recognised: its structured data stayed in the raw head, untranslated, and
   * shipped with its internal `data-i18n-raw` key visible in the markup.
   */
  const jsonLd = [];
  const ldRe = /[ \t]*<script\b([^>]*\stype="application\/ld\+json"[^>]*)>([\s\S]*?)<\/script>\s*\n?/gi;
  let lm;
  while ((lm = ldRe.exec(rest)) !== null) {
    jsonLd.push({
      i18nKey: L.attr('<script' + lm[1] + '>', 'data-i18n-raw') || null,
      value: lm[2].trim(),
    });
  }
  if (jsonLd.length) rest = rest.replace(ldRe, '');

  return { meta, jsonLd, headRest: rest };
}
