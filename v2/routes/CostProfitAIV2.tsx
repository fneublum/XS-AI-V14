// Phase 3B — Cost / Profit AI (first iteration rebuild).
//
// Replaces the Phase 3B placeholder with a working calculator. Not full
// parity with the v1 5,100-LOC version — iteration one focuses on the
// core loop: enter cost inputs, pick a margin target, see landed cost
// + sell price + scenario columns side-by-side.

import React, { useMemo, useState } from 'react';
import {
  Card, CardHeader, CardTitle, CardBody, Input, FormField, Label, Badge, Button,
} from '../primitives';

interface CostInputs {
  fob: string;              // FOB price per unit, USD
  quantity: string;         // units
  freightTotal: string;     // total freight for the shipment, USD
  dutyPct: string;          // import duty %
  brokeragePct: string;     // brokerage + customs handling %
  otherPerUnit: string;     // misc per-unit overhead
  targetMarginPct: string;  // target margin % on sell price
}

interface Scenario {
  label: string;
  mult: number;      // multiplier applied to landed cost per unit
  tone: 'warning' | 'neutral' | 'success';
}

const SCENARIOS: Scenario[] = [
  { label: 'Pessimistic', mult: 1.10, tone: 'warning' },
  { label: 'Base',        mult: 1.00, tone: 'neutral' },
  { label: 'Optimistic',  mult: 0.93, tone: 'success' },
];

const num = (s: string): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const fmt = (n: number): string => n > 0
  ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—';

interface Computed {
  unitCost: number;          // FOB
  freightPerUnit: number;    // total freight / qty
  dutyPerUnit: number;       // FOB × duty%
  brokeragePerUnit: number;  // (FOB + freight) × brokerage%
  otherPerUnit: number;
  landedPerUnit: number;     // sum of the above
  sellPrice: number;         // derived from target margin
  marginPerUnit: number;     // sellPrice - landedPerUnit
  totalRevenue: number;      // sellPrice × qty
  totalProfit: number;       // marginPerUnit × qty
}

function compute(inputs: CostInputs): Computed {
  const fob        = num(inputs.fob);
  const qty        = num(inputs.quantity);
  const freight    = num(inputs.freightTotal);
  const dutyPct    = num(inputs.dutyPct) / 100;
  const brokerPct  = num(inputs.brokeragePct) / 100;
  const other      = num(inputs.otherPerUnit);
  const targetPct  = num(inputs.targetMarginPct) / 100;

  const unitCost        = fob;
  const freightPerUnit  = qty > 0 ? freight / qty : 0;
  const dutyPerUnit     = fob * dutyPct;
  const brokeragePerUnit = (fob + freightPerUnit) * brokerPct;
  const landedPerUnit   = unitCost + freightPerUnit + dutyPerUnit + brokeragePerUnit + other;

  // targetPct is margin on sell price → sellPrice = landed / (1 - targetPct)
  const sellPrice = targetPct < 1
    ? landedPerUnit / (1 - targetPct)
    : landedPerUnit;

  const marginPerUnit = sellPrice - landedPerUnit;
  const totalRevenue = sellPrice * qty;
  const totalProfit = marginPerUnit * qty;

  return {
    unitCost, freightPerUnit, dutyPerUnit, brokeragePerUnit, otherPerUnit: other,
    landedPerUnit, sellPrice, marginPerUnit, totalRevenue, totalProfit,
  };
}

const DEFAULT_INPUTS: CostInputs = {
  fob: '0.50',
  quantity: '40000',
  freightTotal: '4800',
  dutyPct: '0',
  brokeragePct: '1.5',
  otherPerUnit: '0.02',
  targetMarginPct: '25',
};

