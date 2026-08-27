/*
 * ab.js — where the browser reports what an experiment actually did.
 *
 * Two events, and the distinction between them is the whole measurement:
 *
 *   exposure    this visitor was shown this arm
 *   conversion  this visitor then did the thing the test is about
 *
 * Both are counted once per visitor, which is why both are reported from the
 * browser rather than the exposure being counted server-side at render. Mixing
 * the bases — page views on top, unique visitors underneath — produces a
 * "conversion rate" that is neither, and the error does not cancel between
 * arms because reload behaviour is a property of the page, not of the split.
 *
 * The endpoint is deliberately dull: it takes a key, a variant and a goal,
 * checks all three against a running experiment, and increments a counter.
 * Nothing here trusts the caller — a payload naming an experiment that is not
 * running, an arm that does not exist or a goal nobody declared is dropped
 * rather than stored, because the alternative is a results table anyone on the
 * internet can write to.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Experiment } from '../models/index.js';
import { asyncHandler } from '../middleware/error.js';
import { record, EXPOSURE } from '../services/experimentStats.js';
import { logger } from '../lib/log.js';

export const abRouter = Router();

/*
 * Generous, because a visitor legitimately generates one exposure per test on
 * the page plus a conversion or two, and a family behind one office NAT is a
 * single IP. Tight enough that scripting a result into existence is tedious.
 */
const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // A dropped beacon must never surface as an error in the visitor's console:
  // this endpoint is telemetry and has no business affecting the page.
  handler: (_req, res) => res.status(202).json({ ok: true }),
});

/**
 * Obvious automated traffic, kept out of the denominator.
 *
 * A crawler that executes JavaScript and reports an exposure it will never
 * convert on inflates one arm's denominator, and it does not do so evenly —
 * crawl budget is not distributed the way visitors are. This is a coarse filter
 * and it is meant to be: the cost of missing a bot is a small dilution, the
 * cost of an over-eager pattern is silently discarding real visitors.
 */
const BOT = /bot|crawl|spider|slurp|bingpreview|headlesschrome|lighthouse|pingdom|gtmetrix|ahrefs|semrush/i;

const trackBody = z.object({
  experiment: z.string().min(1).max(60),
  variant: z.string().min(1).max(20),
  // `__exposure__` is the denominator; anything else must be a declared goal.
  goal: z.string().min(1).max(60).default(EXPOSURE),
  locale: z.string().max(5).optional(),
});

/**
 * The running experiments, cached briefly in memory.
 *
 * Validating each beacon against the database would put a query on a path that
 * fires several times per page view. Ten seconds of staleness costs at most a
 * few counts on a test that has just been paused, which is not a number anyone
 * will act on.
 */
let cache = { at: 0, byKey: new Map() };
async function runningExperiments() {
  if (Date.now() - cache.at < 10_000) return cache.byKey;
  const rows = await Experiment.find({ status: 'running' },
    { key: 1, variants: 1, goals: 1, _id: 0 }).lean();
  cache = { at: Date.now(), byKey: new Map(rows.map(r => [r.key, r])) };
  return cache.byKey;
}

abRouter.post('/track', limiter, asyncHandler(async (req, res) => {
  /*
   * Always 202, whatever happens below.
   *
   * The browser sends this with `navigator.sendBeacon` during unload, where a
   * response is neither read nor waited for, and a 4xx on a telemetry endpoint
   * is noise in somebody's monitoring for no benefit. What was rejected and why
   * belongs in the server log, which is where the person debugging a test that
   * shows no data will actually look.
   */
  const accepted = () => res.status(202).json({ ok: true });

  const parsed = trackBody.safeParse(req.body);
  if (!parsed.success) return accepted();

  if (BOT.test(req.get('user-agent') || '')) return accepted();

  const { experiment, variant, goal, locale } = parsed.data;
  const running = await runningExperiments();
  const found = running.get(experiment);
  if (!found) {
    logger.debug({ experiment }, '[ab] beacon for an experiment that is not running');
    return accepted();
  }
  if (!found.variants.some(v => v.key === variant)) {
    logger.debug({ experiment, variant }, '[ab] beacon naming an arm that does not exist');
    return accepted();
  }
  if (goal !== EXPOSURE && !(found.goals || []).some(g => g.key === goal)) {
    logger.debug({ experiment, goal }, '[ab] beacon for an undeclared goal');
    return accepted();
  }

  await record({ experiment, variant, goal, locale: locale || '' });
  return accepted();
}));

/**
 * Several events in one request.
 *
 * A page carrying two tests reports two exposures on load; sending them
 * separately doubles the requests for no reason. Capped so one call cannot
 * become an unbounded write loop.
 */
const batchBody = z.object({
  events: z.array(trackBody).min(1).max(20),
});

abRouter.post('/batch', limiter, asyncHandler(async (req, res) => {
  const accepted = () => res.status(202).json({ ok: true });
  const parsed = batchBody.safeParse(req.body);
  if (!parsed.success) return accepted();
  if (BOT.test(req.get('user-agent') || '')) return accepted();

  const running = await runningExperiments();
  for (const event of parsed.data.events) {
    const found = running.get(event.experiment);
    if (!found) continue;
    if (!found.variants.some(v => v.key === event.variant)) continue;
    if (event.goal !== EXPOSURE && !(found.goals || []).some(g => g.key === event.goal)) continue;
    await record({ ...event, locale: event.locale || '' });
  }
  return accepted();
}));
