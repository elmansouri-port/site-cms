import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Button } from './button.jsx';

const ConfirmContext = createContext(null);

/**
 * One confirmation dialogue for the whole admin, awaited like `window.confirm`.
 *
 *   if (!await confirm({ title: 'Delete this block?', tone: 'danger' })) return;
 *
 * The browser's own `confirm` was doing this job. It cannot be styled, it names
 * the origin rather than the product, it truncates, and it blocks the event
 * loop — so it looks like a bug to anybody who has not seen one since 2009. The
 * more useful difference is that this one can say what the consequence is, which
 * is the only thing worth reading in a destructive prompt.
 */
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((options) => {
    // Accept a bare string for the many one-line cases.
    const next = typeof options === 'string' ? { title: options } : options || {};
    setRequest(next);
    return new Promise((resolve) => { resolver.current = resolve; });
  }, []);

  const settle = useCallback((answer) => {
    setRequest(null);
    resolver.current?.(answer);
    resolver.current = null;
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AlertDialogPrimitive.Root open={!!request} onOpenChange={(open) => { if (!open) settle(false); }}>
        <AlertDialogPrimitive.Portal>
          <AlertDialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-60 bg-black/45 backdrop-blur-[1px]" />
          <AlertDialogPrimitive.Content
            className={cn(
              'bg-card data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
              'data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
              'fixed top-1/2 left-1/2 z-60 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2',
              'rounded-xl border p-5 shadow-2xl duration-150',
            )}
          >
            <div className="flex gap-3.5">
              {request?.tone === 'danger' && (
                <span className="bg-destructive/10 text-destructive flex size-9 shrink-0 items-center justify-center rounded-full">
                  <AlertTriangle className="size-4.5" />
                </span>
              )}
              <div className="min-w-0">
                <AlertDialogPrimitive.Title className="text-[15px] leading-snug font-semibold">
                  {request?.title || 'Are you sure?'}
                </AlertDialogPrimitive.Title>
                {request?.body && (
                  <AlertDialogPrimitive.Description asChild>
                    <div className="prose-sm mt-2">{request.body}</div>
                  </AlertDialogPrimitive.Description>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialogPrimitive.Cancel asChild>
                <Button variant="outline">{request?.cancelLabel || 'Cancel'}</Button>
              </AlertDialogPrimitive.Cancel>
              <AlertDialogPrimitive.Action asChild>
                <Button
                  variant={request?.tone === 'danger' ? 'destructive' : 'default'}
                  onClick={() => settle(true)}
                >
                  {request?.confirmLabel || 'Confirm'}
                </Button>
              </AlertDialogPrimitive.Action>
            </div>
          </AlertDialogPrimitive.Content>
        </AlertDialogPrimitive.Portal>
      </AlertDialogPrimitive.Root>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside ConfirmProvider');
  return ctx.confirm;
}
