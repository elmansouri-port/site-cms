# Rainbow by ALE — site & CMS

The Rainbow marketing site, moved from hand-written static HTML into a
database-backed CMS **without changing a single byte of what a visitor
receives**.

Every page of the original site is served by an Astro 7 server-rendered
frontend, composed from content stored in MongoDB, cached in Redis and edited
through a purpose-built admin. A verification tool proves the equivalence on
every run:

```
$ npm run test:core
66 tests, 0 failures

$ npm run verify
126 checks, 0 failure(s)

$ node tools/verify-live.mjs http://localhost:8080
51 page renders compared against the authored source, 0 difference(s)
  1 page(s) exempt by design: blog

$ node tools/verify-chrome.mjs http://localhost:8080
one header and one footer across 13 pages × 3 languages, 0 upstream URLs exposed

$ node tools/verify-editor.mjs http://localhost:8080 --confirm
160 passed, 0 failed

$ node tools/verify-ui.mjs http://localhost:8080 --confirm
43 checks, 0 failure(s)

$ node tools/verify-forms.mjs http://localhost:8080 --confirm
40 checks passed, 0 failed

$ node tools/verify-experiments.mjs http://localhost:8080 --confirm
30 checks, 0 failure(s)
```

The browser suites sign in and do the work: build a landing page with no header
or footer, drop a form on it, submit that form as a visitor, find the submission
under Leads, point a button at a page and check the link resolves differently in
French and German, then break the page, restore it from history, undo the restore,
delete the page and recover it from the trash.

`verify-live` distinguishes a page whose **markup** has drifted from one whose
**copy** was edited in the CMS: on a difference it re-renders against the
catalogue the API is serving, and reports an edit rather than a failure when that
matches. Without that, the tool would go red the first time anyone changed a word
and be switched off by the end of the week.

One page is exempt, and the exemption is stated in `pages.registry.json` and
printed on every run: the blog index reads the articles that exist, so its body
cannot match a template with twelve hard-coded article cards in it — which was the
point of making it dynamic. An exemption on the record beats a page that quietly
falls out of the suite.

Editing is visual — the canvas is the real page in an iframe, so what an editor
sees is not a preview of what ships, it is what ships. Blocks are clicked and
dragged; copy is rewritten in place; the advanced block takes your own HTML and
Tailwind. Articles get the same canvas, rendering the draft you have not saved.
None of which costs the guarantee above.

---

## What this is

| | |
|---|---|
| **Frontend** | Astro 7, SSR on the Node adapter — one route file serves every page in every language |
| **Content API** | Express 5 + Mongoose 9, JWT auth, role-based access, Redis read-through cache |
| **CMS** | React 19 + Vite 8 single-page admin, built on Tailwind 4 and shadcn/ui primitives: pages, blocks, copy, media, blog, navigation, leads, A/B tests, restore points |
| **Data** | MongoDB 8 |
| **Cache** | Redis 7, invalidated by a site-wide revision counter on publish |
| **Delivery** | Docker Compose with an nginx gateway; one origin for site, admin and API |

---

## Getting started

```bash
cp .env.example .env          # then change every secret in it
docker compose up -d --build  # mongo, redis, api, web, cms, gateway
docker compose exec api node apps/api/src/seed/seed.js
```

| | |
|---|---|
| Site | <http://localhost:8080/> |
| CMS | <http://localhost:8080/admin/> |
| API | <http://localhost:8080/api/v1/> |

Sign in with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`. The account is
created on first boot, only when the database is empty.

### Working on it locally

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mongo redis
npm install
npm run seed
npm run dev        # api :4000, web :3000, cms :5173
```

---

## How the migration works

The original site was 18 hand-authored HTML pages plus three translation
catalogues, rendered by splicing translated copy over marked-up byte ranges.
That splice is the seam this CMS is built on.

```
content-source/pages/*.html          the authored templates (French, with data-i18n markers)
content-source/i18n/*.json           the copy, per language
        │
        │  seed  ──  packages/core/src/ingest.js
        ▼
MongoDB
  pages          document scaffolding + an ordered array of section blocks
  contentstrings 1 521 strings × 3 languages, addressed by key
  navigations    navbar and megamenus, per language, drag-ordered
  blogposts      the dynamic content type
  media          uploads + an index of the images that ship with the build
  partners       1 130 entries behind the partner locator
        │
        │  render  ──  packages/core/src/compose.js
        ▼
Astro SSR  →  the same bytes the static site served
```

Three things make that round trip lossless:

1. **HTML is never re-serialized.** The scanner returns byte ranges and the
   renderer splices over them. A parser would normalize quoting and whitespace
   and silently reformat every page.
2. **Blocks hold authored bytes.** Slicing the body into top-level children
   keeps the whitespace that preceded each one, so concatenating the blocks
   reproduces the body exactly — which `tools/verify-fidelity.mjs` asserts.
3. **A page of only authored blocks is emitted as one fragment.** Astro puts a
   newline between sibling template nodes; joining first avoids it.

### What the CMS owns

| Owned by the CMS | Owned by the code |
|---|---|
| Every visible string, in every language | The markup structure and its classes |
| Page metadata, OG fields, JSON-LD overrides | The stylesheets and page scripts |
| Section order, visibility, duplication | Which section a block's markup renders |
| The URL of every page, per language | How a URL is resolved to a page |
| Navigation labels, links, megamenu zones | The megamenu's layout and behaviour |
| Blog posts, media, partner directory | The article template's shape |
| The blog index: its copy, its promo card, how many per page | Which articles match a filter |
| Site-wide and per-page code (add-ins) | |
| Which page a link points at | Where that page lives, per language |
| Lead-capture forms and where they send | The proxy that makes the call |
| Whether a submission is stored at all, and for how long | |
| A/B experiments and their variants | |
| Custom blocks: their HTML, Tailwind and scoped CSS | |
| The header and footer: their words, their links, their markup | Where the megamenu's panels come from |
| The partner map's tile provider | The map's behaviour and clustering |

---

## Editing

