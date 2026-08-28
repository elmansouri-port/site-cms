import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from './cn.js';
import { describeError } from './apiErrors.js';

const ToastContext = createContext(null);

let nextId = 1;

const TONES = {
  success: { icon: CheckCircle2, className: 'border-success/30 bg-success/10 text-success' },
  error: { icon: XCircle, className: 'border-destructive/30 bg-destructive/10 text-destructive' },
  info: { icon: Info, className: 'border-border bg-card text-foreground' },
};

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
    /**
     * Errors take an `ApiError` as often as a string, and its `details` is where
     * a validation failure says which field it means — dropping it leaves an
     * editor with "Validation failed" and nothing to act on, and rendering it
     * naively left them with "[object Object]". See lib/apiErrors.js.
     */
    error: (err) => push(describeError(err), 'error', 7000),
    info: (m) => push(m, 'info'),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-70 flex flex-col items-center gap-2 p-4 sm:items-end"
        role="status"
        aria-live="polite"
      >
        {items.map((t) => {
          const tone = TONES[t.tone] || TONES.info;
          const IconComponent = tone.icon;
          return (
            <div
              key={t.id}
              className={cn(
                'animate-in slide-in-from-bottom-2 fade-in pointer-events-auto flex max-w-md items-start gap-2.5',
                'rounded-lg border px-3.5 py-2.5 text-[13px] leading-snug shadow-lg backdrop-blur-sm',
                tone.className,
              )}
            >
              <IconComponent className="mt-px size-4 shrink-0" />
              <span className="min-w-0 break-words">{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="-mr-1 ml-1 shrink-0 rounded p-0.5 opacity-60 transition hover:opacity-100"
                aria-label="Dismiss"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
