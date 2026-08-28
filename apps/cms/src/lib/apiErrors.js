/*
 * apiErrors.js — turning an API error into a sentence an editor can act on.
 *
 * This is the "[object Object]" bug, and it lived in the one place an editor was
 * most likely to meet it: the toast shown when a save is rejected.
 *
 * `details` on an ApiError is never a list of strings. Two shapes reach the
 * browser, from two different layers:
 *
 *   - a validation failure sends `[{path, message}, …]`, built in
 *     apps/api/src/middleware/validate.js from the zod issues;
 *   - a unique-index collision used to send the offending `{field: value}`
 *     object, from the 11000 branch of apps/api/src/middleware/error.js.
 *
 * The toast did `[].concat(details).join(', ')`, so creating an A/B test with an
 * empty name showed "Validation failed — [object Object], [object Object]" —
 * which is both alarming and silent about the name being empty.
 *
 * Every shape is named here rather than guessed at, and anything unrecognised is
 * dropped instead of stringified: no detail at all beats a detail that reads
 * like a crash. It lives in its own module, without JSX, so it can be tested —
 * see tests/cms.test.mjs.
 */

/** `targeting.allocation` → `targeting → allocation`, for a non-developer. */
export function fieldName(path) {
  return String(path).split('.').filter(Boolean).join(' → ');
}

/** The `details` of an API error, as a readable clause. Empty when there is none. */
export function describeDetails(details) {
  if (!details) return '';
  const parts = [];

  const add = (value) => {
    if (value === null || value === undefined || value === '') return;
    if (typeof value === 'string') { parts.push(value); return; }
    if (typeof value === 'number' || typeof value === 'boolean') { parts.push(String(value)); return; }
    if (Array.isArray(value)) { value.forEach(add); return; }
    if (typeof value !== 'object') return;

    // A zod issue: `{ path: 'variants.0.key', message: 'An arm needs a key' }`.
    if (typeof value.message === 'string') {
      parts.push(value.path ? `${fieldName(value.path)}: ${value.message}` : value.message);
      return;
    }
    // A refused copy write: `{ key, reason }`.
    if (typeof value.reason === 'string') {
      parts.push(value.key ? `${value.key}: ${value.reason}` : value.reason);
      return;
    }
    // A duplicate-key report: `{ slug: 'tarifs' }`.
    const pairs = Object.entries(value)
      .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
      .map(([k, v]) => `${fieldName(k)}: ${v}`);
    if (pairs.length) parts.push(pairs.join(', '));
  };

  add(details);

  // Six is enough to act on. A form with twenty empty fields does not need a
  // toast that covers the screen, and the same message twice is said once.
  const unique = [...new Set(parts)];
  const shown = unique.slice(0, 6);
  const more = unique.length - shown.length;
  return shown.join('; ') + (more > 0 ? `; and ${more} more` : '');
}

/** The whole error as one line: the message, and what it was about. */
export function describeError(err) {
  if (typeof err === 'string') return err;
  const message = err?.message || 'Something went wrong';
  const details = describeDetails(err?.details);
  return details ? `${message} — ${details}` : message;
}
