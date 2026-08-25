/*
 * render.js — apply a content catalogue to a marked-up fragment.
 *
 * Rendering is a splice over the fragment's byte ranges, never a
 * re-serialization, so anything the editor has not touched comes out exactly as
 * authored. The renderer works on a whole document or on a single section
 * block: offsets are always local to the string it is handed, which is what
 * lets the CMS store, reorder and A/B-test sections independently.
 */
import * as L from './html.js';
import { collectUnits } from './units.js';

/** Read the marker key(s) off an opening tag. */
function markersFor(html, unit) {
  const raw = html.slice(unit.tagStart, unit.tagEnd);
  const attrs = L.parseAttrs({ raw, start: unit.tagStart }, html);
  const get = (n) => (attrs.find(a => a.name === n) || {}).value;
  return {
    plain: get('data-i18n'),
    rich: get('data-i18n-rich'),
    raw: get('data-i18n-raw'),
    attrSpec: get('data-i18n-attr'),
    attrs,
  };
}

/**
 * Rebuild a rich element's innerHTML: <n>words</n> placeholders map back onto
 * the inline children captured from the template, so markup and classes live in
 * exactly one place while the catalogue holds only words.
 */
export function renderRich(value, unit, html) {
  const kids = unit.children || [];
  return String(value).replace(/<(\d+)(?:\/>|>([\s\S]*?)<\/\1>)/g, (m, idxStr, inner) => {
    const c = kids[Number(idxStr)];
    if (!c) return inner || ''; // placeholder with no child: drop markup, keep words
    if (c.isVoid) return html.slice(c.start, c.end);
    const open = html.slice(c.start, c.innerStart);
    const close = html.slice(c.innerEnd, c.end);
    return open + (inner == null ? html.slice(c.innerStart, c.innerEnd) : inner) + close;
  });
}

/**
 * Render `template` with `catalogue` (a nested object) for `locale`.
 *
 * opts.stripMarkers  remove data-i18n* attributes from the output (default true)
 * opts.linkLocale    rewrite /fr/... internal links to /<locale>/... (default true)
 * opts.sourceLocale  the locale the templates are authored in (default 'fr')
 * opts.onMissing     callback(key, unit) for keys absent from the catalogue
 * opts.editMode      annotate editable units with data-cms-key for the visual editor
 */
export function render(template, catalogue, locale, opts = {}) {
  const stripMarkers = opts.stripMarkers !== false;
  const linkLocale = opts.linkLocale !== false;
  const sourceLocale = opts.sourceLocale || 'fr';
  const onMissing = opts.onMissing || function () {};
  const editMode = !!opts.editMode;

  const { order } = collectUnits(template);
  const edits = [];
  const annotated = new Set();

  for (const unit of order) {
    const m = markersFor(template, unit);

    if (unit.type === 'attr') {
      if (!m.attrSpec) continue;
      const pair = m.attrSpec.split('|')
        .map(s => s.split(':'))
        .find(p => p[0] === unit.attrName);
      if (!pair) continue;
      const key = pair.slice(1).join(':');
      const val = L.getKey(catalogue, key);
      if (val === undefined) { onMissing(key, unit); continue; }
      const a = m.attrs.find(x => x.name === unit.attrName);
      if (a) edits.push({ start: a.valueStart, end: a.valueEnd, text: String(val) });
      continue;
    }

    const key = unit.type === 'rich' ? m.rich
      : unit.type === 'raw' ? m.raw
        : m.plain;
    if (!key) continue;
    const val = L.getKey(catalogue, key);
    if (val === undefined) { onMissing(key, unit); continue; }

    const text = unit.type === 'rich' ? renderRich(val, unit, template) : String(val);
    edits.push({ start: unit.innerStart, end: unit.innerEnd, text });

    // The visual editor needs to know which DOM node maps to which key. The
    // attribute is only emitted for preview requests, never for public HTML.
    if (editMode && unit.type !== 'raw' && !annotated.has(unit.tagStart)) {
      annotated.add(unit.tagStart);
      edits.push({
        start: unit.tagEnd - 1, end: unit.tagEnd - 1,
        text: ` data-cms-key="${L.escapeAttr(key)}"`,
      });
    }
  }

  // Remove the marker attributes so published pages stay clean.
  if (stripMarkers) {
    const seen = new Set();
    for (const unit of order) {
      if (seen.has(unit.tagStart)) continue;
      seen.add(unit.tagStart);
      const raw = template.slice(unit.tagStart, unit.tagEnd);
      const re = /\s+data-i18n(?:-rich|-attr)?\s*=\s*("[^"]*"|'[^']*')/g;
      let mm;
      while ((mm = re.exec(raw)) !== null) {
        edits.push({
          start: unit.tagStart + mm.index,
          end: unit.tagStart + mm.index + mm[0].length,
          text: '',
        });
      }
    }
  }

  // Strings that live inside inline scripts (locator labels, form modal copy,
  // toggle text) cannot be marked up. A page declares the catalogue branch it
  // needs with <script data-i18n-js="page.js"></script> and the branch is baked
  // in here, so scripts read translated copy without a runtime fetch.
  for (const m of [...template.matchAll(/<script([^>]*\sdata-i18n-js="([^"]+)"[^>]*)>\s*<\/script>/g)]) {
    const branch = L.getKey(catalogue, m[2]);
    if (branch === undefined) { onMissing(m[2], { type: 'js' }); continue; }
    const body = 'window.I18N=' + JSON.stringify(branch) + ';' +
      'window.t=function(k,f){var v=window.I18N[k];return v===undefined?(f===undefined?k:f):v};';
    const openEnd = m.index + m[0].indexOf('>') + 1;
    const closeStart = m.index + m[0].lastIndexOf('</script>');
    edits.push({ start: openEnd, end: closeStart, text: body });
  }

  let out = L.applyEdits(template, dedupe(edits));

  // <html lang="fr"> -> the locale actually being rendered
  out = out.replace(/(<html[^>]*\slang=")[^"]*(")/i, '$1' + locale + '$2');

  // Internal links carry the locale segment.
  if (linkLocale && locale !== sourceLocale) {
    const re = new RegExp('(\\s(?:href|action)=")/' + sourceLocale + '(/|")', 'g');
    out = out.replace(re, '$1/' + locale + '$2');
  }
  return out;
}

/** Drop edits fully contained inside another edit; error on partial overlap. */
function dedupe(edits) {
  const sorted = edits.slice().sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let last = null;
  for (const e of sorted) {
    if (last && e.start < last.end) {
      if (e.end <= last.end) {
        // Zero-width insertions (edit-mode annotations) are kept: they cannot
        // clash with a replacement because they sit on the tag, not the text.
        if (e.start === e.end) { out.push(e); continue; }
        continue; // nested — parent wins
      }
      throw new Error(`overlapping edits: [${last.start},${last.end}) vs [${e.start},${e.end})`);
    }
    out.push(e);
    last = e;
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}
