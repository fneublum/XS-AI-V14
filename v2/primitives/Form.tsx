// Phase 3A — Form primitives (uncontrolled helpers).
// Focused on accessible label/description/error wiring. Form state itself
// is the caller's problem — pair with react-hook-form in Phase 3B.

import React from 'react';
import { cn } from './utils';

export const FormField: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children, className,
}) => (
  <div className={cn('flex flex-col gap-1', className)}>{children}</div>
);

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}
export const Label: React.FC<LabelProps> = ({ required, className, children, ...rest }) => (
  <label className={cn('text-sm font-medium text-slate-700', className)} {...rest}>
    {children}
    {required && <span aria-hidden className="ml-0.5 text-red-600">*</span>}
  </label>
);

export const Description: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  className, ...rest
}) => (
  <p className={cn('text-xs text-slate-500', className)} {...rest} />
);

export const ErrorText: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  className, ...rest
}) => (
  <p role="alert" className={cn('text-xs text-red-600', className)} {...rest} />
);
