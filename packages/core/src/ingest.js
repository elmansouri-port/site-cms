/*
 * ingest.js — turn an authored HTML page into the document the CMS stores.
 *
 * This is the migration seam. It runs once per page at seed time (and again
 * whenever a developer changes a template), and it is deliberately lossless:
 *   sliceDocument()  cuts the document into head / body blocks
 *   extractHeadMeta() lifts the SEO tags into structured, per-locale fields
 *   collectUnits()   lists the copy each block owns, so the CMS can offer
 *                    "edit this section's text" without re-scanning at runtime
 *
 * Everything the ingest does not understand stays as authored bytes.
 */
import { sliceDocument, extractHeadMeta, uniqueKeys } from './slice.js';
import { collectUnits, stripMarkers } from './units.js';
import * as L from './html.js';

/** i18n keys referenced by a fragment, in document order. */
export function keysIn(fragment) {
  const keys = [];
  const seen = new Set();
  const add = (k) => { if (k && !seen.has(k)) { seen.add(k); keys.push(k); } };

  const { order } = collectUnits(fragment);
  for (const unit of order) {
    const raw = fragment.slice(unit.tagStart, unit.tagEnd);
    if (unit.type === 'attr') {
      const spec = L.attr(raw, 'data-i18n-attr');
      if (!spec) continue;
      const pair = spec.split('|').map(s => s.split(':')).find(p => p[0] === unit.attrName);
      if (pair) add(pair.slice(1).join(':'));
      continue;
    }
    add(L.attr(raw, unit.type === 'rich' ? 'data-i18n-rich' : unit.type === 'raw' ? 'data-i18n-raw' : 'data-i18n'));
  }
  for (const m of fragment.matchAll(/<script[^>]*\sdata-i18n-js="([^"]+)"/g)) add(m[1]);
  return keys;
}

const SEO_FIELDS = ['title', 'description', 'keywords', 'robots', 'canonical', 'ogType',
  'ogTitle', 'ogDescription', 'ogUrl', 'ogImage', 'twitterCard', 'twitterTitle',
  'twitterDescription', 'twitterImage'];

/**
 * Build the CMS page document.
 *
 * spec       { key, route, title, pageKind, type, status, noindex, sitemap }
 * html       the authored document
 * catalogues { fr: {...}, en: {...}, ... } used to resolve per-locale SEO copy
 * locales    locale codes to materialise
 */
export function ingestPage(spec, html, catalogues, locales) {
  const { doctype, htmlOpen, headRaw, bodyOpen, blocks } = sliceDocument(html);
  const { meta, jsonLd, headRest } = extractHeadMeta(headRaw);

  // A stub page can carry its only marker on <body> itself. Keep the marked-up
  // tag so the renderer still sees that unit; the published tag is the clean one.
  const bodyMarked = /\sdata-i18n(?:-rich)?=/.test(bodyOpen);

  const seo = {};
  for (const locale of locales) {
    const cat = catalogues[locale] || {};
    const entry = {};
    for (const field of SEO_FIELDS) {
      const m = meta[field];
      if (!m) continue;
      const translated = m.i18nKey ? L.getKey(cat, m.i18nKey) : undefined;
      const value = translated !== undefined ? String(translated) : m.value;
      if (value) entry[field] = value;
    }
    // Canonical and og:url are recomputed per request from the live base URL;
    // the authored placeholder host must not leak into production.
    delete entry.canonical;
    delete entry.ogUrl;
    entry.jsonLdOverride = '';
    entry.replaceAutoLd = false;
    seo[locale] = entry;
  }

  const seoKeys = SEO_FIELDS
    .map(f => meta[f] && meta[f].i18nKey)
    .filter(Boolean)
    .concat(jsonLd.map(j => j.i18nKey).filter(Boolean));

  const sections = uniqueKeys(blocks).map((b, i) => ({
    key: b.key,
    label: b.label,
    type: b.type,
    tag: b.tag,
    anchorId: b.anchorId,
    order: i,
    visible: true,
    locked: b.type === 'script' || b.type === 'style',
    html: b.html,
    keys: b.type === 'html' ? keysIn(b.html) : keysIn(b.html).filter(Boolean),
    layout: { spacingTop: null, spacingBottom: null },
    experiment: { key: null, variants: [] },
    componentKey: null,
    data: {},
  }));

  return {
    key: spec.key,
    route: spec.route,
    title: spec.title,
    pageKind: spec.pageKind || 'page',
    type: spec.type || 'static',
    status: spec.status || 'published',
    locales: spec.locales || locales,
    noindex: !!spec.noindex,
    sitemap: spec.sitemap || { include: !spec.noindex, priority: spec.priority || 0.7, changefreq: 'weekly' },
    doctype,
    htmlOpen,
    bodyOpen: bodyMarked ? stripMarkers(bodyOpen) : bodyOpen,
    bodyOpenRaw: bodyMarked ? bodyOpen : null,
    headRaw: headRest,
    seo,
    seoKeys,
    jsonLd: jsonLd.map(j => ({ i18nKey: j.i18nKey, value: j.value })),
    snippets: { head: '', body: '', footer: '' },
    sections,
  };
}

/**
 * Flatten the authored catalogues into string documents.
 * ownerKeys marks the keys the SEO panel owns so the copy editor can hide them.
 */
export function ingestStrings(catalogues, locales, ownerKeys = new Set()) {
  const byKey = new Map();
  for (const locale of locales) {
    const flat = L.flatten(catalogues[locale] || {});
    for (const [key, value] of Object.entries(flat)) {
      // Leaves are strings, or the occasional list (a locale's option labels).
      if (typeof value !== 'string' && !Array.isArray(value)) continue;
      let doc = byKey.get(key);
      if (!doc) {
        const [page, zone] = key.split('.');
        doc = {
          key,
          page: page || 'common',
          zone: zone || 'body',
          owner: ownerKeys.has(key) ? 'seo' : 'content',
          type: Array.isArray(value) ? 'list' : /<\d+>/.test(value) ? 'rich' : 'text',
          values: {},
        };
        byKey.set(key, doc);
      }
      doc.values[locale] = value;
    }
  }
  return [...byKey.values()];
}
