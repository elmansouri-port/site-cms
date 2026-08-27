import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/cn.js';

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }) {
  return (
    <TabsPrimitive.List
      className={cn('flex items-center gap-1 overflow-x-auto border-b', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, count, children, ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'text-muted-foreground relative -mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent',
        'px-3 py-2 text-[13px] font-medium whitespace-nowrap transition-colors',
        'hover:text-foreground focus-visible:ring-ring/40 rounded-t-md outline-none focus-visible:ring-[3px]',
        'data-[state=active]:border-primary data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && count !== null && (
        <span className="bg-muted text-muted-foreground rounded px-1 text-[11px] tabular-nums">{count}</span>
      )}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ className, ...props }) {
  return (
    <TabsPrimitive.Content
      className={cn('focus-visible:ring-ring/40 rounded-md outline-none focus-visible:ring-[3px]', className)}
      {...props}
    />
  );
}

/**
 * A segmented control: a small set of mutually exclusive choices that switch a
 * view rather than navigate — a language, a breakpoint, a filter.
 */
export function Segmented({ options, value, onChange, className, size = 'default' }) {
  return (
    <div
      role="radiogroup"
      className={cn('bg-muted inline-flex items-center gap-0.5 rounded-md p-0.5', className)}
    >
      {options.map((option) => {
        const optionValue = option?.value ?? option;
        const label = option?.label ?? option;
        const active = value === optionValue;
        return (
          <button
            key={String(optionValue)}
            type="button"
            role="radio"
            aria-checked={active}
            title={option?.title}
            onClick={() => onChange(optionValue)}
            className={cn(
              'focus-visible:ring-ring/40 rounded-[5px] font-medium transition-colors outline-none focus-visible:ring-[3px]',
              size === 'sm' ? 'px-2 py-0.5 text-[11.5px]' : 'px-2.5 py-1 text-[12.5px]',
              active
                ? 'bg-card text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
