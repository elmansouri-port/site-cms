/*
 * /cms/revalidate — the publish webhook (reco.md 7).
 *
 * The CMS calls this with a shared secret after a publish; the frontend drops
 * the affected entries from its local cache so the next request rebuilds from
 * fresh content. Redis inside the API has already been retired by then, so
 * this only clears what the Astro process itself is holding.
 */
export const prerender = false;

import { purgeLocalCache, cacheSize } from '../../lib/api.js';
import { config } from '../../lib/config.js';

export async function POST({ request }) {
  const secret = request.headers.get('x-revalidate-secret');
  if (!secret || secret !== config.revalidateSecret) {
    return json({ error: 'Invalid secret' }, 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch { /* an empty body means "purge everything" */ }

  const before = cacheSize();
  let purged;
  if (body.locale && body.slug) purged = purgeLocalCache(`locale=${body.locale}`);
  else purged = purgeLocalCache();

  return json({ ok: true, purged, before, reason: body.reason || null });
}

export async function GET() {
  return json({ ok: true, entries: cacheSize() });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
