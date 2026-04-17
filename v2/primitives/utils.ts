// Phase 3B — className helper.
// clsx joins truthy classes; twMerge dedupes conflicting Tailwind utilities
// (e.g. `bg-slate-100 bg-slate-200` → `bg-slate-200`) so caller overrides win.

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...classes: ClassValue[]): string {
  return twMerge(clsx(classes));
}
