/*
 * experiments.js — the A/B tests a block, a page or the chrome can opt into.
 *
 * The record holds the hypothesis, the split, the goals and the guardrails;
 * what actually varies is named by whatever opts in (a section's
 * `experiment.key`, a page's, a chrome part's).
 *
 * Two things this router owns that the previous one did not, and both are the
 * difference between a traffic splitter and an experiment system:
 *
 *   - **Results.** A test that cannot say whether it won is a way of changing
 *     the site at random. `/results` returns the counters, the significance and
 *     — as importantly — the reasons the answer is not to be believed yet.
 *   - **Getting out.** Deleting the record used to leave every page, section
 *     and chrome part still naming it, with no endpoint anywhere that could
 *     clear the reference. A page could enter a test and never leave it. Every
 *     destructive path here cleans up after itself, and says what it touched.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { Experiment, ExperimentStat, Page, Chrome } from '../../models/index.js';
import { asyncHandler, conflict, notFoundError, badRequest } from '../../middleware/error.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { audit, publishChanged, snapshot } from '../../services/publish.js';
import { results, requiredSample } from '../../services/experimentStats.js';
import { controlOf } from '@rainbow/core/experiments';

export const experimentsRouter = Router();

experimentsRouter.use(requireAuth);

/* ── Listing ──────────────────────────────────────────────────────────────── */

/**
 * Every test, with enough of its result to sort by.
 *
 * The exposure totals are fetched in one aggregate for the whole list rather
 * than per row: a list of twenty tests should not be twenty round trips, and
 * the number an editor scans for is "is this one getting traffic".
 */
experimentsRouter.get('/', asyncHandler(async (_req, res) => {
  const items = await Experiment.find({}).sort({ createdAt: -1 }).lean();
  const totals = await ExperimentStat.aggregate([
    { $match: { goal: '__exposure__' } },
    { $group: { _id: '$experiment', exposures: { $sum: '$count' } } },
  ]);
  const byKey = new Map(totals.map(t => [t._id, t.exposures]));
  res.json({
    items: items.map(item => ({
      ...item,
      exposures: byKey.get(item.key) || 0,
      controlKey: controlOf(item),
    })),
  });
}));

experimentsRouter.get('/:key', asyncHandler(async (req, res) => {
  const item = await Experiment.findOne({ key: req.params.key }).lean();
  if (!item) throw notFoundError('No such experiment');
  res.json({ item: { ...item, controlKey: controlOf(item) } });
}));

/* ── Where a test is attached ─────────────────────────────────────────────── */

/**
 * Everything that currently names this experiment.
 *
 * Shown before a delete, because "this will also remove two variant arms and
 * stop varying the footer" is the sentence that makes the delete safe to press.
 * Also shown on the test's own screen, so an editor can always answer "what is
 * this test actually changing" without opening every page.
 */
async function attachmentsOf(key) {
  const pages = await Page.find(
    { $or: [{ 'experiment.key': key }, { 'sections.experiment.key': key }] },
    { key: 1, title: 1, route: 1, experiment: 1, status: 1, sections: 1 },
  ).lean();

  const controls = [];
  const arms = [];
  const blocks = [];
  for (const page of pages) {
    if (page.experiment?.key === key) {
      const entry = {
        key: page.key, title: page.title, route: page.route,
        status: page.status, variant: page.experiment.variant,
      };
      if (page.experiment.variantOf) arms.push({ ...entry, variantOf: page.experiment.variantOf });
      else controls.push(entry);
    }
    for (const section of page.sections || []) {
      if (section.experiment?.key !== key) continue;
      blocks.push({
        pageKey: page.key, pageTitle: page.title,
        sectionKey: section.key, label: section.label,
        variants: (section.experiment.variants || []).length,
      });
    }
  }

  const chrome = await Chrome.findOne({ key: 'default' }).lean();
  const chromeParts = [];
  for (const part of ['navbar', 'footer']) {
    if (chrome?.[part]?.experiment?.key === key) chromeParts.push({ part });
  }
  for (const addIn of chrome?.addIns || []) {
    if (addIn.experiment?.key === key) chromeParts.push({ part: 'addIn', key: addIn.key, label: addIn.label });
  }

  return { controls, arms, blocks, chrome: chromeParts };
}

