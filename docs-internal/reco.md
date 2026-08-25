# SaaS Marketing Website  General Recommendations

**Version:** 3.0
**Status:** Reference document

---

## 1. Project Overview

A multi-language, SEO-first SaaS marketing website that separates static editorial pages from database-driven content, with a hybrid category that combines both.

Core capabilities:

- Three distinct page types: Static, Dynamic, and Hybrid  each with a clear content ownership model
- Server-Side Rendering (SSR) for full search-engine readability
- Section-level A/B testing with cookie-persisted variant assignment
- Multi-language support with correct canonical and hreflang handling
- Automatic JSON-LD generation per page type with manual override capability
- Analytics (e.g. Matomo) + session recording (e.g. Hotjar)
- Editor-friendly admin interface for managing dynamic content

---

## 2. Page Type Model

All pages belong to one of three types. The type determines where the content comes from, how it is updated, and whether A/B testing applies.

### 2.1 Static Pages

Content and structure are **hardcoded in the frontend codebase**. No database involvement at render time. Changes require a code deployment.

- A/B testing can be applied at the section level
- Ad-variant entry points (`?version=`) are configured here
- Right choice for pages whose structure is owned by the dev/design team and changes infrequently
- **Examples:** Homepage, Products, Pricing, Campaign landing pages

### 2.2 Dynamic Pages

Structure is fixed (a single page template). **Content is fully loaded from the database** at render time. Editors control everything through the CMS.

- The page template never changes per post  only the content does
- Content is an ordered array of typed section blocks stored in the database
- New posts go live without any code change or deployment
- A/B testing does not apply  content is fully editor-managed
- **Examples:** Blog posts, Documentation articles, Changelog entries

### 2.3 Hybrid Pages

Pages with a **predictable structural skeleton** that rarely changes, but containing sections whose content should be editable without a deployment.

- **Static slots:** coded directly in the template  layout, headers, CTAs owned by the dev team
- **Dynamic slots:** one or more areas that load their content from the database  testimonials, feature lists, partner logos, pricing tiers
- A/B testing applies to both static and dynamic slots independently
- The split is explicit in the template  no ambiguity at runtime
- **Examples:** About page (static hero + dynamic team members from DB), Features page (static layout + dynamic feature cards)

### 2.4 Summary

| Page Type | Content Source | Update Path | A/B Eligible | Examples |
|---|---|---|---|---|
| Static | Codebase | Code deploy | Yes  section level | Homepage, Products, Pricing |
| Dynamic | Database (full) | CMS publish | No | Blog posts, Docs |
| Hybrid | Code + DB mix | Mixed | Yes  both slots | About, Features |

---

## 3. A/B Testing

A/B testing is kept lightweight. Two mechanisms are available; the developer picks whichever fits the experiment.

### 3.1 Cookie-Based Variant Assignment

A variant is assigned once per visitor at **middleware level**, before the page renders server-side. The same variant is served on every subsequent visit until the cookie expires  no visible layout shift, no hydration mismatch.

- Assignment runs in server middleware, not in client JavaScript
- Cookie TTL: 14 days, `SameSite=Lax`
- The rendered HTML always matches the assigned variant

### 3.2 URL Parameter Variants (Ad Campaigns)

A named variant is activated by a URL parameter on entry (e.g. from a paid campaign). These pages are **never indexed**.

- Variant is determined by the URL parameter value, not a cookie
- Page must emit `noindex, nofollow` when the parameter is present
- Must be excluded from sitemap and disallowed in `robots.txt`
- Session-scoped  not persisted

### 3.3 Scope

A/B testing applies at the **section level** on Static and Hybrid pages. The developer defines which sections participate in an experiment and builds the variant components. Dynamic pages do not participate  their content is fully editor-managed.

### 3.4 Analytics Reporting

Each assigned variant is pushed to analytics as a custom dimension and to session recording tools via user identification. This enables filtering session recordings and conversion funnels by variant without additional tooling.

---

## 4. Multi-Language Architecture

### 4.1 URL Structure

- Locale prefix is **always present**  no ambiguous locale-less routes
- Root `/` redirects to browser-detected locale, fallback to `en`
- **Example:**
  - `/en/` → Homepage EN
  - `/fr/` → Homepage FR
  - `/de/blog/` → Blog index DE
  - `/fr/blog/mon-article` → Blog post FR

### 4.2 Canonical & hreflang Rules

- `canonical` = the current locale's URL, never cross-locale
- `x-default` = always the EN version
- If a translation does not exist for a locale, **omit that locale's hreflang entry**  never point to another locale as a fallback
- hreflang is built server-side from the `translations` object returned by the API  one API call, no extra requests

### 4.3 Adding a New Locale

1. Add locale code to the locales config
2. Create translation files for all UI strings
3. Add the locale as an option in the CMS
4. Update the metadata factory and hreflang helper to include the new locale
5. Update sitemap for static pages
6. In the CMS, create translated versions of existing posts with the new locale slug

---

## 5. SEO Architecture

### 5.1 Metadata

Every page exports a metadata-generation function. Required fields: `title`, `description`, `canonical URL`, `alternate language links`. Pages served with the `?version=` parameter must emit `noindex, nofollow`.

### 5.2 JSON-LD  Auto Generation

| Page | Auto JSON-LD Types |
|---|---|
| Homepage | `Organization` + `WebSite` + `SiteLinksSearchBox` |
| Products | `SoftwareApplication` |
| Blog index | `Blog` |
| Blog post | `Article` + `BreadcrumbList` |

### 5.3 JSON-LD  Manual Override

