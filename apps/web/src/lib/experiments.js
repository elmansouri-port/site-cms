/*
 * experiments.js — A/B variant assignment, in server middleware.
 *
 * Assignment happens before anything renders, so the HTML the visitor receives
 * already is their variant: no flash, no layout shift, no hydration mismatch,
 * and a crawler sees a normal page.
 *
 * What changed, and why it matters more than it looks:
 *
 * Assignment used to be `Math.random()` per experiment, remembered in a cookie
 * per experiment. That is unreadable after the fact — asked why a session saw
 * B, nobody could answer — it re-rolled whenever a cookie was lost, so one
 * person could be counted in both arms, and it had no way to express "ramp this
 * to 10% of traffic first".
 *
 * Now there is one visitor id, and the arm is a pure function of it:
 * `assign()` in `@rainbow/core/experiments`, the same function the API uses to
 * check the split it is being told about. One cookie for the whole site instead
 * of one per test, an assignment that survives a cleared per-test cookie, and a
 * result that can be recomputed from the visitor id when somebody asks.
 *
 * URL-parameter variants remain a separate mode for ad campaigns: never
 * persisted, never counted, always noindex.
 */
import { config } from './config.js';
import { assign, variantFromParam, controlOf } from '@rainbow/core/experiments';

/**
 * A visitor id, minted on first sight.
 *
 * Not an identity and not linked to anything: a random value whose only job is
 * to make bucketing stable and countable. It is the reason a returning visitor
 * stays in the arm they were shown, which is a correctness property of the
 * measurement rather than a convenience — a person who flips arms between
 * visits pollutes both.
 */
export function visitorId(cookies) {
  const existing = cookies.get(config.visitorCookie)?.value;
  /*
   * Validated for shape, not for format.
   *
   * The check exists to stop an arbitrary cookie value reaching the hash and
   * the logs, not to enforce how the id was generated. An earlier version
   * allowed only `[a-z0-9]`, which rejects a hyphenated UUID — the single most
   * likely id anyone would ever set here — and a rejected id is re-minted,
   * which silently moves that visitor to a different arm on every request. An
   * id that survives is worth more to the measurement than an id that matches
   * a preferred format.
   */
  if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return { id: existing, fresh: false };
  const id = randomId();
  return { id, fresh: true };
}

