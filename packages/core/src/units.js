/*
 * units.js — walk a document and produce translation units.
 *
 * A unit is an ELEMENT, not a text node, because word order moves around inline
 * markup: "Telechargez l'application <span>Rainbow</span>" becomes
 * "Download the <span>Rainbow</span> app". A per-text-node scheme cannot
 * express that; an element-level rich unit can.
 *
 * Units are anchored to their position in the TAG stream, so the extractor and
 * the renderer agree on what a unit is without ever re-serializing the markup.
 */
import * as L from './html.js';

/**
 * Encode innerHTML as translatable text, replacing each inline child with an
 * indexed placeholder so markup stays in the template and only words are
 * translated. Offsets are absolute into `html`.
 */
export function encodeRich(html, innerStart, innerEnd, children) {
  let out = '';
  let cursor = innerStart;
  children.forEach((c, i) => {
    if (c.start < cursor) return; // nested deeper; already covered
    out += html.slice(cursor, c.start);
    const childInner = c.isVoid ? '' : html.slice(c.innerStart, c.innerEnd).trim();
    out += childInner ? `<${i}>${childInner}</${i}>` : `<${i}/>`;
    cursor = c.end;
  });
  out += html.slice(cursor, innerEnd);
  return out.trim();
}

function zoneOf(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    const n = stack[i].name;
    if (n === 'nav') return 'nav';
    if (n === 'footer') return 'footer';
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].sectionId) return L.slugify(stack[i].sectionId);
  }
  return 'body';
}

/**
 * Walk a document, producing translation units keyed by tag-stream anchor.
 * unit = {anchor, type:'text'|'rich'|'raw'|'attr', value, tagStart, tagEnd, zone, hint}
 */
export function collectUnits(html) {
  const spans = L.scan(html);
  const units = new Map();
  const order = [];
  const stack = [];
  let tagIndex = 0;
  let inHead = false;
  let ldTagStart = 0, ldTagEnd = 0;

  const push = (u) => { units.set(u.anchor, u); order.push(u); };

  let pendingLdJson = null;

  for (const span of spans) {
    if (span.kind === 'raw') {
      // JSON-LD carries the page's schema.org name/description/FAQ text, which
      // search engines read per language. Treat the whole block as one unit
      // rather than trying to translate inside a JS string.
      if (pendingLdJson !== null) {
        push({
          anchor: 'r' + pendingLdJson, type: 'raw', value: span.raw.trim(),
          innerStart: span.start, innerEnd: span.end,
          tagStart: ldTagStart, tagEnd: ldTagEnd,
          zone: 'meta', hint: 'schema', tag: 'script',
        });
        pendingLdJson = null;
      }
      continue;
    }
    if (span.kind === 'text') {
      if (L.isTranslatableText(span.raw) && stack.length) stack[stack.length - 1].textCount++;
      continue;
    }
    if (span.kind !== 'tag') continue;

    const nm = span.name;
    const myIndex = tagIndex++;

    // closing tag: the element is complete, classify it
    if (span.closing) {
      if (nm === 'head') inHead = false;
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name !== nm) continue;
        const el = stack[k];
        const innerStart = el.openEnd;
        const innerEnd = span.start;
        const zone = el.name === 'title' ? 'meta' : zoneOf(stack.slice(0, k));

        if (el.textCount && !el.blockCount) {
          const anchor = 'e' + el.index;
          const common = {
            anchor, tagStart: el.openStart, tagEnd: el.openEnd, zone,
            hint: el.name === 'title' ? 'title' : null, tag: el.name,
            innerStart, innerEnd, children: el.inlineChildren,
          };
          if (el.inlineChildren.length) {
            // The parent owns the whole sentence, so an inline child marked in
            // its own right must give up its unit — otherwise the two ranges
            // nest and the edits collide.
            for (const c of el.inlineChildren) {
              const childAnchor = 'e' + c.index;
              if (units.has(childAnchor)) {
                units.delete(childAnchor);
                const at = order.findIndex(x => x.anchor === childAnchor);
                if (at !== -1) order.splice(at, 1);
              }
            }
            push(Object.assign({
              type: 'rich',
              value: encodeRich(html, innerStart, innerEnd, el.inlineChildren),
            }, common));
          } else {
            push(Object.assign({
              type: 'text',
              value: html.slice(innerStart, innerEnd).trim(),
            }, common));
          }
        }

        stack.length = k;
        if (stack.length) {
          const p = stack[stack.length - 1];
          if (L.INLINE.has(el.name)) {
            p.inlineChildren.push({
              start: el.openStart, end: span.end, index: el.index,
              innerStart, innerEnd, name: el.name, isVoid: false,
            });
          } else {
            p.blockCount++;
          }
        }
        break;
      }
      continue;
    }

    // opening tag
    if (nm === 'head') inHead = true;
    const attrs = L.parseAttrs(span);

    if (nm === 'script') {
      const type = (attrs.find(a => a.name === 'type') || {}).value || '';
      if (type.toLowerCase() === 'application/ld+json') {
        pendingLdJson = myIndex;
        ldTagStart = span.start;
        ldTagEnd = span.end;
      }
    }

    for (const a of attrs) {
      if (!L.isTranslatableAttr(nm, a.name, attrs)) continue;
      if (!L.isTranslatableText(a.value)) continue;
      let hint = a.name;
      if (nm === 'meta') {
        const k = (attrs.find(x => x.name === 'name' || x.name === 'property') || {}).value || 'meta';
        hint = k.replace(/^og:|^twitter:/, '');
      }
      push({
        anchor: `a${myIndex}:${a.name}`, type: 'attr', value: a.value.trim(),
        tagStart: span.start, tagEnd: span.end,
        zone: inHead ? 'meta' : zoneOf(stack), hint, attrName: a.name, tag: nm,
      });
    }

    const selfClosing = /\/>$/.test(span.raw) || L.VOID.has(nm);
    if (!selfClosing) {
      let sectionId = null;
      if (nm === 'section') {
        const idAttr = attrs.find(x => x.name === 'id');
        if (idAttr) sectionId = idAttr.value;
      }
      stack.push({
        name: nm, index: myIndex, openStart: span.start, openEnd: span.end,
        sectionId, textCount: 0, blockCount: 0, inlineChildren: [],
      });
    } else if (stack.length) {
      const p = stack[stack.length - 1];
      if (L.INLINE.has(nm)) {
        p.inlineChildren.push({
          start: span.start, end: span.end, index: myIndex,
          innerStart: span.end, innerEnd: span.end, name: nm, isVoid: true,
        });
      } else {
        p.blockCount++;
      }
    }
  }
  return { units, order };
}

/** Strip data-i18n* markers from a fragment (used when re-ingesting). */
export function stripMarkers(html) {
  return html.replace(/\s+data-i18n(?:-rich|-attr|-raw|-js)?\s*=\s*(?:"[^"]*"|'[^']*')/g, '');
}