The **Design** tab is a visual page builder. The canvas is an iframe of the real
page — the same CSS, the same browser-compiled Tailwind, the same page scripts —
so what an editor is looking at is not a preview of the page, it is the page.

It lists the page's **body only**, and the header and footer are not editable
from it at all — clicking either one in the canvas says where it *is* edited
rather than opening an inspector for something the page does not own. That was
the mistake consolidating them was meant to end: opening one page to change the
footer, and being surprised when it changed on all of them. A page can still hide
either from its own Settings.

The canvas renders at a **real device width** — Desktop is 1440px, scaled to fit
the column. Before that it got whatever width was left over, about 700px, which
is under the site's `lg:` breakpoint: so "Desktop" was quietly showing the
*mobile* header on both this screen and the header editor.

```
click a block          select it, inspector opens on the right
double-click text      rewrite it in place, in the language you are viewing
drag in the list       reorder
+ between two blocks   insert exactly there
Desktop/Tablet/Mobile  resize the canvas
```

Blocks come from a palette that shows each one's shape and says when to use it,
grouped as openers, content, proof, conversion and advanced.

### Getting out of trouble

Every page, article, menu, the header and footer, and the site settings carry a
**History** tab. Not a changelog — a list of moments this thing can be returned
to, what changed at each, and a button.

```
before the autumn campaign rewrite     saved by hand · 2 hours ago · Aïcha
  published · 11 blocks · /tarifs
  Restoring this changes: title, 2 blocks removed
```

Three things make it an undo rather than a museum piece:

- **The API takes the snapshot, not you.** Before every edit, every block
  delete, every conversion and every publish. A history that depends on somebody
  remembering to press "back up first" is empty on the day it is needed.
- **You can name one.** *Save a restore point* records the current state under a
  name — "before the autumn campaign rewrite" — and named points are never
  trimmed, however much editing happens afterwards. Automatic snapshots cover
  the accidents; this covers the deliberate risk.
- **Restoring is undoable.** The state being replaced is snapshotted first, so
  restoring the wrong version costs one more click rather than a second panic.

A **deleted page** comes back from **Pages → Trash**, as a draft, with its blocks
and its SEO. The trash is those same restore points rather than a second copy
that could disagree with them — and the snapshot before a delete is written
unconditionally, because that is precisely the moment it is the only copy left.

### Forms

**Forms** is its own screen, because a form is a thing rather than a property of
the block that shows it. The demo-request form appears on four product pages; it
should be one form, changed once — not four block-local copies that drift apart
until one of them is still asking for a fax number.

The builder is three columns:

| | |
|---|---|
| **Fields** | Drag to reorder, click to configure, add from a row of types |
| **Preview** | The real markup, inside a frame of the site, with the site's own stylesheet — so what you see is not an approximation |
| **This field / Where it goes** | One panel at a time, folded away when you do not need it |

The distinction the panel exists to make obvious is the one that trips everybody
up. A field has a **label**, which is what a visitor reads and is different in
every language, and a **name**, which is what the endpoint receives and has to be
exactly what the automation expects. Send `Adresse e-mail` to a workflow reading
`email` and the submission is refused for every visitor.

So the CMS checks. Every automation endpoint on this site answers an unusable
payload by naming the fields it was missing; the Integrations screen records that
answer, and **Check** compares your form against it:

```
Missing 3 required fields
The endpoint refuses a submission without companySize, country, consent.
```

Before the form goes on a page, and without submitting anything. When nobody has
tested that endpoint yet it says *not checked* rather than showing a green tick —
a check that is confidently wrong is worse than no check.

Where a submission goes is one dropdown:

| | |
|---|---|
| **Leads → demo** | Stored under Leads, filed as a demo request |
| **An integration** | Stored *and* forwarded, server-side, to whatever runs the follow-up |

Stored first, always. A form whose automation is misconfigured still captures
the lead, and the CMS says the integration is failing instead of losing enquiries
quietly for a fortnight. The browser only ever posts to this origin, so the
automation platform stays out of the page source — see **Integrations** below.

The honeypot is not optional and not editable: a field a human never sees and a
bot always fills, answered with a 202 so the bot learns nothing.

**Where a form can go.** A **Form** block on any page, or a **Form** section
inside a blog article. Both render through one function, so a form cannot look or
behave differently depending on where it was placed. A block can still define its
own fields for a genuine one-off — choosing a saved form folds that away, because
the two are alternatives and filling in the half that is ignored is a trap.

Deleting a form that four pages show is refused, and the refusal names them. A
dangling reference renders as an HTML comment naming the missing form: visible to
whoever opens the preview, invisible to a visitor, and never a silent gap.

What forms deliberately are **not**: the booking calendar, the reschedule wizard
and the token-confirmation pages. Those are multi-step flows with a slot picker
and a lookup-then-confirm handshake, not field lists. Pretending a field list
could express them would produce a builder that half-works on the four hardest
pages on the site, so they stay as authored pages.

### Clicking a button to change where it goes

On the **Design** tab, click any button or link on the page. A panel opens with
that one element: where it goes, what it says, and whether it opens in a new tab.

That is the edit people actually make — "that button still points at the old
pricing page" — and finding `secondaryHref` among eighteen fields of a block
whose name you have to guess from the layout is a worse experience than editing
the HTML was.

The panel is honest about three different situations:

| What you clicked | What you get |
|---|---|
| A link the block drew from one of its fields | Its destination, its label and a new-tab option |
| A label whose destination is not yours to choose — the blog list's button goes to the blog | The words, and one line saying why the destination is fixed |
| A link written inside an authored section's own markup | Its destination, spliced over that one attribute's bytes so the rest of the section stays exactly as it was authored |

That last row is the interesting one. The imported pages are stored as the bytes
they were written with and a verification tool proves the site still ships those
bytes, so "let an editor fix a link" cannot mean re-serialising the section: a
parser would normalise the quoting and rewrite two hundred lines to change nine
characters. Instead the anchor is found by scanning, the `href` value's byte range
is replaced, and everything around it is untouched.

