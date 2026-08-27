import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { useId } from 'react';
import { cn } from '../../lib/cn.js';

export function Switch({ className, ...props }) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer focus-visible:border-ring focus-visible:ring-ring/40 inline-flex h-5 w-9 shrink-0 cursor-pointer',
        'items-center rounded-full border border-transparent shadow-xs transition-all outline-none',
        'focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'bg-card pointer-events-none block size-4 rounded-full ring-0 shadow-sm transition-transform',
          'data-[state=checked]:translate-x-4.5 data-[state=unchecked]:translate-x-0.5',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({ className, ...props }) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer border-input focus-visible:border-ring focus-visible:ring-ring/40 size-4 shrink-0 cursor-pointer',
        'rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check className="size-3 stroke-3" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/**
 * A checkbox with a clickable label and room for a line of explanation.
 *
 * `onChange` takes the boolean directly rather than an event: every caller in
 * this admin wanted the value and had to reach through `e.target.checked` for it.
 */
export function CheckboxField({ label, hint, checked, onChange, disabled, className, id: given }) {
  const generated = useId();
  const id = given || generated;
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <Checkbox
        id={id}
        checked={!!checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange?.(next === true)}
        className="mt-0.5"
      />
      <div className="grid gap-0.5">
        <label
          htmlFor={id}
          className={cn('text-[13px] leading-snug font-medium select-none', !disabled && 'cursor-pointer')}
        >
          {label}
        </label>
        {hint && <p className="text-muted-foreground text-[12px] leading-snug">{hint}</p>}
      </div>
    </div>
  );
}

/** The same, as a switch — for a setting that takes effect rather than a choice. */
export function SwitchField({ label, hint, checked, onChange, disabled, className, id: given }) {
  const generated = useId();
  const id = given || generated;
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <div className="min-w-0 grow">
        <label
          htmlFor={id}
          className={cn('text-[13px] leading-snug font-medium select-none', !disabled && 'cursor-pointer')}
        >
          {label}
        </label>
        {hint && <p className="text-muted-foreground mt-0.5 text-[12px] leading-snug">{hint}</p>}
      </div>
      <Switch
        id={id}
        checked={!!checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange?.(next === true)}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
}
