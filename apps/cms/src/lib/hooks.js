import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * Load a resource from the API and keep loading/error state with it.
 * `deps` behaves like a useEffect dependency list; `reload()` refetches.
 */
export function useResource(path, deps = [], { skip = false } = {}) {
  const [state, setState] = useState({ data: null, loading: !skip, error: null });
  const alive = useRef(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (skip || !path) {
      setState(s => ({ ...s, loading: false }));
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));
    api.get(path)
      .then((data) => { if (!cancelled) setState({ data, loading: false, error: null }); })
      .catch((error) => { if (!cancelled) setState({ data: null, loading: false, error }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, skip, ...deps]);

  const reload = useCallback(() => setNonce(n => n + 1), []);
  const patch = useCallback((updater) => setState(s => ({ ...s, data: updater(s.data) })), []);

  return { ...state, reload, patch };
}

/** Debounce a rapidly changing value (search boxes, inline editors). */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Track whether anything is unsaved, and warn before the tab closes. */
export function useDirtyGuard(dirty) {
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
