/*
 * endpoints.js — route third-party calls through this origin.
 *
 * The authored pages call automation webhooks directly from the browser, with
 * the automation host written into the markup. That publishes three things a
 * marketing site should not publish: which automation platform runs the
 * business's lead flow, the exact webhook path for every form, and an endpoint
 * anybody can post to all day without touching the site at all.
 *
 * The fix is an indirection, not a rewrite of the pages: every authored
 * endpoint becomes a path on this origin, and the server makes the outbound
 * call. The substitution happens at render time, so the authored templates keep
 * saying what they always said and the mapping stays editable in the CMS.
 *
 * The rule is deliberately dumb — exact string replacement of a known URL — and
 * the map is data. That is what lets the verification tools reproduce the
 * transformation from `content-source/integrations.json` without holding any
 * credential.
 */

/** Where a proxied integration answers, given its slug. */
export function proxyPath(slug) {
  return `/api/v1/hooks/${slug}`;
}

/**
 * Replace every mapped upstream URL with its path on this origin.
 *
 * Longest URL first, so an integration at `…/booking` cannot eat the prefix of
 * `…/booking-cancel` and leave a dangling suffix. Only exact occurrences are
 * touched: no regex over the markup, nothing inferred from the host.
 */
export function rewriteEndpoints(html, integrations) {
  if (!html || !integrations?.length) return html;

  const mappings = integrations
    .filter(i => i && i.url && i.slug && i.enabled !== false)
    .sort((a, b) => b.url.length - a.url.length);

  let out = html;
  for (const { url, slug } of mappings) {
    if (!out.includes(url)) continue;
    out = out.split(url).join(proxyPath(slug));
  }
  return out;
}

/** Which mapped endpoints appear in a piece of markup. Used by the tools. */
export function endpointsIn(html, integrations) {
  return (integrations || []).filter(i => i?.url && html.includes(i.url)).map(i => i.slug);
}
