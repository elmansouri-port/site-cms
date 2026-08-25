# Content model

What lives in the database, and who owns it.

## Collections

### `pages`

One document per route. Holds the document scaffolding (doctype, `<html>` tag,
`<head>` remainder, `<body>` tag) and an ordered array of section blocks.

| Field | Meaning |
|---|---|
| `key` | Stable identifier, never changes. `index`, `tarifs`, `collaboration` |
| `route` | Locale-less path. `''` is the homepage |
| `pageKind` | Drives the automatic structured data: `home`, `product`, `pricing`, `blogIndex`, `blogPost`, `page`, `form`, `error` |
| `type` | `static`, `hybrid` or `dynamic` — the content-ownership model from `reco.md` |
| `locales` | The languages this page exists in. Only these are routed, indexed and given an hreflang entry |
| `headRaw` | The `<head>` minus the tags the CMS owns: stylesheets, fonts, the Tailwind config, per-page `<style>` |
| `seo` | A map of locale → metadata, including `jsonLdOverride` and `replaceAutoLd` |
| `snippets` | Per-page `head` / `body` / `footer` HTML |
| `sections[]` | The blocks, in render order |
| `sourceHash` | Hash of the authored template, so a re-seed can tell an untouched page from a changed one |
| `editedInCms` | Set the moment an editor changes anything; the seed then refuses to overwrite without `--force` |

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
  layout: { spacingTop, spacingBottom },
  experiment: { key, variants: [{ key, html }] },
}
```

`html` blocks came from the authored pages and hold their exact bytes.
`component` blocks are built in the CMS and rendered by Astro. Both sit in one
list, so a new component block can be dropped between two authored sections.

`locked` blocks are the pages' inline `<script>` elements. They can be hidden
but not reordered, because the markup around them assumes where they sit.

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

`owner: 'seo'` rows are the ones a page's SEO panel edits; the copy table hides
them so the same string is not editable in two places.

### `blogposts`

The dynamic content type. One document per language, tied to its siblings by
`groupId` so hreflang lists only the translations that exist. `bodyHtml` is the
article; `blocks[]` are optional component blocks appended after it.

An imported article keeps `pageKey` pointing at the authored page that renders
it verbatim.

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
| `settings` | One document: site identity, languages, default metadata, the three global snippets, analytics |
| `media` | Uploads, plus an index of the images that ship with the build (`source: 'bundled'`, undeletable) |
| `partners` | The 1 130-entry directory behind the locator map |
| `leads` | Form submissions, stored before they are forwarded anywhere |
| `redirects` | Old URL → new URL, applied in the frontend middleware |
| `experiments` | A/B tests a section block can opt into |
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
3. Describe its fields in `apps/cms/src/lib/blockSchemas.js`.

The block is then available on every page. No API change, no migration.

## Re-importing a changed template

Change the file in `content-source/pages/`, then `npm run seed`. Pages whose
source hash changed are refreshed; pages an editor has touched are skipped with
a warning until you pass `--force`.
