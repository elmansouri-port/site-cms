/*
 * /assets/partners.json — the URL the partner locator has always fetched.
 *
 * Keeping the path lets the authored page's JavaScript stay exactly as it was
 * while the directory itself becomes CMS-managed.
 */
export const prerender = false;

import { apiGet } from '../../lib/api.js';

export async function GET() {
  let partners = [];
  try {
    partners = await apiGet('/api/v1/site/partners', { ttl: 300 }) || [];
  } catch (err) {
    console.error('[partners] could not load directory:', err.message);
  }

  return new Response(JSON.stringify(partners), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