**Open in a new tab** always writes `rel="noopener noreferrer"` with it. Somebody
ticking a checkbox is not choosing to hand the new tab a live reference back to
the page that opened it.

Clicking a field inside a form does not edit it here. It says which form the
field belongs to and offers to open it, because that form may be on four pages
and changing it from one of them without saying so is how a CMS loses trust.

### Panels that fold

The sidebar collapses to its icons, both rails of the visual editor fold, and
every panel on the form builder has a chevron. Each remembers its own state, so a
layout you arranged for the job you are doing survives the next navigation and
the next session.

The canvas is why. At 1440px the three-column editor scales a desktop preview to
roughly half size, which is unreadable for the one thing a preview is for.

A closed inspector still opens itself when you select a block — a click that
worked and appeared to do nothing would be worse than no fold at all.

### Links that follow a rename

Every button, link and menu entry is chosen rather than typed:

```
Page          → page:tarifs        resolved to /fr/tarifs, /de/preise, per render
Article       → post:the-slug
On this page  → #pricing           the anchors that actually exist on this page
Web address   → https://…
Email, phone  → mailto:, tel:
File          → the media library's reference
```

A page is stored **by name**, not by path. One stored value is therefore correct
in every language, and stays correct when the URL changes — which matters because
renaming a URL is a thing this CMS actively encourages (it writes the redirect
for you), and a hand-typed path would quietly start costing a redirect hop on
every click.

A path typed by hand still works. It just says so, underneath the field.

### The custom block

The advanced block is your own HTML, with Tailwind. The site loads Tailwind from
the CDN and compiles classes in the browser, so any utility class works with no
build step between writing it and seeing it. Its optional stylesheet is scoped to
the block before it is emitted — `.card {}` becomes `.cms-block-<key> .card {}` —
so a selector cannot reach out and restyle the rest of the page. Five starting
points (two columns, three cards, gradient banner, testimonial, blank) are
written in the site's own theme, so a starter looks like a Rainbow section before
you change a word.

### Header and footer

One header and one footer for the whole site, under **Header & footer**. Change
them there and every page follows.

They used to live *inside* each page — eighteen copies. The markup was the same
everywhere; what differed was the translation key on each string, because the
extractor minted a fresh key every time it met the same sentence on a new page.
In French that was invisible. In English and German it was not: `verify-chrome`
found **thirteen different footers** in each of those languages, because only
some of the duplicate keys had ever been translated. Consolidating fixed that.

Four tabs, and the first one is the answer to why this screen did not work.

| | |
|---|---|
| **Text** | Every string the part renders, one row each, in every language |
| **Links** | Every `href`, with its own anchor text, and the usual page picker |
| **Markup** | The structure: layout, classes, which elements exist |
| **CSS & JS** | The part's own stylesheet and script, emitted with it |

#### Why editing the markup used to do nothing

The screen opened on the markup, with the French words plainly visible inside it.
So people changed the words there, saved, looked at the site — and found it
unchanged. Every string in the header carries a translation key, and the renderer
**splices the catalogue's value over the marked range** on the way out. The copy
in the markup is a default that is overridden on every single request.

Two things follow, and both are now true:

- **Editing the markup writes the catalogue.** The API works out which marked
  strings an edit changed and saves them as the copy for the language the canvas
  is showing, then reports how many moved. It needs to be *told* which language:
  a caller that does not say gets its markup saved and its copy left alone, and
  the response says so. Defaulting to French meant a migration script that merely
  reformatted the markup had every string it touched recorded as a deliberate
  edit.
- **The words are not edited through the markup any more.** The Text tab lists
  them. A sentence containing a link or a styled word is not offered as a text
  box — its stored value is `Welcome to <0>Rainbow</0>`, and retyping that as
  plain text would delete the link — so those open in Copy & languages, which
  shows the placeholders.

The "edited" badge follows the *structure*, not the words: a copy change emits
identical bytes, so counting it as an edit lit the badge and offered **Restore
original** for something that had not happened.

And the markup editor is a textarea, which normalises CRLF to LF the moment it is
focused. The authored pages are CRLF, so opening the header and changing one word
used to rewrite all sixty of its lines — an unreadable history entry, a spurious
"edited" badge, and `verify-live` reporting the whole site as drifted. Incoming
markup is put back into the convention the stored copy uses.

#### What is not on this screen

The **dropdown panels and the mobile drawer** are built in the browser by
`/js/mega-menu.js` from the CMS navigation, and the script *hides* the
placeholder markup for them that this part carries. Editing that markup can never
have an effect, so the screen says so and points at **Navigation** instead.

Every breakpoint is one click away — Desktop, Laptop, Tablet, Mobile — and so is
every language, because a header has a different design at each width and
different copy in each language.

Each part takes its own CSS and JavaScript, and can be A/B tested — a header test
runs on every page, so it reaches full traffic fast, and for the same reason it
makes the whole site uncacheable while it runs. The interface says so.

**Restore original** puts a part back to the markup the site was migrated with.
That is what makes the header safe to hand to a marketer: the worst case is one
click from being undone.

A page can opt out under its own **Settings** — a campaign landing page usually
should, since every link in a navigation bar is a way to leave before converting.

### Images

An image in the library has two things a filename does not: a **name** you can
change freely, and a **reference** pages point at.

```
stored in the page   <img src="/media/a/hero-home">
sent to the browser  <img src="/media/hero-home-9f2c1e.webp">
```

Because pages hold the reference, **replacing an image updates every page that
uses it** — one upload instead of hunting through nine pages for a hard-coded
URL, and without the ones nobody remembers keeping the old picture.

The indirection is resolved on the server, so a visitor still gets one request
for a content-hashed file that caches for a month. There is no redirect on the
hot path; `/media/a/<slug>` also resolves on its own, as a fallback for a
reference that escaped the render pass.

The library shows, for every image:

