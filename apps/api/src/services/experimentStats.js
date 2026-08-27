/*
 * experimentStats.js — counting what happened, and saying what it means.
 *
 * The hard part of an A/B feature is not splitting traffic; it is refusing to
 * answer before the answer exists. Every number here comes with the conditions
 * under which it may be believed, because a results screen that shows a
 * conversion rate and a green arrow will be acted on, and at three hundred
 * visitors that arrow is noise.
 *
 * Two things are deliberately *not* done:
 *
 *   - No per-visitor event log. Counters answer every question anyone asks of
 *     a marketing A/B test, and an event row per impression would be the
 *     largest collection in this database within a month.
 *   - No peeking correction beyond the guardrails. Sequential testing is the
 *     right answer to "can I check it daily", and it is more machinery than
 *     this site needs; the honest alternative is a fixed horizon and a screen
 *     that says how far off it is.
 */
import { ExperimentStat } from '../models/index.js';
import { controlOf, dayKey, primaryGoal } from '@rainbow/core/experiments';

/** The reserved goal key that holds the denominator. */
export const EXPOSURE = '__exposure__';

/**
 * Increment one counter.
 *
 * Upsert rather than find-then-save: two conversions landing in the same
 * millisecond must both be counted, and a read-modify-write loses one of them
 * roughly as often as the site is busy.
 */
export async function record({ experiment, variant, goal, locale = '', at = new Date() }) {
  await ExperimentStat.updateOne(
    { experiment, variant, goal, day: dayKey(at), locale: locale || '' },
    { $inc: { count: 1 } },
    { upsert: true },
  );
}

/* ── The statistics ───────────────────────────────────────────────────────── */

/**
 * Φ(z) — the standard normal CDF, via Abramowitz & Stegun 7.1.26.
 *
 * Accurate to about 1.5e-7, which is several orders of magnitude finer than the
 * decision it feeds ("is this above 95%"). Written out rather than pulled from
 * a stats package because it is nine lines and a dependency here would be a
 * dependency in the API's boot path.
 */
function normalCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t
    + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Two-proportion z-test, control against one arm.
 *
 * The pooled standard error is the one that belongs under the null hypothesis
 * ("these two rates are the same"), which is the hypothesis the p-value is
 * about. The unpooled error is used separately, for the probability the arm is
 * genuinely better, because that question assumes the rates differ.
 */
export function compare(control, arm) {
  const n1 = control.exposures; const c1 = control.conversions;
  const n2 = arm.exposures; const c2 = arm.conversions;
  if (!n1 || !n2) return null;

  const p1 = c1 / n1;
  const p2 = c2 / n2;
  const pooled = (c1 + c2) / (n1 + n2);
  const sePooled = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));

  // Both arms at zero (or both at 100%) leaves nothing to compare: the test has
  // no information yet, which is different from a result of "no difference".
  if (!sePooled) return null;

  const z = (p2 - p1) / sePooled;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));

  const seUnpooled = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  const probabilityBetter = seUnpooled ? normalCdf((p2 - p1) / seUnpooled) : 0.5;

  // The interval on the *difference*, which is the quantity the decision is
  // about. A lift of "+12%" whose interval spans −4% to +29% is not a lift.
  const margin = 1.96 * seUnpooled;
  return {
    z,
    pValue,
    confidence: (1 - pValue) * 100,
    probabilityBetter: probabilityBetter * 100,
    absoluteLift: (p2 - p1) * 100,
    relativeLift: p1 > 0 ? ((p2 - p1) / p1) * 100 : null,
    interval: { low: (p2 - p1 - margin) * 100, high: (p2 - p1 + margin) * 100 },
  };
}

/**
 * Sample ratio mismatch: is traffic actually splitting the way it was told to?
 *
 * This is the check that catches a broken experiment rather than a losing one.
 * A 50/50 test reporting 60/40 has something wrong with it — a variant that
 * errors before it reports exposure, a cached control served to half the
 * assigned traffic — and every conversion number in the same table is then
 * meaningless. Reported at p < 0.001, the conventional threshold, because at
 * anything looser a healthy test trips it eventually just by running.
 */
