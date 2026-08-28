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
import { resolveAssetsDeep } from './assets.js';
import { localiseData } from './i18nData.js';
import { resolveLinksDeep } from './links.js';
import { buildHead, buildJsonLd } from './seo.js';

const NL = '\n';

/** Pick the HTML a block contributes, honouring an assigned A/B variant. */
export function blockHtml(block, variantKey) {
  const v = variantFor(block, variantKey);
  if (v && typeof v.html === 'string' && v.html.length) return v.html;
  return block.html || '';
}

/** The variant record assigned to this block, if any. */
export function variantFor(block, variantKey) {
  if (!variantKey || !block.experiment || !Array.isArray(block.experiment.variants)) return null;
  return block.experiment.variants.find(x => x.key === variantKey) || null;
}

/**
 * The block as the assigned arm defines it.
 *
 * A component variant states only what it changes, so its fields are merged
 * over the control's rather than replacing them: a variant that tests one
 * headline does not have to restate the whole hero. `html` variants are handled
 * by blockHtml above; this is the component path.
 */
export function effectiveBlock(block, variants) {
  const key = block.experiment && block.experiment.key
    ? (variants || {})[block.experiment.key]
    : null;
  const v = variantFor(block, key);
  if (!v) return block;
  if (v.data && typeof v.data === 'object') {
    return { ...block, data: { ...(block.data || {}), ...v.data }, variantKey: key };
  }
  if (typeof v.html === 'string' && v.html.length) {
    return { ...block, html: v.html, variantKey: key };
  }
  return { ...block, variantKey: key };
}

/**
 * Tag a block's outermost element so the visual editor can map a click in the
 * rendered page back to the block that produced it.
 *
 * Only ever called for preview requests. The attribute goes on the first real
 * tag rather than a wrapper, because wrapping authored markup would change the
 * layout the editor is looking at — the whole point is that the canvas is the
 * page, not an approximation of it.
 */
export function annotateBlock(html, block) {
  const source = String(html || '');
  const at = source.search(/<[a-zA-Z][a-zA-Z0-9-]*(?=[\s/>])/);
  if (at < 0) return source;
  const tagEnd = source.indexOf('>', at);
  if (tagEnd < 0) return source;
  // Never annotate twice, and never touch a comment or a doctype.
  if (/\sdata-cms-block=/.test(source.slice(at, tagEnd))) return source;
  const attrs = ` data-cms-block="${escapeAttribute(block.key)}"`
    + ` data-cms-block-type="${escapeAttribute(block.componentKey || block.type || 'html')}"`
    + ` data-cms-block-label="${escapeAttribute(block.label || block.key)}"`
    + (block.locked ? ' data-cms-block-locked="1"' : '');
  const selfClosing = source[tagEnd - 1] === '/';
  const insertAt = selfClosing ? tagEnd - 1 : tagEnd;
  return source.slice(0, insertAt) + attrs + source.slice(insertAt);
}

const escapeAttribute = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Tag a chrome region so the editor can recognise it without offering it.
 *
 * Deliberately not `data-cms-block`: the visual editor treats that as "this is
 * yours to change", and the header is not. The bridge uses this to refuse
 * selection and point at the screen that does own it.
 */
export function annotateChrome(html, role) {
  const source = String(html || '');
  const at = source.search(/<[a-zA-Z][a-zA-Z0-9-]*(?=[\s/>])/);
  if (at < 0) return source;
  const tagEnd = source.indexOf('>', at);
  if (tagEnd < 0) return source;
  if (/\sdata-cms-chrome-region=/.test(source.slice(at, tagEnd))) return source;
  const insertAt = source[tagEnd - 1] === '/' ? tagEnd - 1 : tagEnd;
  return source.slice(0, insertAt)
    + ` data-cms-chrome-region="${escapeAttribute(role)}"`
    + source.slice(insertAt);
}

/**
 * The markup a chrome part contributes, honouring its A/B arm and add-ins.
 *
 * Returns null when the part is hidden or the page has opted out, so the
 * placeholder block renders nothing at all rather than an empty wrapper.
 *
 * The header and footer are one document for the whole site, so their CSS and
 * JavaScript are emitted with them rather than being appended to the end of the
 * page: a header's stylesheet has to be in the document before the header is,
 * or the first paint is unstyled.
 */
