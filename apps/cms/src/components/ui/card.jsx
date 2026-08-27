import { cn } from '../../lib/cn.js';

export function Card({ className, ...props }) {
  return (
    <div
      data-slot="card"
      className={cn('bg-card text-card-foreground flex flex-col rounded-xl border shadow-xs', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'flex min-h-13 items-center gap-3 border-b px-4 py-3',
        // A header with actions on the right: the title takes the slack.
        '[&>[data-slot=card-actions]]:ml-auto',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }) {
  return <h2 data-slot="card-title" className={cn('text-[13.5px] leading-tight font-semibold', className)} {...props} />;
}

export function CardDescription({ className, ...props }) {
  return (
    <p data-slot="card-description" className={cn('text-muted-foreground text-[12.5px]', className)} {...props} />
  );
}

export function CardActions({ className, ...props }) {
  return <div data-slot="card-actions" className={cn('flex items-center gap-2', className)} {...props} />;
}

export function CardContent({ className, ...props }) {
  return <div data-slot="card-content" className={cn('p-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }) {
  return (
    <div
      data-slot="card-footer"
      className={cn('bg-muted/40 flex items-center gap-2 rounded-b-xl border-t px-4 py-3', className)}
      {...props}
    />
  );
}
