import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn.js';

export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-secondary text-secondary-foreground',
        primary: 'border-transparent bg-accent text-accent-foreground',
        success: 'border-success/25 bg-success/12 text-success',
        warning: 'border-warning/30 bg-warning/12 text-warning',
        destructive: 'border-destructive/25 bg-destructive/10 text-destructive',
        outline: 'text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({ className, variant, ...props }) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** The tone every status word in the admin gets, decided in exactly one place. */
const STATUS_TONE = {
  published: 'success',
  live: 'success',
  running: 'success',
  ok: 'success',
  active: 'success',
  draft: 'warning',
  paused: 'warning',
  scheduled: 'warning',
  pending: 'warning',
  new: 'primary',
  error: 'destructive',
  failed: 'destructive',
  spam: 'destructive',
  archived: 'outline',
  finished: 'outline',
  read: 'outline',
};

export function StatusBadge({ status, className }) {
  if (!status) return null;
  return (
    <Badge variant={STATUS_TONE[String(status).toLowerCase()] || 'default'} className={className}>
      {status}
    </Badge>
  );
}
