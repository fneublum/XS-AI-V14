// Phase 3A — Input primitive. Paired with <Form /> for labels + error messages.

import React from 'react';
import { cn } from './utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...rest }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full rounded-md border bg-white px-3 text-sm text-slate-900 shadow-sm',
        'placeholder:text-slate-400',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-0',
        'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
        invalid ? 'border-red-500' : 'border-slate-300',
        className,
      )}
      {...rest}
    />
  ),
);
Input.displayName = 'Input';