| | |
|---|---|
| **Where it is used** | Split into uses **by reference** (which follow a replacement) and **by filename** (which do not) |
| **Replace** | Keeps the reference. The previous file goes to history, and **Put back** undoes it |
| **Rename** | The old reference is kept as an alias, so nothing breaks and the tidy-up is optional |
| **Alt text** | Per language, described once here rather than retyped on every page |

Deleting an image that pages still use is refused, with the list of places, since
the alternative is a broken image on each of them.

The site was migrated with hard-coded filenames, so those uses start out pinned.
**Make it managed** gives an image a reference and repoints every occurrence
across pages, articles and the chrome at it — after which replacing the file is
enough. The seed names all 160 bundled images on first run.

Picking an image through the library — the picker in any block, or **Insert
image** in a code editor — stores the reference, so the managed path is the
default rather than the disciplined choice.

### Add-ins

Named snippets injected on every page: a chat widget, a consent banner, a
campaign pixel. Each has a name, a note, an on/off switch, an optional page
filter and its own A/B key.

Settings used to have three anonymous "global snippet" textareas. Nobody dared
touch them and nobody knew what was in them. The difference is not the
capability, it is that in two years somebody can tell what this one was for.

Those three fields are gone. Anything in them is migrated into named add-ins on
first boot — switched **on**, because they were running, and a migration that
silently disabled a consent banner would be a worse bug than the one it fixed.

### The blog's front page

`/{lang}/blog` reads the articles that exist. It used to be three authored
sections: a hero with nine hard-coded category pills, a featured card about a
webinar guide, and twelve article cards pointing at Unsplash photographs and,
mostly, at nothing. Publishing an article changed none of it, two of the cards
linked to articles that were never written, and the filter script filtered the
placeholders.

It is now one `blog_index` block, and three things about it were choices:

- **The filters are in the URL.** `?category=…&q=…&page=2` is resolved on the
  server, so a filtered blog is a real page: shareable, crawlable, and working
  with JavaScript off. The old version filtered by hiding DOM nodes, which is why
  page two did not exist and no filtered view had an address.
- **The pills come from the articles**, with a count each. A fixed list of
  categories is a list of promises — nine pills, of which two had anything behind
  them.
- **The lead article is the featured one, else the newest.** Never a hard-coded
  slug, which is how the old page came to link an article nobody wrote.

The promo card beside it is a slot an editor fills — a guide, an ebook — and
leaving its title empty gives the lead article the full width rather than a gap.

The page is exempt from `verify-live`, stated in `pages.registry.json` and printed
by the tool on every run: a body that reads the database cannot match a template
with twelve article cards in it, and that was the point. An exemption on the
record beats a page that quietly falls out of the suite.

### Component blocks speak more than one language

A component block's data used to be one value for the whole site, so a block
dropped onto a trilingual site said the same thing in all three. That is why the
blog index stayed a static page: there was no way to give it a French heading and
a German one.

A field marked `i18n` in its schema stores a map instead of a string, resolved for
the locale being rendered in the same pass that resolves image references and page
links. The editor gets a language switch per field, with the source language shown
underneath and the missing languages named — so an untranslated field is visible
in the CMS rather than discovered on the site.

### Blog articles

An article body is an ordered list of **sections**, not one HTML box. That
matters for one reason: the *Sommaire*. A contents list built by scanning
rendered markup for headings can only guess — it cannot know that this `h2` is a
chapter and that one is the label on a summary box. Here each section says
whether it belongs in the contents and under what name, so the list is a fact
about the article rather than an inference from it.

```
Heading      a chapter. In the contents by default.
Text         paragraphs and lists
Key points   the blue summary box. In the contents by default.
Image        a figure with a caption
Pull quote   emits Quotation structured data
Callout      a tip, an aside, a warning
Video        YouTube or any embed
Custom       your own HTML with Tailwind, and CSS scoped to the section
```

Drag to reorder, hide a section while you rewrite it, duplicate one. Anchors are
generated from the heading and de-duplicated, so two chapters called
*Conclusion* do not both answer to `#conclusion`.

#### The canvas

Beside the section list is the article, as the page. Add a *Key points* section
and the blue box appears; type in it and the box fills in; the contents list picks
the heading up. Before this the editor was a list of forms and writing an article
meant saving, looking, and coming back — the page builder has had a live canvas
from the beginning and the articles did not, which is why composing one felt like
writing code.

It is not a second renderer. The **unsaved** draft is posted to
`/cms/article-preview`, which pours it into the authored article template and
composes the document exactly as the published route does: real header, real
footer, real stylesheet, real scripts. Nothing is written anywhere — the draft
travels in the request and is gone with the response — so previewing cannot
publish half a paragraph on an article that is already live. Selecting a section
scrolls the page to it, and the scroll position survives a re-render, because
being returned to the top on every keystroke is worse than no canvas.

Articles imported as one block of HTML keep working — the contents list is then
derived from their headings, and **Split into sections** converts one into the
first section, losing nothing.

Three things the article template used to state and now reports honestly:

- the **breadcrumb** is `Home › Blog › Category › Title`, with the category
  linking to the filtered blog. It used to say *Collaboration* on every article,
  linking to an anchor that existed on no page.
- the **contents list** is the article's own chapters. It used to be the same six
  links everywhere, and it is now omitted entirely rather than shown empty.
- **related articles** come from the same category first, topped up with the most
  recent. They used to be three hand-written cards, two of them pointing at
  articles that were never written — which `verify-assets` had been reporting as
  broken links since the migration.

And one that was actively wrong. The template ended with an eighty-line
"Dynamic SEO" script that built the canonical URL, the OG tags and the JSON-LD in
the browser. Under the CMS it threw on its first statement — the element it
reaches for was lifted into the CMS-owned head years ago — so *everything after
that line never ran*, which is why the article template's own LinkedIn and X
buttons pointed at `#`. Had it run, the `@graph` it builds is hard-coded to the
article the template shipped with: every article published through the CMS would
have told search engines it was *The Power of Rainbow* by Marie Hillion, published
1 July 2026. It is gone, replaced by the four lines that set the share URLs, which
is the one thing there that genuinely needs the address bar.

