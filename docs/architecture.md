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

Variant *assignment* happens in the middleware, but it is only *persisted* after
the page has reported which experiments it actually used. Without that, a test
running on one page would set a cookie on every page of the site and — much more
expensively — force every response to be marked `private`, because any of them
might have depended on an assignment.

## URLs

One page, one URL per language. A page carries a base route plus optional
per-locale overrides (`routes: { en: 'pricing', de: 'preise' }`), so a German
visitor gets `/de/preise` rather than the French slug. The consequences are
enforced rather than left to whoever edits next:

- Arriving on the untranslated path is a **301** to the locale's own path, not a
  second copy of the page.
- `canonical`, `hreflang` and the sitemap are all built from the same resolver
  (`routeFor()`), so they cannot disagree with each other.
- Renaming a URL writes the redirect for you, and repoints anything that already
  pointed at the old path so no chain builds up.
- The blog's own segment is per locale too (`Settings → Languages`).

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

## The visual editor

The page builder does not render blocks a second time in React. The canvas is
an `<iframe>` of the real page, requested in edit mode, and the CMS talks to it
over `postMessage`.

```
CMS (/admin/)                          Astro (/fr/tarifs, edit mode)
─────────────                          ─────────────────────────────
iframe src ──────────────────────────▶ compose(): every block's outer tag gets
                                         data-cms-block="<key>"
                                       every translatable unit already carries
                                         data-cms-key="<string key>"
                                       + /js/cms-editor.js
       ◀── layout: block rectangles ── reports geometry on scroll/resize/load
       ◀── select: block clicked ───── click anywhere in a block
       ◀── elementClicked: what it is ─ click a link, button or form control
       ◀── stringChange: key, value ── double-click text, type, blur
       ─── select / editString ──────▶ scroll to and focus a block or string
```

Both sides ignore message types they do not recognise, which is what lets the
protocol grow: `elementClicked` was added to the canvas script before the parent
could handle it, and neither half broke.

Consequences worth stating:

- **What you see is what ships**, because it *is* what ships — the same CSS, the
  same browser-compiled Tailwind, the same page scripts. There is no second
  renderer to drift from the first.
- **Nothing is annotated on a public page.** `data-cms-block` and the bridge
  script are emitted only when the preview cookie *and* the edit cookie are
  present; `data-cms-key` only under preview.
- **The iframe never writes to the API.** It reports intent; the parent owns the
  access token and the error handling.

Because the canvas is the live page, editing an imported section's *copy* is
safe — the string catalogue is the seam it always was — while editing its
*structure* is not, and is therefore a deliberate conversion (below) rather than
a textarea.

## Clicking an element, not a block

A click on the canvas answers two questions, and the second one is the useful
one. *Which block* is `data-cms-block` on the outer tag, which the canvas has
always reported. *Which field drew this button* is harder: by the time the
browser sees it, the `href` has been resolved from a `page:` reference and
rewritten for the locale, so it cannot be matched back to the stored value.

So the blocks annotate it. In edit mode only:

```astro
const fieldHook = (name) => (editMode ? { 'data-cms-field': name } : {});
…
<a {...linkAttrs(primaryHref, data.primaryNewTab)} {...fieldHook('primaryHref')}>
```

`describeElement` in `cms-editor.js` reports the field name, the element's text,
its rectangle, the form it belongs to if any, and — for markup the CMS did not
generate — its index among the block's anchors. That index is the fallback
identity: inside an authored section, "the third link in this block" is the only
stable handle there is, and it means the same thing on both sides because the
browser and the server walk the same markup in the same order.

Three cases, three different backends:

| The element came from | Edited by |
|---|---|
| A component block's field | `PATCH /pages/:key/sections/:key` with the block's `data` |
| A label-only field | The same, but the panel says why the destination is fixed |
| An authored section's own markup | `PATCH /pages/:key/sections/:key/anchors/:index` |

That last endpoint is why `packages/core/src/anchors.js` exists. The authored
pages are stored as the bytes they were written with, and `verify-live.mjs`
proves the site still ships those bytes — so changing a link cannot mean
re-serialising the section. `anchorsIn` scans for anchors quote-aware (a `>`
inside an attribute value does not end a tag), takes the byte range of the
`href` *value*, and splices. The quoting style, the whitespace and the two
hundred lines around it are untouched, so a section under the fidelity guarantee
stays under it.

