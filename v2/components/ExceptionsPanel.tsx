// AI Dashboard — Exceptions panel.
//
// Surfaces the output of useExceptions() in a compact severity-grouped
// table. v1: detection only, no auto-remediation. Detectors are listed
// at the top so the user knows what's being watched.

import React, { useMemo } from 'react';
import { AlertCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardBody, Badge, Button } from '../primitives';
import { cn } from '../primitives/utils';
import { useExceptions } from '../queries/useExceptions';
import {
  RULE_LABEL, SEVERITY_TONE, type Exception, type ExceptionSeverity,
} from '../lib/exceptions';

const SEVERITY_ORDER: ExceptionSeverity[] = ['high', 'medium', 'low'];
const SEVERITY_LABEL: Record<ExceptionSeverity, string> = {
  high: 'High', medium: 'Medium', low: 'Low',
};

export const ExceptionsPanel: React.FC = () => {
  const { data, isLoading, error, refetch } = useExceptions();

  const grouped = useMemo(() => {
    const m = new Map<ExceptionSeverity, Exception[]>();
    for (const sev of SEVERITY_ORDER) m.set(sev, []);
    for (const e of data) m.get(e.severity)?.push(e);
    return m;
  }, [data]);

  const counts = useMemo(() => ({
    high:   grouped.get('high')?.length   ?? 0,
    medium: grouped.get('medium')?.length ?? 0,
    low:    grouped.get('low')?.length    ?? 0,
    total:  data.length,
  }), [data, grouped]);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle>Exceptions</CardTitle>
          {!isLoading && counts.total === 0 && (
            <Badge variant="success" dot>Clean</Badge>
          )}
          {!isLoading && counts.total > 0 && (
            <div className="flex items-center gap-1.5 ml-1">
              {counts.high   > 0 && <Badge variant="danger"  dot>{counts.high} high</Badge>}
              {counts.medium > 0 && <Badge variant="warning" dot>{counts.medium} medium</Badge>}
              {counts.low    > 0 && <Badge variant="neutral" dot>{counts.low} low</Badge>}
            </div>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={refetch} disabled={isLoading}>
          <RefreshCw size={12} className={cn(isLoading && 'animate-spin')} />
          <span className="ml-1.5">Recheck</span>
        </Button>
      </CardHeader>
      <CardBody>
        {error ? (
          <div className="flex items-center gap-2 text-rose-300 text-[12px]">
            <AlertCircle size={14} />
            <span>{error.message}</span>
          </div>
        ) : isLoading ? (
          <div className="text-slate-500 text-[12px]">Scanning…</div>
        ) : counts.total === 0 ? (
          <div className="flex items-center gap-2 text-emerald-300 text-[12px]">
            <ShieldCheck size={14} />
            <span>No exceptions found across orders and customer invoices.</span>
          </div>
        ) : (
          <div className="divide-y divide-[#1f1f1f]">
            {SEVERITY_ORDER.flatMap(sev => grouped.get(sev) ?? []).map(e => (
              <div key={e.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
                <span
                  className={cn('mt-1.5 inline-block w-2 h-2 rounded-full shrink-0', SEVERITY_TONE[e.severity])}
                  title={SEVERITY_LABEL[e.severity]}
                  aria-label={`${SEVERITY_LABEL[e.severity]} severity`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12px] font-medium text-slate-200">{e.title}</span>
                    <span className="font-mono text-[11px] text-slate-400">{e.entityRef}</span>
                  </div>
                  <div className="text-[11.5px] text-slate-500 mt-0.5 truncate">{e.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-[#1f1f1f]">
          <div className="text-[10px] uppercase tracking-wider text-slate-600 mb-1">Watched rules</div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(RULE_LABEL) as Array<keyof typeof RULE_LABEL>).map(r => (
              <span key={r} className="text-[10.5px] text-slate-500 bg-[#0d0d0d] border border-[#1f1f1f] rounded px-1.5 py-0.5">
                {RULE_LABEL[r]}
              </span>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
};