export function chromePart(chrome, role, ctx = {}) {
  const part = chrome && chrome[role];
  if (!part || part.visible === false) return null;
  if (ctx.pageChrome && ctx.pageChrome[role] === false) return null;

  let { html, css, js } = part;
  const key = part.experiment && part.experiment.key;
  const arm = key ? (ctx.variants || {})[key] : null;
  if (arm && Array.isArray(part.experiment.variants)) {
    const v = part.experiment.variants.find(x => x.key === arm);
    if (v) {
      if (typeof v.html === 'string' && v.html.length) html = v.html;
      if (typeof v.css === 'string' && v.css.length) css = v.css;
      if (typeof v.js === 'string' && v.js.length) js = v.js;
    }
  }

  if (!html) return null;
  return { html, css: css || '', js: js || '', variantKey: arm || null };
}

/*
 * Where the chrome lives inside authored markup.
 *
 * Most pages carry the header and the footer as top-level blocks, so the block
 * itself is the placeholder and gets replaced wholesale. The article template
 * does not: its navbar sits nested inside a <header> wrapper, because that is
 * how the page was authored. Consolidating only the top-level case would have
 * left exactly one page with a header nobody could change from the CMS — which
 * is the failure mode the consolidation exists to remove.
 *
 * So the region is found by pattern instead. Two patterns, both anchored on
 * markup that is unambiguous in this site — `<nav id="navbar">` and the single
 * `<footer>` — and both applied to the stored bytes rather than a parse tree, so
 * nothing is re-serialized. Stored offsets were the alternative and they go
 * stale the moment anyone edits the block.
 */
export const CHROME_PATTERNS = {
  navbar: /<nav\b[^>]*id="navbar"[\s\S]*?<\/nav>/,
  footer: /<footer\b[\s\S]*?<\/footer>/,
};

/**
 * Swap any chrome region found inside a block for the shared version.
 *
 * `renderPart(role)` returns the already-rendered markup for that part, or null
 * when it is hidden or the page opted out — in which case the region is removed,
 * because a page that has turned the footer off should not show the authored one.
 */
export function replaceChromeRegions(html, renderPart) {
  let out = html;
  for (const role of ['navbar', 'footer']) {
    const pattern = CHROME_PATTERNS[role];
    if (!pattern.test(out)) continue;
    const replacement = renderPart(role);
    out = out.replace(pattern, () => replacement ?? '');
  }
  return out;
}

/** Does this markup contain a chrome region at all? */
export function hasChromeRegion(html) {
  return CHROME_PATTERNS.navbar.test(html) || CHROME_PATTERNS.footer.test(html);
}

/**
 * The whitespace and comments before a block's first real tag.
 *
 * The slicer attaches the trivia preceding an element to the block that
 * follows it, which is what makes `blocks.join('')` reproduce the authored body
 * exactly. It matters here because the shared chrome stores the *element* —
 * `<nav id="navbar">…</nav>` and nothing else — so that it can be spliced into a
 * page that nests it inside a wrapper as easily as into a page that carries it
 * as a block. A placeholder block therefore has to contribute its own trivia
 * back, or every page would lose the newlines and the `<!-- NAV -->` comment
 * that sat in front of it.
 */
export function leadingTrivia(html) {
  const source = String(html || '');
  let at = 0;
  for (;;) {
    const ws = /^\s*/.exec(source.slice(at))[0].length;
    at += ws;
    if (source.startsWith('<!--', at)) {
      const close = source.indexOf('-->', at);
      if (close < 0) return source.slice(0, at);
      at = close + 3;
      continue;
    }
    return source.slice(0, at);
  }
}

/** A block's markup with its leading trivia removed. */
export function withoutLeadingTrivia(html) {
  return String(html || '').slice(leadingTrivia(html).length);
}