function randomId() {
  // crypto.randomUUID exists in Node 19+ and in every runtime this ships on;
  // the fallback keeps `astro dev` working on an older local Node.
  try {
    return globalThis.crypto.randomUUID().replace(/-/g, '');
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

/**
 * Resolve every running experiment for this request.
 *
 * Returns the arm per experiment, plus the two facts the middleware needs
 * afterwards: whether a campaign parameter was used (never index that URL) and
 * which experiments are cookie-scoped (those responses cannot be shared-cached).
 */
export function resolveExperiments(experiments, { url, locale, visitor }) {
  const variants = {};
  const reasons = {};

  /*
   * A `?version=` URL is a campaign entry point and must not be indexed —
   * whether or not it names a variant that exists. Judging that on the
   * parameter alone means a typo in a campaign link cannot put a duplicate page
   * into the index.
   */
  const paramNames = new Set(['version']);
  for (const exp of experiments || []) {
    if (exp.mode === 'param') paramNames.add(exp.paramName || 'version');
  }
  const paramActive = [...paramNames].some(name => url.searchParams.has(name));

  /*
   * A forced arm, for QA. Deliberately separate from the campaign parameter:
   * `?ab_preview=key:B` shows an arm without entering the visitor into the test,
   * so checking a variant before launch does not put a fake exposure into the
   * results — which is exactly what happens when the only way to see B is to
   * keep reloading until you are assigned it.
   */
  const forced = {};
  for (const pair of (url.searchParams.get('ab_preview') || '').split(',')) {
    const [key, value] = pair.split(':');
    if (key && value) forced[key.trim()] = value.trim();
  }

  for (const exp of experiments || []) {
    if (forced[exp.key] && variantFromParam(exp, forced[exp.key])) {
      variants[exp.key] = forced[exp.key];
      reasons[exp.key] = 'forced';
      continue;
    }

    if (exp.mode === 'param') {
      const value = url.searchParams.get(exp.paramName || 'version');
      const match = value ? variantFromParam(exp, value) : null;
      if (!match) continue;
      variants[exp.key] = match;
      reasons[exp.key] = 'param';
      continue;
    }

    const { variant, reason } = assign(exp, visitor, { locale });
    reasons[exp.key] = reason;
    // Held back by the allocation means the visitor is not in the test at all
    // and must see the control — not nothing, and not a blank block.
    variants[exp.key] = variant || controlOf(exp);
    if (!variant) reasons[exp.key] = reason;
  }

  const modes = Object.fromEntries((experiments || []).map(e => [e.key, e.mode || 'cookie']));

  return { variants, reasons, paramActive, modes, forced };
}

/**
 * Which running experiments actually decided anything about this page.
 *
 * Assignment is computed for every running test on every request, because the
 * middleware does not yet know which page will be served. Acting on all of them
 * would make every response on the site visitor-specific, because any one of
 * them *might* have depended on an assignment. So the page records what it
 * really used, and only that suppresses shared caching and is reported as an
 * exposure.
 */
export function usedExperiments(page, variants, chrome = null) {
  const used = new Set();
  const consider = (key) => { if (key && variants[key] !== undefined) used.add(key); };

  // Whole-page test: the API tells us which experiment chose these sections.
  consider(page?.experimentKey);
  for (const section of page?.sections || []) {
    if (section.visible === false) continue;
    consider(section.experiment?.key);
  }

  // A header or footer test applies to every page, so it counts on every page —
  // which is exactly why it is worth knowing about: it makes the whole site
  // visitor-specific for as long as it runs.
  for (const part of ['navbar', 'footer']) {
    const slot = chrome?.[part];
    if (!slot || slot.visible === false) continue;
    if (page?.chrome && page.chrome[part] === false) continue;
    consider(slot.experiment?.key);
  }
  for (const addIn of chrome?.addIns || []) {
    if (!addIn.enabled) continue;
    if (addIn.pages?.length && page?.key && !addIn.pages.includes(page.key)) continue;
    consider(addIn.experiment?.key);
  }

  return used;
}

/**
 * Persist the visitor id.
 *
 * One cookie for the whole site, written on first sight rather than on first
 * assignment. Writing it lazily was the old behaviour's other flaw: the id has
 * to exist *before* the first test starts, or every visitor already on the site
 * is minted fresh the day a test launches and the first day's split is drawn
 * from a different population than the rest.
 */
export function writeVisitor(cookies, { id, fresh }, days = 365) {
  if (!fresh) return;
  cookies.set(config.visitorCookie, id, {
    path: '/',
    sameSite: 'lax',
    httpOnly: false, // the browser reports exposure and goals with it
    maxAge: days * 24 * 3600,
  });
}

/**
 * What the browser needs to report this page's experiments.
 *
 * Only the tests the page actually used, so the beacon script cannot report an
 * exposure for a test the visitor never saw.
 */
export function runtimeExperiments(experiments, variants, used, reasons = {}) {
  const out = [];
  for (const exp of experiments || []) {
    if (!used.has(exp.key)) continue;
    const variant = variants[exp.key];
    if (!variant) continue;
    out.push({
      key: exp.key,
      variant,
      // A forced or campaign arm is shown but never counted: QA and ad traffic
      // are not the population the test is measuring.
      count: reasons[exp.key] === 'assigned',
      goals: (exp.goals || []).map(g => ({
        key: g.key,
        type: g.type,
        formKey: g.formKey || '',
        selector: g.selector || '',
        urlPattern: g.urlPattern || '',
        eventName: g.eventName || '',
      })),
    });
  }
  return out;
}
