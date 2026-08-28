/*
 * copy.js — writing the string catalogue from somewhere other than the copy editor.
 *
 * The header, the footer and every migrated page render their text by splicing
 * the catalogue over marked ranges in the markup. So a screen that shows the
 * markup and lets somebody change the words has to write the catalogue, or the
 * change is discarded on the next render and the editor is left believing the
 * CMS is broken. It was.
 *
 * The same guard the copy editor has applies here: a value that would strip the
 * numbered placeholders out of a rich string is refused rather than written,
 * because those placeholders are the element's inline children — a link, an
 * emphasis, the homepage's word rotator — and a save that quietly deletes them
 * is unrecoverable from the value that replaced it.
 */
import { ContentString } from '../models/index.js';

const PLACEHOLDER = /<\d+(?:\/>|>)/;

/*
 * Catalogue values use LF.
 *
 * A multi-line string reaches this function from two places with two
 * conventions: the authored `i18n/*.json` files use LF, and a value read back
 * out of a CRLF template — the footer's address block, which spans three lines —
 * arrives with CRLF. Both render identically in a browser and neither is wrong,
 * but storing whichever one happened to write last means the copy in the database
 * and the copy in the repository disagree about a string nobody edited, and
 * `verify-live` then reports twelve pages as "edited in the CMS" for a change
 * that is invisible.
 *
 * One convention, chosen to match the files, because those are the migration's
 * reference copy.
 */
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const toLf = (value) => (
  typeof value === 'string' ? value.split(CR + LF).join(LF) : value
);

/** Would writing `next` over `existing` throw away rich-text structure? */
function wouldFlatten(existing, next) {
  if (typeof existing !== 'string' || typeof next !== 'string') return false;
  return PLACEHOLDER.test(existing) && !PLACEHOLDER.test(next);
}

/**
 * Write `{key: value}` into one locale of the catalogue.
 *
 * Returns `{ written: [keys], refused: [{key, reason}] }`. Nothing throws: the
 * caller is usually saving something else at the same time (a header's markup)
 * and a refused string must not lose that save. Everything refused is named, so
 * the interface can say what did not go in rather than reporting success.
 *
 * Keys the catalogue has never held are created, the way the import does it —
 * a template may legitimately reference a string nobody has translated yet.
 */
export async function writeCopy(values, locale, user = null) {
  const entries = Object.entries(values || {}).filter(([k]) => k);
  if (!entries.length) return { written: [], refused: [] };

  const keys = entries.map(([k]) => k);
  const current = new Map(
    (await ContentString.find({ key: { $in: keys } }, { key: 1, values: 1, _id: 0 }).lean())
      .map(r => [r.key, r.values || {}]),
  );

  const written = [];
  const refused = [];
  const ops = [];

  for (const [key, rawValue] of entries) {
    const value = Array.isArray(rawValue) ? rawValue.map(toLf) : toLf(rawValue);
    const existing = (current.get(key) || {})[locale];
    if (wouldFlatten(existing, value)) {
      refused.push({
        key,
        reason: 'it would remove the inline markup (a link or a styled word) from this string',
      });
      continue;
    }
    if (existing === value) continue;
    const [page, zone] = key.split('.');
    written.push(key);
    ops.push({
      updateOne: {
        filter: { key },
        update: {
          $set: {
            [`values.${locale}`]: value,
            ...(user ? { updatedBy: user._id } : {}),
          },
          $setOnInsert: {
            page: page || 'common',
            zone: zone || 'body',
            owner: 'content',
            type: PLACEHOLDER.test(value) ? 'rich' : 'text',
          },
        },
        upsert: true,
      },
    });
  }

  if (ops.length) await ContentString.bulkWrite(ops, { ordered: false });
  return { written, refused };
}

/**
 * The catalogue values for a list of keys, every locale.
 *
 * Used to show, next to each string in the header, what it currently says in
 * each language — the question "why did my edit not appear" is answered by
 * seeing that the German column is empty and the French one is not.
 */
export async function readCopy(keys) {
  const rows = await ContentString.find(
    { key: { $in: [...new Set(keys)] } },
    { key: 1, values: 1, type: 1, notes: 1, _id: 0 },
  ).lean();
  const out = {};
  for (const row of rows) out[row.key] = row;
  return out;
}