### Articles are not pages

The Pages list excludes them. One migrated page *is* an article —
`blog-the-power-of-rainbow` is the authored article the template was taken from,
and it is also a BlogPost — and it appeared under Pages, so both screens claimed
to own the same thing and an editor who found it there got the markup instead of
the article. Articles are edited under **Blog**; that list is pages.
`?includeArticles=1` still returns everything, for the migration tools and for
anybody working out where an article's markup actually lives.

### Publishing

One flow, in the order the work happens: **Write → Configure → Search & sharing**,
then a bar along the bottom that always says the same four things — what state
this is in, whether anything is unsaved, how to look at it, and the one action
that moves it forward.

The primary button changes with the state, because the interesting question is
never "do you want to save" but "will people see this": *Publish*, *Publish
changes*, *Save draft*. Publishing with unsaved edits saves first, since
otherwise the button puts the *previous* version live.

The steps carry a count of what is unfinished, and the problems are stated as
consequences rather than rules — "no cover image: it is the hero, the card
thumbnail and the sharing image", not "field required".

### Seeing it before you publish

Character counters do not tell you what a link looks like. The **Search &
sharing** step renders the real thing, from the values the page will emit:

| | |
|---|---|
| **Tab** | A browser tab, which shows about 30 characters — not 60 |
| **Google** | ~60 of the title, ~155 of the description, with the path |
| **X** | The 1.91:1 card, so you can see what gets cropped |
| **WhatsApp** | The small square thumbnail in a real message bubble |
| **LinkedIn** | Which ignores the description on most cards |

Each one says what it would do differently — where Google will cut the title,
that WhatsApp's crop makes text inside an image unreadable, that a link with no
image gets markedly fewer clicks. The same previews sit in a page's SEO tab.

### The imported pages

The eighteen migrated pages are stored as the exact bytes they were authored
with, and `verify-live` proves the site still ships those bytes. In the builder
their **copy** is fully editable — that is what the string catalogue is for — and
they can be hidden, reordered and given anchors.

Changing their **structure** is a different matter, so it is an explicit choice
rather than a side effect: *Convert to a custom block* moves the markup into a
custom block, where it gains Tailwind, spacing controls and A/B variants. The
dialogue says plainly that the section leaves the byte-fidelity guarantee, and
the previous version stays in the page's history. Sections nobody converts keep
passing `verify-live` unchanged.

### On-page check

The SEO tab reads the **rendered page** rather than scoring the form you just
filled in — title and description length against what search results actually
show, H1 count, heading order, missing alt text, canonical, hreflang coverage,
JSON-LD validity, social image, thin copy. Every check is one you would act on.

### Whether leads are kept at all

Every form stores its submission before forwarding it, so an automation platform
being down does not cost a lead. That is the right default and it is not always
the right answer: a deployment whose forms feed a CRM that is already the system
of record does not want a second copy of every enquiry here, and one that does
not need the data should not be holding names, email addresses and IP addresses.

**Settings → Leads** turns it off, and off means **not written**, not hidden.
There is no copy to leak, to export, or to have to delete on request. Submissions
are still accepted and still forwarded, so nothing about the visitor's experience
or the integration changes. A retention period is the other half of the same
question and sits next to it; saving one deletes what is already older, and the
confirmation says how many — because "keep for 90 days" applied to two years of
leads is a destructive act and "Saved" is not an adequate description of it.

### The partner directory

1,130 partners behind the locator's map, and for a long time none of them: the
export lived at the repository root, the seed looked only in
`content-source/data/`, found nothing, and returned **silently**. A directory of
1,130 partners, a map with no pins, and nothing anywhere saying why. The seed now
looks in both places and logs a miss.

Two other things the map needed:

- **`hq` and `keywords` were read by the page and absent from the model.** The
  locator's three filter buttons are all/head-offices/subsidiaries and its map
  draws the two kinds differently; `keywords` is searched alongside the name. So
  editing any partner in the CMS *deleted both* — visible only as a pin in the
  wrong style. `raw` is now merged rather than rebuilt, so a field the CMS does
  not model survives an edit.
- **The basemap needed an API key.** CARTO's `light_all` tiles still arrive with
  HTTP 200 and every one of them is a grey square stamped "API KEY REQUIRED". No
  console error, no broken image, no failed request — just a map that looks like a
  placeholder, which is what it was. It is OpenStreetMap's own tiles now, and the
  URL is read from the page's translation branch (`mapTileUrl`), so a paid
  provider can be set from **Copy & languages** without a deploy.

**Import** takes the export as a JSON file or pasted text and upserts on `id`, so
loading the same file twice updates rather than duplicates. It describes the file
before writing anything — how many rows, how many countries, how many have
coordinates — because a directory that imports cleanly and has no coordinates is a
map with no pins on it, and that is worth knowing beforehand. *Replace the whole
directory* deletes what the file does not mention, and asks first.

Country names come from the export in English, inconsistently: `USA`, `MEXICO`,
`Utd.Arab.Emir.`. The locator prints them on every card and groups its filter by
them, so a French reader got a list of English names with two of them mangled.
`tools/build-countries.mjs` maps each spelling to an ISO 3166-1 code once and
takes the names from `Intl.DisplayNames` — the names a browser would use — and the
dataset endpoint translates them for the language the page was fetched from.

### Accented characters

The pages and the catalogues were authored with `&eacute;` rather than `é`: 1,673
of them in French alone. Everything is UTF-8 and has been since the migration, so
the escaping bought nothing and made the CMS hard to use — the copy editor showed
`L'&eacute;diteur fran&ccedil;ais`, the page builder labelled a block
"Footer: La prochaine conversation de votre &eacute;quipe m&eacute;rite", and
searching the strings for "équipe" matched nothing.

`npm run decode:entities` fixes both sides in one pass. Both, deliberately:
`verify-live` renders the authored template against the authored catalogue and
diffs, so decoding one side and not the other would make it fail on every page —
and it would be right to. The fidelity hashes are re-pinned afterwards. The
guarantee is not weakened; the baseline is corrected.

