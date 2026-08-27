/*
 * Collapsible panels, and the memory that makes them worth having.
 *
 * A builder screen is three or four panels wide, and which of them somebody
 * wants open depends on what they are doing: writing copy wants the preview
 * wide, wiring up an endpoint wants the delivery panel open and the preview out
 * of the way. Collapsing is only half of that — a panel that reopens on every
 * navigation is a panel you close again every time, so the state is persisted
 * per panel id and read back synchronously on the first render.
 *
 * `useCollapsed` exists separately because the two editor rails are not cards:
 * they are grid columns whose width changes, and they need the same memory
 * without the same chrome.
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn.js';

const STORAGE_PREFIX = 'cms.panel.';

function read(id, fallback) {
  try {
    const stored = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (stored === null) return fallback;
    return stored === '1';
  } catch {
    // Private browsing, or storage denied. A panel is not worth an exception.
    return fallback;
  }
}

/**
 * Whether a panel is open, remembered.
 *
 * Returns `[open, toggle, setOpen]`. The initial value is read during the first
 * render rather than in an effect, so a panel the editor closed last week does
 * not flash open before closing itself.
 */
export function useCollapsed(id, defaultOpen = true) {
  const [open, setOpen] = useState(() => read(id, defaultOpen));

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + id, open ? '1' : '0');
    } catch { /* see read() */ }
  }, [id, open]);

  const toggle = useCallback(() => setOpen(o => !o), []);
  return [open, toggle, setOpen];
}

/**
 * A titled panel that folds away.
 *
 * The header is a button, the whole width of it, because a 12px chevron is a
 * target somebody misses. `actions` sits outside that button so a Save inside a
 * panel header does not also collapse it.
 */
export function CollapsiblePanel({
  id,
  title,
  subtitle,
  icon: Icon,
  actions,
  badge,
  defaultOpen = true,
  className,
  bodyClassName,
  children,
}) {
  const [open, toggle] = useCollapsed(id, defaultOpen);

  return (
    <section className={cn('bg-card overflow-hidden rounded-xl border shadow-xs', className)}>
      <div className="flex items-center gap-1 border-b px-1.5 py-1.5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="hover:bg-muted flex min-w-0 grow items-center gap-2 rounded-md px-2 py-1 text-left transition-colors"
        >
          <ChevronDown
            className={cn(
              'text-muted-foreground size-3.5 shrink-0 transition-transform',
              !open && '-rotate-90',
            )}
          />
          {Icon && <Icon className="text-muted-foreground size-3.5 shrink-0" />}
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold">{title}</span>
            {subtitle && (
              <span className="text-muted-foreground block truncate text-[11.5px]">{subtitle}</span>
            )}
          </span>
          {badge}
        </button>
        {actions && <span className="flex shrink-0 items-center gap-1 pr-1">{actions}</span>}
      </div>
      {open && <div className={cn('p-3', bodyClassName)}>{children}</div>}
    </section>
  );
}
