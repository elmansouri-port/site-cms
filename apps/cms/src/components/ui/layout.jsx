import { Search } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Input } from './input.jsx';

/**
 * The top of a screen: what this is, one line saying what it is for, and the
 * actions that belong to the whole screen.
 *
 * Every screen uses it, so no screen has to decide how big its own title is.
 */
export function PageHeader({ title, description, children, breadcrumb, className }) {
  return (
    <div className={cn('mb-5 flex flex-wrap items-start gap-4', className)}>
      <div className="min-w-0 grow">
        {breadcrumb && <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px]">{breadcrumb}</div>}
        <h1 className="text-[19px] leading-tight font-semibold">{title}</h1>
        {description && (
          <p className="text-muted-foreground mt-1 max-w-3xl text-[13px] leading-relaxed">{description}</p>
        )}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** A row of filters above a list. */
export function Toolbar({ className, ...props }) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)} {...props} />;
}

export function SearchInput({ className, ...props }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
      <Input type="search" className="pl-8" {...props} />
    </div>
  );
}

/**
 * A length gauge that turns green inside the range search results actually show.
 *
 * `good` is the [min, max] that reads well; `max` is where the bar ends.
 */
export function Meter({ value, good, max, className }) {
  const pct = Math.min(100, (value / max) * 100);
  const tone = value === 0
    ? 'bg-input'
    : value < good[0]
      ? 'bg-warning'
      : value <= good[1]
        ? 'bg-success'
        : 'bg-destructive';
  return (
    <div className={cn('bg-muted relative h-1 w-full overflow-hidden rounded-full', className)}>
      <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} />
      <span
        className="bg-foreground/25 absolute top-0 h-full w-px"
        style={{ left: `${(good[1] / max) * 100}%` }}
        aria-hidden="true"
      />
    </div>
  );
}

/** A label/value list — the "about this page" panels. */
export function DataList({ className, ...props }) {
  return <dl className={cn('grid min-w-0 gap-0', className)} {...props} />;
}

export function DataRow({ label, children, className }) {
  return (
    <div className={cn('flex min-w-0 items-center justify-between gap-4 border-b py-2 last:border-0', className)}>
      <dt className="text-muted-foreground text-[12.5px]">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[12.5px] font-medium">{children}</dd>
    </div>
  );
}

/** An inline path, key or identifier. */
export function Code({ className, ...props }) {
  return (
    <code
      className={cn('bg-muted text-muted-foreground rounded px-1 py-0.5 font-mono text-[12px]', className)}
      {...props}
    />
  );
}
