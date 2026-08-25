import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

let nextId = 1;

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const dismiss = useCallback((id) => setItems(list => list.filter(t => t.id !== id)), []);

  const push = useCallback((message, tone = 'info', ttl = 4000) => {
    const id = nextId++;
    setItems(list => [...list, { id, message, tone }]);
    if (ttl) setTimeout(() => dismiss(id), ttl);
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({
    push,
    success: (m) => push(m, 'success'),
    error: (m) => push(typeof m === 'string' ? m : m?.message || 'Something went wrong', 'error', 7000),
    info: (m) => push(m, 'info'),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map(t => (
          <div key={t.id} className={`toast toast--${t.tone}`} onClick={() => dismiss(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
