/*
 * entities.mjs — turn the static site's HTML entities back into characters.
 *
 * The pages and the translation catalogues were authored with `&eacute;` rather
 * than `é`: 1,673 of them in French alone. Everything is UTF-8 and has been
 * since the migration, so the escaping buys nothing and costs plenty:
 *
 *   - **The copy editor is unreadable.** A French sentence reads
 *     `L'&eacute;diteur fran&ccedil;ais des communications d'entreprise`. To
 *     change one word an editor has to type entities, and typing `é` instead
 *     leaves the page inconsistent with the rest of the catalogue.
 *   - **So are the section labels.** The page builder lists
 *     "Footer: La prochaine conversation de votre &eacute;quipe m&eacute;rite".
 *   - **And the search does not match.** Searching the strings for "équipe"
 *     finds nothing, because the stored value does not contain it.
 *
 * ── What is decoded, and what is not ────────────────────────────────────────
 *
 * The list is written out rather than taken from an HTML5 entity table, and it
 * covers exactly the 36 entities this content actually uses. A table would also
 * decode things nobody wrote, and this runs over every page the site is built
 * from.
 *
 * Two groups are deliberately left alone, for different reasons:
 *
 *   `&amp; &lt; &gt; &quot; &apos;` — **structural**. Decoding `&amp;` to `&` in
 *   a URL turns one query parameter into two; decoding `&lt;` invents a tag.
 *   These are the escapes that are doing a job.
 *
 *   `&nbsp;` and the zero-width and fixed-width spaces — **invisible**. A
 *   non-breaking space is indistinguishable from an ordinary one in a text box,
 *   so an editor cannot tell it is there, cannot type it deliberately, and will
 *   eventually delete it by accident while fixing the spacing it exists to
 *   protect. They stay legible as entities.
 */

/** The characters, by entity name. Numeric forms are handled below. */
export const DECODE = {
  // French
  eacute: 'é', Eacute: 'É', egrave: 'è', Egrave: 'È', agrave: 'à', Agrave: 'À',
  ccedil: 'ç', Ccedil: 'Ç', ecirc: 'ê', Ecirc: 'Ê', ocirc: 'ô', Ocirc: 'Ô',
  icirc: 'î', Icirc: 'Î', acirc: 'â', Acirc: 'Â', ucirc: 'û', Ucirc: 'Û',
  ugrave: 'ù', Ugrave: 'Ù', euml: 'ë', Euml: 'Ë', iuml: 'ï', Iuml: 'Ï',
  ccaron: 'č', oelig: 'œ', OElig: 'Œ', aelig: 'æ', AElig: 'Æ',
  // German
  auml: 'ä', Auml: 'Ä', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', szlig: 'ß',
  // Spanish and Italian, for when those locales are switched on
  ntilde: 'ñ', Ntilde: 'Ñ', aacute: 'á', Aacute: 'Á', iacute: 'í', Iacute: 'Í',
  oacute: 'ó', Oacute: 'Ó', uacute: 'ú', Uacute: 'Ú',
  // Punctuation and symbols
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', bdquo: '„',
  lsquo: '‘', rsquo: '’', sbquo: '‚',
  hellip: '…', mdash: '—', ndash: '–', middot: '·', bull: '•',
  copy: '©', reg: '®', trade: '™', deg: '°',
  euro: '€', pound: '£', yen: '¥', cent: '¢',
  times: '×', divide: '÷', plusmn: '±', frac12: '½', frac14: '¼',
  rarr: '→', larr: '←', uarr: '↑', darr: '↓', harr: '↔',
  dagger: '†', sect: '§', para: '¶', permil: '‰',
  sup2: '²', sup3: '³', micro: 'µ', not: '¬',
};

/**
 * Entity names that must survive.
 *
 * `nbsp` is here rather than absent from DECODE so that a reader of this file
 * sees it was considered. See the note at the top.
 */
export const KEEP = new Set([
  'amp', 'lt', 'gt', 'quot', 'apos', 'nbsp',
  /*
   * The other invisibles, for the same reason as `nbsp`.
   *
   * A soft hyphen or a zero-width space decoded into a text box is a character an
   * editor cannot see, cannot type on purpose, and will delete by accident. They
   * belong in markup as entities or not at all.
   */
  'shy', 'zwj', 'zwnj', 'ensp', 'emsp', 'thinsp',
]);

/** Code points that must survive as entities, for the same reasons. */
const KEEP_CODES = new Set([34, 38, 60, 62, 39, 160]);

const NAMED = /&([a-zA-Z][a-zA-Z0-9]{1,31});/g;
const NUMERIC = /&#(x[0-9a-fA-F]{1,6}|[0-9]{1,7});/g;

/**
 * One string, decoded.
 *
 * Returns the string unchanged when there was nothing to do, so a caller can
 * compare by identity and skip a write.
 */
export function decodeEntities(text) {
  if (typeof text !== 'string' || !text.includes('&')) return text;

  let out = text.replace(NAMED, (match, name) => {
    if (KEEP.has(name)) return match;
    const ch = DECODE[name];
    return ch === undefined ? match : ch;
  });

  out = out.replace(NUMERIC, (match, digits) => {
    const code = digits[0] === 'x' || digits[0] === 'X'
      ? Number.parseInt(digits.slice(1), 16)
      : Number.parseInt(digits, 10);
    if (!Number.isFinite(code) || KEEP_CODES.has(code)) return match;
    // Control characters and anything outside Unicode are left as written: a
    // decode that produces an unprintable byte is not an improvement.
    if (code < 32 || code > 0x10ffff || (code >= 0x7f && code <= 0x9f)) return match;
    try {
      return String.fromCodePoint(code);
    } catch {
      return match;
    }
  });

  return out === text ? text : out;
}

/** Which decodable entities a string still contains, with counts. */
export function entitiesIn(text) {
  const found = new Map();
  if (typeof text !== 'string') return found;
  for (const m of String(text).matchAll(NAMED)) {
    if (KEEP.has(m[1]) || DECODE[m[1]] === undefined) continue;
    found.set(m[0], (found.get(m[0]) || 0) + 1);
  }
  for (const m of String(text).matchAll(NUMERIC)) {
    const code = m[1][0] === 'x' || m[1][0] === 'X'
      ? Number.parseInt(m[1].slice(1), 16)
      : Number.parseInt(m[1], 10);
    if (KEEP_CODES.has(code)) continue;
    found.set(m[0], (found.get(m[0]) || 0) + 1);
  }
  return found;
}

/**
 * Decode every string inside a JSON value, leaving object *keys* alone.
 *
 * The keys of a translation catalogue are the identifiers the page markup
 * references — `a-propos-de-rainbow.body.l-diteur-fran-ais-des`, ugly because it
 * was minted from entity-encoded text. Rewriting them would mean rewriting every
 * `data-i18n` attribute in eighteen pages at the same instant, and any miss is a
 * string that silently stops rendering. So the values are fixed and the keys are
 * left as the archaeology they are.
 */
export function decodeDeep(value) {
  if (typeof value === 'string') return decodeEntities(value);
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
      const next = decodeDeep(item);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? out : value;
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const next = decodeDeep(item);
      if (next !== item) changed = true;
      out[key] = next;
    }
    return changed ? out : value;
  }
  return value;
}
