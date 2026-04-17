// Phase 3B — Shared "module landing" layout for AI / placeholder pages.
// Tight hero + action cards + optional recent activity feed.

import React from 'react';
import { Card, Badge } from '../primitives';
import { cn } from '../primitives/utils';

export interface ModuleAction {
  id: string;
  label: string;
  description?: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface ModuleStat {
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'warning';
}

interface ModuleLandingProps {
  title: string;
  description: string;
  badge?: string;                     // e.g. "Beta" next to the title
  stats?: ModuleStat[];
  actions?: ModuleAction[];
  recent?: React.ReactNode;           // activity feed etc.
  className?: string;
}

const statTone: Record<NonNullable<ModuleStat['tone']>, string> = {
  neutral:  'text-slate-100',
  positive: 'text-emerald-400',
  warning:  'text-amber-400',
};

export const ModuleLanding: React.FC<ModuleLandingProps> = ({
  title, description, badge, stats, actions, recent, className,
}) => (
  <div className={cn('max-w-5xl', className)}>
    <div className="mb-8">
      <div className="flex items-center gap-2">
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">{title}</h1>
        {badge && <Badge variant="info">{badge}</Badge>}
      </div>
      <p className="text-[13px] text-slate-500 mt-1 max-w-2xl">{description}</p>
    </div>

    {stats && stats.length > 0 && (
      <div className={cn(
        'grid gap-px bg-[#1f1f1f] border border-[#1f1f1f] rounded-md overflow-hidden mb-8',
        stats.length === 2 ? 'grid-cols-2' : stats.length === 3 ? 'grid-cols-3' : 'grid-cols-4',
      )}>
        {stats.map(s => (
          <div key={s.label} className="bg-[#0a0a0a] p-4">
            <div className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
              {s.label}
            </div>
            <div className={cn('font-mono tabular-nums text-[22px] font-semibold mt-1', statTone[s.tone ?? 'neutral'])}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
    )}

    {actions && actions.length > 0 && (
      <div className="grid grid-cols-2 gap-3 mb-8">
        {actions.map(a => (
          <button
            key={a.id}
            type="button"
            onClick={a.onClick}
            disabled={a.disabled}
            className={cn(
              'text-left p-4 rounded-md border transition-colors',
              a.disabled
                ? 'border-[#161616] bg-[#0a0a0a] opacity-50 cursor-not-allowed'
                : 'border-[#1f1f1f] bg-[#0a0a0a] hover:border-[#2a2a2a] hover:bg-[#111111]',
            )}
          >
            <div className="text-[13px] font-medium text-slate-100">{a.label}</div>
            {a.description && (
              <div className="text-[12px] text-slate-500 mt-1">{a.description}</div>
            )}
          </button>
        ))}
      </div>
    )}

    {recent && (
      <Card>
        {recent}
      </Card>
    )}
  </div>
);
