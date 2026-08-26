/*
 * assets.js — images referenced by name instead of by filename.
 *
 * A page that says `<img src="/images/collaboration_hero.jpg">` has pinned
 * itself to a file. Changing that photo then means finding every page that
 * mentions it — and the ones nobody remembers keep the old one. That is the
 * failure mode this removes.
 *
 * A managed asset has a stable reference, `/media/a/<slug>`, and the renderer
 * resolves it to whatever file the asset currently holds:
 *
 *   stored in the page   <img src="/media/a/hero-home">
 *   sent to the browser  <img src="/media/hero-home-9f2c1e.webp">
 *
 * The indirection is resolved on the server, not by a redirect, so a visitor
 * still gets one request for a content-hashed file that can be cached for a
 * year. Replacing the asset bumps the site revision, every cached page
 * re-renders, and the new file appears everywhere it is used at once.
 *
 * The same shape as endpoints.js on purpose: a data map and an exact string
 * replacement. Nothing is parsed, nothing is inferred from the URL.
 */

/** The reference a page stores for an asset. */
export const ASSET_PREFIX = '/media/a/';

export function assetRef(slug) {
  return `${ASSET_PREFIX}${slug}`;
}

/**
 * Resolve every asset reference in a piece of markup to its current file.
 *
 * `assets` is `[{ slug, url, aliases }]`. Longest reference first, so an asset
 * called `hero` cannot eat the prefix of `hero-wide` and leave a dangling
 * suffix. An unknown slug is left exactly as written — it then hits the API's
 * own `/media/a/:slug` route, which is the fallback for a reference that
 * outlived its asset.
 */
export function resolveAssets(html, assets) {
  if (!html || !assets?.length) return html;

  const pairs = [];
  for (const asset of assets) {
    if (!asset?.url) continue;
    for (const slug of [asset.slug, ...(asset.aliases || [])]) {
      if (slug) pairs.push([assetRef(slug), asset.url]);
    }
  }
  pairs.sort((a, b) => b[0].length - a[0].length);

  let out = html;
  for (const [ref, url] of pairs) {
    if (!out.includes(ref)) continue;
    out = out.split(ref).join(url);
  }
  return out;
}

/**
 * The same resolution, over a block's data rather than its markup.
 *
 * A component block keeps its image in a field (`data.image`), not in HTML, so
 * it never passes through the renderer's string pass. Without this, a hero
 * picked from the library would be pinned to a filename while the same image
 * inside a text block stayed managed — the kind of half-working that is worse
 * than not having the feature.
 *
 * Walks strings, arrays and plain objects. Anything else is returned untouched.
 */
export function resolveAssetsDeep(value, assets) {
  if (!assets?.length || value == null) return value;

  if (typeof value === 'string') {
    return value.includes(ASSET_PREFIX) ? resolveAssets(value, assets) : value;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const resolved = resolveAssetsDeep(item, assets);
      if (resolved !== item) changed = true;
      return resolved;
    });
    return changed ? next : value;
  }
  if (typeof value === 'object' && value.constructor === Object) {
    let changed = false;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      const resolved = resolveAssetsDeep(item, assets);
      if (resolved !== item) changed = true;
      next[key] = resolved;
    }
    return changed ? next : value;
  }
  return value;
}

/** Which asset references appear in a piece of markup. */
export function assetsIn(html) {
  const source = String(html || '');
  const found = new Set();
  const pattern = new RegExp(`${ASSET_PREFIX.replace(/\//g, '\\/')}([a-z0-9][a-z0-9-]*)`, 'gi');
  let match;
  while ((match = pattern.exec(source)) !== null) found.add(match[1].toLowerCase());
  return [...found];
}