/** Which add-ins apply to this page, in one zone, after A/B resolution. */
export function addInsFor(chrome, zone, ctx = {}) {
  const all = (chrome && chrome.addIns) || [];
  const out = [];
  for (const addIn of all) {
    if (!addIn.enabled || addIn.zone !== zone) continue;
    if (addIn.pages?.length && ctx.pageKey && !addIn.pages.includes(ctx.pageKey)) continue;

    let html = addIn.html;
    const key = addIn.experiment && addIn.experiment.key;
    const arm = key ? (ctx.variants || {})[key] : null;
    if (arm && Array.isArray(addIn.experiment.variants)) {
      const v = addIn.experiment.variants.find(x => x.key === arm);
      if (v && typeof v.html === 'string') html = v.html;
    }
    if (html) out.push({ key: addIn.key, html, variantKey: arm || null });
  }
  return out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Render one chrome part, ready to splice into a page.
 *
 * Returns null when the part is hidden or this page opted out. Its CSS goes
 * before the markup and its JavaScript after, because a header's stylesheet has
 * to be in the document before the header is or the first paint is unstyled.
 */
function renderChrome(role, page, ctx, opts = {}) {
  const part = chromePart(ctx.chrome, role, {
    variants: ctx.variants,
    pageChrome: page.chrome,
  });
  if (!part) return null;
  let html = render(part.html, ctx.catalogue || {}, ctx.locale, {
    sourceLocale: ctx.sourceLocale,
    editMode: !!opts.annotateStrings,
    onMissing: ctx.onMissing,
    integrations: ctx.integrations,
        assets: ctx.assets,
        links: ctx.links,
  });
  if (part.css) html = `<style data-cms-chrome="${role}">${part.css}</style>` + html;
  if (part.js) html += `<script data-cms-chrome="${role}">${part.js}</script>`;
  // A placeholder block owns the whitespace and comment that preceded it in the
  // authored page; the shared chrome stores only the element.
  return (opts.trivia || '') + html;
}

/**
 * A component block with its references resolved.
 *
 * Three indirections resolve here rather than inside each block template: a
 * block should render the data it is handed, and "which file is this image",
 * "where is this page in this language" and "which language am I" are questions
 * about the request, not about the block.
 *
 * Translations first, because the other two operate on the resolved value: a
 * German heading may carry a different image reference from the French one.
 */
function withResolvedData(block, ctx) {
  let data = localiseData(block.data, ctx.locale, ctx.sourceLocale);
  if (ctx.assets?.length) data = resolveAssetsDeep(data, ctx.assets);
  if (ctx.links?.size) data = resolveLinksDeep(data, ctx.links);
  return data === block.data ? block : { ...block, data };
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
      integrations: opts.integrations,
      assets: opts.assets,
      links: opts.links,
    });
    return rendered.slice(rendered.indexOf('>') + 1, rendered.lastIndexOf('</body>'));
  }

  const parts = [];
  for (const block of page.sections || []) {
    if (block.visible === false) continue;

    // The header and footer come from the shared chrome document, wherever the
    // page's placeholder block sits.
    const chromeCtx = {
      chrome: opts.chrome,
      variants: opts.variants,
      catalogue: opts.catalogue,
      locale: opts.locale,
      sourceLocale: opts.sourceLocale,
      onMissing: opts.onMissing,
      integrations: opts.integrations,
      assets: opts.assets,
      links: opts.links,
    };
    if (block.role) {
      const html = renderChrome(block.role, page, chromeCtx, {
        annotateStrings: opts.editMode,
        trivia: block.trivia ?? leadingTrivia(block.html),
      });
      if (html) parts.push(html);
      continue;
    }

    if (block.type === 'component') {
      const effective = effectiveBlock(block, opts.variants);
      const html = opts.renderComponent
        ? opts.renderComponent(withResolvedData(effective, opts))
        : '';
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

    let rendered = render(raw, opts.catalogue || {}, opts.locale, {
      sourceLocale: opts.sourceLocale,
      editMode: opts.editMode,
      onMissing: opts.onMissing,
      integrations: opts.integrations,
      assets: opts.assets,
      links: opts.links,
    });
    // Some pages nest the header inside a wrapper rather than carrying it as a
    // block of its own. The region is swapped in place so those pages are
    // covered by the shared chrome too.
    if (opts.chrome && hasChromeRegion(rendered)) {
      rendered = replaceChromeRegions(
        rendered,
        (role) => renderChrome(role, page, chromeCtx, { annotateStrings: opts.editMode }),
      );
    }
    parts.push(rendered);
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
    integrations: opts.integrations,
      assets: opts.assets,
      links: opts.links,
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
      integrations: ctx.integrations,
        assets: ctx.assets,
        links: ctx.links,
    })
    : '';

  head.push(headRaw.replace(/\s*$/, ''));
  head.push(buildHead(page, ctx));
  const ld = buildJsonLd(page, ctx);
  if (ld) head.push(ld);
  if (page.snippets && page.snippets.head) head.push(page.snippets.head);
  for (const addIn of addInsFor(ctx.chrome, 'head', { variants: ctx.variants, pageKey: page.key })) {
    head.push(addIn.html);
  }

  const parts = [];
  const raw = (html) => { if (html) parts.push({ kind: 'html', html }); };

  if (ctx.runtime) raw(`<script>window.__CMS__=${jsonForScript(ctx.runtime)};</script>`);

  const addInCtx = { variants: ctx.variants, pageKey: page.key };
  for (const addIn of addInsFor(ctx.chrome, 'bodyStart', addInCtx)) raw(addIn.html);

  if (page.bodyOpenRaw) {
    // Stub page whose only marked element is <body> itself.
    raw(composeBody(page, {
      catalogue: ctx.catalogue, locale, sourceLocale: ctx.sourceLocale,
      editMode: ctx.annotateStrings ?? ctx.editMode, onMissing: ctx.onMissing,
      variants: ctx.variants, integrations: ctx.integrations,
      assets: ctx.assets, links: ctx.links,
    }));
  } else {
    // Copy is annotated for inline editing on any preview render; the block
    // overlay and its bridge are added only when the visual editor asked for
    // them. `annotateStrings` defaults to editMode so callers that only know
    // about one flag (the verification tools) behave as before.
    const annotateStrings = ctx.annotateStrings ?? ctx.editMode;
    const chromeCtx = {
      chrome: ctx.chrome,
      variants: ctx.variants,
      catalogue: ctx.catalogue,
      locale,
      sourceLocale: ctx.sourceLocale,
      onMissing: ctx.onMissing,
      integrations: ctx.integrations,
      assets: ctx.assets,
      links: ctx.links,
    };

    for (const block of page.sections || []) {
      // A hidden block still reaches the visual editor, greyed out, so an
      // editor can find and unhide it without leaving the canvas.
      if (block.visible === false && !ctx.editMode) continue;

      // The header and footer are not this page's content. The block marks
      // where they go; the markup comes from the one chrome document.
      if (block.role) {
        let html = renderChrome(block.role, page, chromeCtx, {
          annotateStrings,
          // The API sends the placeholder's trivia rather than its markup, so a
          // page payload does not carry a second copy of the footer.
          trivia: block.trivia ?? leadingTrivia(block.html),
        });
        if (!html) continue;
        /*
         * Marked as chrome, not as a block.
         *
         * It used to be annotated as a selectable block with the label "Site
         * header", which meant the page canvas offered an inspector for
         * something that page does not own — the exact confusion consolidating
         * the header was meant to remove. The region is still marked, so a click
         * on it can say where it is edited instead of doing nothing.
         */
        if (ctx.editMode) html = annotateChrome(html, block.role);
        raw(html);
        continue;
      }

      if (block.type === 'component') {
        // A component's image lives in a field, not in markup, so it never
        // passes the renderer's string pass. Resolve its references here.
        const effective = effectiveBlock(block, ctx.variants);
        parts.push({
          kind: 'component',
          block: withResolvedData(effective, ctx),
        });
        continue;
      }
      const variantKey = block.experiment && block.experiment.key
        ? (ctx.variants || {})[block.experiment.key]
        : null;
      const source = blockHtml(block, variantKey);
      if (!source) continue;
      let html = render(source, ctx.catalogue || {}, locale, {
        sourceLocale: ctx.sourceLocale,
        editMode: annotateStrings && block.type === 'html',
        onMissing: ctx.onMissing,
        integrations: ctx.integrations,
        assets: ctx.assets,
        links: ctx.links,
      });
      // Some pages nest the header inside a wrapper rather than carrying it as
      // a block of its own, so the region is swapped in place. Without this the
      // article template would keep a header nobody could edit.
      if (ctx.chrome && hasChromeRegion(html)) {
        html = replaceChromeRegions(
          html,
          (role) => renderChrome(role, page, chromeCtx, { annotateStrings }),
        );
      }
      if (ctx.editMode) html = annotateBlock(html, block);
      if (ctx.editMode && block.visible === false) {
        html = `<div data-cms-hidden="1" style="opacity:.4;outline:2px dashed #a78bfa">${html}</div>`;
      }
      raw(html);
    }
  }

  // The bridge the CMS canvas talks to. Preview-only: a published page never
  // carries it, so there is nothing to strip and nothing to leak.
  if (ctx.editMode) raw('<script src="/js/cms-editor.js" defer></script>');

  /*
   * The experiment beacon, and only on a page that is actually running one.
   *
   * Conditioning it on the page's own tests rather than emitting it everywhere
   * keeps two promises at once: a page with no experiment ships exactly the
   * bytes it was authored with — which is what `verify-live` asserts — and the
   * site does not pay for a script that would have nothing to report.
   */
  if (ctx.runtime?.experiments?.length) raw('<script src="/js/ab.js" defer></script>');

  if (page.snippets && page.snippets.body) raw(page.snippets.body);
  if (page.snippets && page.snippets.footer) raw(page.snippets.footer);
  for (const addIn of addInsFor(ctx.chrome, 'bodyEnd', addInCtx)) raw(addIn.html);

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
