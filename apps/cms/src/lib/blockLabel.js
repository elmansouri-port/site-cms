import { textOf } from '@rainbow/core/article';
import { firstHeading } from '@rainbow/core/html';

/**
 * What a block should be called in a list.
 *
 * The migration derived every imported block's label from its markup, which
 * produced "Section: Relative", "Block: Block 8" and a dozen more that name a
 * CSS class or a counter. An editor scanning that list cannot tell the hero from
 * the pricing table, which is the one thing the list exists to do.
 *
 * So a label that is obviously machine-made is replaced, at display time only,
 * by the block's own first heading — which is the words on the page, and which
 * the block already carries. The stored label is left alone: it is what the
 * fidelity checks and the section keys were derived from, and rewriting it in
 * the database would be a migration with no way back.
 */

/** Labels that name the markup rather than the content. */
const GENERIC = [
  /^section:\s*(relative|absolute|fixed|sticky|container|wrapper|block|div)?\s*\d*$/i,
  /^block:\s*block\s*\d+$/i,
  /^(section|block|div|new section)\s*\d*$/i,
];

const isGeneric = (label) => !label.trim() || GENERIC.some(re => re.test(label.trim()));

export function blockLabel(section) {
  const stored = textOf(section?.label || '');
  if (!isGeneric(stored)) return stored;

  // `heading` is what the API's block-list projection sends; `html` is present
  // on the full page document the visual editor already has.
  const heading = textOf(section?.heading || firstHeading(section?.html || ''));
  if (heading) return heading;

  return stored || section?.key || 'Untitled block';
}
