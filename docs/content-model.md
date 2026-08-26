# Content model

What lives in the database, and who owns it.

## Collections

### `pages`

One document per route. Holds the document scaffolding (doctype, `<html>` tag,
`<head>` remainder, `<body>` tag) and an ordered array of section blocks.

| Field | Meaning |
|---|---|
| `key` | Stable identifier, never changes. `index`, `tarifs`, `collaboration` |
| `route` | The shared path, in the source language. `''` is the homepage |
| `routes` | Per-locale path overrides: `{ en: 'pricing', de: 'preise' }`. A locale with no entry uses `route`. Editable per language under **URLs** |
| `pageKind` | Drives the automatic structured data: `home`, `product`, `pricing`, `blogIndex`, `blogPost`, `page`, `form`, `error` |
| `type` | `static`, `hybrid` or `dynamic` — the content-ownership model from `reco.md` |
| `locales` | The languages this page exists in. Only these are routed, indexed and given an hreflang entry |
| `headRaw` | The `<head>` minus the tags the CMS owns: stylesheets, fonts, the Tailwind config, per-page `<style>` |
| `seo` | A map of locale → metadata, including `jsonLdOverride` and `replaceAutoLd` |
| `snippets` | Per-page `head` / `body` / `footer` HTML |
| `sections[]` | The blocks, in render order |
| `sourceHash` | Hash of the authored template, so a re-seed can tell an untouched page from a changed one |
| `editedInCms` | Set the moment an editor changes anything; the seed then refuses to overwrite without `--force` |
| `experiment` | Whole-page A/B: `{ key, variant, variantOf }`. `variantOf` names the control page and marks this document as an arm — no URL, no sitemap entry, no hreflang |

### Section blocks

```js
{
  key: 'hero',            // unique within the page
  label: 'Section: Hero', // what the block manager shows
  type: 'html' | 'script' | 'style' | 'component',
  html: '<section …>',    // authored bytes, for html/script/style
  componentKey: 'hero',   // registry name, for component blocks
  data: { … },            // that component's content
  keys: ['index.hero.title', …],   // the copy this block holds
  visible: true,
  locked: false,          // structural: hideable, not movable
  convertedFrom: null,    // 'html' once converted — outside the fidelity check
  layout: { spacingTop, spacingBottom },
  experiment: { key, variants: [{ key, label, html, data }] },
}
```

`html` blocks came from the authored pages and hold their exact bytes.
`component` blocks are built in the CMS and rendered by Astro. Both sit in one
list, so a new component block can be dropped between two authored sections.

`locked` blocks are the pages' inline `<script>` elements. They can be hidden
but not reordered, because the markup around them assumes where they sit.

A block variant supplies whichever of `html` or `data` fits its block. Authored
and custom blocks vary by markup; a component block varies by **field
overrides**, merged over the control's `data`, so testing one headline does not
mean restating the whole hero. The merge happens in `effectiveBlock()` at compose
time, before the component renders.

### The custom block

`componentKey: 'custom_html'` is the advanced block: an editor's own markup, with
Tailwind classes that work because the site compiles Tailwind in the browser —
there is no build step between writing a class and seeing it.

```js
data: {
  html: '<div class="py-20">…</div>',
  css: '.card { … }',      // scoped to this block before it is emitted
  containerClass: '',      // extra classes on the block's own wrapper
  contained: false,        // add the site's max-width and gutters
}
```

The stylesheet is rewritten to `.cms-block-<key> .card { … }` before it reaches
the page, recursing into `@media` and leaving `@keyframes` bodies alone. An
editor gets full control of their own block and none of anyone else's.

### `chromes`

One document, `key: 'default'`: the site's header and footer, plus its add-ins.

```js
{
  navbar: {
    html,          // what renders — the element only, no leading trivia
    authoredHtml,  // the migration-time copy, so "restore original" works
    css, js,       // add-in slots, emitted around the markup
    visible, edited,
    experiment: { key, variants: [{ key, label, html, css, js }] },
  },
  footer: { …the same },
  addIns: [{ key, label, note, zone, html, enabled, order, pages[], experiment }],
}
```

Chrome CSS is emitted **unscoped**, unlike a custom block's: a header's styling
legitimately reaches the page around it, and scoping it would mean wrapping the
markup and changing the layout. That is why both parts are admin-only.

A page says whether it shows them (`page.chrome`), and marks where they go with a
placeholder section (`role`). See `docs/architecture.md` for why the trivia lives
on the page rather than in the chrome.

### `integrations`

One per outbound endpoint the site calls.

```js
{
  slug: 'livre-blanc-lead',      // public: /api/v1/hooks/livre-blanc-lead
  url, method, headers,          // never returned by a public route
  responseMode: 'ok' | 'fields',
  responseFields: ['slots'],     // the only keys copied out of the reply
  captureLead: true, leadType: 'whitepaper',
  timeoutMs, rateLimit: { windowMs, max }, enabled,
  calls, failures, lastCallAt, lastStatus, lastError,
}
```

Seeded from `content-source/integrations.json`; the CMS owns the records after
that. Deleting one does not restore the authored URL in the pages by accident —
it stops the renderer repointing them, which the delete response says out loud.

### `media`

An image is an asset with a stable reference, not a filename.

