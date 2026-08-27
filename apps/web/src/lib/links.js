/*
 * linkAttrs — href, plus new-tab handling, in one place.
 *
 * `target="_blank"` without `rel="noopener"` hands the new tab a live reference
 * back to the page that opened it. An editor ticking "open in a new tab" is not
 * choosing to accept that, so the two travel together and neither is spelled out
 * at a call site where one of them could be left off.
 *
 * Returns a props object, spread onto the anchor: `<a {...linkAttrs(href, newTab)}>`.
 */
export function linkAttrs(href, newTab) {
  if (!newTab) return { href };
  return { href, target: '_blank', rel: 'noopener noreferrer' };
}
