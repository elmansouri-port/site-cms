/*
 * i18nData.js — a component block's own copy, in every language.
 *
 * The migrated pages get their translations from the string catalogue, spliced
 * over marked ranges in the authored markup. A component block has no markup to
 * mark: its copy lives in `data`, and `data` was one value for the whole site.
 * So a block dropped onto a trilingual site said the same thing in all three
 * languages, and the only way round it was not to use component blocks — which
 * is why the blog index was still a static page with hard-coded article cards.
 *
 * A field is translated by storing a map instead of a string:
 *
 *   "title": "Blog Rainbow"                                  one language
 *   "title": { "__i18n": true, "fr": "Blog Rainbow",
 *              "en": "Rainbow Blog", "de": "Rainbow Blog" }   three
 *
 * The marker is explicit rather than inferred. A block's data legitimately holds
 * objects — a promo card, a layout, a form's field list — and guessing that
 * `{fr: …}` means a translation would eventually collapse somebody's data that
 * happened to have a two-letter key. `__i18n` cannot happen by accident.
 *
 * Resolution happens once per render, in the same pass that resolves image
 * references and page links: a block should render the values it is handed, and
 * "which language is this" is a question about the request, not about the block.
 */

const MARKER = '__i18n';

/** Is this value a translation map rather than ordinary block data? */
export function isTranslated(value) {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value[MARKER] === true;
}

/**
 * Build a translation map. Empty locales are kept out, so `hasTranslation`
 * can tell "not translated yet" from "deliberately blank".
 */
export function translated(values = {}) {
  const out = { [MARKER]: true };
  for (const [locale, value] of Object.entries(values)) {
    if (locale === MARKER) continue;
    if (value === undefined || value === null || value === '') continue;
    out[locale] = value;
  }
  return out;
}

/**
 * The value for one locale.
 *
 * Falls back to the source language rather than rendering nothing: a page with
 * an untranslated heading is worse in German than in French, but a page with no
 * heading at all is worse in both. The CMS shows which languages are missing so
 * the fallback is visible rather than silently permanent.
 */
export function pickLocale(value, locale, sourceLocale = 'fr') {
  if (!isTranslated(value)) return value;
  if (value[locale] !== undefined && value[locale] !== '') return value[locale];
  if (value[sourceLocale] !== undefined && value[sourceLocale] !== '') return value[sourceLocale];
  // Any language beats none, and which one is arbitrary only when both the
  // requested and the source language are absent.
  for (const [key, v] of Object.entries(value)) {
    if (key !== MARKER && v !== undefined && v !== '') return v;
  }
  return '';
}

/** Which locales this field has been written in. */
export function localesOf(value) {
  if (!isTranslated(value)) return [];
  return Object.keys(value).filter(k => k !== MARKER && value[k] !== undefined && value[k] !== '');
}

/**
 * Resolve every translation map inside a block's data for one locale.
 *
 * Returns the original object when nothing needed resolving, so the cached page
 * payload is not copied on every request to translate a page that has no
 * translated fields.
 */
export function localiseData(data, locale, sourceLocale = 'fr') {
  return walk(data, locale, sourceLocale);
}

function walk(value, locale, sourceLocale) {
  if (isTranslated(value)) return pickLocale(value, locale, sourceLocale);

  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = walk(item, locale, sourceLocale);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : value;
  }

  if (value && typeof value === 'object') {
    let changed = false;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const next = walk(item, locale, sourceLocale);
      if (next !== item) changed = true;
      out[key] = next;
    }
    return changed ? out : value;
  }

  return value;
}