experimentsRouter.get('/:key/attachments', asyncHandler(async (req, res) => {
  const item = await Experiment.findOne({ key: req.params.key }).lean();
  if (!item) throw notFoundError('No such experiment');
  res.json(await attachmentsOf(req.params.key));
}));

/* ── Results ──────────────────────────────────────────────────────────────── */

experimentsRouter.get('/:key/results', asyncHandler(async (req, res) => {
  const item = await Experiment.findOne({ key: req.params.key }).lean();
  if (!item) throw notFoundError('No such experiment');
  const locale = req.query.locale ? String(req.query.locale) : null;
  res.json(await results(item, { locale }));
}));

/**
 * How big this test has to get before it can see what it is looking for.
 *
 * Answered from the baseline the editor types, or from the control's measured
 * rate once there is one — which is the more useful of the two, and the reason
 * this is a live endpoint rather than a number in the documentation.
 */
experimentsRouter.get('/:key/sample-size', asyncHandler(async (req, res) => {
  const item = await Experiment.findOne({ key: req.params.key }).lean();
  if (!item) throw notFoundError('No such experiment');

  const mde = Number(req.query.mde ?? 0.1);
  let baseline = req.query.baseline !== undefined ? Number(req.query.baseline) : null;
  let source = 'supplied';

  if (baseline === null) {
    const measured = await results(item, {});
    const primary = measured.goals?.[measured.primaryGoalKey];
    const control = primary?.arms?.find(a => a.isControl);
    if (control?.rate != null && control.exposures > 0) {
      baseline = control.rate / 100;
      source = 'measured';
    }
  }

  if (baseline === null) {
    return res.json({ perArm: null, reason: 'no baseline yet — supply one or wait for traffic on the control' });
  }
  res.json({ perArm: requiredSample(baseline, mde), baseline, mde, source });
}));

/* ── Creating and editing ─────────────────────────────────────────────────── */

const goalBody = z.object({
  key: z.string().min(1).max(60).regex(/^[a-z0-9-_]+$/),
  name: z.string().max(120).optional(),
  type: z.enum(['form', 'click', 'pageview', 'custom']).default('form'),
  formKey: z.string().max(80).optional(),
  selector: z.string().max(300).optional(),
  urlPattern: z.string().max(300).optional(),
  eventName: z.string().max(80).optional(),
  primary: z.boolean().optional(),
});

const experimentBody = z.object({
  key: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  hypothesis: z.string().max(4000).optional(),
  status: z.enum(['draft', 'running', 'paused', 'finished']).default('draft'),
  pageKey: z.string().max(80).nullable().optional(),
  scope: z.enum(['block', 'page', 'chrome']).default('block'),
  mode: z.enum(['cookie', 'param']).default('cookie'),
  paramName: z.string().max(40).default('version'),
  cookieDays: z.number().int().min(1).max(365).default(90),
  targeting: z.object({
    locales: z.array(z.string().max(5)).max(20).optional(),
    allocation: z.number().int().min(1).max(100).optional(),
  }).optional(),
  variants: z.array(z.object({
    key: z.string().min(1).max(20).regex(/^[A-Za-z0-9-]+$/),
    label: z.string().max(80).optional(),
    weight: z.number().int().min(0).max(100).default(50),
    isControl: z.boolean().optional(),
  })).min(2).max(6),
  goals: z.array(goalBody).max(10).optional(),
  guardrails: z.object({
    minExposuresPerArm: z.number().int().min(0).max(10_000_000).optional(),
    minRuntimeHours: z.number().int().min(0).max(8760).optional(),
    confidenceTarget: z.number().min(50).max(99.9).optional(),
  }).optional(),
  conclusion: z.string().max(4000).optional(),
});

/**
 * Exactly one control, and at most one primary goal.
 *
 * Enforced on write rather than interpreted on read: `controlOf()` falling back
 * to "the first arm" is a safety net for old records, not a licence to store a
 * test whose baseline depends on array order. Two arms both marked control is
 * a question with no correct answer, and the place to refuse it is here.
 */
