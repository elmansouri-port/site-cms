import { cn } from '../../lib/cn.js';

/**
 * The shared shape of every text control.
 *
 * Kept as one string rather than repeated per component so an input, a textarea
 * and a native select cannot end up a pixel apart from each other.
 */
export const controlClasses =
  'flex w-full min-w-0 rounded-md border bg-card px-2.5 py-1.5 text-[13px] shadow-xs transition-[color,box-shadow] '
  + 'placeholder:text-muted-foreground/70 '
  + 'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 outline-none '
  + 'disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-muted '
  + 'aria-invalid:border-destructive aria-invalid:ring-destructive/25';

export function Input({ className, type = 'text', mono = false, ...props }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        controlClasses,
        'h-9',
        mono && 'font-mono text-[12.5px]',
        'file:text-foreground file:mr-3 file:border-0 file:bg-transparent file:text-[12.5px] file:font-medium',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, mono = false, rows = 4, ...props }) {
  return (
    <textarea
      data-slot="textarea"
      rows={rows}
      className={cn(controlClasses, 'field-sizing-content min-h-16 resize-y', mono && 'font-mono text-[12.5px]', className)}
      {...props}
    />
  );
}
