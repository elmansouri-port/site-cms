import { useId } from 'react';
import { cn } from '../../lib/cn.js';

export function Label({ className, ...props }) {
  return (
    <label
      data-slot="label"
      className={cn('text-[12.5px] leading-none font-medium select-none', className)}
      {...props}
    />
  );
}

/**
 * A labelled control, with room for the two things a form actually needs to say:
 * what this is for, and what is wrong with it.
 *
 * The hint is not decoration. Nearly every field in this admin has a
 * consequence an editor cannot guess — renaming a route writes a redirect,
 * turning off the header makes a landing page — and the hint is where that is
 * stated, next to the control rather than in a manual.
 */
export function Field({ label, hint, error, children, htmlFor, className, inline = false }) {
  const generated = useId();
  const id = htmlFor || generated;
  const control = typeof children === 'function' ? children(id) : children;

  if (inline) {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        {label && <Label htmlFor={id}>{label}</Label>}
        <div className="ml-auto">{control}</div>
      </div>
    );
  }

  return (
    <div data-slot="field" className={cn('grid gap-1.5', className)}>
      {label && <Label htmlFor={id}>{label}</Label>}
      {control}
      {hint && !error && <p className="text-muted-foreground text-[12px] leading-snug">{hint}</p>}
      {error && <p className="text-destructive text-[12px] leading-snug">{error}</p>}
    </div>
  );
}

/** A row of fields that becomes one column when there is no room for two. */
export function FieldRow({ className, cols = 2, ...props }) {
  return (
    <div
      className={cn('grid gap-4', cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2', className)}
      {...props}
    />
  );
}

/** Vertical rhythm inside a card body, so no screen invents its own spacing. */
export function FieldSet({ className, ...props }) {
  return <div className={cn('grid gap-4', className)} {...props} />;
}

/** A heading inside a long form, where a second card would be too heavy. */
export function FieldGroupLabel({ className, children, hint, ...props }) {
  return (
    <div className={cn('border-b pb-2', className)} {...props}>
      <h3 className="text-[12px] font-semibold tracking-wide uppercase">{children}</h3>
      {hint && <p className="text-muted-foreground mt-1 text-[12px] normal-case">{hint}</p>}
    </div>
  );
}
