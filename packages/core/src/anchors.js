/*
 * anchors.js — change one link inside authored markup, and nothing else.
 *
 * The imported pages are stored as the exact bytes they were written with, and
 * two verification tools prove the site still ships those bytes. So "let an
 * editor click a button on the page and change where it goes" cannot mean
 * re-serialising the block: a parser would normalise quoting and whitespace and
 * silently rewrite the whole section to change nine characters.
 *
 * The same technique the renderer uses applies here. Find the nth anchor by
 * scanning, take the byte range of its `href` value, and splice. Everything
 * outside that range is untouched, which is why this is safe to offer on a page
 * that is under a byte-fidelity guarantee — the change is exactly the change the
 * editor asked for.
 *
 * Indexing is by position among the anchors of that block, which is what the
 * canvas reports: the browser and this function walk the same markup in the same
 * order, so "the third link in this block" means the same thing on both sides.
 */

/**
 * Every anchor in a fragment, with the byte ranges worth editing.
 *
 * `hrefStart`/`hrefEnd` bracket the *value* of the href, quotes excluded, so a
 * splice cannot disturb the quoting style the page was authored with.
 */
export function anchorsIn(html) {
  const source = String(html || '');
  const out = [];
  // Quote-aware: a `>` inside an attribute value does not end the tag, which a
  // naive /<a[^>]*>/ gets wrong on markup carrying inline JavaScript.
  const pattern = /<a\b/gi;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const tagStart = match.index;
    let i = tagStart + 2;
    let quote = null;
    while (i < source.length) {
      const ch = source[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      i++;
    }
    const tagEnd = i < source.length ? i + 1 : source.length;
    const raw = source.slice(tagStart, tagEnd);

    const href = /(\shref\s*=\s*)("([^"]*)"|'([^']*)')/i.exec(raw);
    const entry = {
      index: out.length,
      tagStart,
      tagEnd,
      raw,
      href: null,
      hrefStart: -1,
      hrefEnd: -1,
      target: (/(\starget\s*=\s*)("([^"]*)"|'([^']*)')/i.exec(raw) || [])[3] || null,
    };
    if (href) {
      // +1 to step over the opening quote.
      const valueStart = tagStart + href.index + href[1].length + 1;
      const value = href[3] !== undefined ? href[3] : href[4];
      entry.href = value;
      entry.hrefStart = valueStart;
      entry.hrefEnd = valueStart + value.length;
    }
    out.push(entry);
    pattern.lastIndex = tagEnd;
  }

  return out;
}

/**
 * Point the nth anchor somewhere else.
 *
 * Returns the markup unchanged when that anchor does not exist or carries no
 * href — a click that cannot be honoured must not corrupt the page, and the
 * caller can tell because the result is identical.
 */
export function setAnchorHref(html, index, href) {
  const source = String(html || '');
  const anchor = anchorsIn(source)[index];
  if (!anchor || anchor.hrefStart < 0) return source;

  return source.slice(0, anchor.hrefStart)
    + escapeAttrValue(href)
    + source.slice(anchor.hrefEnd);
}

/**
 * Add, change or remove `target` on the nth anchor.
 *
 * `rel="noopener"` travels with `_blank`: a new tab handed a reference back to
 * the opener is a genuine hazard, and an editor ticking "open in a new tab" is
 * not choosing to accept it.
 */
export function setAnchorTarget(html, index, target) {
  const source = String(html || '');
  const anchor = anchorsIn(source)[index];
  if (!anchor) return source;

  let tag = anchor.raw
    .replace(/\starget\s*=\s*("[^"]*"|'[^']*')/i, '')
    .replace(/\srel\s*=\s*("[^"]*"|'[^']*')/i, '');

  if (target === '_blank') {
    // Before the closing `>`, and before a self-closing slash if there is one.
    tag = tag.replace(/\s*\/?>$/, ' target="_blank" rel="noopener noreferrer">');
  }

  return source.slice(0, anchor.tagStart) + tag + source.slice(anchor.tagEnd);
}

/** The text an anchor shows, for naming it in a list. */
export function anchorText(anchor, html) {
  const source = String(html || '');
  const closing = source.toLowerCase().indexOf('</a>', anchor.tagEnd);
  const inner = closing < 0 ? '' : source.slice(anchor.tagEnd, closing);
  return inner.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function escapeAttrValue(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}
