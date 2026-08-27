import { cva } from 'class-variance-authority';
import { AlertCircle, Info, Loader2, TriangleAlert, CheckCircle2 } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { Button } from './button.jsx';

export function Spinner({ label, className }) {
  return (
    <div className={cn('text-muted-foreground flex items-center gap-2 py-8 text-[13px]', className)} role="status">
      <Loader2 className="size-4 animate-spin" />
      <span>{label || 'Loading…'}</span>
    </div>
  );
}

/** A grey block standing in for content that has not arrived yet. */
export function Skeleton({ className, ...props }) {
  return <div className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />;
}

/** The shape of a table while it loads, so the layout does not jump on arrival. */
export function SkeletonRows({ rows = 5, cols = 4 }) {
  return (
    <div className="grid gap-2 p-4">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton
              key={c}
              className="h-4"
              style={{ width: c === 0 ? '28%' : `${Math.max(10, 22 - c * 3)}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon: IconComponent, title, children, action, className }) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      {IconComponent && (
        <span className="bg-muted text-muted-foreground mb-3 flex size-11 items-center justify-center rounded-full">
          <IconComponent className="size-5" />
        </span>
      )}
      <h3 className="text-[14px] font-semibold">{title}</h3>
      {children && <p className="text-muted-foreground mt-1.5 max-w-md text-[12.5px] leading-relaxed">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry, className }) {
  if (!error) return null;
  return (
    <Empty icon={AlertCircle} title="That did not load" action={onRetry && <Button variant="outline" onClick={onRetry}>Try again</Button>} className={className}>
      {error.message}
      {error.details?.length ? ` — ${[].concat(error.details).join(', ')}` : ''}
    </Empty>
  );
}

const calloutVariants = cva('rounded-lg border px-3.5 py-3 text-[12.5px] leading-relaxed', {
  variants: {
    tone: {
      info: 'border-border bg-muted/60 text-muted-foreground',
      primary: 'border-primary/20 bg-accent/60 text-accent-foreground',
      warning: 'border-warning/30 bg-warning/8 text-warning',
      danger: 'border-destructive/25 bg-destructive/8 text-destructive',
      success: 'border-success/25 bg-success/8 text-success',
    },
  },
  defaultVariants: { tone: 'info' },
});

const CALLOUT_ICONS = {
  info: Info,
  primary: Info,
  warning: TriangleAlert,
  danger: AlertCircle,
  success: CheckCircle2,
};

/**
 * A note next to the control it is about.
 *
 * Used for the consequence of a setting, not for decoration: "a page with no
 * header is a landing page — make sure it has its own way back to the site".
 */
export function Callout({ tone = 'info', title, children, className, icon = true }) {
  const IconComponent = CALLOUT_ICONS[tone];
  return (
    <div className={cn(calloutVariants({ tone }), className)}>
      <div className="flex gap-2.5">
        {icon && IconComponent && <IconComponent className="mt-px size-3.5 shrink-0" />}
        <div className="min-w-0 [&_strong]:font-semibold">
          {title && <p className="text-foreground mb-1 text-[13px] font-semibold">{title}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}