`setAnchorTarget` writes `rel="noopener noreferrer"` alongside `target="_blank"`,
never separately. The same pairing is in `apps/web/src/lib/links.js` for the
component blocks, for the same reason: `rel` is the half that gets forgotten, and
forgetting it is a real hazard rather than a cosmetic slip.

## Forms

A form is its own collection, not a property of the block that shows it — see
`docs/content-model.md`. Three things follow from that, and all three are the
point:

**One renderer.** `packages/core/src/form.js` produces the markup, and it is
called from four places: the `FormBlock` Astro component, the `form` article
section in `core/article.js`, the CMS's preview endpoint, and nothing else. The
article path is why this lives in core rather than in the web app — an article
body is an HTML *string* spliced into one page block, so a form inside one can
never be an Astro component. Without a string renderer, "a form in an article"
would have been a second implementation.

**Resolution happens server-side.** A block stores `formKey`; `services/forms.js`
resolves it into `data.form` as the page payload is built, so the block component
receives plain data and the string renderer receives the same object. The forms
are cached as one list under the site revision, which is why saving a form calls
`publishChanged` — the pages showing it have to retire with it.

**The endpoint's contract is recorded, not guessed.** `services/integrationProbe.js`
sends a deliberately invalid payload — that is what makes it safe — and reads the
refusal, which names the fields the workflow required. Stored on the integration
as `contract`. `formContractGaps` compares a form against it, so the builder can
say "this form is missing `companySize`" without submitting anything. When no
probe has run the answer is *not checked*, which is a different answer from *fine*.

```
Form.target         'lead:demo'  → stored under Leads, filed as a demo request
                    'hook:x'     → stored, then forwarded to integration x
```

Stored either way, before any forwarding. A misconfigured automation costs a
retry rather than a fortnight of lost enquiries.

## Site chrome

The header and the footer are not page content, so they no longer live in pages.
One `chromes` document holds both; a page carries a **placeholder** — a section
with `role: 'navbar' | 'footer'` — that says where they go.

```
page.sections[]                        chromes.default
  … hero, features, pricing …
  { role: 'footer', trivia: '\n\n  <!-- FOOTER -->\n  ' }  ──▶  footer.html
```

Two details earn their keep:

- **The chrome stores the element, the page stores the trivia.** The slicer
  attaches the whitespace and comment preceding an element to the block that
  follows it, which is what makes `blocks.join('')` reproduce the authored body
  exactly. So the shared copy is `<nav id="navbar">…</nav>` with nothing in front
  of it, and each placeholder contributes its own leading trivia back at render
  time. The page payload ships `trivia` instead of `html`, so it does not carry a
  second copy of the footer.
- **Nesting is handled by pattern, not by position.** The article template puts
  its navbar *inside* a `<header>` wrapper, so it has no top-level placeholder.
  `replaceChromeRegions()` swaps the region wherever it appears, using patterns
  exported from `compose.js` — the same ones `verify-live` imports, so the tool
  and the renderer cannot drift. Without it, exactly one page would have kept a
  header nobody could edit.

A page opts out with `chrome.navbar = false`; the placeholder then renders
nothing. `usedExperiments()` counts a chrome test on every page, because that is
what it is.

In edit mode a chrome region is annotated `data-cms-chrome-region`, deliberately
*not* `data-cms-block`: the bridge treats the second as "this is yours to
change". Clicking chrome in a page canvas therefore refuses selection and reports
`chromeClicked`, which the editor turns into a pointer at the screen that owns
it.

## Outbound integrations

The renderer repoints third-party endpoints at this origin
(`packages/core/src/endpoints.js`), and `apps/api/src/routes/hooks.js` makes the
call. The mapping is data, the substitution is exact string replacement, and the
upstream URL is never on a public route:

```
browser ──▶ POST /api/v1/hooks/<slug>          (rate limited, honeypot checked)
                 │
                 ├── store a Lead first        (nothing is lost if the rest fails)
                 └── fetch(upstream)  ──▶ automation platform
                          │
                          ▼
            { ok }  or  { ok, …allowlisted fields }
```