const CostProfitAIV2: React.FC = () => {
  const [inputs, setInputs] = useState<CostInputs>(DEFAULT_INPUTS);
  const [showExplain, setShowExplain] = useState(false);
  const set = (k: keyof CostInputs) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setInputs(prev => ({ ...prev, [k]: e.target.value }));

  const base = useMemo(() => compute(inputs), [inputs]);
  const scenarios = useMemo(
    () => SCENARIOS.map(s => ({
      ...s,
      landedPerUnit: base.landedPerUnit * s.mult,
      sellPrice: base.sellPrice * s.mult,
      marginPerUnit: (base.sellPrice * s.mult) - (base.landedPerUnit * s.mult),
      totalProfit: ((base.sellPrice * s.mult) - (base.landedPerUnit * s.mult)) * num(inputs.quantity),
    })),
    [base, inputs.quantity],
  );

  return (
    <div className="max-w-6xl">
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">Cost / Profit AI</h1>
            <Badge variant="info">v2 preview</Badge>
          </div>
          <p className="text-[13px] text-slate-500 mt-1">
            Landed cost + margin target → sell price. Live scenario comparison.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setShowExplain(v => !v)}
          className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616] h-7 px-2.5 text-[12px]"
        >
          {showExplain ? 'Hide explanation' : 'Explain the math'}
        </Button>
      </div>

      <div className="grid grid-cols-[340px_1fr] gap-4">
        {/* Inputs column */}
        <Card>
          <CardHeader>
            <CardTitle>Cost inputs</CardTitle>
            <Button
              size="sm" variant="secondary"
              onClick={() => setInputs(DEFAULT_INPUTS)}
              className="bg-transparent border border-[#1f1f1f] text-slate-400 hover:bg-[#161616] h-6 px-2 text-[11px]"
            >
              Reset
            </Button>
          </CardHeader>
          <CardBody>
            <div className="space-y-3.5">
              <NumField label="FOB price / unit" value={inputs.fob} onChange={set('fob')} prefix="$" />
              <NumField label="Quantity" value={inputs.quantity} onChange={set('quantity')} suffix="units" />
              <NumField label="Total freight" value={inputs.freightTotal} onChange={set('freightTotal')} prefix="$" />
              <NumField label="Import duty" value={inputs.dutyPct} onChange={set('dutyPct')} suffix="%" />
              <NumField label="Brokerage + customs" value={inputs.brokeragePct} onChange={set('brokeragePct')} suffix="%" />
              <NumField label="Other / unit" value={inputs.otherPerUnit} onChange={set('otherPerUnit')} prefix="$" />
              <div className="pt-3 border-t border-[#1f1f1f]">
                <NumField
                  label="Target margin"
                  value={inputs.targetMarginPct}
                  onChange={set('targetMarginPct')}
                  suffix="%"
                  hint="Margin on sell price (not on cost)"
                />
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Result + scenarios column */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Per-unit breakdown (base)</CardTitle>
              <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                {num(inputs.quantity).toLocaleString('en-US')} units
              </span>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px]">
                <CostRow label="FOB"       value={fmt(base.unitCost)} />
                <CostRow label="Freight"   value={fmt(base.freightPerUnit)} />
                <CostRow label="Duty"      value={fmt(base.dutyPerUnit)} />
                <CostRow label="Brokerage" value={fmt(base.brokeragePerUnit)} />
                <CostRow label="Other"     value={fmt(base.otherPerUnit)} />
                <CostRow label="Landed"    value={fmt(base.landedPerUnit)} bold />
                <CostRow label="Sell price" value={fmt(base.sellPrice)}  bold tone="positive" />
                <CostRow label="Margin / unit" value={fmt(base.marginPerUnit)} tone="positive" />
              </div>
              <div className="mt-4 pt-3 border-t border-[#1f1f1f] grid grid-cols-2 gap-x-6 text-[13px]">
                <CostRow label="Total revenue" value={fmt(base.totalRevenue)} bold />
                <CostRow label="Total profit"  value={fmt(base.totalProfit)}  bold tone="positive" />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Scenarios</CardTitle>
              <span className="text-[11px] text-slate-500 font-mono tabular-nums">±10% landed</span>
            </CardHeader>
            <div className="grid grid-cols-3">
              {scenarios.map(s => (
                <div
                  key={s.label}
                  className="p-4 border-r last:border-r-0 border-[#1f1f1f]"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant={s.tone} dot>{s.label}</Badge>
                    <span className="font-mono text-[10px] text-slate-500">×{s.mult.toFixed(2)}</span>
                  </div>
                  <dl className="text-[12px] space-y-1.5">
                    <ScenarioRow label="Landed"   value={fmt(s.landedPerUnit)} />
                    <ScenarioRow label="Sell"     value={fmt(s.sellPrice)} bold />
                    <ScenarioRow label="Margin"   value={fmt(s.marginPerUnit)} />
                    <ScenarioRow label="Profit"   value={fmt(s.totalProfit)} bold />
                  </dl>
                </div>
              ))}
            </div>
          </Card>

          {showExplain && (
            <Card>
              <CardHeader>
                <CardTitle>How the numbers flow</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="text-[12.5px] text-slate-400 space-y-2 list-disc pl-4">
                  <li>
                    <span className="text-slate-200">Freight per unit</span> = total freight ÷ quantity.
                    Freight doesn't scale linearly with individual units in practice, but for a
                    single-shipment calculation it's close enough.
                  </li>
                  <li>
                    <span className="text-slate-200">Duty</span> = FOB × duty%. Many HS codes are
                    duty-free (0%) for your major customers — double-check the
                    <span className="font-mono tabular-nums"> hsCode </span>on the Product record.
                  </li>
                  <li>
                    <span className="text-slate-200">Brokerage</span> is taken on
                    (FOB + freight) since brokers quote on CIF-adjacent value. Adjust the
                    percentage to match your actual broker's rate sheet.
                  </li>
                  <li>
                    <span className="text-slate-200">Sell price</span> = landed ÷ (1 − margin%).
                    The margin is on the sell price, not on cost — that matters when comparing to
                    customer quotes.
                  </li>
                  <li>
                    <span className="text-slate-200">Scenarios</span> shift landed cost by ±10%
                    (pessimistic / optimistic) while keeping the same sell price ratio. Used for
                    sanity checks before a proposal.
                  </li>
                </ul>
                <p className="mt-4 text-[11px] text-slate-600 font-mono">
                  AI assistant (Gemini / Claude) integration — Phase 3C.
                  Planned: pick a Product from the catalog, auto-fill FOB from supplier offers,
                  suggest a margin target based on customer price history.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

const NumField: React.FC<{
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  prefix?: string;
  suffix?: string;
  hint?: string;
}> = ({ label, value, onChange, prefix, suffix, hint }) => (
  <FormField>
    <Label>{label}</Label>
    <div className="relative">
      {prefix && (
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-500 font-mono pointer-events-none">
          {prefix}
        </span>
      )}
      <Input
        type="number"
        value={value}
        onChange={onChange}
        className={`h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums ${prefix ? 'pl-6' : ''} ${suffix ? 'pr-10' : ''}`}
      />
      {suffix && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-500 font-mono pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
    {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
  </FormField>
);

const CostRow: React.FC<{
  label: string; value: string; bold?: boolean;
  tone?: 'positive' | 'neutral';
}> = ({ label, value, bold, tone }) => (
  <div className="flex items-center justify-between py-0.5">
    <span className={bold ? 'text-slate-200 font-medium' : 'text-slate-500'}>{label}</span>
    <span className={`font-mono tabular-nums ${
      tone === 'positive' ? 'text-emerald-400' : bold ? 'text-slate-100' : 'text-slate-300'
    } ${bold ? 'font-semibold' : ''}`}>
      {value}
    </span>
  </div>
);

const ScenarioRow: React.FC<{ label: string; value: string; bold?: boolean }> = ({
  label, value, bold,
}) => (
  <div className="flex items-center justify-between">
    <dt className="text-slate-500 text-[11px] uppercase tracking-wider">{label}</dt>
    <dd className={`font-mono tabular-nums ${bold ? 'text-slate-100 font-semibold' : 'text-slate-300'}`}>
      {value}
    </dd>
  </div>
);

export default CostProfitAIV2;
