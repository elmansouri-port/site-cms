# Architecture

## The problem this shape solves

The site existed as 18 hand-authored HTML pages. They are good pages —
carefully built layouts, a lot of bespoke CSS, several pages of inline
JavaScript — and the brief was to put a CMS behind them **without changing what
a visitor receives**.

Two obvious approaches were rejected:

- **Rebuild every page as components.** Roughly 800 kB of markup rewritten by
  hand, with no way to prove the result matched. Every difference would be a
  visual regression nobody notices until a customer does.
- **Store the pages as opaque HTML blobs.** Editable only by someone
  comfortable in a code editor, and the translations would have nowhere to
  live.

The chosen approach uses the seam the site already had. Every translatable
string in those pages carries a `data-i18n` marker, and the copy lives in
per-language JSON. The site was already "template + content"; this project
moves the content into a database and keeps the splice.

## The pipeline

```
authored HTML                 the CMS                         what ships
─────────────                 ───────                         ──────────
<h1 data-i18n="a.b">     →    pages.sections[]         →      <h1>Welcome</h1>
  Bienvenue                     .html  (authored bytes)
</h1>                         contentstrings
                                a.b = { fr: …, en: … }
```

Three rules keep it lossless:

1. **Never re-serialize HTML.** `packages/core/src/html.js` scans markup into
   byte ranges. A real parser would normalize attribute quoting, boolean
   attributes and whitespace, and silently reformat all eighteen pages.
2. **Blocks keep their leading whitespace.** `sliceBody()` cuts the body into
   top-level children, attaching the trivia before each element to it, so
   `blocks.join('')` is the original body exactly.
3. **A page of authored blocks is one fragment.** Astro puts a newline between
   sibling template nodes; `PageDocument.astro` joins first when no component
   block is involved.

`tools/verify-fidelity.mjs` asserts 1–3 offline. `tools/verify-live.mjs`
asserts them against a running server. Both are part of `npm test`.

## Request path

```
browser
  │
  ▼
nginx gateway ─── /admin/ ──▶ CMS (static SPA)
  │           ─── /api/  ──▶ content API
  │           ─── /media/ ─▶ content API (uploads volume)
  ▼
Astro SSR
  │  middleware: redirects → locale → A/B assignment → preview
  ▼
content API ──▶ Redis (read-through, keyed by site revision)
                  │ miss
                  ▼
                MongoDB
```

Nothing in the page render happens in the browser. The middleware resolves the
locale and the A/B variant before anything is fetched, so the HTML that leaves
the server already is the visitor's variant, in the visitor's language.

## Why the API is separate from the CMS

The CMS is an editor interface. It talks to the same database as the content
API but serves no public pages, and the frontend never calls it. That
separation means the admin can be down, redeployed or locked behind a VPN
without the marketing site noticing.

## Caching and invalidation

Every cached value is namespaced with a revision counter in Redis. Publishing
increments it, which retires the whole previous generation in a single write —
no key hunting and no half-stale pages. The API then calls the frontend's
`/cms/revalidate` webhook so the Astro process drops its own copies.

Both layers degrade instead of failing:

- Redis unreachable → the API serves from MongoDB.
- API unreachable → the frontend serves its last known copy of that payload.
- Neither available → a 503 with `retry-after`, not a broken page.

## The section registry

Component blocks name their renderer with a string
(`hero`, `pricing_cards`, …). `SectionRenderer.astro` maps that name to a
component; an unknown name logs a warning and renders nothing, so a bad
reference in the database cannot take a page down.

Adding a block type is three steps: build the component, register it, add its
field schema in `apps/cms/src/lib/blockSchemas.js`. No API change, no
migration.

## Where the seams are

| Seam | File |
|---|---|
| HTML scanning and splicing | `packages/core/src/html.js` |
| What counts as a translatable unit | `packages/core/src/units.js` |
| Applying a catalogue to markup | `packages/core/src/render.js` |
| Cutting a document into blocks | `packages/core/src/slice.js` |
| Building `<head>` and JSON-LD | `packages/core/src/seo.js` |
| Assembling a page | `packages/core/src/compose.js` |
| The migration itself | `packages/core/src/ingest.js` + `apps/api/src/seed/seed.js` |
