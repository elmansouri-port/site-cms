import { cn } from '../../lib/cn.js';

/**
 * A data table.
 *
 * The wrapper scrolls horizontally rather than the page: a wide table on a
 * narrow window should not push the whole layout sideways, which is what makes
 * the sidebar drift away from the left edge.
 */
export function Table({ className, containerClassName, ...props }) {
  return (
    <div className={cn('w-full overflow-x-auto', containerClassName)}>
      <table className={cn('w-full caption-bottom text-[13px]', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }) {
  return (
    <thead
      className={cn(
        'bg-muted/50 [&_th]:text-muted-foreground border-b [&_th]:h-9 [&_th]:px-4 [&_th]:text-left',
        '[&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:tracking-wide [&_th]:uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function TBody({ className, ...props }) {
  return (
    <tbody
      className={cn(
        '[&_tr]:border-b [&_tr:last-child]:border-0 [&_td]:px-4 [&_td]:py-2.5 [&_td]:align-middle',
        className,
      )}
      {...props}
    />
  );
}

export function TRow({ className, interactive = false, ...props }) {
  return (
    <tr
      className={cn('transition-colors', interactive && 'hover:bg-muted/50', className)}
      {...props}
    />
  );
}

/** A right-aligned last column holding row actions. */
export function TActions({ className, ...props }) {
  return <td className={cn('text-right whitespace-nowrap', className)} {...props} />;
}