function sampleRatioMismatch(arms, variants) {
  const total = arms.reduce((sum, a) => sum + a.exposures, 0);
  if (total < 100) return { checked: false, reason: 'not enough traffic to judge' };

  const weightTotal = variants.reduce((sum, v) => sum + Math.max(0, v.weight ?? 0), 0);
  if (!weightTotal) return { checked: false, reason: 'no weights configured' };

  let chi = 0;
  for (const arm of arms) {
    const weight = Math.max(0, variants.find(v => v.key === arm.variant)?.weight ?? 0);
    const expected = total * (weight / weightTotal);
    if (expected <= 0) continue;
    chi += ((arm.exposures - expected) ** 2) / expected;
  }

  // One degree of freedom for the usual two arms; the survival function of
  // chi-square with df=1 is 2(1 − Φ(√χ²)).
  const df = arms.length - 1;
  const pValue = df === 1
    ? 2 * (1 - normalCdf(Math.sqrt(Math.max(0, chi))))
    // For more arms, the Wilson–Hilferty transform is close enough to decide a
    // 0.001 threshold and avoids carrying an incomplete-gamma implementation.
    : 1 - normalCdf(((chi / df) ** (1 / 3) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df)));

  return { checked: true, chiSquare: chi, pValue, mismatch: pValue < 0.001 };
}

/**
 * How many exposures per arm this test needs before it can see the effect it is
 * looking for. The standard fixed-horizon formula at 95% / 80% power.
 *
 * Shown before the test starts, which is the only time it can change anything:
 * a test needing 40 000 visitors per arm on a page that gets 900 a week is not
 * a test, and finding that out on day one costs nothing.
 */
export function requiredSample(baselineRate, minimumDetectableEffect) {
  const p = Number(baselineRate);
  const mde = Number(minimumDetectableEffect);
  if (!(p > 0 && p < 1) || !(mde > 0)) return null;
  const p2 = Math.min(0.999999, p * (1 + mde));
  const zAlpha = 1.959964;  // two-tailed 95%
  const zBeta = 0.841621;   // 80% power
  const pBar = (p + p2) / 2;
  const numerator = (zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) + zBeta * Math.sqrt(p * (1 - p) + p2 * (1 - p2))) ** 2;
  return Math.ceil(numerator / ((p2 - p) ** 2));
}

/* ── Reading a test ───────────────────────────────────────────────────────── */

/**
 * Everything the results screen shows, for one experiment.
 *
 * `days` and `byLocale` come from the same query rather than three: the
 * counters are small and grouping them in memory is cheaper than three round
 * trips, and it guarantees the totals in each view agree with each other.
 */