Four escapes are left alone because they are doing a job — `&amp; &lt; &gt;
&quot;` — and so is `&nbsp;`, because a non-breaking space is indistinguishable
from an ordinary one in a text box and an editor will eventually delete the thing
they cannot see. The catalogue *keys* are left too: they were minted from
entity-encoded text and read like `l-diteur-fran-ais-des`, and renaming them would
mean rewriting every `data-i18n` attribute in eighteen pages at the same instant.

### Redirects, and why each one exists

Changing a page's URL leaves a 301 behind automatically, because a rename without
one throws away whatever ranking and inbound links the old address had. The cost
is a list nobody understands: somebody opens the screen, finds
`/en/pricing → /en/tarifs`, cannot remember an English pricing page, and has no
way to tell whether deleting it breaks something.

So every row says **where it came from** — "tarifs was renamed", read back from
the note the automatic path writes — and **whether anything has followed it**.
`hits` existed and was never incremented, so the field was a permanent zero, which
is worse than absent: the one question anybody asks about a redirect is whether it
is still load-bearing. The frontend middleware now counts them, fire-and-forget, so
a visitor's redirect never waits on a counter.

*Followed: never* is the one that is safe to delete — as long as it has been in
place long enough to know. A redirect left over from a rename that was itself
undone points at a URL that was never public.

---

### The admin itself

| | |
|---|---|
| ![Overview](docs/screenshots/01-overview.png) | ![Pages](docs/screenshots/02-pages.png) |
| The overview: what is broken, what is unpublished, what came in | Every route, with landing pages and drafts marked |
| ![The visual editor](docs/screenshots/03-page-design.png) | ![History](docs/screenshots/20-page-history.png) |
| The builder — the canvas is the real page in an iframe | History: the way back out of a mistake |
| ![The form builder](docs/screenshots/10b-form-builder.png) | ![The link inspector](docs/screenshots/06-link-inspector.png) |
| The form builder: fields, the real markup with the site's own styles, and where submissions go | Click a button on the page and change where it points |
| ![Header and footer](docs/screenshots/06-chrome.png) | ![Dark](docs/screenshots/01-overview-dark.png) |
| One header and one footer, at a real device width | And the same thing in dark |


Built on Tailwind 4 and the shadcn/ui contract — Radix primitives for behaviour,
semantic colour tokens for the skin — in `apps/cms/src/components/ui/`. Every
screen imports from there and nothing else, which is what keeps twenty screens
looking like one product rather than twenty.

What that buys, concretely:

| | |
|---|---|
| **Light and dark** | Every colour is a token pair, so the theme switch is one class on the root. Follows the operating system by default |
| **⌘K** | Jump to any screen, page or article by name |
| **Real dialogues** | Confirmations say what will happen — "a restore point is written first, so this is recoverable" — rather than `localhost:8080 says:` |
| **Keyboard and screen readers** | Radix handles focus trapping, `aria-*` and roll-your-own-listbox bugs, which is most of what hand-built admin widgets get wrong |
| **No layout jump on save** | A refetch keeps the previous data on screen instead of unmounting behind a spinner |

`npm run ui:shots` photographs every screen in both themes into `artifacts/ui/`,
and CI keeps them as a build artefact — a visual regression is much easier to see
than to describe.

## Page types

Straight from `reco.md`:

- **Static** — structure in the codebase, content spliced in. Homepage,
  products, pricing. A/B testable at the section level.
- **Dynamic** — one template, content entirely from the database. Blog posts;
  publishing needs no deploy.
- **Hybrid** — an authored skeleton with database-driven slots. The blog index,
  the FAQ, the partner locator.

A page's type is metadata, not a code path: any block can go on any page.

---

## SEO

Everything is server-rendered — there is no client-side content on this site.

### URLs

One page, one URL per language. Each page has a shared path plus optional
per-language overrides, edited under its **URLs** tab:

```
/fr/tarifs        /en/pricing        /de/preise
/fr/blog/{slug}   /en/blog/{slug}    /de/blog/{slug}
```

- A visitor arriving on the untranslated path gets a **301** to the language's
  own path — never a second copy of the page competing with the first.
- Renaming a URL **writes the redirect for you**, and repoints anything that
  already pointed at the old path so no redirect chain builds up. Forgetting
  that redirect is the most expensive mistake a CMS can let you make, so it is
  not left to whoever edits next.
- `canonical`, `hreflang` and the sitemap are built from the same resolver, so
  they cannot disagree with each other.
- The blog's own segment is per language too, under **Settings → Languages**.

### Tags

- `canonical` is always the current locale's URL, never cross-locale.
- `hreflang` lists only the locales a page actually exists in; `x-default`
  points at English. A missing translation gets no entry rather than a
  misleading one.
- JSON-LD is generated per page type (Organization + WebSite on the homepage,
  SoftwareApplication on products, Blog on the index, Article on a post) plus a
  `BreadcrumbList` on every page, and can be extended or replaced from the CMS.
  Breadcrumb trails only list intermediate levels that are real pages — pointing
  a crawler at `/fr/products/` because something lives beneath it would point it
  at a 404.
- `?version=` campaign entry points emit `noindex, nofollow`, are excluded from
  the sitemap, and are disallowed in `robots.txt`.
- `sitemap.xml` covers every locale of every indexable page plus published
  articles, at their localized paths, with `xhtml:link` alternates.

---

## A/B testing

Variants are assigned in Astro middleware, **before** the page renders, and
stored in a cookie for the experiment's window. The HTML a visitor receives
already is their variant: no flash, no layout shift, no hydration mismatch, and
a crawler sees an ordinary page.

### Creating one asks two questions

Name, and what varies. That is all that is required.

It used to ask for a **key** as well — a slug matching `^[a-z0-9-]+$`, labelled
"it cannot change later". That is a database concern presented as a decision: the
interface generated it from the name anyway, and all asking achieved was a form
that could fail validation on a field nobody meant to touch. It is derived now,
and two tests with the same name get `-2` rather than a conflict about a field the
editor never filled in. It is still settable, behind a disclosure, for when a
report elsewhere already names one.

