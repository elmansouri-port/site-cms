import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge class names, letting a caller's utility win over a component's default.
 *
 * `clsx` flattens the conditionals; `twMerge` resolves the conflicts — without
 * it `cn('p-2', 'p-6')` emits both and the winner is whichever CSS rule the
 * bundler happened to order last.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