```js
{
  name: 'Collaboration hero',        // a label; nothing points at it
  slug: 'collaboration-hero',        // the reference: /media/a/collaboration-hero
  aliases: ['old-hero'],             // earlier references, still resolving
  filename, url,                     // the file it currently holds
  history: [{ filename, url, replacedAt }],
  alt: { fr, en, de },
  source: 'upload' | 'bundled',
}
```

`resolveAssets()` in `packages/core/src/assets.js` turns every `/media/a/<slug>`
in the markup into the current `url` at render time, and `resolveAssetsDeep()`
does the same for a component block's fields — a hero's image lives in `data`,
not in HTML, so it would otherwise stay pinned to a filename while the same image
in a text block was managed.

Replacing a file bumps the site revision, so every cached page re-renders with
the new URL. The bytes stay immutable and long-cached; only the mapping changes.

`/media/a/:slug` also resolves on its own, as a 302 to the current file, for a
reference that escaped the render pass — inside a JavaScript string, say.

### `contentstrings`

The translation catalogue, one row per key.

```js
{ key: 'tarifs.hero.title', page: 'tarifs', zone: 'hero',
  owner: 'content' | 'seo', type: 'text' | 'rich' | 'list',
  values: { fr: '…', en: '…', de: '…' } }
```

`rich` values carry numbered placeholders — `Welcome to <0>Rainbow</0>` —
which bind to the inline children in the template. Markup and classes stay in
exactly one place and translators only ever see words.

A rich value therefore **cannot be edited as plain text**: writing the rendered
element's words back over it deletes the placeholders, and with them the link,
the emphasis or the styled span they stood for. That is enforced in three
places — the renderer flags rich units with `data-cms-rich`, the visual editor
refuses to start an inline edit on one, and `/strings/bulk` rejects a value that
drops placeholders from a value that had them. It cost the homepage headline its
word rotator once, which is why the guard is at the layer that owns the data and
not only in the interface.

`owner: 'seo'` rows are the ones a page's SEO panel edits; the copy table hides
them so the same string is not editable in two places.

### `blogposts`

The dynamic content type. One document per language, tied to its siblings by
`groupId` so hreflang lists only the translations that exist. `bodyHtml` is the
article; `blocks[]` are optional component blocks appended after it.

An imported article keeps `pageKey` pointing at the authored page that renders
it verbatim.

`sections[]` is the body as an ordered list, and takes precedence over
`bodyHtml`:

```js
{
  key, type: 'heading' | 'rich' | 'keyPoints' | 'image' | 'quote'
            | 'callout' | 'embed' | 'custom',
  data: { ... },      // the fields that type asks for
  anchorId,           // the #link; derived from the heading when empty
  inToc,              // null follows the type's default
  tocLabel, visible, order,
}
```

`renderArticleBody()` in `packages/core/src/article.js` returns the markup and
the contents list from one pass, so the anchors the Sommaire links to are by
construction the anchors the body emits. The CMS calls the same function, which
is why the contents list an editor sees is the one that ships rather than a
second implementation that can disagree with it.

### `navigations`

The navbar. Item order is explicit and is what the site renders. Each item may
have a megamenu with three zones — `main` (required), `features` and `footer`
(both optional). An empty optional zone renders no container at all.

Links carry `column` (the resources menu uses two) and `variant`
(`item`, `showcase`, `cta`), which is how one data shape covers the three
different menu layouts.

### Others

| Collection | Holds |
|---|---|
| `settings` | One document: site identity, languages, the blog's segment per locale, default metadata, the three global snippets, analytics |
| `media` | Named image assets: `slug` is the reference pages point at, `aliases` the ones they used to, `history` the files replaced. See below |
| `partners` | The 1 130-entry directory behind the locator map |
| `leads` | Form submissions, stored before they are forwarded anywhere |
| `redirects` | Old URL → new URL, applied in the frontend middleware |
| `experiments` | A/B tests. `scope: 'block'` varies one section; `scope: 'page'` serves a whole alternative page at the control's URL |
| `versions` | Snapshots taken before every destructive edit; the last 30 per item |
| `auditlogs` | Who changed what, and when |

## Adding a language

1. Add it in **Settings → Languages** and mark it active.
2. Import a catalogue in **Copy & translations → Import**, or translate in the
   table. The "Missing in …" filter shows exactly what is left.
3. Add the language to each page's `locales` list.
4. Translate the navigation labels — the language pills in the navigation
   editor switch which language you are editing.

Until a page lists the language, it is not routed and gets no hreflang entry:
an incomplete translation stays invisible rather than advertising itself.

## Adding a block type

1. Build `apps/web/src/components/blocks/YourBlock.astro`, reading only
   `data` — never page-level context.
2. Register it in `SectionRenderer.astro`.
3. Describe it in `apps/cms/src/lib/blockSchemas.js`: its fields, plus the
   `category`, one-line `description` and `wireframe` the insert palette shows.

The block is then available on every page, in the palette, and A/B testable by
field override. No API change, no migration.

## Adding a language, URL side

Beyond the steps above, give the language its own paths where the words differ:

1. **Settings → Languages** sets the blog's segment for that locale.
2. Each page's **URLs** tab sets that page's path. Leave it empty to share the
   base route.
3. Nothing else — the redirect from the old path, the canonical, the hreflang
   entry and the sitemap row all follow from the same resolver.

## Re-importing a changed template

Change the file in `content-source/pages/`, then `npm run seed`. Pages whose
source hash changed are refreshed; pages an editor has touched are skipped with
a warning until you pass `--force`.