function normalise(body) {
  const out = { ...body };
  if (out.variants) {
    /*
     * Arm keys must be distinct.
     *
     * Nothing checked this before, and the site is running a test whose two arms
     * are both keyed `seo`. Every consumer then agrees with itself and is
     * wrong: assignment walks the weights and always lands on the first match,
     * the control resolves to the same arm as the challenger, and the counters
     * merge both into one row — so the test reports a perfect tie for ever and
     * looks like it is working.
     */
    const keys = out.variants.map(v => v.key);
    const duplicate = keys.find((k, i) => keys.indexOf(k) !== i);
    if (duplicate) {
      throw badRequest(`Two arms are both keyed "${duplicate}". Arm keys identify the arm in `
        + 'cookies, in the results and in every block that names one, so they have to differ — '
        + 'the labels beside them are what visitors and reports read.');
    }

    const flagged = out.variants.filter(v => v.isControl);
    if (flagged.length > 1) throw badRequest('Only one arm can be the control');
    out.variants = out.variants.map((v, i) => ({
      ...v,
      label: v.label || (i === 0 ? 'Control' : `Variant ${v.key}`),
      isControl: flagged.length ? !!v.isControl : i === 0,
    }));
  }
  if (out.goals?.length) {
    const primaries = out.goals.filter(g => g.primary);
    if (primaries.length > 1) throw badRequest('Only one goal can be the primary one');
    out.goals = out.goals.map((g, i) => ({
      ...g,
      name: g.name || g.key,
      primary: primaries.length ? !!g.primary : i === 0,
    }));
  }
  return out;
}

experimentsRouter.post('/', requireRole('editor'), validate(experimentBody), asyncHandler(async (req, res) => {
  if (await Experiment.exists({ key: req.body.key })) throw conflict('A test with that key already exists');
  const body = normalise(req.body);
  const item = await Experiment.create({
    ...body,
    // Fixed once, at creation. Everything about who-sees-what hangs off this
    // value, so it must not be derived from anything an editor can rename.
    salt: crypto.randomBytes(8).toString('hex'),
    startedAt: body.status === 'running' ? new Date() : null,
  });
  await audit(req, 'experiment.create', 'experiment', item.key, { scope: item.scope });
  await publishChanged('experiment created');
  res.status(201).json({ item: item.toObject() });
}));

experimentsRouter.patch('/:key', requireRole('editor'), validate(experimentBody.partial()), asyncHandler(async (req, res) => {
  const item = await Experiment.findOne({ key: req.params.key });
  if (!item) throw notFoundError('No such experiment');

  // The key is in the assignment salt's neighbours, in every block that names
  // it, and in whatever already read the results. Changing it would orphan all
  // three.
  const { key: _ignored, ...rest } = req.body;
  const changes = normalise(rest);

  /*
   * Changing the split while a test is running invalidates what it has measured
   * so far: the visitors already counted were assigned under the old weights,
   * and mixing the two populations produces a number that describes neither.
   * Refused rather than silently allowed — restarting is cheap, a quietly
   * wrong result is not.
   */
  if (item.status === 'running' && changes.variants) {
    const before = JSON.stringify(item.variants.map(v => [v.key, v.weight]));
    const after = JSON.stringify(changes.variants.map(v => [v.key, v.weight]));
    if (before !== after) {
      throw conflict('Pause the test before changing its arms or weights — the visitors already '
        + 'counted were assigned under the current split, and mixing the two makes the result '
        + 'describe neither.');
    }
  }

  Object.assign(item, changes);
  if (changes.status === 'running' && !item.startedAt) item.startedAt = new Date();
  if (changes.status === 'finished') item.endedAt = new Date();
  await item.save();

  await audit(req, 'experiment.update', 'experiment', item.key, { status: item.status });
  await publishChanged('experiment updated');
  res.json({ item: item.toObject() });
}));

/* ── Lifecycle ────────────────────────────────────────────────────────────── */

/**
 * Start a test, refusing the states that make its result unreadable.
 *
 * All three refusals are things that are cheap to fix now and impossible to fix
 * afterwards: a test with no goal has measured nothing, a page-scoped test with
 * one arm has nothing to compare, and restarting after data exists silently
 * merges two populations.
 */
