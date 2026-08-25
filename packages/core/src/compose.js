/*
 * compose.js — assemble a published page from what the CMS stores.
 *
 * The output is the authored document with three kinds of change and nothing
 * else: editor copy spliced over the marked ranges, the CMS-owned <head>
 * metadata re-emitted, and the snippet zones filled in. Section blocks are
 * concatenated in their stored order, so a page nobody has touched renders
 * byte-for-byte as it was authored.
 */
import { render } from './render.js';
import { buildHead, buildJsonLd } from './seo.js';

const NL = '\n';

/** Pick the HTML a block contributes, honouring an assigned A/B variant. */
export function blockHtml(block, variantKey) {
  if (variantKey && block.experiment && Array.isArray(block.experiment.variants)) {
    const v = block.experiment.variants.find(x => x.key === variantKey);
    if (v && typeof v.html === 'string' && v.html.length) return v.html;
  }
  return block.html || '';
}

/**
 * Render the body of a page.
 *
 * opts: { catalogue, locale, sourceLocale, variants: {experimentKey: variantKey},
 *         editMode, renderComponent(block) -> string }
 */
export function composeBody(page, opts) {
  // <body> can itself be the marked element on a stub page. Render the tag pair
  // together so the unit still resolves, then hand back only its contents.
  if (page.bodyOpenRaw) {
    const inner = (page.sections || [])
      .filter(b => b.visible !== false)
      .map(b => blockHtml(b, null))
      .join('');
    const rendered = render(page.bodyOpenRaw + inner + '</body>', opts.catalogue || {}, opts.locale, {
      sourceLocale: opts.sourceLocale,
      editMode: opts.editMode,
      onMissing: opts.onMissing,
    });
    return rendered.slice(rendered.indexOf('>') + 1, rendered.lastIndexOf('</body>'));
  }

  const parts = [];
  for (const block of page.sections || []) {
    if (block.visible === false) continue;

    if (block.type === 'component') {
      const html = opts.renderComponent ? opts.renderComponent(block) : '';
      if (html) parts.push(html);
      continue;
    }

    const variantKey = block.experiment && block.experiment.key
      ? (opts.variants || {})[block.experiment.key]
      : null;
    const raw = blockHtml(block, variantKey);
    if (!raw) continue;

    // Script and style blocks hold no copy: splice nothing, ship as authored.
    if (block.type === 'script' || block.type === 'style') {
      parts.push(renderScriptBlock(raw, opts));
      continue;
    }

    parts.push(render(raw, opts.catalogue || {}, opts.locale, {
      sourceLocale: opts.sourceLocale,
      editMode: opts.editMode,
      onMissing: opts.onMissing,
    }));
  }
  return parts.join('');
}

/**
 * Script blocks still need the two document-level rewrites the renderer does:
 * the data-i18n-js catalogue branch and the locale prefix on internal links.
 */
function renderScriptBlock(raw, opts) {
  return render(raw, opts.catalogue || {}, opts.locale, {
    sourceLocale: opts.sourceLocale,
    onMissing: opts.onMissing,
  });
}

/**
 * Assemble the document as addressable parts.
 *
 * The frontend needs the pieces rather than one string: raw blocks are emitted
 * verbatim, while `component` blocks are handed to Astro to render as real
 * components. Everything else — head, snippets, the closing tags — is the same
 * either way.
 *
 * ctx: { locale, sourceLocale, baseUrl, settings, translations, noindex,
 *        catalogue, variants, editMode, runtime (object injected as window.__CMS__),
 *        renderComponent }
 */
export function composeParts(page, ctx) {
  const locale = ctx.locale;
  const head = [];

  const headRaw = page.headRaw
    ? render(page.headRaw, ctx.catalogue || {}, locale, {
      sourceLocale: ctx.sourceLocale,
      onMissing: ctx.onMissing,
    })
    : '';

  head.push(headRaw.replace(/\s*$/, ''));
  head.push(buildHead(page, ctx));
  const ld = buildJsonLd(page, ctx);
  if (ld) head.push(ld);
  if (ctx.settings && ctx.settings.globalHeadSnippet) head.push(ctx.settings.globalHeadSnippet);
  if (page.snippets && page.snippets.head) head.push(page.snippets.head);

  const parts = [];
  const raw = (html) => { if (html) parts.push({ kind: 'html', html }); };

  if (ctx.runtime) raw(`<script>window.__CMS__=${jsonForScript(ctx.runtime)};</script>`);

  if (page.bodyOpenRaw) {
    // Stub page whose only marked element is <body> itself.
    raw(composeBody(page, {
      catalogue: ctx.catalogue, locale, sourceLocale: ctx.sourceLocale,
      editMode: ctx.editMode, onMissing: ctx.onMissing,
    }));
  } else {
    for (const block of page.sections || []) {
      if (block.visible === false) continue;
      if (block.type === 'component') {
        parts.push({ kind: 'component', block });
        continue;
      }
      const variantKey = block.experiment && block.experiment.key
        ? (ctx.variants || {})[block.experiment.key]
        : null;
      const source = blockHtml(block, variantKey);
      if (!source) continue;
      raw(render(source, ctx.catalogue || {}, locale, {
        sourceLocale: ctx.sourceLocale,
        editMode: ctx.editMode && block.type === 'html',
        onMissing: ctx.onMissing,
      }));
    }
  }

  if (ctx.settings && ctx.settings.globalBodySnippet) raw(ctx.settings.globalBodySnippet);
  if (page.snippets && page.snippets.body) raw(page.snippets.body);
  if (ctx.settings && ctx.settings.globalFooterSnippet) raw(ctx.settings.globalFooterSnippet);
  if (page.snippets && page.snippets.footer) raw(page.snippets.footer);

  const htmlOpen = (page.htmlOpen || '<html lang="fr">')
    .replace(/(\slang=")[^"]*(")/i, `$1${locale}$2`);

  return {
    prologue: [
      page.doctype || '<!DOCTYPE html>\n',
      htmlOpen,
      NL + '<head>' + NL,
      head.filter(Boolean).join(NL),
      NL + '</head>' + NL,
      page.bodyOpen || '<body>',
    ].join(''),
    parts,
    // The last block already carries whatever whitespace preceded </body> in
    // the authored file, so nothing is added here.
    epilogue: '</body>' + NL + '</html>' + NL,
  };
}

/** The same document, flattened to one string (used by tests and previews). */
export function composeDocument(page, ctx) {
  const { prologue, parts, epilogue } = composeParts(page, ctx);
  const body = parts.map(p => (p.kind === 'html'
    ? p.html
    : (ctx.renderComponent ? ctx.renderComponent(p.block) : ''))).join('');
  return prologue + body + epilogue;
}

/** JSON that is safe to inline inside a <script> element. */
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

export function jsonForScript(value) {
  return JSON.stringify(value)
    .split('<').join('\\u003c')
    .split('>').join('\\u003e')
    .split(LINE_SEP).join('\\u2028')
    .split(PARA_SEP).join('\\u2029');
}
