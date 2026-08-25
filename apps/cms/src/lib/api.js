/*
 * api.js — the admin's HTTP client.
 *
 * Access tokens are short-lived and kept in memory only; the refresh token is
 * an http-only cookie the browser never exposes to JavaScript. A 401 triggers
 * one silent refresh and one retry, so a session that has been open all
 * afternoon does not interrupt someone mid-edit.
 */
const BASE = '/api/v1';

let accessToken = null;
let refreshing = null;
const listeners = new Set();

export function setToken(token) {
  accessToken = token;
  for (const fn of listeners) fn(token);
}
export const getToken = () => accessToken;
export function onTokenChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function refresh() {
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new ApiError(res.status, 'Session expired');
        const data = await res.json();
        setToken(data.token);
        return data;
      })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function request(path, { method = 'GET', body, headers = {}, raw = false, retry = true } = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(isForm ? {} : body ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && path !== '/auth/refresh' && path !== '/auth/login') {
    try {
      await refresh();
      return request(path, { method, body, headers, raw, retry: false });
    } catch {
      setToken(null);
    }
  }

  if (raw) return res;
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText, data?.details);
  return data;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path) => request(path, { method: 'DELETE' }),
  upload: (path, formData) => request(path, { method: 'POST', body: formData }),
  raw: (path, options) => request(path, { ...options, raw: true }),
  refresh,
};

/** Build a query string from a plain object, dropping empty values. */
export function qs(params = {}) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    out.set(k, String(v));
  }
  const s = out.toString();
  return s ? `?${s}` : '';
}
