/*
 * links.js — link to a page by name instead of by path.
 *
 * The same failure mode as a hard-coded image filename, one step worse. A block
 * whose button says `href="/fr/tarifs"` has pinned itself to three things at
 * once: that path, that language, and that path never changing. All three break
 * in ordinary use —
 *
 *   - the German page is at `/de/preise`, so a French path on a German render
 *     sends a German visitor to a 301 at best and the wrong language at worst;
 *   - renaming the pricing page writes a redirect, so the button still works,
 *     but every button pointing at the old path now costs a hop;
 *   - a page moved under a new parent leaves every hand-typed link behind.
 *
 * So a link is stored as a reference and resolved at render time:
 *
 *   stored in the block   href="page:tarifs"
 *   served to a German    href="/de/preise"
 *   served to a French    href="/fr/tarifs"
 *
 * Deliberately the same shape as assets.js and endpoints.js: a data map and an
 * exact string replacement, nothing parsed and nothing inferred. An unresolved
 * reference is left as written rather than emitted as a broken path — it shows
 * up in `verify-assets` as a link to nowhere, which is what it is.
 */

export const PAGE_REF = 'page:';
export const POST_REF = 'post:';

/** The reference a block stores for a page. */
export const pageRef = (key) => `${PAGE_REF}${key}`;
export const postRef = (slug) => `${POST_REF}${slug}`;

export const isRef = (value) => typeof value === 'string'
  && (value.startsWith(PAGE_REF) || value.startsWith(POST_REF));

/**
 * Build the resolution map for one locale.
 *
 * `pages` is the route index's page list — `{ key, route, routes, locales }` —
 * and `routeFor` is passed in rather than imported so this module stays free of
 * the SEO helpers and can be tested on plain data.
 */
export function linkTargets({ pages = [], posts = [], locale, blogSegment = 'blog', routeFor }) {
  const map = new Map();

  for (const page of pages) {
    if (!page?.key) continue;
    // A page that does not exist in this locale has no URL in it. Leaving the
    // reference unresolved is honest; inventing a path would be a 404 with a
    // confident-looking href.
    if (page.locales?.length && !page.locales.includes(locale)) continue;
    const route = routeFor ? routeFor(page, locale) : page.route || '';
    map.set(pageRef(page.key), `/${locale}${route ? `/${route}` : ''}`);
  }

  for (const post of posts) {
    if (!post?.slug) continue;
    if (post.locale && post.locale !== locale) continue;
    map.set(postRef(post.slug), `/${locale}/${blogSegment}/${post.slug}`);
  }

  return map;
}

/**
 * Build the thumbnail map for one locale: what image a `page:` or `post:`
 * reference's own cover image is, for anything that wants to show a link as a
 * card rather than a row — the megamenu's showcase link, say — without every
 * caller having to know where a cover image lives on a page versus a post.
 */
export function imageTargets({ pages = [], posts = [], locale }) {
  const map = new Map();

  for (const page of pages) {
    if (!page?.key) continue;
    const image = page.meta?.[locale]?.image;
    if (image) map.set(pageRef(page.key), image);
  }

  for (const post of posts) {
    if (!post?.slug) continue;
    if (post.locale && post.locale !== locale) continue;
    if (post.coverImage) map.set(postRef(post.slug), post.coverImage);
  }

  return map;
}

/**
 * Replace every reference in a piece of markup with the path it resolves to.
 *
 * Longest reference first, so `page:products` cannot eat the prefix of
 * `page:products-overview` and leave a dangling suffix — the same rule, for the
 * same reason, as in assets.js.
 */
export function resolveLinks(html, targets) {
  if (!html || !targets?.size) return html;
  if (!html.includes(PAGE_REF) && !html.includes(POST_REF)) return html;

  let out = html;
  for (const [ref, path] of [...targets].sort((a, b) => b[0].length - a[0].length)) {
    if (!out.includes(ref)) continue;
    out = out.split(ref).join(path);
  }
  return out;
}

/**
 * The same resolution over a block's data rather than its markup.
 *
 * A component block keeps its links in fields (`data.primaryHref`), which never
 * pass through the markup renderer. Without this, a hero's button would be
 * pinned to a path while the same link inside a text block stayed managed — the
 * kind of half-working that is worse than not having the feature.
 */
export function resolveLinksDeep(value, targets) {
  if (!targets?.size || value == null) return value;

  if (typeof value === 'string') {
    /*
     * Every string, not only the ones that *are* a reference.
     *
     * `primaryHref` holds a bare `page:tarifs`, but a block's HTML-ish fields —
     * a form's consent line, a callout's body, a custom block's markup — hold a
     * reference *inside* an anchor. Gating on "starts with page:" left those
     * unresolved, so a link written in the CMS's own link picker rendered as a
     * literal `href="page:politique"` on the live page. `resolveLinks` returns
     * the string untouched when neither prefix appears, so this costs one
     * `includes` per string.
     */
    return resolveLinks(value, targets);
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const resolved = resolveLinksDeep(item, targets);
      if (resolved !== item) changed = true;
      return resolved;
    });
    return changed ? next : value;
  }
  if (typeof value === 'object' && value.constructor === Object) {
    let changed = false;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      const resolved = resolveLinksDeep(item, targets);
      if (resolved !== item) changed = true;
      next[key] = resolved;
    }
    return changed ? next : value;
  }
  return value;
}

/** Which references appear in a value, for reporting the ones that resolve to nothing. */
export function refsIn(value, found = new Set()) {
  if (typeof value === 'string') {
    if (isRef(value)) found.add(value);
    else {
      for (const match of String(value).matchAll(/(?:page|post):[a-z0-9][a-z0-9\-/]*/gi)) {
        found.add(match[0]);
      }
    }
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) refsIn(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) refsIn(item, found);
  }
  return found;
}
