/*
 * /assets/partners.json — the URL the partner locator has always fetched.
 *
 * Keeping the path lets the authored page's JavaScript stay exactly as it was
 * while the directory itself becomes CMS-managed.
 *
 * ── Why this route works out the language ───────────────────────────────────
 *
 * The locator prints each partner's country on its card and groups its filter
 * dropdown by it, and those names come out of the source export in English —
 * inconsistently, at that: `USA`, `MEXICO`, `Utd.Arab.Emir.`. So the French page
 * listed English country names with two of them mangled.
 *
 * The page fetches a language-less URL, hard-coded in markup that is under the
 * byte-fidelity guarantee, so the language has to be worked out here rather than
 * asked for. Three sources, in descending order of how much they can be trusted:
 *
 *   1. `?locale=`, if a caller passes one. Nothing does today; it makes the
 *      endpoint testable and gives a future caller a way to be explicit.
 *   2. the `Referer`'s first path segment. This is a same-origin fetch from
 *      `/fr/trouver-un-partenaire`, and the default referrer policy sends the
 *      full path for same-origin requests — so it is present, and it is right.
 *   3. the locale cookie, for a browser that strips referrers.
 *
 * Falling through all three serves the export's own English, which is what the
 * page did before and is never worse than it.
 */
export const prerender = false;

import { apiGet } from '../../lib/api.js';
import { config } from '../../lib/config.js';

const LOCALE = /^[a-z]{2}$/;

/** The language this request is being made from, or null. */
function localeOf({ url, request, cookies }) {
  const asked = url.searchParams.get('locale');
  if (asked && LOCALE.test(asked)) return asked;

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const segment = new URL(referer).pathname.split('/').filter(Boolean)[0];
      if (segment && LOCALE.test(segment)) return segment;
    } catch { /* a referrer that is not a URL tells us nothing */ }
  }

  const cookie = cookies.get(config.localeCookie)?.value;
  if (cookie && LOCALE.test(cookie)) return cookie;

  return null;
}

export async function GET(context) {
  const locale = localeOf(context);
  const path = locale
    ? `/api/v1/site/partners?locale=${encodeURIComponent(locale)}`
    : '/api/v1/site/partners';

  let partners = [];
  try {
    partners = await apiGet(path, { ttl: 300 }) || [];
  } catch (err) {
    console.error('[partners] could not load directory:', err.message);
  }

  return new Response(JSON.stringify(partners), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
      /*
       * One URL, three answers.
       *
       * Without this a shared cache would hand the first language asked for to
       * everybody — a German visitor reading French country names, which is
       * worse than the English it replaced.
       */
      vary: 'Referer, Cookie',
    },
  });
}
