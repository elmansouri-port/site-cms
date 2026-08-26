/*
 * article.js — an article body as an ordered list of sections.
 *
 * A blog post used to be one HTML textarea. That works right up until somebody
 * asks for a table of contents, at which point you need to know where the
 * sections are — and parsing them back out of a blob of markup, every render,
 * guessing which headings the author meant as chapters, is the wrong end of the
 * problem.
 *
 * So the body is a list. Each section knows whether it belongs in the contents
 * and under which name, which makes the "sommaire" a projection of the structure
 * rather than a heuristic over the output. It also means a section can be
 * reordered, hidden or restyled without touching the ones around it.
 *
 * The rendered markup deliberately uses the classes the authored article page
 * already styles (`.prose-article h2`, `.key-points-box`, …), so a section
 * composed in the CMS is indistinguishable from the article the design came from.
 */
import { slugify, escapeAttr } from './html.js';

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Turn markup into the text it renders as.
 *
 * Stripping tags is not enough: a heading written as `Rainbow&nbsp;: le tour`
 * leaves the literal `&nbsp;` behind, which then gets escaped again on the way
 * into the contents list and displays as `&amp;nbsp;`. Entities have to be
 * resolved at the point the text is extracted, not at the point it is emitted.
 */
export function textOf(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (m, dec) => safeCodePoint(Number(dec), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => safeCodePoint(parseInt(hex, 16), m))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
      const found = NAMED[name] ?? NAMED[String(name).toLowerCase()];
      return found === undefined ? m : found;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const safeCodePoint = (code, fallback) => {
  try { return String.fromCodePoint(code); } catch { return fallback; }
};

/*
 * The named entities that actually appear in this site's copy.
 *
 * Not the full HTML5 table - that is two thousand entries to solve a problem
 * this content does not have. These are the ones the French and German
 * catalogues use, plus the five that are structural. An unrecognised entity is
 * left alone rather than mangled, so the worst case is the old behaviour.
 */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  eacute: '\u00e9', egrave: '\u00e8', ecirc: '\u00ea', euml: '\u00eb',
  agrave: '\u00e0', acirc: '\u00e2', auml: '\u00e4', aacute: '\u00e1',
  ccedil: '\u00e7', ugrave: '\u00f9', ucirc: '\u00fb', uuml: '\u00fc', uacute: '\u00fa',
  ocirc: '\u00f4', ouml: '\u00f6', oacute: '\u00f3', ograve: '\u00f2',
  icirc: '\u00ee', iuml: '\u00ef', iacute: '\u00ed',
  Eacute: '\u00c9', Egrave: '\u00c8', Agrave: '\u00c0', Ccedil: '\u00c7',
  Ouml: '\u00d6', Auml: '\u00c4', Uuml: '\u00dc',
  szlig: '\u00df', oelig: '\u0153', aelig: '\u00e6',
  laquo: '\u00ab', raquo: '\u00bb', hellip: '\u2026', mdash: '\u2014', ndash: '\u2013',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  deg: '\u00b0', times: '\u00d7', euro: '\u20ac', copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
  middot: '\u00b7', bull: '\u2022', shy: '', ensp: ' ', emsp: ' ', thinsp: ' ',
};

/**
 * What each section type asks for, and what it renders.
 *
 * `toc: true` means the type is a natural contents entry — a heading is, a
 * paragraph is not — which is only the default; any section can opt in or out.
 */
export const ARTICLE_SECTIONS = {
  heading: {
    label: 'Heading',
    description: 'A chapter title. The natural unit of the contents list.',
    toc: true,
    fields: [
      { name: 'text', label: 'Heading', type: 'text' },
      { name: 'level', label: 'Level', type: 'select', options: [2, 3], hint: 'Level 2 is a chapter, level 3 a sub-point.' },
    ],
  },
  rich: {
    label: 'Text',
    description: 'Paragraphs, lists and links. The workhorse.',
    fields: [
      { name: 'html', label: 'Text', type: 'html', rows: 12, hint: 'Paragraphs in <p>, lists in <ul>. Styled by the article stylesheet.' },
    ],
  },
  keyPoints: {
    label: 'Key points',
    description: 'The blue summary box. Put it near the top — it is what skimmers read.',
    toc: true,
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'items', label: 'Points (one per line)', type: 'lines' },
    ],
  },
  image: {
    label: 'Image',
    description: 'A figure with an optional caption.',
    fields: [
      { name: 'src', label: 'Image', type: 'media' },
      { name: 'alt', label: 'Alt text', type: 'text', hint: 'Describe the image. Read by screen readers and image search.' },
      { name: 'caption', label: 'Caption', type: 'text' },
    ],
  },
  quote: {
    label: 'Pull quote',
    description: 'One sentence, given room. Emits Quotation structured data.',
    fields: [
      { name: 'text', label: 'Quote', type: 'textarea' },
      { name: 'attribution', label: 'Attributed to', type: 'text' },
    ],
  },
  callout: {
    label: 'Callout',
    description: 'A tip, a warning, or an aside that should not read as body copy.',
    fields: [
      { name: 'tone', label: 'Tone', type: 'select', options: ['tip', 'info', 'warning'] },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'html', label: 'Text', type: 'html', rows: 5 },
    ],
  },
  embed: {
    label: 'Video or embed',
    description: 'A YouTube video or any third-party embed.',
    fields: [
      { name: 'youtubeId', label: 'YouTube id', type: 'text' },
      { name: 'html', label: 'Or paste embed code', type: 'code', language: 'html', rows: 6 },
      { name: 'caption', label: 'Caption', type: 'text' },
    ],
  },
  custom: {
    label: 'Custom HTML',
    description: 'Your own markup with Tailwind, and CSS scoped to this section.',
    advanced: true,
    fields: [
      { name: 'html', label: 'HTML', type: 'code', language: 'html', rows: 16 },
      { name: 'css', label: 'CSS', type: 'code', language: 'css', rows: 8, hint: 'Scoped to this section automatically.' },
    ],
  },
};

