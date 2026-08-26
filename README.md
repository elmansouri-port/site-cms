# Rainbow by ALE — site & CMS

The Rainbow marketing site, moved from hand-written static HTML into a
database-backed CMS **without changing a single byte of what a visitor
receives**.

Every page of the original site is served by an Astro 7 server-rendered
frontend, composed from content stored in MongoDB, cached in Redis and edited
through a purpose-built admin. A verification tool proves the equivalence on
every run:

```
$ npm run verify
133 checks, 0 failure(s)

$ node tools/verify-live.mjs http://localhost:8080
54 page renders compared against the authored source, 0 difference(s)
```

---

## What this is

| | |
|---|---|
| **Frontend** | Astro 7, SSR on the Node adapter — one route file serves every page in every language |
| **Content API** | Express 5 + Mongoose 9, JWT auth, role-based access, Redis read-through cache |
| **CMS** | React 19 + Vite 8 single-page admin: pages, blocks, copy, media, blog, navigation, leads, A/B tests |
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
| Navigation labels, links, megamenu zones | The megamenu's layout and behaviour |
| Blog posts, media, partner directory | The article template's shape |
| Global and per-page code snippets | |
| A/B experiments and their variants | |

---

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

- `canonical` is always the current locale's URL, never cross-locale.
- `hreflang` lists only the locales a page actually exists in; `x-default`
  points at English. A missing translation gets no entry rather than a
  misleading one.
- JSON-LD is generated per page type (Organization + WebSite on the homepage,
  SoftwareApplication on products, Blog on the index, Article + BreadcrumbList
  on a post) and can be extended or replaced from the CMS.
- `?version=` campaign entry points emit `noindex, nofollow`, are excluded from
  the sitemap, and are disallowed in `robots.txt`.
- `sitemap.xml` covers every locale of every indexable page plus published
  articles, with `xhtml:link` alternates.

---

## A/B testing

Variants are assigned in Astro middleware, **before** the page renders, and
stored in a cookie for the experiment's window. The HTML a visitor receives
already is their variant: no flash, no layout shift, no hydration mismatch, and
a crawler sees an ordinary page.

Two modes:

- **cookie** — weighted split, persisted (14 days by default), for real tests.
- **param** — `?version=b` for ad campaigns. Session-scoped, never indexed.

The assignment is exposed as `window.__CMS__.variants` so analytics and session
recording can be filtered by variant.

---

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
  web/          Astro frontend  (public/ holds css, js, images, video)
  cms/          React admin
packages/
  core/         the shared scanner, renderer, slicer and SEO builders
content-source/ the authored templates, catalogues and seed data
tools/          verification and migration scripts
infra/nginx/    gateway configuration
docs/           architecture, operations and content-model notes
```

## Tools

| Command | What it does |
|---|---|
| `npm run verify` | Proves slicing and composition reproduce every page body |
| `node tools/verify-live.mjs [url]` | Diffs a running server against the authored source |
| `node tools/verify-megamenu.mjs` | Proves the CMS-driven menu renders identically |
| `node tools/verify-assets.mjs [url]` | Proves every referenced asset exists and loads |
| `npm run seed` | Loads the authored site into MongoDB (re-runnable) |
| `npm run seed:reset` | Drops the content collections first |
| `node tools/build-nav-seed.mjs` | Regenerates the navigation seed from the shipped menu |
| `node tools/build-media-index.mjs` | Regenerates the bundled-media manifest |

`npm run seed` is safe to re-run: it updates templates whose source file
changed and leaves anything edited in the CMS alone. `--force` overrides that.

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
