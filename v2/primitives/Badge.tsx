// Phase 3A — Badge primitive. Linear/Vercel: thin border + tinted bg, tiny text.

import React from 'react';
import { cn } from './utils';

type Variant = 'neutral' | 'success' | 'info' | 'warning' | 'danger';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
  dot?: boolean;
}

const variantClasses: Record<Variant, string> = {
  neutral: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  info:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  warning: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  danger:  'bg-red-500/10 text-red-400 border-red-500/20',
};

const dotClasses: Record<Variant, string> = {
  neutral: 'bg-slate-400',
  success: 'bg-emerald-400',
  info:    'bg-blue-400',
  warning: 'bg-amber-400',
  danger:  'bg-red-400',
};

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral', dot, className, children, ...rest
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded border',
      variantClasses[variant],
      className,
    )}
    {...rest}
  >
    {dot && <span className={cn('h-1 w-1 rounded-full', dotClasses[variant])} aria-hidden />}
    {children}
  </span>
);
