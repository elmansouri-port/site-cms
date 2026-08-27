import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { controlClasses } from './input.jsx';

/**
 * A native select, styled to match the rest of the controls.
 *
 * Radix's Select looks marginally better and behaves markedly worse in the two
 * places this admin needs one most: inside a scrolling dialog, and on a form
 * with fifteen of them. The native element keeps the platform's keyboard
 * handling, mobile picker and search-by-typing, and matching its skin to the
 * other controls costs one wrapper.
 */
export function Select({ className, options, children, placeholder, ...props }) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          controlClasses,
          'h-9 cursor-pointer appearance-none pr-8',
          !props.value && placeholder && 'text-muted-foreground',
          className,
        )}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {children
          || options?.map((o) => {
            const value = o?.value ?? o;
            return (
              <option key={String(value)} value={value}>
                {o?.label ?? o}
              </option>
            );
          })}
      </select>
      <ChevronDown
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2"
        aria-hidden="true"
      />
    </div>
  );
}