experimentsRouter.post('/:key/start', requireRole('editor'), asyncHandler(async (req, res) => {
  const item = await Experiment.findOne({ key: req.params.key });
  if (!item) throw notFoundError('No such experiment');
  if (item.status === 'running') return res.json({ item: item.toObject(), note: 'Already running.' });

  if (!item.goals?.length) {
    throw badRequest('Add a goal before starting: a test with nothing to measure cannot be read '
      + 'afterwards, and deciding what counts as success once the numbers are in is how tests '
      + 'get talked into having won.');
  }
  const attached = await attachmentsOf(item.key);
  const varying = attached.controls.length + attached.blocks.length + attached.chrome.length;
  if (!varying) {
    throw badRequest('Nothing is using this test yet. Attach it to a block, a page or the header '
      + 'and footer first, or it will split traffic between two identical experiences.');
  }
  if (item.scope === 'page' && !attached.arms.length) {
    throw badRequest('This page test has no variant arm yet — create one from the page\'s Variants tab.');
  }

  const measured = await ExperimentStat.countDocuments({ experiment: item.key });
  if (measured && item.status === 'finished') {
    throw conflict('This test has already finished with data recorded. Duplicate it instead: '
      + 'restarting would pool visitors from two different runs into one number.');
  }

  item.status = 'running';
  if (!item.startedAt) item.startedAt = new Date();
  item.endedAt = null;
  await item.save();
  await audit(req, 'experiment.start', 'experiment', item.key);
  await publishChanged('experiment started');
  res.json({ item: item.toObject() });
}));

experimentsRouter.post('/:key/pause', requireRole('editor'), asyncHandler(async (req, res) => {
  const item = await Experiment.findOne({ key: req.params.key });
  if (!item) throw notFoundError('No such experiment');
  item.status = 'paused';
  await item.save();
  await audit(req, 'experiment.pause', 'experiment', item.key);
  await publishChanged('experiment paused');
  // Everyone sees the control while paused, which is worth saying out loud:
  // "paused" reading as "frozen on whatever they last saw" is a real
  // expectation and it is not what happens.
  res.json({ item: item.toObject(), note: 'Every visitor now sees the control. Counting has stopped.' });
}));

/**
 * Finish a test and, optionally, keep the winning content.
 *
 * Promoting is the step that is usually done by hand and usually done wrong:
 * the test is switched off, everyone goes back to the control, and the change
 * that won is quietly lost. Doing it here means "this arm won" and "the site
 * now shows it" are one action.
 */
const finishBody = z.object({
  winner: z.string().max(20).nullable().optional(),
  conclusion: z.string().max(4000).optional(),
  promote: z.boolean().default(false),
});

experimentsRouter.post('/:key/finish', requireRole('editor'), validate(finishBody), asyncHandler(async (req, res) => {
  const item = await Experiment.findOne({ key: req.params.key });
  if (!item) throw notFoundError('No such experiment');

  const { winner, conclusion, promote } = req.body;
  if (winner && !item.variants.some(v => v.key === winner)) {
    throw badRequest(`"${winner}" is not one of this test's arms`);
  }

  if (promote && !winner) throw badRequest('Name the winning arm to promote it');
  const promoted = promote ? await promoteVariant(item, winner, req) : [];

  item.status = 'finished';
  item.endedAt = new Date();
  if (winner !== undefined) item.winner = winner;
  if (conclusion !== undefined) item.conclusion = conclusion;
  await item.save();

  await audit(req, 'experiment.finish', 'experiment', item.key, { winner, promoted: promoted.length });
  await publishChanged('experiment finished');
  res.json({ item: item.toObject(), promoted });
}));

/**
 * Make the winning arm's content the content everybody gets.
 *
 * Each attachment is snapshotted first, because this overwrites the control's
 * own content with the variant's and "put it back" has to stay available for
 * as long as somebody might change their mind.
 */