export async function results(experiment, { locale = null } = {}) {
  const filter = { experiment: experiment.key };
  if (locale) filter.locale = locale;
  const rows = await ExperimentStat.find(filter).lean();

  const variants = experiment.variants || [];
  const controlKey = controlOf(experiment);
  const goals = experiment.goals || [];
  const primary = primaryGoal(experiment);

  /** total[variant][goal] = count */
  const total = {};
  const byDay = {};
  const byLocale = {};
  for (const row of rows) {
    (total[row.variant] ||= {})[row.goal] = (total[row.variant]?.[row.goal] || 0) + row.count;
    const d = (byDay[row.day] ||= {});
    (d[row.variant] ||= {})[row.goal] = (d[row.variant]?.[row.goal] || 0) + row.count;
    if (row.locale) {
      const l = (byLocale[row.locale] ||= {});
      (l[row.variant] ||= {})[row.goal] = (l[row.variant]?.[row.goal] || 0) + row.count;
    }
  }

  const armFor = (variantKey, goalKey) => {
    const bucket = total[variantKey] || {};
    const exposures = bucket[EXPOSURE] || 0;
    const conversions = bucket[goalKey] || 0;
    return {
      variant: variantKey,
      exposures,
      conversions,
      rate: exposures ? (conversions / exposures) * 100 : null,
    };
  };

  const perGoal = {};
  for (const goal of goals) {
    const arms = variants.map(v => armFor(v.key, goal.key));
    const control = arms.find(a => a.variant === controlKey);
    perGoal[goal.key] = {
      goal: { key: goal.key, name: goal.name || goal.key, type: goal.type, primary: !!goal.primary },
      arms: arms.map(arm => ({
        ...arm,
        isControl: arm.variant === controlKey,
        label: variants.find(v => v.key === arm.variant)?.label || arm.variant,
        // The control is not compared with itself: a row of zeroes and a
        // confidence of 0% reads as a result, and it is not one.
        comparison: arm.variant === controlKey || !control ? null : compare(control, arm),
      })),
    };
  }

  const exposureArms = variants.map(v => ({ variant: v.key, exposures: total[v.key]?.[EXPOSURE] || 0 }));
  const srm = sampleRatioMismatch(exposureArms, variants);

  return {
    key: experiment.key,
    status: experiment.status,
    startedAt: experiment.startedAt,
    endedAt: experiment.endedAt,
    controlKey,
    primaryGoalKey: primary?.key || null,
    totals: exposureArms,
    goals: perGoal,
    srm,
    readiness: readiness(experiment, exposureArms, perGoal[primary?.key]),
    byDay,
    byLocale,
  };
}

/**
 * May this result be acted on yet, and if not, what is missing?
 *
 * Returned as a list of unmet conditions rather than a boolean, because "wait"
 * is not useful advice on its own — the editor needs to know whether they are
 * waiting three days or three months, and whether the thing to fix is traffic,
 * time or a broken variant.
 */
function readiness(experiment, exposureArms, primaryResult) {
  const guard = experiment.guardrails || {};
  const blockers = [];

  const minPerArm = guard.minExposuresPerArm ?? 0;
  const smallest = exposureArms.length ? Math.min(...exposureArms.map(a => a.exposures)) : 0;
  if (minPerArm && smallest < minPerArm) {
    blockers.push({
      kind: 'sample',
      message: `${smallest.toLocaleString()} of ${minPerArm.toLocaleString()} visitors on the smallest arm`,
      progress: minPerArm ? Math.min(1, smallest / minPerArm) : 1,
    });
  }

  const minHours = guard.minRuntimeHours ?? 0;
  if (minHours && experiment.startedAt) {
    const ranHours = (Date.now() - new Date(experiment.startedAt).getTime()) / 3_600_000;
    if (ranHours < minHours) {
      blockers.push({
        kind: 'runtime',
        message: `${Math.floor(ranHours)}h of ${minHours}h — a test that skips a weekend has measured weekdays`,
        progress: Math.min(1, ranHours / minHours),
      });
    }
  } else if (minHours && !experiment.startedAt) {
    blockers.push({ kind: 'runtime', message: 'not started yet', progress: 0 });
  }

  const target = guard.confidenceTarget ?? 95;
  const best = bestArm(primaryResult);
  if (best && best.comparison && best.comparison.confidence < target) {
    blockers.push({
      kind: 'confidence',
      message: `${best.comparison.confidence.toFixed(1)}% confident, target ${target}%`,
      progress: Math.min(1, best.comparison.confidence / target),
    });
  }

  return {
    ready: blockers.length === 0 && !!primaryResult,
    blockers,
    // Named separately from `ready` because a leader with no statistical
    // support is still the thing an editor wants to see on the screen — as long
    // as it is not labelled a winner.
    leader: best ? best.variant : null,
    leaderConfidence: best?.comparison?.confidence ?? null,
  };
}

function bestArm(primaryResult) {
  if (!primaryResult) return null;
  const candidates = primaryResult.arms.filter(a => !a.isControl && a.comparison);
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.comparison.absoluteLift > a.comparison.absoluteLift ? b : a));
}
