/*
 * catalogue.js — turn the flat string rows back into the nested object the
 * renderer looks keys up in.
 *
 * Editors work on rows (`tarifs.hero.title` in five languages); the renderer
 * wants `catalogue.tarifs.hero.title`. Compiling is a full collection read, so
 * the result is cached per locale and only recomputed when the site revision
 * moves — which publishing does.
 */
import { ContentString } from '../models/index.js';
import { unflatten } from '@rainbow/core/html';
import { cached } from '../lib/redis.js';

export async function compileCatalogue(locale) {
  const rows = await ContentString.find({}, { key: 1, values: 1, _id: 0 }).lean();
  const pairs = {};
  for (const row of rows) {
    const value = row.values ? row.values[locale] : undefined;
    if (value === undefined || value === null || value === '') continue;
    pairs[row.key] = value;
  }
  return unflatten(pairs);
}

export function catalogueFor(locale, ttl = 600) {
  return cached(`catalogue:${locale}`, ttl, () => compileCatalogue(locale));
}

/** Per-locale counts for the CMS dashboard: how much is actually translated. */
export async function translationCoverage(locales) {
  const rows = await ContentString.find({}, { values: 1, _id: 0 }).lean();
  const total = rows.length;
  const out = {};
  for (const locale of locales) {
    let filled = 0;
    for (const row of rows) {
      const v = row.values ? row.values[locale] : undefined;
      if (v !== undefined && v !== null && String(v).length) filled++;
    }
    out[locale] = { total, filled, missing: total - filled, percent: total ? Math.round((filled / total) * 100) : 0 };
  }
  return out;
}