async function promoteVariant(experiment, winner, req) {
  const promoted = [];
  const pages = await Page.find({ $or: [{ 'experiment.key': experiment.key }, { 'sections.experiment.key': experiment.key }] });

  for (const page of pages) {
    let touched = false;
    await snapshot('page', page.key, page.toObject(), req.user, `before promoting "${winner}"`, { force: true });

    // Block-scoped: copy the winning variant's markup or field overrides onto
    // the block itself, then drop the variant list.
    for (const section of page.sections || []) {
      if (section.experiment?.key !== experiment.key) continue;
      const arm = (section.experiment.variants || []).find(v => v.key === winner);
      if (arm) {
        if (arm.html != null) section.html = arm.html;
        // A component block's variant is field overrides merged over the
        // control's data — the same merge `effectiveBlock()` does at compose
        // time, so what gets promoted is exactly what visitors were served.
        if (arm.data) section.data = { ...(section.data || {}), ...arm.data };
        section.markModified('data');
      }
      section.experiment = { key: null, variants: [] };
      section.markModified('experiment');
      touched = true;
      promoted.push({ kind: 'block', page: page.key, section: section.key, arm: winner });
    }

    // Page-scoped: the winning arm is a whole page document. Its content moves
    // onto the control; its URL, SEO and locales were never its own.
    if (page.experiment?.key === experiment.key && !page.experiment.variantOf) {
      const control = page.experiment.variant || controlOf(experiment);
      if (winner !== control) {
        const arm = await Page.findOne({
          'experiment.key': experiment.key,
          'experiment.variant': winner,
          'experiment.variantOf': page.key,
        }).lean();
        if (arm) {
          for (const field of ['doctype', 'htmlOpen', 'bodyOpen', 'bodyOpenRaw', 'headRaw', 'sections', 'snippets', 'jsonLd']) {
            page[field] = arm[field];
          }
          page.markModified('sections');
          promoted.push({ kind: 'page', page: page.key, arm: winner });
        }
      }
      page.experiment = { key: null, variant: null, variantOf: null };
      touched = true;
    }

    if (touched) {
      page.editedInCms = true;
      await page.save();
    }
  }
  return promoted;
}

/* ── Detaching and deleting ───────────────────────────────────────────────── */

/**
 * Take this test off everything that names it, without deleting the record.
 *
 * The endpoint this router most needed and did not have. A page that had
 * entered a page-scoped test could not leave it: nothing cleared
 * `page.experiment`, so the CMS kept reporting the page as an arm of a test
 * that might no longer exist.
 *
 * Variant arm pages are kept by default and turned into ordinary drafts at a
 * real route, because they are somebody's work — a `__variant/...` path is a
 * placeholder, not a decision to throw the content away.
 */
const detachBody = z.object({
  arms: z.enum(['keep', 'delete']).default('keep'),
});

experimentsRouter.post('/:key/detach', requireRole('editor'), validate(detachBody), asyncHandler(async (req, res) => {
  const key = req.params.key;
  const removed = await detachEverywhere(key, req, req.body.arms);
  await audit(req, 'experiment.detach', 'experiment', key, removed);
  await publishChanged('experiment detached');
  res.json({ ok: true, ...removed });
}));

async function detachEverywhere(key, req, armsMode = 'keep') {
  const removed = { pages: [], blocks: [], arms: [], chrome: [] };

  const pages = await Page.find({ $or: [{ 'experiment.key': key }, { 'sections.experiment.key': key }] });
  for (const page of pages) {
    await snapshot('page', page.key, page.toObject(), req.user, `before detaching "${key}"`, { force: true });
    let touched = false;

    for (const section of page.sections || []) {
      if (section.experiment?.key !== key) continue;
      section.experiment = { key: null, variants: [] };
      section.markModified('experiment');
      removed.blocks.push({ page: page.key, section: section.key });
      touched = true;
    }

    if (page.experiment?.key === key) {
      if (page.experiment.variantOf) {
        // An arm. Either it goes, or it becomes a page in its own right — which
        // needs a real route, because `__variant/...` was never an address.
        if (armsMode === 'delete') {
          await snapshot('page', page.key, page.toObject(), req.user, 'before delete', { force: true });
          await page.deleteOne();
          removed.arms.push({ key: page.key, action: 'deleted' });
          continue;
        }
        page.route = await freeRoute(page.key);
        page.routes = new Map();
        page.status = 'draft';
        page.noindex = true;
        page.experiment = { key: null, variant: null, variantOf: null };
        removed.arms.push({ key: page.key, action: 'kept', route: page.route });
        touched = true;
      } else {
        page.experiment = { key: null, variant: null, variantOf: null };
        removed.pages.push(page.key);
        touched = true;
      }
    }

    if (touched) await page.save();
  }

  const chrome = await Chrome.findOne({ key: 'default' });
  if (chrome) {
    let touched = false;
    for (const part of ['navbar', 'footer']) {
      if (chrome[part]?.experiment?.key !== key) continue;
      chrome[part].experiment = { key: null, variants: [] };
      chrome.markModified(part);
      removed.chrome.push({ part });
      touched = true;
    }
    for (const addIn of chrome.addIns || []) {
      if (addIn.experiment?.key !== key) continue;
      addIn.experiment = { key: null, variants: [] };
      removed.chrome.push({ part: 'addIn', key: addIn.key });
      touched = true;
    }
    if (touched) {
      chrome.markModified('addIns');
      await chrome.save();
    }
  }

  return removed;
}

