/*
 * api.js — the frontend's view of the content API.
 *
 * Two layers of cache sit between a request and MongoDB: Redis inside the API,
 * and a small in-process map here. The local one exists because a page render
 * needs the same settings, catalogue and route index every time, and a hot
 * marketing homepage should not open four HTTP connections to answer a request
 * that has not changed in ten minutes.
 *
 * Everything degrades rather than fails: a stale entry is served if the API is
 * unreachable, because the last known copy of the homepage is worth more than
 * an error page.
 */
import { config } from './config.js';

const store = new Map();

function put(key, value, ttl) {
  store.set(key, { value, expires: Date.now() + ttl * 1000, stale: value });
}

/** Fetch JSON with a local TTL cache and stale-on-error fallback. */
export async function apiGet(path, { ttl = config.cacheTtl, preview = false, signal } = {}) {
  const key = `${preview ? 'p' : 'l'}:${path}`;
  const hit = store.get(key);
  if (!preview && hit && hit.expires > Date.now()) return hit.value;

  const headers = { accept: 'application/json' };
  if (preview) headers['x-preview-secret'] = config.previewSecret;

  try {
    const res = await fetch(`${config.apiUrl}${path}`, {
      headers,
      signal: signal ?? AbortSignal.timeout(8000),
    });
    if (res.status === 404) {
      if (!preview) put(key, null, Math.min(ttl, 15));
      return null;
    }
    if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
    const data = await res.json();
    if (!preview) put(key, data, ttl);
    return data;
  } catch (err) {
    if (hit) {
      console.warn(`[api] ${path} failed (${err.message}) — serving cached copy`);
      return hit.stale;
    }
    throw err;
  }
}

export async function apiPost(path, body, { headers = {} } = {}) {
  const res = await fetch(`${config.apiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return res.json();
}

/** Drop the local cache — called by the revalidation webhook after a publish. */
export function purgeLocalCache(prefix = '') {
  if (!prefix) {
    const n = store.size;
    store.clear();
    return n;
  }
  let n = 0;
  for (const key of store.keys()) {
    if (key.includes(prefix)) { store.delete(key); n++; }
  }
  return n;
}

export const cacheSize = () => store.size;
