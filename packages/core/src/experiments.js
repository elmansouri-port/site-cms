/*
 * experiments.js — who sees which arm, decided the same way everywhere.
 *
 * The old assignment was `Math.random()` in the frontend middleware. That is
 * wrong in three ways that only show up once somebody tries to read the result:
 *
 *   - It is not reproducible. Asked "why did this session see B?", nobody can
 *     answer, and a support ticket about a variant becomes unfalsifiable.
 *   - It re-rolls whenever the per-test cookie is lost, so a visitor who clears
 *     cookies is counted twice, in different arms, and the denominator drifts
 *     away from the number of people.
 *   - It cannot express "ramp this to 10% of traffic first", because there is
 *     no stable notion of which tenth.
 *
 * So assignment is a pure function of the visitor id and the test's salt.
 * Same visitor, same test, same arm — on every page, on every request, for as
 * long as the visitor id survives. Re-salting reshuffles everybody on purpose;
 * nothing else does.
 *
 * This lives in core rather than in the frontend because two other places need
 * the identical answer: the API validates incoming exposure events against it,
 * and the results screen checks the observed split against the intended one.
 * A second implementation of a hash is a second implementation that can drift,
 * and the failure mode of drift here is numbers that look fine and are not.
 */

/**
 * FNV-1a, 32-bit. Small, fast, no dependency, and — the property that matters —
 * identical in every JavaScript runtime, because assignment computed on the
 * server must equal assignment recomputed anywhere else.
 */
export function hash32(input) {
  let h = 0x811c9dc5;
  const str = String(input);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // The FNV prime, via shifts: `h * 16777619` overflows into floating point
    // and stops being the same number on both sides.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Where a visitor falls on a 0–9999 line, for one test. */
export function bucketOf(visitorId, salt) {
  return hash32(`${visitorId}:${salt}`) % 10000;
}

/**
 * Two independent draws per visitor per test, and they must not be correlated.
 *
 * The first decides whether the visitor is in the test at all (allocation), the
 * second which arm they land in. Deriving both from one hash would tie them
 * together: raising the allocation from 10% to 20% would hand the whole new
 * tenth to one arm, because they would all sit in the same region of the line.
 * Different salt suffixes make them independent, so ramping traffic up keeps
 * the split balanced.
 */
const ALLOCATION_SALT = ':alloc';
const VARIANT_SALT = ':arm';

/** The arm that is the baseline. Falls back to the first arm. */
export function controlOf(experiment) {
  const variants = experiment?.variants || [];
  return variants.find(v => v.isControl)?.key || variants[0]?.key || null;
}

/**
 * Is this test allowed to decide anything about this request?
 *
 * Locale targeting is here rather than at the call site because it is part of
 * the test's definition: a German-only headline test that quietly ran in French
 * has not tested the German headline, it has diluted itself.
 */
export function isEligible(experiment, { locale } = {}) {
  if (!experiment) return false;
  if (experiment.status !== 'running') return false;
  const locales = experiment.targeting?.locales || [];
  if (locales.length && locale && !locales.includes(locale)) return false;
  return (experiment.variants || []).length >= 2;
}

/**
 * Assign one visitor to one arm.
 *
 * Returns `{ variant: null, reason }` when the visitor is not in the test, and
 * the reason is kept rather than collapsed to a boolean: "held back by the
 * allocation" and "this test does not run in this language" produce the same
 * blank page and need very different fixes.
 */
export function assign(experiment, visitorId, { locale } = {}) {
  if (!isEligible(experiment, { locale })) {
    return { variant: null, reason: experiment?.status === 'running' ? 'not-targeted' : 'not-running' };
  }
  if (!visitorId) return { variant: null, reason: 'no-visitor-id' };

  const salt = experiment.salt || experiment.key;

  const allocation = Math.max(0, Math.min(100, experiment.targeting?.allocation ?? 100));
  if (allocation < 100) {
    const roll = bucketOf(visitorId, salt + ALLOCATION_SALT);
    if (roll >= allocation * 100) return { variant: null, reason: 'held-back' };
  }

  const variants = experiment.variants || [];
  const total = variants.reduce((sum, v) => sum + Math.max(0, v.weight ?? 0), 0);
  // Every weight at zero is a misconfiguration, not an instruction to show
  // nobody anything: fall back to the control rather than blanking the block.
  if (total <= 0) return { variant: controlOf(experiment), reason: 'no-weights' };

  // Walk the weights across the same 0–9999 line, so changing one arm's weight
  // moves only the boundary between them rather than reshuffling everybody.
  let point = (bucketOf(visitorId, salt + VARIANT_SALT) / 10000) * total;
  for (const v of variants) {
    point -= Math.max(0, v.weight ?? 0);
    if (point < 0) return { variant: v.key, reason: 'assigned' };
  }
  return { variant: variants[variants.length - 1].key, reason: 'assigned' };
}

/**
 * The arm named by a URL parameter, for campaign entry points and for QA.
 *
 * Returns null unless the value names a real arm, so a typo in a campaign link
 * shows the control rather than a blank page.
 */
export function variantFromParam(experiment, value) {
  if (!value) return null;
  return (experiment.variants || []).some(v => v.key === value) ? value : null;
}

/** `YYYY-MM-DD` in UTC — the day key the counters are grouped by. */
export function dayKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

/** The goal that decides the test, or the first one if nobody marked it. */
export function primaryGoal(experiment) {
  const goals = experiment?.goals || [];
  return goals.find(g => g.primary) || goals[0] || null;
}
