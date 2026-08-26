/*
 * redis.js — cache plumbing.
 *
 * Every cached value is namespaced with a site revision number. Publishing
 * anything bumps the revision, which retires the whole previous generation in
 * one write instead of hunting for the keys that changed. Individual purges
 * still exist for the cases where precision matters (one page, one locale).
 *
 * The cache is optional: if Redis is unreachable the API keeps serving from
 * MongoDB. A marketing site going slightly slower beats a marketing site going
 * down.
 */
import Redis from 'ioredis';
import { config } from '../config.js';
import { logger } from './log.js';

let client = null;
let healthy = false;

export function getRedis() {
  if (client || !config.cache.enabled) return client;
  client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  });
  client.on('ready', () => { healthy = true; logger.info('redis ready'); });
  client.on('error', (err) => {
    if (healthy) logger.warn({ err: err.message }, 'redis error — serving uncached');
    healthy = false;
  });
  client.on('end', () => { healthy = false; });
  return client;
}

export const redisHealthy = () => healthy;

/**
 * Wait for the connection to come up.
 *
 * Short-lived processes — the seed, a one-off script — create the client and
 * use it in the same breath, long before the `ready` event fires. Without this
 * they would silently skip the cache invalidation and leave the site serving
 * yesterday's content.
 */
export function redisReady(timeoutMs = 3000) {
  const r = getRedis();
  if (!r) return Promise.resolve(false);
  if (healthy) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (value) => {
      clearTimeout(timer);
      r.off('ready', onReady);
      r.off('error', onError);
      resolve(value);
    };
    const onReady = () => done(true);
    const onError = () => done(false);
    const timer = setTimeout(() => done(false), timeoutMs);
    r.once('ready', onReady);
    r.once('error', onError);
  });
}

const REV_KEY = () => `${config.cache.prefix}:rev`;
let revCache = { value: null, at: 0 };

/** Current site revision; cached in-process for a second to avoid a round trip per request. */
export async function revision() {
  const now = Date.now();
  if (revCache.value !== null && now - revCache.at < 1000) return revCache.value;
  const r = getRedis();
  if (!r || !healthy) return revCache.value ?? '0';
  try {
    const v = (await r.get(REV_KEY())) || '0';
    revCache = { value: v, at: now };
    return v;
  } catch {
    return revCache.value ?? '0';
  }
}

/** Bump the revision — every cached page, catalogue and menu is now stale. */
export async function bumpRevision(reason = 'content change') {
  const r = getRedis();
  revCache = { value: null, at: 0 };
  if (!r) return null;
  if (!healthy && !(await redisReady())) return null;
  try {
    const v = await r.incr(REV_KEY());
    logger.info({ revision: v, reason }, 'cache revision bumped');
    return v;
  } catch (err) {
    logger.warn({ err: err.message }, 'could not bump cache revision');
    return null;
  }
}

function fullKey(rev, key) {
  return `${config.cache.prefix}:${rev}:${key}`;
}

export async function cacheGet(key) {
  const r = getRedis();
  if (!r || !healthy) return null;
  try {
    const raw = await r.get(fullKey(await revision(), key));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key, value, ttl = config.cache.ttl) {
  const r = getRedis();
  if (!r || !healthy) return false;
  try {
    await r.set(fullKey(await revision(), key), JSON.stringify(value), 'EX', ttl);
    return true;
  } catch {
    return false;
  }
}

/** Read-through helper. */
export async function cached(key, ttl, producer) {
  const hit = await cacheGet(key);
  if (hit !== null) return hit;
  const value = await producer();
  if (value !== undefined && value !== null) await cacheSet(key, value, ttl);
  return value;
}

export async function closeRedis() {
  if (client) {
    try { await client.quit(); } catch { client.disconnect(); }
    client = null;
  }
}