Each blog post has two fields in the `seo` object:

- `jsonLdOverride`  edited via the CMS code editor. When populated, injected alongside the auto-generated JSON-LD.
- `replaceAutoLd`  boolean. When `true`, the manual JSON-LD replaces the auto-generated one entirely.

JSON-LD is always **server-rendered**  never injected via client-side JavaScript.

### 5.4 Sitemap

Covers all locales × all page types. Generated server-side. Must never include `?version=` URLs.

### 5.5 Robots

```
Disallow: /api/
Disallow: /admin/
Disallow: /*?version=*
```

---

## 6. Rendering Strategy

| Page | Strategy | Reason |
|---|---|---|
| Static pages (Homepage, Products…) | Full SSR | A/B cookies and `?version=` are per-request |
| Blog index | ISR  periodic revalidation | Stable list; CDN cache appropriate |
| Blog post | ISR + on-demand webhook revalidation | Stable; purges on CMS publish |
| Hybrid pages | Full SSR or ISR per slot | Developer decides per page based on content volatility |

Hard rules:

- No client-side rendering for above-the-fold or SEO-critical content
- A/B variants resolved entirely server-side  never client-injected
- All images have explicit dimensions to prevent CLS
- Third-party scripts (analytics, session recording) loaded after interactive  never blocking

---

## 7. Admin Panel  CMS

The CMS is used **purely as an editor UI**. It does not serve any frontend pages. It connects directly to the same database instance as the Content API.

**What the CMS does:**

- Provides a clean interface for editors to create and publish content
- Manages the section block array per locale
- Handles auth, roles, and media management
- Fires a webhook on publish to trigger ISR revalidation

**What the CMS does NOT do:**

- Does not serve public-facing pages
- Does not replace or wrap the Content API
- Is not the API the frontend calls

**Webhook on publish:**

- Trigger: on publish status change
- Target: revalidation endpoint
- Payload: `{ locale, slug }`
- Auth: secret header

---

## 8. Section System

### 8.1 Principles

- Every section is a self-contained component  no global state, no side effects
- Sections receive a `locale` input and handle their own string lookups
- Sections are unaware of whether they appear on a static, dynamic, or hybrid page
- A/B variant selection happens above the section  components are pure

### 8.2 Section Registry

A central registry maps string keys to components. This is what allows dynamic pages to reference components by a name stored in the database.

**Adding a custom section to a blog post:**

1. Build the component under a dedicated sections directory
2. Register it in the registry with a key string
3. In the CMS, add a `customSection` block to the post and set `componentKey` to that key
4. Done  no API change, no DB migration

### 8.3 Section Renderer

The section renderer component dispatches incoming block objects to the correct component. For unknown `componentKey` values it logs a warning and renders nothing  the page never crashes.

---

## 9. Content Snippet Injectors

### 9.1 Global Code Snippets

Add three fields in the CMS global settings:

- `global_head_snippet`
- `global_body_snippet`
- `global_footer_snippet`

Each is a textarea accepting arbitrary HTML. Inject them in the site layout in the `<head>`, before `</body>`, and at the end of `<body>` respectively.

These fields will be used for: tracking scripts, canonical tags, global meta tags, and JSON-LD structured data. Do not build individual CMS fields per meta tag type  the textarea approach is intentional.

### 9.2 Per-Page Code Snippets

Add three fields on each individual page entry in the CMS:

- `page_head_snippet`
- `page_body_snippet`
- `page_footer_snippet`

Inject them in the same zones as global snippets, **after** the global ones.

### 9.3 OpenGraph Per-Page Fields

Add the following optional fields to each page entry in the CMS:

- `og_title`
- `og_description`
- `og_image` (media upload)

Rules:

- Only render a tag if the field has a value  do not output empty `content=""` attributes.
- `og_image` must expose the absolute URL of the uploaded asset.
- If any field is empty, fall back to the global default OG values defined in the CMS global settings (add `default_og_title`, `default_og_description`, `default_og_image` there as well).

---

## 10. Navbar & Megamenu

### 10.1 Navbar Ordering

The navbar items are stored in the CMS with a user-defined order (via drag-and-drop). The frontend must respect this order. The drag-and-drop handler in the CMS must persist the new order to the database on save.

### 10.2 Megamenu Layout with Optional Zones

Each navbar item can have a megamenu. The megamenu has three zones:

- `main`  left side, always required
- `features`  right side, optional
- `footer`  bottom, optional

Rules:

- If `features` is empty/null, do not render its container. The `main` zone must expand to fill the full width.
- If `footer` is empty/null, do not render its container. No residual spacing, border, or margin should remain.
- Use flexbox so zones fill available space based on what is present.
- Corners and edges must remain visually clean in all four combinations: main only / main + features / main + footer / main + features + footer.

---

## 11. Video Thumbnails

Add an optional `thumbnail` image field to every video component/block in the CMS.

Rules:

- If a thumbnail is provided, display it as a placeholder over the video until the video is fully loaded.
- If no thumbnail is provided, fall back to the current default behavior.
- This applies to all video blocks across the CMS (inline videos, hero videos, etc.).

---

## 12. General Quality Rules

- All snippet fields must be injected as functional HTML  never render snippet content as text. Validate by checking the SSR HTML output  tags must appear verbatim in the correct position.
- No `useEffect` for above-the-fold or SEO-critical content
- All images must have explicit `width` and `height` attributes to prevent Cumulative Layout Shift
- Third-party scripts must be loaded asynchronously and after the page is interactive
- All pages must be accessible via SSR  no client-side-only rendering for SEO-critical content