/** The heading text a section contributes to the contents, if any. */
export function sectionLabel(section) {
  const data = section?.data || {};
  if (section?.tocLabel) return textOf(section.tocLabel);
  if (section?.type === 'heading') return textOf(data.text);
  if (data.title) return textOf(data.title);
  return '';
}

/** Whether a section appears in the contents list. */
export function inContents(section) {
  if (!section || section.visible === false) return false;
  if (section.inToc === false) return false;
  if (!sectionLabel(section)) return false;
  return section.inToc === true || ARTICLE_SECTIONS[section.type]?.toc === true;
}

/**
 * The anchor a section is addressed by.
 *
 * Derived from its label when nobody set one, and made unique within the
 * article: two chapters called "Conclusion" would otherwise both answer to
 * `#conclusion` and the contents would jump to the wrong one.
 */
export function anchorFor(section, taken = new Set()) {
  // No label and no explicit anchor means nothing links here, and an id derived
  // from the section type (`id="rich"`) is noise in the markup and a collision
  // waiting to happen.
  const label = sectionLabel(section);
  const base = section.anchorId || (label ? slugify(label, 48) : '');
  if (!base) return '';
  let id = base;
  let n = 1;
  while (taken.has(id)) id = `${base}-${++n}`;
  taken.add(id);
  return id;
}

/**
 * The contents list: `[{ id, label, level }]`.
 *
 * Level lets the list indent sub-points under chapters, which is the difference
 * between a contents list and a flat pile of links.
 */
export function contentsOf(sections) {
  const taken = new Set();
  const out = [];
  for (const section of sections || []) {
    const id = anchorFor(section, taken);
    if (!inContents(section)) continue;
    out.push({
      id,
      label: sectionLabel(section),
      level: section.type === 'heading' ? Number(section.data?.level) || 2 : 2,
    });
  }
  return out;
}

