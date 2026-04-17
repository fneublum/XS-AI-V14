// Phase 3B — PL Invoice Engine (first iteration rebuild).
//
// Replaces the Phase 3B placeholder with a working PL → Invoice
// generator. Not full parity with v1's 5,943-LOC 3-step wizard —
// first iteration focuses on the core loop: pick an existing
// packing list, review the derived invoice, save it to the
// `invoices` table.
//
// Out of scope for iteration one:
//   - PDF upload / Gemini extraction (use AI Upload instead, then
//     come here with the PL row already created)
//   - Inline item editing inside the drawer (items come from the PL
//     as-is; post-create they're editable in Invoices)
//   - QuickBooks journal preview + push

import React, { useEffect, useState } from 'react';
import {
  Card, CardHeader, CardTitle, CardBody, Badge, Button, Skeleton,
  Input, FormField, Label, EmptyState,
} from '../primitives';
import { usePackingLists, PackingList } from '../queries/usePackingLists';
import { useEntityInsert } from '../queries/useEntityMutations';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { cn } from '../primitives/utils';

const fmt = (n: number, c: string = 'USD') => {
  try {
    return n.toLocaleString('en-US', {
      style: 'currency', currency: c,
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  } catch { return `${c} ${n.toLocaleString('en-US')}`; }
};

const PLInvoiceEngineV2: React.FC = () => {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PackingList | null>(null);
  const pls = usePackingLists(search);

  return (
    <div className="max-w-6xl">
      <div className="mb-8 flex items-baseline justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
              P&L Invoice Engine
            </h1>
            <Badge variant="info">v2 preview</Badge>
          </div>
          <p className="text-[13px] text-slate-500 mt-1">
            Pick a packing list → preview the derived customer invoice → save.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-[380px_1fr] gap-4">
        {/* Left: PL picker */}
        <Card>
          <CardHeader>
            <CardTitle>Packing Lists</CardTitle>
            {pls.data && (
              <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                {pls.data.length}
              </span>
            )}
          </CardHeader>
          <div className="px-3 pb-2">
            <Input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="PL # / B/L / consignee"
              className="h-7 text-[12px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500"
            />
          </div>

          {pls.isLoading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} height={36} />
              ))}
            </div>
          ) : pls.error ? (
            <EmptyState
              tone="danger"
              title="Couldn't load packing lists"
              description={pls.error.message}
              action={{ label: 'Retry', onClick: pls.refetch }}
            />
          ) : !pls.data || pls.data.length === 0 ? (
            <EmptyState
              title="No packing lists"
              description="Create a PL first, then come back here to generate its invoice."
            />
          ) : (
            <ul className="max-h-[500px] overflow-y-auto">
              {pls.data.map(pl => {
                const active = selected?.id === pl.id;
                return (
                  <li key={pl.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(pl)}
                      className={cn(
                        'w-full text-left px-3 py-2 border-t border-[#1f1f1f] hover:bg-[#141414]',
                        active && 'bg-[#161616]',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono tabular-nums text-[12px] text-slate-100">
                          {pl.plNumber}
                        </span>
                        <Badge variant={pl.status.toUpperCase() === 'INVOICED' ? 'success' : 'neutral'} dot>
                          {pl.status}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                        {pl.consignee ?? '—'}
                      </div>
                      <div className="text-[10px] text-slate-600 mt-0.5 font-mono tabular-nums">
                        SO {pl.soNumber ?? '—'} · B/L {pl.blNumber ?? '—'}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Right: preview + save */}
        <div className="min-w-0">
          {selected
            ? <InvoicePreview pl={selected} onInvoiced={() => setSelected(null)} />
            : (
              <Card>
                <EmptyState
                  title="Pick a packing list"
                  description="Select one on the left to preview the invoice that would be generated from it."
                />
              </Card>
            )}
        </div>
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────

interface InvoicePreviewProps {
  pl: PackingList;
  onInvoiced: () => void;
}

const InvoicePreview: React.FC<InvoicePreviewProps> = ({ pl, onInvoiced }) => {
  const { currentCompanyId } = useCompany();
  const toast = useToast();
  const insert = useEntityInsert<{
    companyId: string; invoiceNumber: string; soldTo: string | null;
    billToName: string | null; invoiceDate: string;
    paymentTerms: string | null; incoterm: string | null;
    totalAmount: number; currency: string;
    soNumber: string | null; plNumber: string | null;
    bookingNumber: string | null;
  }>({ table: 'invoices', listQueryKeys: ['invoices', 'pl'], idPrefix: 'INV' });

  const [invoiceNumber, setNumber] = useState('');
  const [soldTo, setSoldTo] = useState('');
  const [invoiceDate, setDate] = useState('');
  const [totalAmount, setTotal] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [paymentTerms, setTerms] = useState('');
  const [incoterm, setIncoterm] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const suffix = Math.floor(Date.now() % 100000).toString().padStart(5, '0');
    setNumber(`INV-${suffix}`);
    setSoldTo(pl.consignee ?? '');
    setDate(new Date().toISOString().slice(0, 10));
    setTotal('');
    setCurrency('USD');
    setTerms('');
    setIncoterm('');
    setSaved(false);
  }, [pl.id]);

  const totalNum = Number(totalAmount);
  const totalValid = totalAmount !== '' && Number.isFinite(totalNum) && totalNum > 0;

  const save = () => {
    if (!totalValid || !invoiceNumber.trim()) return;
    const companyId = currentCompanyId === 'ALL' ? 'DEFAULT' : currentCompanyId;
    insert.mutate(
      {
        companyId,
        invoiceNumber,
        soldTo: soldTo || null,
        billToName: soldTo || null,
        invoiceDate,
        paymentTerms: paymentTerms || null,
        incoterm: incoterm || null,
        totalAmount: totalNum,
        currency,
        soNumber: pl.soNumber,
        plNumber: pl.plNumber,
        bookingNumber: null,
      },
      {
        onSuccess: () => {
          toast.push({
            kind: 'success',
            title: 'Invoice created',
            description: `${invoiceNumber} linked to PL ${pl.plNumber}.`,
          });
          setSaved(true);
          setTimeout(onInvoiced, 1800);
        },
        onError: (err) => {
          toast.push({ kind: 'error', title: 'Could not create invoice', description: err.message });
        },
      },
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Packing list</CardTitle>
          <Badge variant={pl.status.toUpperCase() === 'INVOICED' ? 'success' : 'neutral'} dot>
            {pl.status}
          </Badge>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px]">
            <Row label="PL #"         value={<span className="font-mono tabular-nums">{pl.plNumber}</span>} />
            <Row label="SO #"         value={<span className="font-mono tabular-nums">{pl.soNumber ?? '—'}</span>} />
            <Row label="B/L #"        value={<span className="font-mono tabular-nums">{pl.blNumber ?? '—'}</span>} />
            <Row label="Carrier"      value={pl.carrier ?? '—'} />
            <Row label="Consignee"    value={pl.consignee ?? '—'} />
            <Row label="Container"    value={<span className="font-mono tabular-nums">{pl.containerNumber ?? '—'}</span>} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Derived invoice</CardTitle>
          <span className="text-[11px] text-slate-500">Editable draft</span>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-2 gap-3">
            <FormField>
              <Label required>Invoice #</Label>
              <Input value={invoiceNumber} onChange={e => setNumber(e.target.value)}
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
            </FormField>
            <FormField>
              <Label>Invoice date</Label>
              <Input type="date" value={invoiceDate} onChange={e => setDate(e.target.value)}
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <FormField>
              <Label>Sold to / Bill to</Label>
              <Input value={soldTo} onChange={e => setSoldTo(e.target.value)}
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
            </FormField>
            <FormField>
              <Label>Incoterm</Label>
              <Input value={incoterm} onChange={e => setIncoterm(e.target.value)}
                placeholder="CFR, FOB, …"
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
            </FormField>
          </div>
          <div className="grid grid-cols-[1fr_1fr_120px] gap-3 mt-3">
            <FormField>
              <Label required>Total amount</Label>
              <Input type="number" min={0} step={0.01} value={totalAmount}
                onChange={e => setTotal(e.target.value)}
                invalid={totalAmount !== '' && !totalValid}
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
            </FormField>
            <FormField>
              <Label>Payment terms</Label>
              <Input value={paymentTerms} onChange={e => setTerms(e.target.value)}
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200" />
            </FormField>
            <FormField>
              <Label>Currency</Label>
              <Input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
                className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums" />
            </FormField>
          </div>

          <div className="mt-5 pt-3 border-t border-[#1f1f1f] flex items-center gap-3">
            {saved ? (
              <div className="flex items-center gap-2 text-emerald-400 text-[12.5px]">
                <span>✓ Invoice saved — closing…</span>
              </div>
            ) : (
              <div className="text-[12px] text-slate-500">
                {totalValid
                  ? `Will insert as ${fmt(totalNum, currency)} against SO ${pl.soNumber ?? '—'}.`
                  : 'Enter a total amount to enable save.'}
              </div>
            )}
            <Button
              size="sm"
              onClick={save}
              disabled={!totalValid || !invoiceNumber.trim() || insert.isPending || saved}
              loading={insert.isPending}
              className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
            >
              {insert.isPending ? 'Saving…' : saved ? 'Saved' : 'Create invoice'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
};

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start gap-3">
    <dt className="w-20 shrink-0 text-slate-500 text-[10px] uppercase tracking-wider font-medium">
      {label}
    </dt>
    <dd className="flex-1 min-w-0 text-slate-200 break-words">{value}</dd>
  </div>
);

export default PLInvoiceEngineV2;
