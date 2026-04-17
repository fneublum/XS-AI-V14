// Phase 3B — Empty state and error state.
// Linear-style: centered, muted, minimal.

import React from 'react';
import { cn } from './utils';
import { Button } from './Button';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
  tone?: 'neutral' | 'danger';
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title, description, action, className, tone = 'neutral',
}) => (
  <div className={cn(
    'flex flex-col items-center justify-center text-center py-10 px-6',
    className,
  )}>
    <div
      className={cn(
        'w-10 h-10 rounded-full border flex items-center justify-center mb-3',
        tone === 'danger'
          ? 'border-red-500/30 bg-red-500/5 text-red-400'
          : 'border-[#1f1f1f] bg-[#0f0f0f] text-slate-500',
      )}
      aria-hidden
    >
      <span className="text-sm">{tone === 'danger' ? '!' : '·'}</span>
    </div>
    <div className="text-[13px] font-medium text-slate-200">{title}</div>
    {description && (
      <div className="text-[12px] text-slate-500 mt-1 max-w-sm">{description}</div>
    )}
    {action && (
      <Button
        variant="secondary"
        size="sm"
        className="mt-3 h-7 px-3 text-[12px] bg-[#161616] text-slate-200 hover:bg-[#1f1f1f] border border-[#1f1f1f]"
        onClick={action.onClick}
      >
        {action.label}
      </Button>
    )}
  </div>
);