/** Render one section to the markup the article stylesheet expects. */
function renderSection(section, id) {
  const data = section.data || {};
  const anchor = id ? ` id="${escapeAttr(id)}"` : '';

  switch (section.type) {
    case 'heading': {
      const level = Number(data.level) === 3 ? 3 : 2;
      if (!data.text) return '';
      return `<h${level}${anchor}>${escapeHtml(data.text)}</h${level}>`;
    }

    case 'rich':
      return data.html ? `<div${anchor}>${data.html}</div>` : '';

    case 'keyPoints': {
      const items = toLines(data.items);
      if (!items.length) return '';
      return `<div class="key-points-box" role="note"${anchor}>`
        + (data.title ? `<h2>${escapeHtml(data.title)}</h2>` : '')
        + `<ul>${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
        + '</div>';
    }

    case 'image': {
      if (!data.src) return '';
      return `<figure${anchor} class="my-8">`
        + `<img src="${escapeAttr(data.src)}" alt="${escapeAttr(data.alt || '')}" loading="lazy" decoding="async" class="w-full rounded-2xl">`
        + (data.caption ? `<figcaption class="mt-3 text-sm text-gray-500 text-center">${escapeHtml(data.caption)}</figcaption>` : '')
        + '</figure>';
    }

    case 'quote': {
      if (!data.text) return '';
      return `<figure${anchor} class="my-8 border-l-4 border-brand-500 pl-6" itemscope itemtype="https://schema.org/Quotation">`
        + `<blockquote class="text-xl leading-relaxed text-navy-900 font-medium" itemprop="text">${escapeHtml(data.text)}</blockquote>`
        + (data.attribution
          ? `<figcaption class="mt-3 text-sm text-gray-500" itemprop="spokenByCharacter">${escapeHtml(data.attribution)}</figcaption>`
          : '')
        + '</figure>';
    }

    case 'callout': {
      if (!data.html && !data.title) return '';
      const tone = ['tip', 'info', 'warning'].includes(data.tone) ? data.tone : 'info';
      const skin = {
        tip: 'border-green-200 bg-green-50',
        info: 'border-brand-200 bg-brand-50',
        warning: 'border-amber-200 bg-amber-50',
      }[tone];
      return `<aside${anchor} class="my-8 rounded-2xl border ${skin} p-6" role="note">`
        + (data.title ? `<p class="font-bold text-navy-900 mb-2">${escapeHtml(data.title)}</p>` : '')
        + (data.html || '')
        + '</aside>';
    }

    case 'embed': {
      let body = '';
      if (data.youtubeId) {
        const id2 = String(data.youtubeId).trim();
        body = '<div class="relative w-full overflow-hidden rounded-2xl" style="aspect-ratio:16/9">'
          + `<iframe src="https://www.youtube-nocookie.com/embed/${escapeAttr(id2)}" title="${escapeAttr(data.caption || 'Video')}"`
          + ' loading="lazy" allowfullscreen class="absolute inset-0 w-full h-full" style="border:0"></iframe></div>';
      } else if (data.html) {
        body = data.html;
      }
      if (!body) return '';
      return `<figure${anchor} class="my-8">${body}`
        + (data.caption ? `<figcaption class="mt-3 text-sm text-gray-500 text-center">${escapeHtml(data.caption)}</figcaption>` : '')
        + '</figure>';
    }

    case 'custom': {
      if (!data.html && !data.css) return '';
      const scope = `article-section-${String(section.key || 'custom').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      const css = data.css ? `<style>${scopeCss(data.css, `.${scope}`)}</style>` : '';
      return `${css}<div${anchor} class="${scope} my-8">${data.html || ''}</div>`;
    }

    default:
      return '';
  }
}

/**
 * The whole body, plus the contents list built from the same pass.
 *
 * Returns `{ html, contents }`. A post with no sections falls back to its
 * `bodyHtml`, and the contents are then derived from that markup's headings —
 * imported articles keep working without being migrated.
 */
export function renderArticleBody(post) {
  const sections = (post?.sections || []).filter(s => s.visible !== false);

  if (!sections.length) {
    const html = post?.bodyHtml || '';
    return { html: withHeadingIds(html).html, contents: withHeadingIds(html).contents };
  }

  const taken = new Set();
  const parts = [];
  const contents = [];

  for (const section of sections) {
    const id = anchorFor(section, taken);
    const html = renderSection(section, id);
    if (!html) continue;
    parts.push(html);
    if (inContents(section)) {
      contents.push({
        id,
        label: sectionLabel(section),
        level: section.type === 'heading' ? Number(section.data?.level) || 2 : 2,
      });
    }
  }

  return { html: parts.join('\n'), contents };
}

/**
 * Give every heading in a blob of markup an id, and report them.
 *
 * The fallback for articles written as one piece of HTML: a contents list still
 * works, it just cannot be curated. Headings that already carry an id keep it,
 * so an author who wants a specific anchor gets it.
 */
export function withHeadingIds(html) {
  const source = String(html || '');
  if (!source) return { html: '', contents: [] };

  const taken = new Set();
  const contents = [];
  const out = source.replace(
    /<(h[23])(\s[^>]*)?>([\s\S]*?)<\/\1>/gi,
    (match, tag, attrs = '', inner) => {
      const text = textOf(inner);
      if (!text) return match;
      const existing = /\sid="([^"]+)"/i.exec(attrs || '');
      let id = existing ? existing[1] : slugify(text, 48);
      if (!existing) {
        let n = 1;
        const base = id;
        while (taken.has(id)) id = `${base}-${++n}`;
      }
      taken.add(id);
      contents.push({ id, label: text, level: tag.toLowerCase() === 'h3' ? 3 : 2 });
      return existing
        ? match
        : `<${tag}${attrs || ''} id="${escapeAttr(id)}">${inner}</${tag}>`;
    },
  );
  return { html: out, contents };
}

const toLines = (value) => {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  return String(value || '').split('\n').map(v => v.trim()).filter(Boolean);
};

/**
 * Prefix a stylesheet's selectors with a scope.
 *
 * The same trick the custom page block uses: a section's CSS should be able to
 * style that section and nothing else. Kept here rather than shared because the
 * two callers differ in what a "block" is, and one small duplicated function is
 * cheaper than an abstraction over two shapes.
 */
function scopeCss(source, prefix) {
  const text = String(source || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < text.length) {
    const brace = text.indexOf('{', i);
    if (brace < 0) break;
    const head = text.slice(i, brace).trim();
    const body = readBlock(text, brace);
    if (!body) break;
    if (head.startsWith('@')) {
      const name = head.slice(1).split(/[\s(]/)[0].toLowerCase();
      out.push(name === 'keyframes' || name === 'font-face'
        ? `${head}{${body.inner}}`
        : `${head}{${scopeCss(body.inner, prefix)}}`);
    } else if (head) {
      const selectors = head.split(',').map(s => s.trim()).filter(Boolean)
        .map(s => (s.startsWith('&') ? s.replace('&', prefix) : `${prefix} ${s}`));
      if (selectors.length) out.push(`${selectors.join(',')}{${body.inner}}`);
    }
    i = body.end;
  }
  return out.join('\n');
}

function readBlock(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}
