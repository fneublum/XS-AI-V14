// Phase 3B — "Rebuild pending" placeholder for the big v1 modules that
// don't have v2 parity yet. Each instance describes what's in v1 and
// links back to the v1 URL until the proper v2 rebuild ships.

import React from 'react';
import { Card, CardHeader, CardTitle, CardBody, Badge, Button } from '../primitives';
import { useToast } from '../primitives/Toast';

interface Props {
  title: string;
  description: string;
  v1Path: string;             // e.g. '#commissions' — opens v1 (drops ?v2=1)
  stats?: Array<{ label: string; value: string }>;
  v1Features: string[];
  plannedFeatures: string[];
  locEstimate: string;         // informational "~9,900 LOC" etc.
}

export const RebuildPendingV2: React.FC<Props> = ({
  title, description, v1Path, stats, v1Features, plannedFeatures, locEstimate,
}) => {
  const toast = useToast();

  const openV1 = () => {
    // Drop ?v2=1 and (optionally) route-hash to the v1 screen.
    const url = new URL(window.location.origin);
    if (v1Path) url.hash = v1Path.replace(/^#/, '');
    window.location.href = url.toString();
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <div className="flex items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">{title}</h1>
          <Badge variant="warning">Rebuild pending</Badge>
        </div>
        <p className="text-[13px] text-slate-500 mt-1 max-w-2xl">{description}</p>
      </div>

      {stats && stats.length > 0 && (
        <div className="grid grid-cols-3 gap-px bg-[#1f1f1f] border border-[#1f1f1f] rounded-md overflow-hidden mb-8">
          {stats.map(s => (
            <div key={s.label} className="bg-[#0a0a0a] p-4">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
                {s.label}
              </div>
              <div className="font-mono tabular-nums text-[22px] text-slate-100 font-semibold mt-1">
                {s.value}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-8">
        <Card>
          <CardHeader>
            <CardTitle>Shipped in v1</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="text-[12.5px] text-slate-300 space-y-1.5 list-disc pl-4">
              {v1Features.map(f => <li key={f}>{f}</li>)}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Planned for v2 rebuild</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="text-[12.5px] text-slate-300 space-y-1.5 list-disc pl-4">
              {plannedFeatures.map(f => <li key={f}>{f}</li>)}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card className="mb-6">
        <CardBody>
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-slate-100 font-medium">
                Use the v1 version while the rebuild ships
              </div>
              <div className="text-[12px] text-slate-500 mt-0.5">
                Same data, original UI. Estimated v1 size: {locEstimate}.
              </div>
            </div>
            <Button
              size="sm"
              onClick={openV1}
              className="bg-indigo-600 text-white hover:bg-indigo-500 h-8 px-3 text-[12.5px] font-medium rounded-md"
            >
              Open in v1
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => toast.push({ kind: 'info', title: 'Rebuild scoping', description: 'Feature breakdown lands with Phase 3C.' })}
              className="h-8 px-3 text-[12.5px] bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
            >
              Rebuild plan
            </Button>
          </div>
        </CardBody>
      </Card>

      <p className="text-[11px] text-slate-600 font-mono">
        Why a placeholder? The v1 version is {locEstimate} of workflow logic.
        Porting it without a redesign pass would bloat v2; we'll rebuild it
        Linear-style once the CRUD foundations across the app are stable.
      </p>
    </div>
  );
};
