import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * Load a resource from the API and keep loading/error state with it.
 *
 * `deps` behaves like a useEffect dependency list; `reload()` refetches.
 *
 * A refetch is a **background** refresh: the previous data stays on screen and
 * `refreshing` goes true, rather than `loading` flipping back and the caller
 * unmounting its whole tree behind a spinner. That difference is not cosmetic —
 * every screen here reloads after a save, and remounting throws away the
 * transient state the save just produced. The undo offered after restoring a
 * version was disappearing exactly that way, at exactly the moment somebody
 * needed it.
 */
export function useResource(path, deps = [], { skip = false } = {}) {
  const [state, setState] = useState({ data: null, loading: !skip, refreshing: false, error: null });
  const [nonce, setNonce] = useState(0);
  // A refetch of the same path is a refresh; a change of path is a fresh load.
  const loadedPath = useRef(null);

  useEffect(() => {
    if (skip || !path) {
      setState(s => ({ ...s, loading: false }));
      return undefined;
    }
    let cancelled = false;
    const isRefresh = loadedPath.current === path;
    setState(s => ({
      ...s,
      loading: isRefresh ? false : true,
      refreshing: isRefresh,
      error: isRefresh ? s.error : null,
    }));

    api.get(path)
      .then((data) => {
        if (cancelled) return;
        loadedPath.current = path;
        setState({ data, loading: false, refreshing: false, error: null });
      })
      .catch((error) => {
        if (cancelled) return;
        // A failed refresh keeps the last good data on screen: a marketing CMS
        // that blanks the page because one poll failed is worse than a stale one.
        setState(s => ({ data: isRefresh ? s.data : null, loading: false, refreshing: false, error }));
      });

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
