/*
 * countries.js — the partner directory's country names, per language.
 *
 * The directory is exported from another system and its `country` field is
 * English, inconsistently: `USA`, `MEXICO`, `Utd.Arab.Emir.`. The locator groups
 * its filter dropdown by that value and prints it on every partner card, so a
 * French reader got a list of English country names with two of them abbreviated
 * and one shouted.
 *
 * The table is generated rather than written — `tools/build-countries.mjs` maps
 * each of the export's spellings to an ISO 3166-1 code once and takes the names
 * from `Intl.DisplayNames`, so they are the names a browser would use.
 *
 * Read from disk once and kept: it is 82 rows that change when somebody
 * regenerates the file, which means a deploy. A country the table does not know
 * about falls through to the export's own spelling — visibly English, which is
 * the right failure: the alternative is a blank country on a partner card.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../lib/log.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.CONTENT_SOURCE_DIR
  ? path.resolve(process.env.CONTENT_SOURCE_DIR, 'data/countries.i18n.json')
  : path.resolve(HERE, '../../../../content-source/data/countries.i18n.json');

let table = null;

function load() {
  if (table) return table;
  try {
    const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    table = doc.countries || {};
    logger.info({ countries: Object.keys(table).length }, 'country names loaded');
  } catch (err) {
    // Not fatal, and worth one line in the log rather than a failed request:
    // without the table the locator shows the export's English names, which is
    // exactly what it did before the table existed.
    logger.warn({ err: err.message, file: FILE }, 'no country name table — countries stay as exported');
    table = {};
  }
  return table;
}

/**
 * `{ 'USA': 'États-Unis', … }` for one language.
 *
 * Keyed by the export's spelling, because that is what a partner row holds and
 * therefore what a caller has to look up.
 */
export async function countryNames(locale) {
  const all = load();
  const out = {};
  for (const [source, entry] of Object.entries(all)) {
    const name = entry?.[locale];
    if (name) out[source] = name;
  }
  return out;
}

/** The ISO code for an exported spelling, or null. Used by nothing yet; here
 *  because a table that knows the code and cannot be asked for it is a trap. */
export function countryCode(name) {
  return load()[name]?.code || null;
}
