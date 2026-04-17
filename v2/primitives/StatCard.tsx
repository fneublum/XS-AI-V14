// Phase 3A — Stat card. Linear-style: tight label, mono number, delta hint.

import React from 'react';
import { cn } from './utils';

interface StatCardProps {
  label: string;
  value: string;
  delta?: { text: string; tone?: 'positive' | 'negative' | 'neutral' | 'warning' };
}

const deltaTone: Record<NonNullable<NonNullable<StatCardProps['delta']>['tone']>, string> = {
  positive: 'text-emerald-400',
  negative: 'text-red-400',
  warning:  'text-amber-400',
  neutral:  'text-slate-500',
};

export const StatCard: React.FC<StatCardProps> = ({ label, value, delta }) => (
  <div className="bg-[#0a0a0a] p-4">
    <div className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
      {label}
    </div>
    <div className="font-mono tabular-nums text-[26px] font-semibold text-slate-100 mt-1">
      {value}
    </div>
    {delta && (
      <div className={cn('text-[11px] font-mono tabular-nums mt-1', deltaTone[delta.tone ?? 'neutral'])}>
        {delta.text}
      </div>
    )}
  </div>
);

interface StatGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4 | 5;
}

const columnClasses: Record<NonNullable<StatGridProps['columns']>, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
};

export const StatGrid: React.FC<StatGridProps> = ({ children, columns = 4 }) => (
  <div className={cn(
    'grid gap-px bg-[#1f1f1f] border border-[#1f1f1f] rounded-md overflow-hidden',
    columnClasses[columns],
  )}>
    {children}
  </div>
);