`GET /api/v1/site/integrations` returns the map for the renderer and is gated on
the shared revalidate secret — every other route under `/site` is public, and
this one carries exactly the thing the proxy exists to hide.

## Named image assets

The same shape as the endpoint proxy: a data map and an exact string
replacement, applied in `render()`.

```
stored     <img src="/media/a/hero-home">
rendered   <img src="/media/hero-home-9f2c1e.webp">
```

Two details are what make it hold together:

- **Component fields are resolved too.** A hero's image is in `data.image`, not
  in markup, so it never reaches the renderer's string pass.
  `resolveAssetsDeep()` walks the block's data in `composeParts`. Without it,
  half the site would be managed and half pinned — worse than not having the
  feature, because you could not tell which was which.
- **Renaming keeps the old reference.** Old slugs move to `aliases` and keep
  resolving, so renaming is safe. A rename that broke every page using the old
  name is a rename nobody performs, which would make the feature ornamental.

`verify-live` still reports zero differences with two pages storing references
instead of filenames, which is the point: the indirection is invisible in the
output.

## Links that survive a rename

The third indirection, and the same shape as the two above: a data map and an
exact string replacement.

```
stored in a block   href="page:tarifs"
served to a French  href="/fr/tarifs"
served to a German  href="/de/preise"
```

A typed path pins a link to three things at once — that path, that language, and
that path never changing. All three break in ordinary use: a German visitor
following a French path lands on a redirect at best, renaming a page leaves every
button pointing at a redirect, and a page moved under a new parent leaves them
pointing at nothing.

`packages/core/src/links.js` builds the map from the same route index the
resolver uses, so a link and a canonical URL cannot disagree about where a page
lives. A reference to a page that does not exist in the locale being rendered is
left unresolved rather than turned into a confident-looking 404.

`resolveLinksDeep()` walks a component block's data alongside
`resolveAssetsDeep()`, for the same reason: a hero's button lives in
`data.primaryHref`, not in markup.

## Restore points

Every content type that can be edited can be put back. The mechanism is one
collection and one service — `packages/…` no, `apps/api/src/services/history.js` —
and every entity declares three things: how to load it, how to write a snapshot
back, and how to describe itself.

Three properties make it an undo rather than a museum:

- **The API takes the snapshot, not the editor.** Before every edit, delete,
  conversion and publish. A history that depends on somebody pressing "back up
  first" is empty on the day it is needed.
- **The list is readable without loading the snapshots.** A page document
  carries every block's markup — hundreds of kilobytes — so each version stores
  a small `digest` (title, route, status, block count) written once at snapshot
  time. The history screen compares consecutive digests to say what each restore
  would change.
- **Restoring is undoable.** The state being replaced is snapshotted first, and
  the response names it, so the interface can offer the undo immediately.

A delete is snapshotted with `force`, bypassing the debounce that collapses
several edits in a row into one restore point. Without that, deleting something
you had just edited wrote no snapshot at all — the one case where the snapshot is
not a convenience but the only remaining copy. **Pages → Trash** is a projection
of those snapshots, not a second collection that could disagree with them.

## Converting an authored block

An imported section is stored as the exact bytes it was authored with, which is
what `verify-fidelity` and `verify-live` prove. Visual block editing of such a
section cannot preserve that: the markup has to render through the block wrapper
to gain spacing controls, variants and a form.

So it is an explicit action. `POST /pages/:key/sections/:sectionKey/convert`
moves the markup into a `custom_html` component block, sets its spacing to
`none` (the authored markup carries its own padding), clears the now-unused
translation keys, and stamps `convertedFrom: 'html'`. The CMS labels the section
`converted` from then on, and the previous version is in the page's history.

Sections nobody converts stay byte-identical, so `verify-live` keeps reporting
`0 difference(s)` for them.

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
| Resolving named images | `packages/core/src/assets.js` |
| Resolving page references in links | `packages/core/src/links.js` |
| Proxying third-party endpoints | `packages/core/src/endpoints.js` |
| Restore points and the trash | `apps/api/src/services/history.js` |
| The migration itself | `packages/core/src/ingest.js` + `apps/api/src/seed/seed.js` |
| What must be true before the API serves | `apps/api/src/seed/bootstrap.js` |
| The admin's component library | `apps/cms/src/components/ui/` |