/** A route an arm can be promoted to without colliding with a real page. */
async function freeRoute(base) {
  const clean = String(base).replace(/^__variant\//, '').replace(/^\/+|\/+$/g, '');
  let candidate = clean || 'variant';
  for (let n = 2; await Page.exists({ route: candidate }); n++) candidate = `${clean}-${n}`;
  return candidate;
}

/**
 * Delete the test and everything that pointed at it.
 *
 * The old delete removed the record only, which left blocks naming a key that
 * no longer resolved. That was survivable for a block — it falls back to its
 * control markup — but not for a page, whose `experiment.variantOf` keeps it
 * out of the route index: the arm became an unreachable document with no way
 * back. Deleting now detaches first, in the same request.
 */
experimentsRouter.delete('/:key', requireRole('editor'), asyncHandler(async (req, res) => {
  const item = await Experiment.findOne({ key: req.params.key });
  if (!item) throw notFoundError('No such experiment');

  const armsMode = req.query.arms === 'delete' ? 'delete' : 'keep';
  const removed = await detachEverywhere(req.params.key, req, armsMode);
  await Experiment.deleteOne({ key: req.params.key });

  // The counters outlive the record on purpose: deleting a test should not
  // silently destroy the measurement that justified whatever was shipped
  // because of it. `?stats=delete` is the deliberate way to drop them.
  let stats = 'kept';
  if (req.query.stats === 'delete') {
    const { deletedCount } = await ExperimentStat.deleteMany({ experiment: req.params.key });
    stats = `deleted ${deletedCount} row(s)`;
  }

  await audit(req, 'experiment.delete', 'experiment', req.params.key, { ...removed, stats });
  await publishChanged('experiment deleted');
  res.json({ ok: true, ...removed, stats });
}));

/**
 * Copy a test so the next iteration starts from what was learned.
 *
 * A finished test cannot be restarted (its counters describe the run that
 * finished), so the honest way to run "the same test but with a bigger
 * headline" is a new record. Doing it in one click is what makes that rule
 * something other than an obstacle.
 */
experimentsRouter.post('/:key/duplicate', requireRole('editor'), asyncHandler(async (req, res) => {
  const source = await Experiment.findOne({ key: req.params.key }).lean();
  if (!source) throw notFoundError('No such experiment');

  let key = `${source.key}-2`;
  for (let n = 2; await Experiment.exists({ key }); n++) key = `${source.key}-${n + 1}`;

  const item = await Experiment.create({
    ...source,
    _id: undefined, createdAt: undefined, updatedAt: undefined,
    key,
    name: `${source.name} (copy)`,
    status: 'draft',
    // A fresh salt, so the copy re-randomises. Reusing it would hand every
    // visitor the same arm they had last time, and a re-run whose population is
    // the previous run's population is not an independent test.
    salt: crypto.randomBytes(8).toString('hex'),
    startedAt: null, endedAt: null, winner: null, conclusion: '',
  });

  await audit(req, 'experiment.duplicate', 'experiment', key, { from: source.key });
  res.status(201).json({ item: item.toObject() });
}));
