/*
 * experiments.js — A/B variant assignment (reco.md 3).
 *
 * Assignment happens in server middleware, before anything renders, and the
 * chosen variant is written to a cookie. That is the whole point: the HTML the
 * visitor receives already is their variant, so there is no flash, no layout
 * shift and no hydration mismatch — and a crawler sees a normal page.
 *
 * URL-parameter variants are a separate mode for ad campaigns: session-scoped,
 * never persisted, and always noindex.
 */
import { config } from './config.js';

const cookieName = (key) => `${config.abCookiePrefix}${key}`;

function pickWeighted(variants) {
  const total = variants.reduce((sum, v) => sum + (v.weight ?? 0), 0);
  if (total <= 0) return variants[0]?.key ?? null;
  let roll = Math.random() * total;
  for (const v of variants) {
    roll -= v.weight ?? 0;
    if (roll <= 0) return v.key;
  }
  return variants[variants.length - 1].key;
}

/**
 * Resolve every running experiment for this request.
 * Returns { variants: {key: variantKey}, assignments: [...], paramActive: bool }
 */
export function resolveExperiments(experiments, { cookies, url }) {
  const variants = {};
  const assignments = [];

  // A `?version=` URL is a campaign entry point and must not be indexed
  // (reco.md 3.2 and 5.1) — whether or not it names a variant that exists.
  // Judging that on the parameter alone means a typo in a campaign link cannot
  // accidentally put a duplicate page into the index.
  const paramNames = new Set(['version']);
  for (const exp of experiments || []) {
    if (exp.mode === 'param') paramNames.add(exp.paramName || 'version');
  }
  let paramActive = [...paramNames].some(name => url.searchParams.has(name));

  for (const exp of experiments || []) {
    if (exp.mode === 'param') {
      const value = url.searchParams.get(exp.paramName || 'version');
      if (!value) continue;
      const match = (exp.variants || []).find(v => v.key === value);
      if (!match) continue;
      // Campaign entry points are never remembered: no cookie is written.
      variants[exp.key] = match.key;
      continue;
    }

    const existing = cookies.get(cookieName(exp.key))?.value;
    const known = (exp.variants || []).some(v => v.key === existing);
    if (known) {
      variants[exp.key] = existing;
      continue;
    }
    const chosen = pickWeighted(exp.variants || []);
    if (!chosen) continue;
    variants[exp.key] = chosen;
    assignments.push({ name: cookieName(exp.key), value: chosen, days: exp.cookieDays || 14 });
  }

  return { variants, assignments, paramActive };
}

/** Persist newly assigned variants for the configured window. */
export function writeAssignments(cookies, assignments) {
  for (const a of assignments) {
    cookies.set(a.name, a.value, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false, // analytics reads it client-side to tag the session
      maxAge: a.days * 24 * 3600,
    });
  }
}
