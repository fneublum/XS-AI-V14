// Phase 3B — Thin activity feed for ModuleLanding.

import React from 'react';
import { Badge, Skeleton, EmptyState, CardHeader, CardTitle } from '../primitives';
import { useAiActivity } from '../queries/useAiActivity';
import { formatDate } from '../lib/formatDate';

const fmtRelative = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const ms = Date.now() - d.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
};

interface ActivityFeedProps {
  module?: string;
  title?: string;
  limit?: number;
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({
  module, title = 'Recent activity', limit = 8,
}) => {
  const q = useAiActivity(module, limit);

  return (
    <>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {q.data && (
          <span className="text-[11px] text-slate-500 font-mono tabular-nums">
            {q.data.length}
          </span>
        )}
      </CardHeader>

      {q.isLoading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton width={100} height={14} />
              <Skeleton width={200} height={14} />
              <Skeleton width={60} height={14} className="ml-auto" />
            </div>
          ))}
        </div>
      ) : q.error ? (
        <EmptyState
          tone="danger"
          title="Couldn't load activity"
          description={q.error.message}
          action={{ label: 'Retry', onClick: q.refetch }}
        />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description={module
            ? `Events for "${module}" will appear here as they happen.`
            : 'Run something and it shows up here.'}
        />
      ) : (
        <ul className="divide-y divide-[#1f1f1f]">
          {q.data.map(e => (
            <li key={e.id} className="px-4 py-2.5 flex items-center gap-3 text-[12.5px]">
              <Badge
                variant={e.resultStatus === 'SUCCESS' ? 'success' : e.resultStatus === 'ERROR' ? 'danger' : 'neutral'}
                dot
              >
                {e.resultStatus}
              </Badge>
              <span className="font-mono tabular-nums text-slate-300">{e.action}</span>
              {e.entityType && (
                <span className="text-slate-500 font-mono tabular-nums text-[11px]">
                  {e.entityType}
                </span>
              )}
              {e.durationMs !== null && (
                <span className="text-slate-600 font-mono tabular-nums text-[11px]">
                  {e.durationMs}ms
                </span>
              )}
              <span className="ml-auto text-slate-500 text-[11px]">
                {fmtRelative(e.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};
