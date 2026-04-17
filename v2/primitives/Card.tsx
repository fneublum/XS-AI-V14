// Phase 3A — Card primitive. Linear/Vercel vibe: sharp-cornered panels with
// hairline borders (#1f1f1f), no shadows, subtle hover lift.

import React from 'react';
import { cn } from './utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, hoverable, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-md border border-[#1f1f1f] bg-[#0a0a0a]',
        hoverable && 'transition-colors hover:border-[#2a2a2a]',
        className,
      )}
      {...rest}
    />
  ),
);
Card.displayName = 'Card';

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className, ...rest
}) => (
  <div className={cn('px-4 py-2.5 border-b border-[#1f1f1f] flex items-center justify-between', className)} {...rest} />
);

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className, ...rest
}) => (
  <h3 className={cn('text-[13px] font-medium text-slate-100', className)} {...rest} />
);

export const CardBody: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className, ...rest
}) => (
  <div className={cn('p-4', className)} {...rest} />
);