The **goal** is offered in the same dialogue rather than deferred, because a test
with no goal measures nothing and cannot be started — it was the thing everybody
had to come back for. The **hypothesis** is last and optional: it is the field
nobody fills in afterwards and the one that makes a finished test worth reading a
year later, so it is offered now and not demanded.

And when something *is* refused, the message says what. A validation failure sends
`[{path, message}, …]` and a duplicate key used to send the offending
`{field: value}` object; the toast rendered both with `join(', ')`, so creating a
test with an empty name produced **"Validation failed — [object Object],
[object Object]"** — alarming, and silent about the name being empty. Every shape
the API can send is now named, and an unrecognised one is dropped rather than
stringified: no detail at all beats a detail that reads like a crash. See
`apps/cms/src/lib/apiErrors.js`, and `tests/cms.test.mjs`, which exists so it
cannot come back.

Three scopes:

- **A block.** Any block, of any kind. A component block varies by *field
  override* — a variant states only what it changes, merged over the control, so
  testing one headline does not mean restating the whole hero. Authored and
  custom blocks vary by markup.
- **A whole page body.** Duplicate the page as arm B, change whatever you like,
  split the traffic. The arm has no URL of its own: its content is served at the
  control's address, so there is one canonical URL and nothing duplicate in the
  index. Arms are `noindex` and excluded from the sitemap. Only the body varies —
  the header and footer come from the shared chrome either way.
- **The header, the footer, or an add-in.** Site-wide, so the test reaches full
  traffic in a fraction of the time a single page's would.

Two modes:

- **cookie** — weighted split, persisted (14 days by default), for real tests.
- **param** — `?version=b` for ad campaigns. Session-scoped, never indexed.

An assignment is only *persisted*, and shared caching only suppressed, for the
experiments a page actually used. Otherwise a test on one page would cookie every
visitor on every page and force the whole site to be served `private`.

The assignment is exposed as `window.__CMS__.variants`, and a page-level arm as
`window.__CMS__.page.variant`, so analytics and session recording can be
filtered by variant.

---

## Integrations

The forms used to post straight from the visitor's browser to the automation
platform that runs the lead flow. Three things followed, none of them good: the
platform and every webhook path were readable in the page source of a public
marketing site; the endpoints could be hammered without ever loading the site;
and the platform's raw reply — internal ids, execution URLs, error text — was
handed to anyone with the network tab open.

Now the browser posts to a path on this origin and the server makes the call:

```
before   fetch('https://<automation-host>/webhook/livre-blanc-lead', …)
after    fetch('/api/v1/hooks/livre-blanc-lead', …)
```

The substitution happens **at render time**, from the mapping in the CMS, so the
authored templates still say what they always said and nothing had to be
rewritten by hand. It is the same class of transformation as the locale prefix
the renderer already puts on internal links.

What the browser gets back is the smallest true thing:

- `ok` — whether it worked, and nothing else. The default.
- `fields` — that, plus an allowlist of keys named on the integration. The
  booking calendar needs `slots`; it does not need the execution URL.

There is no pass-everything mode.

Other properties worth knowing:

- **Nothing is lost.** A submission is stored under **Leads** *before* the
  outbound call, so an automation that is down, mid-deploy or misconfigured
  costs a notification, not a lead.
- **Health is visible.** Call and failure counts, last status and last error sit
  on the Integrations screen, so "is this form working?" does not mean logging
  into the automation tool. Failures surface on the dashboard.
- **Internal addresses are refused.** An endpoint must be a public URL — private
  ranges, loopback and the compose service names are rejected, so this cannot be
  turned into a probe for the network the API sits in.
- **The upstream URL is never returned by a public route.** The admin screen
  shows the host and a path hint, never the full URL. The renderer reads the map
  over a server-only endpoint gated by the shared secret.
- `content-source/integrations.json` seeds the mapping and lets the verification
  tools reproduce the substitution without holding any credential.

### What each endpoint actually wants

**Test** on the Integrations screen does not send a plausible submission — it
sends a deliberately invalid one, and that is what makes it safe. Every one of
these endpoints refuses an unusable payload by naming what was wrong, so a wrong
method comes back as *did you mean to make a GET request*, an inactive workflow as
*the workflow must be active*, and an empty body as the list of fields it
required. No lead is created and no follow-up is triggered.

The answer is stored on the integration, which is what lets the form builder say
"this form is missing `companySize`" before the form ever goes on a page. Run
against the live platform, this is what came back:

| Endpoint | Method | Required fields | Verdict |
|---|---|---|---|
| `livre-blanc-lead` | POST | `firstName` `lastName` `email` `company` | working |
| `demo-request-lead` | POST | `firstName` `lastName` `email` `company` `companySize` `country` `consent` | working |
| `booking` | POST | `email` `first_name` `last_name` `datetime` | working |
| `booking-change` | POST | `ref` `token` | working |
| `booking-confirm` | POST | — | working |
| `booking-cancel` | POST | — | working |
| `booking-lookup` | **GET**, as a query string | `ref` `token` | working |
| `availability` | **GET** | — | working |
| `unsubscribe` | POST | — | **the workflow is not active** |
| `unsubscribe-check` | POST | — | **the workflow is not active** |

Two of those methods were wrong in the seed data and are fixed: `availability`
and `booking-lookup` are registered as GET, and the proxy was sending them a
POST with a JSON body. A GET integration now carries a `queryFields` list and the
proxy builds the query string instead — see `routes/hooks.js`.

The last two rows are not something the CMS can fix. The workflows behind those
paths are not active on the automation platform, so the CMS reports exactly that
rather than a bare 404: the fix is on the other side, and saying so is more useful
than a status code.

Note the naming: `firstName` in one workflow, `first_name` in another. That is
why a form field's wire name is a field of its own rather than derived from its
label — the contract is not negotiable and the wording on the page is.

## Caching

Reads go through Redis, keyed by a site revision number. Publishing anything
increments the revision, which retires the entire previous generation in one
write — no key hunting, no stale fragments. The API then calls the frontend's
`/cms/revalidate` webhook so it drops its own in-process copies.

If Redis is unreachable the API keeps serving from MongoDB, and if the API is
unreachable the frontend serves its last known copy. A slower marketing site
beats a missing one.

---

## Repository layout

```
apps/
  api/          content API and CMS backend
    src/routes/admin/    one router per thing it manages
    src/services/        history (restore points), publishing, content, catalogue
  web/          Astro frontend  (public/ holds css, js, images, video)
    src/components/blocks/   one Astro component per block type
  cms/          React admin
    src/components/ui/       the shadcn/ui component library every screen uses
    src/pages/               one file per screen
packages/
  core/         the shared scanner, renderer, slicer, SEO builders and the three
                indirections: assets.js, links.js, endpoints.js
                copy.js      what a fragment's marked strings are, and what
                             changing its markup did to them
                i18nData.js  a component block's own copy, per language
content-source/ the authored templates, catalogues and seed data
                data/        the partner directory and its country names
tools/          verification and migration scripts
  lib/env.mjs   how every tool reads .env
infra/nginx/    gateway configuration
docs/           architecture, operations and content-model notes
```

## Tools

Read-only. Safe anywhere, including production:

| Command | What it proves |
|---|---|
| `npm run lint` | No unused imports, no accidental globals, no half-finished refactor |
| `npm test` | Unit tests, fidelity, assets and the API integration suite |
| `npm run verify` | Slicing and composition reproduce every page body, offline |
| `npm run verify:live -- [url]` | A running server still ships the authored bytes |
| `npm run verify:chrome -- [url]` | One header and one footer on every page in every language, and no automation endpoint in the browser |
| `npm run verify:assets -- [url]` | Every referenced image, script and link resolves |
| `npm run verify:menu -- [url]` | The CMS-driven megamenu renders identically to the shipped one |
| `npm run ui:shots -- [url]` | Photographs every admin screen, light and dark, into `artifacts/ui/` |

Writes to the database, and undoes it. Development and staging only — both refuse
to run without `--confirm`:

| Command | What it proves |
|---|---|
| `npm run verify:editor -- [url] --confirm` | The builder, localized URLs, A/B testing, the header and footer, the integration proxy and article sections — 160 checks |
| `npm run verify:ui -- [url] --confirm` | Every editing flow, driven by a real browser: landing pages, forms, the blog on a page, link references, restore, undo, trash — 43 checks |
| `npm run verify:forms -- [url] --confirm` | The form builder and the link inspector, in a real browser: that the preview is styled by the site rather than the admin, that a clashing field name is refused before a save, that clicking a button on the page repoints it, that a folded panel stays folded, and that a link inside hand-written markup is spliced rather than re-serialised — 40 checks |

Content:

| Command | What it does |
|---|---|
| `npm run seed` | Loads the authored site into MongoDB (re-runnable) |
| `npm run seed -- --only=forms,partners` | Runs just those steps |
| `npm run seed:reset` | Drops the content collections first |
| `node tools/build-nav-seed.mjs` | Regenerates the navigation seed from the shipped menu |
| `node tools/build-media-index.mjs` | Regenerates the bundled-media manifest |
| `npm run build:countries` | Regenerates the partner directory's country names, in every language |

`npm run seed` is safe to re-run: it updates templates whose source file
changed and leaves anything edited in the CMS alone. `--force` overrides that.

`--only=` exists because every step being idempotent is not the same as every
step being wanted. The four site forms went missing from a working database and
the only offered way to restore them was a seed that also walks eighteen pages
and 1,521 strings — so, reasonably, nobody ran it: the forms stayed missing, the
form blocks rendered an HTML comment, and the dashboard reported four failing
integrations for months. The step names are `settings pages strings navigation
chrome snippets integrations forms blog media partners`, and an unknown one is
refused with the list rather than silently doing nothing.

One-off migrations. Each takes the source files and the database together, so the
fidelity guarantee holds across the change rather than being spent on it, and each
is re-runnable — a second pass finds nothing:

| Command | What it does |
|---|---|
| `npm run decode:entities -- --confirm` | `&eacute;` becomes `é`, in the pages, the catalogues and the database |
| `npm run strip:dev-scripts -- --confirm` | Removes the live-reload tag the site was built with, and the empty blocks it left behind |
| `npm run strip:legacy-seo -- --confirm` | Removes the article template's in-page SEO script, keeping its share links |
| `npm run blog:index -- --confirm` | Turns the static blog page into the dynamic index |
| `npm run fix:map-tiles -- --confirm` | Points the partner map at a basemap that does not need an API key |
| `npm run routes:apply -- --confirm` | Applies `routes.i18n.json`, writing a 301 for every path that changes |

Each prints what it would do first; `--confirm` applies it. `--source-only`
skips the database, for a checkout with no server running. After any of them:

```bash
npm run verify -- --write-hashes   # re-pin the fidelity baseline
npm run verify:live                # against a running server
```

Against a local `npm run dev` the three services are on separate ports, so the
tools take both:

```bash
npm run verify:live   -- http://localhost:3000
npm run verify:ui     -- http://localhost:5173 --confirm
npm run verify:forms  -- http://localhost:5173 --confirm
npm run verify:editor -- http://localhost:4000 --site http://localhost:3000 --confirm
```

Behind the gateway one origin serves everything, and one URL is enough.

---

## Production notes

- Change `JWT_SECRET`, `PREVIEW_SECRET`, `REVALIDATE_SECRET`, the Mongo
  password and the bootstrap administrator password before exposing anything.
- Put TLS in front of the gateway and set `SITE_URL` to the public origin —
  canonical URLs, OG tags and the sitemap are all built from it.
- `SECURE_COOKIES=true` once you are on HTTPS.
- Uploads live on the `uploads` volume; back it up with the database.
- `GET /readyz` on the API reports MongoDB, Redis and the current revision.

## Licence

Proprietary — ALE International.
