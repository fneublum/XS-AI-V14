// Phase 3C — Purchase & cost wizard.
//
//   1. Source         — supplier_offers list, pick offer (no DB write)
//   2. Landed cost    — v1-parity math (CIF + duty + logistics split)
//                       against the picked offer, BEFORE any PO exists,
//                       so the user has landed cost in hand to decide
//                       whether to buy. Also supports editing landed
//                       cost on an existing PO via POSelector.
//   3. Purchase order — creates the PO from offer + landed cost, plus
//                       mirrors into cost_calculations for step 4.
//   4. Price list     — reads cost_calculations (sales-facing, no cost columns)

import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Sparkles, Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, CardHeader, CardTitle, Input, Skeleton, EmptyState, Badge, Button,
  DataTable, DataTableColumn,
} from '../primitives';
import PurchaseOrdersV2 from './PurchaseOrdersV2';
import { useSupplierOffers, SupplierOffer } from '../queries/useSupplierOffers';
import { useCostCalculations } from '../queries/useCostCalculations';
import { usePurchaseOrders, PurchaseOrder } from '../queries/usePurchaseOrders';
import { useFreightQuotes, FreightQuote } from '../queries/useFreightQuotes';
import { GoogleGenAI } from '../../services/geminiClient';
import { nextPONumber } from '../lib/poNumber';
import { useCompany } from '../providers/CompanyProvider';
import { useToast } from '../primitives/Toast';
import { formatDate as fmtDate } from '../lib/formatDate';
import { shortName, tooltipName } from '../lib/formatName';
import { formatMoney as fmtCurrency } from '../lib/formatMoney';
import { cn } from '../primitives/utils';
import { RowActions } from '../components/RowActions';
import { useRowDelete } from '../components/useRowDelete';
import { getSupabaseClient } from '../../services/supabase';
import { SupplierOfferDrawer, EMPTY_SUPPLIER_OFFER } from '../components/SupplierOfferDrawer';
import { AiUploadModal } from '../components/AiUploadModal';
import { SupabaseSelectField } from '../components/SupabaseSelectField';
import { ensureProducts } from '../lib/ensureProducts';
import { FormField, Label } from '../primitives';
import { useEntityInsert } from '../queries/useEntityMutations';

type Step = 1 | 2 | 3 | 4;
type ShipmentType = 'IMPORT' | 'EXPORT' | 'LOCAL';
type FreightType = 'PORT_TO_PORT' | 'DOOR_TO_PORT' | 'PORT_TO_DOOR' | 'DOOR_TO_DOOR';

const FREIGHT_TYPE_LABEL: Record<FreightType, string> = {
  PORT_TO_PORT: 'Port to port',
  DOOR_TO_PORT: 'Door to port',
  PORT_TO_DOOR: 'Port to door',
  DOOR_TO_DOOR: 'Door to door',
};
const needsPickup   = (f: FreightType) => f === 'DOOR_TO_PORT' || f === 'DOOR_TO_DOOR';
const needsDelivery = (f: FreightType) => f === 'PORT_TO_DOOR' || f === 'DOOR_TO_DOOR';

const STEPS: Array<{ n: Step; label: string; hint: string }> = [
  { n: 1, label: 'Source',          hint: 'Pick a supplier offer' },
  { n: 2, label: 'Landed cost',     hint: 'Freight, duties, FX' },
  { n: 3, label: 'Purchase order',  hint: 'Create PO & save prices' },
  { n: 4, label: 'Price list',      hint: 'What sales sees' },
];

const cityCountry = (raw: string | null): string => {
  if (!raw) return '';
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length <= 2 ? parts.join(', ') : parts.slice(-2).join(', ');
};

const usd = (n: number) => n.toLocaleString('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const money = (n: number, cur = 'USD') => {
  try { return n.toLocaleString('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  catch { return `${cur} ${n.toFixed(2)}`; }
};

const StepHeader: React.FC<{ step: Step; onJump: (s: Step) => void }> = ({ step, onJump }) => (
  <ol className="flex items-center gap-1 mb-6 flex-wrap">
    {STEPS.map((s, i) => {
      const done   = step > s.n;
      const active = step === s.n;
      return (
        <li key={s.n} className="flex items-center">
          <button
            type="button"
            onClick={() => onJump(s.n)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-md border text-[12px] transition-colors',
              active && 'bg-indigo-500/10 border-indigo-500/30 text-indigo-200',
              done   && 'bg-[#0f0f0f] border-[#1f1f1f] text-slate-300 hover:border-[#2a2a2a]',
              !active && !done && 'bg-transparent border-[#1f1f1f] text-slate-500',
            )}
          >
            <span className={cn(
              'inline-flex items-center justify-center h-4 w-4 rounded-full text-[10px] font-mono tabular-nums',
              active && 'bg-indigo-500 text-white',
              done   && 'bg-emerald-500/20 text-emerald-300',
              !active && !done && 'bg-[#1f1f1f] text-slate-500',
            )}>
              {done ? <Check size={10} /> : s.n}
            </span>
            <span className="font-medium">{s.label}</span>
            <span className="text-slate-500 hidden md:inline">· {s.hint}</span>
          </button>
          {i < STEPS.length - 1 && (
            <ChevronRight size={12} className="text-slate-700 mx-0.5" aria-hidden />
          )}
        </li>
      );
    })}
  </ol>
);

const PurchaseCostWizardV2: React.FC = () => {
  const toast = useToast();
  const qc = useQueryClient();
  const { currentCompanyId } = useCompany();

  const [step, setStep]       = useState<Step>(1);
  const [search, setSearch]   = useState('');
  const [picked, setPicked]   = useState<SupplierOffer | null>(null);
  const [savedPOId, setSavedPOId] = useState<string | null>(null);

  // Landed cost state lifted to wizard level so Step 3 can read it
  // when creating the PO (and Step 2 can persist the values the user
  // typed when hopping between steps). Initialized lazily when the
  // landed step first loads from either the picked offer or the PO
  // the user selected.
  const [landedHeader, setLandedHeader] = useState<LandedHeader | null>(null);
  const [landedLines, setLandedLines]   = useState<LandedLine[]>([]);

  const [offerInDrawer, setOfferInDrawer] = useState<SupplierOffer | null>(null);
  const [drawerMode, setDrawerMode]       = useState<'view' | 'edit' | 'create'>('view');
  const [aiUploadOpen, setAiUploadOpen]   = useState(false);

  const offers = useSupplierOffers(search);

  const { confirmDelete, deleteDialog } = useRowDelete<SupplierOffer>({
    table: 'supplier_offers',
    listQueryKeys: ['supplierOffers'],
    rowLabel: r => r.offerNumber || r.id.slice(0, 14),
  });

  const openOffer = (o: SupplierOffer, m: 'view' | 'edit' | 'create') => {
    setOfferInDrawer(o);
    setDrawerMode(m);
  };
  const createOffer = () => {
    setOfferInDrawer({ ...EMPTY_SUPPLIER_OFFER });
    setDrawerMode('create');
  };

  // Step 1 → step 2 handoff: stash the picked offer and reset any
  // prior PO/landed state so the user lands on a clean Landed cost
  // view derived from the new offer. NO database write here — the PO
  // is created later in step 3 once the user has reviewed landed cost.
  const pickOffer = (offer: SupplierOffer) => {
    setPicked(offer);
    setSavedPOId(null);
    setLandedHeader(null);
    setLandedLines([]);
    setStep(2);
  };

  // Same as pickOffer but stays on step 2 — for when the user is
  // already on Landed cost and wants to swap source offers without
  // bouncing back to step 1.
  const selectOfferForLanded = (offer: SupplierOffer | null) => {
    setPicked(offer);
    setSavedPOId(null);
    setLandedHeader(null);
    setLandedLines([]);
  };

  // Step 3 action: materialize the purchase order from the picked
  // offer + the landed-cost state the user typed in step 2. Writes
  // both `purchase_orders` (with landed fields baked in) and the
  // mirrored `cost_calculations` rows that feed step 4. Returns the
  // new PO id so the UI can pivot to saved-PO view without a round
  // trip.
  const createPOFromPickedAndLanded = async (): Promise<string | null> => {
    if (!picked || !landedHeader) return null;
    const offer = picked;
    const h = landedHeader;
    const lines = landedLines;
    const companyId = currentCompanyId === 'ALL' ? offer.companyId : currentCompanyId;
    // Formatted PO id — `PO-NNNNNXX`. Falls back to the legacy random
    // string only if the sequence lookup throws.
    let poId: string;
    try { poId = await nextPONumber(offer.supplierName); }
    catch { poId = `PO${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }
    const poItems = offer.items.map((it, i) => {
      const l = lines[i];
      return {
        productName: it.productName,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        total: it.total ?? it.quantity * it.unitPrice,
        // Persist the landed breakdown on each line so the PO row
        // fully describes what was computed in step 2. Zero-safe
        // when the user never opened step 2 (lines empty).
        landedFobUnitUsd:       l?.fobUnit        ?? null,
        landedPickupUnitUsd:    l?.allocPickup    ?? null,
        landedOceanUnitUsd:     l?.allocOcean     ?? null,
        landedDeliveryUnitUsd:  l?.allocDelivery  ?? null,
        landedInsuranceUnitUsd: l?.allocInsurance ?? null,
        landedPortClearUnitUsd: l?.allocPortClear ?? null,
        landedDutyUnitUsd:      l?.dutyUnit       ?? null,
        landedUnitPriceUsd:     l?.landedUnit     ?? null,
        landedTotalUsd:         l?.landedTotal    ?? null,
      };
    });
    const totalAmount = offer.items.reduce((s, it) => s + (it.total || it.quantity * it.unitPrice), 0);
    const landedGrand = lines.reduce((s, l) => s + l.landedTotal, 0);
    const payload: Record<string, unknown> = {
      id: poId,
      companyId,
      supplierId: offer.supplierId,
      supplierName: offer.supplierName,
      status: 'PENDING',
      orderDate: new Date().toISOString().slice(0, 10),
      expectedDeliveryDate: null,
      paymentTerms: offer.paymentTerms,
      items: poItems,
      totalAmount: totalAmount || offer.totalAmount,
      currency: offer.currency || 'USD',
      notes: offer.notes,
      incoterm: offer.incoterm,
      freightType: h.freightType,
      loadingLocation: offer.loadingLocation,
      originPort: h.pol.trim() || offer.originPort,
      destinationPort: h.pod.trim() || offer.destinationPort,
      fxRateToUsd:             h.fxRate,
      freightPickupTotalUsd:   h.pickupTotal,
      freightOceanTotalUsd:    h.oceanTotal,
      freightDeliveryTotalUsd: h.deliveryTotal,
      insuranceTotalUsd:       h.insuranceTotal,
      portClearanceTotalUsd:   h.portClearTotal,
      dutyRatePct:             h.dutyPct,
      shipmentType:            h.shipmentType,
      marginPct:               h.marginPct,
      landedGrandUsd:          landedGrand,
    };
    const sb = getSupabaseClient();
    const { error: poErr } = await sb.from('purchase_orders').insert(payload);
    if (poErr) {
      toast.push({ kind: 'error', title: 'PO create failed', description: poErr.message });
      return null;
    }

    // Mirror each line into cost_calculations → feeds step 4.
    const stamp = Date.now();
    const marginDec = Math.min(Math.max(h.marginPct / 100, 0), 0.999);
    const calcRows = lines.map((l, i) => ({
      id:                 `CA${stamp}-${i}`,
      companyId,
      calculationNumber:  `CA-${String(stamp).slice(-7)}-${i + 1}`,
      date:               new Date().toISOString(),
      productName:        l.productName,
      hsCode:             l.hsCode ?? null,
      origin:             h.pol.trim() || offer.originPort || null,
      destination:        h.pod.trim() || offer.destinationPort || null,
      pickupLocation:     offer.loadingLocation ?? null,
      fobPrice:           l.fobUnit,
      quantity:           l.quantity,
      freightCost:        (l.allocPickup + l.allocOcean + l.allocDelivery) * l.quantity,
      insuranceCost:      l.allocInsurance * l.quantity,
      dutyPercent:        h.dutyPct,
      portClearanceCost:  l.allocPortClear * l.quantity,
      deliveryCost:       l.allocDelivery * l.quantity,
      marginPercent:      h.marginPct,
      totalLandedCost:    l.landedTotal,
      unitLandedCost:     l.landedUnit,
      recommendedSalesPrice: marginDec < 1 ? l.landedUnit / (1 - marginDec) : l.landedUnit,
      supplierName:       offer.supplierName,
      poa:                h.pol.trim() || offer.originPort || null,
      pod:                h.pod.trim() || offer.destinationPort || null,
      deliveryMethod:     offer.incoterm ?? null,
    }));
    if (calcRows.length > 0) {
      const { error: ccErr } = await sb.from('cost_calculations').upsert(calcRows, { onConflict: 'id' });
      if (ccErr) {
        toast.push({ kind: 'warning', title: 'PO saved, price entries failed', description: ccErr.message });
      }
    }

    setSavedPOId(poId);
    void qc.invalidateQueries({ queryKey: ['purchaseOrders'] });
    void qc.invalidateQueries({ queryKey: ['costCalculations'] });
    toast.push({
      kind: 'success',
      title: 'Purchase order created',
      description: `${poId.slice(0, 14)} · ${offer.supplierName} · ${calcRows.length} price entr${calcRows.length === 1 ? 'y' : 'ies'}`,
    });
    return poId;
  };

  return (
    <div className="bento-scope p-4" style={{ maxWidth: '1280px' }}>
      <div className="flex items-end gap-4 flex-wrap mb-6 pb-2">
        <div className="min-w-0 flex items-center gap-3">
          <span className="block w-1 h-9 rounded-full" style={{ background: 'var(--b-teal-2)' }} />
          <div className="min-w-0">
            <h1 className="b-display font-semibold leading-none"
                style={{ color: 'var(--b-text)', fontSize: '32px', fontVariationSettings: "'opsz' 64, 'wght' 600", letterSpacing: '-0.02em' }}>
              Purchase &amp; cost
            </h1>
            <p className="text-[13px] mt-1.5" style={{ color: 'var(--b-text-mute)' }}>
              Source → Landed cost → Purchase order → Price list
            </p>
          </div>
        </div>
      </div>

      <StepHeader step={step} onJump={setStep} />

      {step === 1 && (
        <Step1Source
          offers={offers}
          search={search}
          setSearch={setSearch}
          onPick={(o) => { pickOffer(o); }}
          onView={(o) => openOffer(o, 'view')}
          onEdit={(o) => openOffer(o, 'edit')}
          onDelete={(o) => confirmDelete(o)}
          onNew={createOffer}
          onAiUpload={() => setAiUploadOpen(true)}
        />
      )}
      {step === 2 && (
        <Step2LandedCost
          picked={picked}
          savedPOId={savedPOId}
          header={landedHeader}
          lines={landedLines}
          onHeaderChange={setLandedHeader}
          onLinesChange={setLandedLines}
          onSelectOffer={selectOfferForLanded}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}
      {step === 3 && (
        <Step3PO
          picked={picked}
          savedPOId={savedPOId}
          landedHeader={landedHeader}
          landedLines={landedLines}
          onCreatePO={createPOFromPickedAndLanded}
          onBack={() => setStep(2)}
          onNext={() => setStep(4)}
        />
      )}
      {step === 4 && (
        <Step4PriceList
          onBack={() => setStep(3)}
          onRestart={() => {
            setPicked(null);
            setSavedPOId(null);
            setLandedHeader(null);
            setLandedLines([]);
            setStep(1);
          }}
        />
      )}

      <SupplierOfferDrawer
        offer={offerInDrawer}
        mode={drawerMode}
        onOpenChange={(o) => !o && setOfferInDrawer(null)}
        onModeChange={setDrawerMode}
      />

      <SupplierOfferAiUpload
        open={aiUploadOpen}
        onOpenChange={setAiUploadOpen}
      />

      {deleteDialog}
    </div>
  );
};

// ─────────────────── Step 1: Source ────────────────────────────

const Step1Source: React.FC<{
  offers: ReturnType<typeof useSupplierOffers>;
  search: string;
  setSearch: (s: string) => void;
  onPick: (o: SupplierOffer) => void;
  onView: (o: SupplierOffer) => void;
  onEdit: (o: SupplierOffer) => void;
  onDelete: (o: SupplierOffer) => void;
  onNew: () => void;
  onAiUpload: () => void;
}> = ({ offers, search, setSearch, onPick, onView, onEdit, onDelete, onNew, onAiUpload }) => {
  const rows = offers.data ?? [];
  const offersBySupplier = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of rows) m.set(o.supplierName, (m.get(o.supplierName) ?? 0) + 1);
    return m;
  }, [rows]);

  const columns = useMemo<DataTableColumn<SupplierOffer>[]>(() => [
    {
      id: 'supplier', header: 'Supplier', sortable: true, filterable: true,
      value: r => r.supplierName,
      cell: r => {
        const count = offersBySupplier.get(r.supplierName) ?? 1;
        return (
          <span className="text-slate-100 font-medium" title={tooltipName(r.supplierName)}>
            {shortName(r.supplierName)}
            {count > 1 && <span className="ml-1.5 text-[10px] font-mono text-indigo-300/80">×{count}</span>}
          </span>
        );
      },
    },
    { id: 'offer', header: 'Offer #', mono: true, sortable: true, filterable: true,
      value: r => r.offerNumber,
      cell: r => <span className="text-slate-400">{r.offerNumber.slice(0, 14)}</span> },
    { id: 'status', header: 'Status', sortable: true, filterable: true,
      value: r => r.status,
      cell: r => <Badge variant="neutral" dot>{r.status}</Badge> },
    { id: 'incoterm', header: 'Incoterm', sortable: true, filterable: true,
      value: r => r.incoterm ?? '',
      cell: r => r.incoterm
        ? <Badge variant="info">{r.incoterm}</Badge>
        : <span className="text-slate-600">—</span> },
    { id: 'pickup', header: 'Pick up', sortable: true, filterable: true,
      value: r => [cityCountry(r.loadingLocation), r.originPort].filter(Boolean).join(' · '),
      cell: r => (
        <span className="text-slate-400 text-[11.5px]">
          {cityCountry(r.loadingLocation) || '—'}
          {r.originPort && <span className="text-slate-500"> · {r.originPort}</span>}
        </span>
      ) },
    { id: 'items', header: 'Items', align: 'right', mono: true, sortable: true,
      value: r => r.items.length,
      cell: r => <span className="text-slate-400">{r.items.length}</span> },
    { id: 'total', header: 'Total', align: 'right', mono: true, sortable: true,
      value: r => r.totalAmount,
      cell: r => fmtCurrency(r.totalAmount, r.currency) },
    { id: 'valid', header: 'Valid until', align: 'right', sortable: true,
      value: r => r.validUntil ?? '',
      cell: r => (
        <span className="text-slate-500 font-mono tabular-nums text-[11px]">
          {fmtDate(r.validUntil ?? '')}
        </span>
      ) },
  ], [offersBySupplier]);

  const rowActions = (r: SupplierOffer) => (
    <div className="flex items-center gap-1">
      <RowActions onView={() => onView(r)} onEdit={() => onEdit(r)} onDelete={() => onDelete(r)} />
      <Button
        size="sm"
        onClick={(e) => { e.stopPropagation(); onPick(r); }}
        className="shrink-0 h-6 px-2 text-[11px] bg-indigo-600 text-white hover:bg-indigo-500 rounded-md inline-flex items-center gap-1"
      >
        <Sparkles size={11} /> Landed cost
      </Button>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Supplier offers · {rows.length}</CardTitle>
        <div className="flex items-center gap-2">
          <div className="w-56">
            <Input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Offer #, supplier, port"
              className="h-7 text-[12px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500"
            />
          </div>
          <Button size="sm" onClick={onNew}
            className="h-7 px-2.5 text-[12px] bg-indigo-600 text-white hover:bg-indigo-500 rounded-md">
            + New offer
          </Button>
          <Button size="sm" onClick={onAiUpload}
            className="h-7 px-2.5 text-[12px] bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/40 text-indigo-200 hover:from-indigo-500/30 hover:to-purple-500/30 rounded-md inline-flex items-center gap-1.5">
            <Sparkles size={12} /> AI Upload
          </Button>
        </div>
      </CardHeader>
      {offers.isLoading ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton width={180} height={14} />
              <Skeleton width={120} height={14} />
              <Skeleton width={80} height={14} className="ml-auto" />
            </div>
          ))}
        </div>
      ) : offers.error ? (
        <EmptyState
          tone="danger"
          title="Couldn't load supplier offers"
          description={offers.error.message}
          action={{ label: 'Retry', onClick: offers.refetch }}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={search ? 'No matches' : 'No supplier offers yet'}
          description={search ? `Nothing matched "${search}".` : 'Offers land in supplier_offers.'}
          action={search ? { label: 'Clear search', onClick: () => setSearch('') } : undefined}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={r => r.id}
          rowActions={rowActions}
          defaultSort={{ columnId: 'supplier', direction: 'asc' }}
        />
      )}
    </Card>
  );
};

// ───────────────── Step 3: Purchase order ─────────────────

const Step3PO: React.FC<{
  picked: SupplierOffer | null;
  savedPOId: string | null;
  landedHeader: LandedHeader | null;
  landedLines: LandedLine[];
  onCreatePO: () => Promise<string | null>;
  onBack: () => void;
  onNext: () => void;
}> = ({ picked, savedPOId, landedHeader, landedLines, onCreatePO, onBack, onNext }) => {
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try { await onCreatePO(); } finally { setCreating(false); }
  };

  const landedGrand = useMemo(
    () => landedLines.reduce((s, l) => s + l.landedTotal, 0),
    [landedLines],
  );

  return (
    <div className="space-y-4">
      {picked && !savedPOId && (
        <Card>
          <div className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-slate-500 uppercase tracking-wider">Ready to purchase</div>
                <div className="mt-1 text-[13px] text-slate-100 truncate">{shortName(picked.supplierName)}</div>
                <div className="mt-0.5 text-[11.5px] text-slate-500">
                  {picked.items.length} item{picked.items.length === 1 ? '' : 's'} ·{' '}
                  {fmtCurrency(picked.totalAmount, picked.currency)}
                  {picked.paymentTerms && ` · ${picked.paymentTerms}`}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="info">{picked.currency}</Badge>
                  {picked.incoterm && <Badge variant="neutral">{picked.incoterm}</Badge>}
                  {landedHeader && (
                    <span className="text-[11px] text-slate-500">
                      Landed grand total: <span className="font-mono tabular-nums text-emerald-300">{usd(landedGrand)}</span>
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" onClick={onBack}
                  className="h-7 px-2.5 text-[12px] bg-transparent text-slate-400 hover:text-slate-200 border border-[#1f1f1f] rounded-md">
                  ← Landed cost
                </Button>
                <Button
                  size="sm"
                  onClick={handleCreate}
                  disabled={!landedHeader || creating}
                  loading={creating}
                  className="h-7 px-3 text-[12px] bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40 rounded-md"
                >
                  {creating ? 'Creating…' : 'Create purchase order'}
                </Button>
              </div>
            </div>
            {!landedHeader && (
              <div className="text-[11.5px] text-amber-300/90 bg-amber-500/5 border border-amber-500/20 rounded-md px-3 py-2">
                Open step 2 (Landed cost) first so this PO is saved with the freight, duty and price breakdown.
              </div>
            )}
          </div>
        </Card>
      )}
      {picked && savedPOId && (
        <Card>
          <div className="p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider">PO created</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-[11.5px] text-emerald-300">{savedPOId.slice(0, 14)}</span>
                <Badge variant="info">{picked.currency}</Badge>
                {picked.incoterm && <Badge variant="neutral">{picked.incoterm}</Badge>}
              </div>
              <div className="mt-1 text-[13px] text-slate-100 truncate">{shortName(picked.supplierName)}</div>
              <div className="mt-0.5 text-[11.5px] text-slate-500">
                {picked.items.length} item{picked.items.length === 1 ? '' : 's'} ·{' '}
                {fmtCurrency(picked.totalAmount, picked.currency)}
                {picked.paymentTerms && ` · ${picked.paymentTerms}`}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" onClick={onBack}
                className="h-7 px-2.5 text-[12px] bg-transparent text-slate-400 hover:text-slate-200 border border-[#1f1f1f] rounded-md">
                ← Landed cost
              </Button>
              <Button size="sm" onClick={onNext}
                className="h-7 px-2.5 text-[12px] bg-indigo-600 text-white hover:bg-indigo-500 rounded-md">
                Price list →
              </Button>
            </div>
          </div>
        </Card>
      )}
      <PurchaseOrdersV2 />
      {!picked && (
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" onClick={onBack}
            className="h-7 px-2.5 text-[12px] bg-transparent text-slate-400 hover:text-slate-200 border border-[#1f1f1f] rounded-md">
            ← Landed cost
          </Button>
          <Button size="sm" onClick={onNext}
            className="h-7 px-2.5 text-[12px] bg-indigo-600 text-white hover:bg-indigo-500 rounded-md">
            Price list →
          </Button>
        </div>
      )}
    </div>
  );
};

// ─────────────────── Step 2: Landed cost ─────────────────────

interface LandedHeader {
  fxRate: number;
  pickupTotal: number;
  oceanTotal: number;
  deliveryTotal: number;
  insuranceTotal: number;
  portClearTotal: number;
  dutyPct: number;
  shipmentType: ShipmentType;
  freightType: FreightType;
  marginPct: number;
  /** Port of destination — seeded from the offer / PO but editable
   *  here since landed cost depends on it (duty, delivery lane) and
   *  it flows into cost_calculations.pod for the price list. */
  pod: string;
  /** Port of loading — kept alongside POD for the same reason. */
  pol: string;
}

interface LandedLine {
  productName: string;
  quantity: number;
  unitPrice: number;
  hsCode?: string;
  grade?: string;
  fobUnit: number;
  allocPickup: number;
  allocOcean: number;
  allocDelivery: number;
  allocInsurance: number;
  allocPortClear: number;
  dutyUnit: number;
  landedUnit: number;
  landedTotal: number;
}

interface LandedLineInput {
  productName: string;
  quantity: number;
  unitPrice: number;
  hsCode?: string;
  grade?: string;
}

const computeLinesFromItems = (items: LandedLineInput[], h: LandedHeader): LandedLine[] => {
  const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  const fx = h.fxRate || 1;
  const dutyExempt = h.shipmentType === 'LOCAL' || h.shipmentType === 'EXPORT';
  const pickupEff   = needsPickup(h.freightType)   ? h.pickupTotal   : 0;
  const deliveryEff = needsDelivery(h.freightType) ? h.deliveryTotal : 0;
  return items.map(it => {
    const qty  = Number(it.quantity)  || 0;
    const unit = Number(it.unitPrice) || 0;
    const share = totalQty > 0 ? qty / totalQty : 0;
    const fobUnit = unit * fx;
    const fobLine = fobUnit * qty;
    const allocPickup    = pickupEff         * share;
    const allocOcean     = h.oceanTotal      * share;
    const allocDelivery  = deliveryEff       * share;
    const allocInsurance = h.insuranceTotal  * share;
    const allocPortClear = h.portClearTotal  * share;
    const freightForDuty = allocPickup + allocOcean;
    const cif = fobLine + freightForDuty + allocInsurance;
    const dutyLine = dutyExempt ? 0 : cif * (h.dutyPct / 100);
    const landedTotal = fobLine + allocPickup + allocOcean + allocDelivery + allocInsurance + allocPortClear + dutyLine;
    const landedUnit = qty > 0 ? landedTotal / qty : 0;
    return {
      productName: it.productName,
      quantity: qty,
      unitPrice: unit,
      hsCode: it.hsCode,
      grade: it.grade,
      fobUnit,
      allocPickup:    qty > 0 ? allocPickup    / qty : 0,
      allocOcean:     qty > 0 ? allocOcean     / qty : 0,
      allocDelivery:  qty > 0 ? allocDelivery  / qty : 0,
      allocInsurance: qty > 0 ? allocInsurance / qty : 0,
      allocPortClear: qty > 0 ? allocPortClear / qty : 0,
      dutyUnit:       qty > 0 ? dutyLine       / qty : 0,
      landedUnit,
      landedTotal,
    };
  });
};

const POSelector: React.FC<{
  pos: PurchaseOrder[];
  value: string;
  onChange: (id: string) => void;
}> = ({ pos, value, onChange }) => (
  <div className="flex items-center gap-2">
    <span className="text-[11px] text-slate-500 uppercase tracking-wider">Existing PO</span>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-7 text-[12px] bg-[#111111] border border-[#1f1f1f] text-slate-200 rounded-md px-2 appearance-none"
    >
      <option value="">— pick a PO —</option>
      {pos.map(po => (
        <option key={po.id} value={po.id}>
          {po.id.slice(0, 14)} · {shortName(po.supplierName)} · {money(po.totalAmount, po.currency)}
        </option>
      ))}
    </select>
  </div>
);

/** Summarize an offer's items for the dropdown. Keeps the <option>
 *  text scannable: first one or two product names, "+N more" when it
 *  spills, plus qty when a single item. */
const summarizeOfferItems = (items: SupplierOffer['items']): string => {
  if (!items || items.length === 0) return 'no items';
  const names = items.map(it => (it.productName ?? '').trim()).filter(Boolean);
  if (names.length === 0) return `${items.length} item${items.length === 1 ? '' : 's'}`;
  if (items.length === 1) {
    const it = items[0];
    const qty = Number(it.quantity) || 0;
    const suffix = qty ? ` × ${qty.toLocaleString('en-US')}` : '';
    return `${names[0]}${suffix}`;
  }
  const head = names.slice(0, 2).join(', ');
  const extra = names.length > 2 ? ` +${names.length - 2} more` : '';
  return `${head}${extra}`;
};

const OfferSelector: React.FC<{
  offers: SupplierOffer[];
  value: string;
  onChange: (id: string) => void;
}> = ({ offers, value, onChange }) => (
  <div className="flex items-center gap-2">
    <span className="text-[11px] text-slate-500 uppercase tracking-wider">Source offer</span>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-7 text-[12px] bg-[#111111] border border-[#1f1f1f] text-slate-200 rounded-md px-2 appearance-none max-w-[540px]"
    >
      <option value="">— pick an offer —</option>
      {offers.map(o => (
        <option key={o.id} value={o.id}>
          {(o.offerNumber || o.id.slice(0, 14))} · {shortName(o.supplierName)} · {money(o.totalAmount, o.currency)} · {summarizeOfferItems(o.items)}
        </option>
      ))}
    </select>
  </div>
);

const InlineMoney: React.FC<{ label: string; value: number; onChange: (n: number) => void; disabled?: boolean; sublabel?: string }> = ({ label, value, onChange, disabled, sublabel }) => (
  <div className={disabled ? 'opacity-50' : undefined}>
    <div className="text-[10.5px] text-slate-500 uppercase tracking-wider mb-1">
      {label} <span className="text-slate-700">(USD)</span>
    </div>
    <Input
      type="number" min={0} step={1}
      value={disabled ? '' : (value || '')}
      disabled={disabled}
      onChange={e => onChange(Number(e.target.value) || 0)}
      className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums text-right disabled:cursor-not-allowed"
    />
    {sublabel && <div className="text-[10px] text-slate-500 mt-1 truncate" title={sublabel}>{sublabel}</div>}
  </div>
);

const InlineNum: React.FC<{ label: string; value: number; onChange: (n: number) => void; step?: number; suffix?: string }> = ({ label, value, onChange, step, suffix }) => (
  <div>
    <div className="text-[10.5px] text-slate-500 uppercase tracking-wider mb-1">{label}</div>
    <div className="relative">
      <Input
        type="number" min={0} step={step ?? 1}
        value={value || ''}
        onChange={e => onChange(Number(e.target.value) || 0)}
        className="h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 font-mono tabular-nums text-right pr-6"
      />
      {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-500 pointer-events-none">{suffix}</span>}
    </div>
  </div>
);

// ─────────── Freight quote matching (POL/POD → best rate) ────────

/** Pull "GTPRQ" out of "Puerto Quetzal (GTPRQ)". Returns the trimmed
 *  raw string when no parens are present. */
const extractPortCode = (raw: string | null | undefined): string => {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const m = s.match(/\(([A-Z0-9]{3,6})\)/);
  return m ? m[1].trim().toUpperCase() : s.toUpperCase();
};

/** Loose match: compare raw name (lowercased) OR extracted parenthetical
 *  code. Quote fields can be stored either way depending on who created
 *  the record. */
const portMatches = (headerValue: string, quoteFull: string | null, quoteCode: string | null): boolean => {
  if (!headerValue.trim()) return false;
  const hRaw = headerValue.trim().toLowerCase();
  const hCode = extractPortCode(headerValue);
  const qFull = (quoteFull ?? '').trim().toLowerCase();
  const qCode = (quoteCode ?? '').trim().toUpperCase();
  if (qFull && (qFull === hRaw || qFull.includes(hRaw) || hRaw.includes(qFull))) return true;
  if (qCode && hCode && qCode === hCode) return true;
  return false;
};

/** Standard 40ft container payload used to normalize quote rates to
 *  per-pound. Quotes on this ERP are always priced as if the box is
 *  filled to this weight, so scaling against the actual shipment size
 *  gives an accurate ocean-freight allocation. */
const CONTAINER_CAPACITY_LBS = 43_000;

/** Coalesce a quote's rate to a single number for display + sorting.
 *  The `oceanCost` breakdown column is often stored as `0` rather
 *  than null, so a plain `??` fallback lets the zero swallow the
 *  real `rate`. Prefer the first value that's strictly > 0. */
const quoteRate = (q: FreightQuote): number => {
  if (typeof q.oceanCost === 'number' && q.oceanCost > 0) return q.oceanCost;
  if (typeof q.rate === 'number' && q.rate > 0) return q.rate;
  return 0;
};

/** Scale a per-container quote rate to the shipment's actual weight.
 *  `quote_rate` is for a full 43k lb container, so the effective
 *  ocean freight for a shipment of N lbs is `quote_rate × N / 43k`.
 *  When N is missing we fall back to the raw rate. */
const scaleRateToShipment = (quote: number, totalLbs: number): number => {
  if (!Number.isFinite(totalLbs) || totalLbs <= 0) return quote;
  const scaled = quote * (totalLbs / CONTAINER_CAPACITY_LBS);
  return Math.round(scaled);
};

const isExpiredQuote = (q: FreightQuote, today: string): boolean => {
  if ((q.status ?? '').toUpperCase() === 'EXPIRED') return true;
  if (q.validUntil && q.validUntil.slice(0, 10) < today) return true;
  return false;
};

/** Return every quote whose POL+POD both match the given header values,
 *  sorted so active ones come first (cheapest-first), with expired
 *  ones at the end. The auto-pick (first entry) is always the cheapest
 *  ACTIVE quote so we don't default to something stale; the full list
 *  populates the "Other" dropdown where expired rows get tagged so
 *  users can still see why a cheaper quote wasn't chosen. Quotes with
 *  no usable rate (0 or null everywhere) sink below priced ones. */
const matchingQuotes = (quotes: FreightQuote[], pol: string, pod: string): FreightQuote[] => {
  if (!pol.trim() || !pod.trim()) return [];
  const today = new Date().toISOString().slice(0, 10);
  const candidates = quotes.filter(q => {
    const polHit = portMatches(pol, q.originPort,      q.originPortCode);
    const podHit = portMatches(pod, q.destinationPort, q.destinationPortCode);
    return polHit && podHit;
  });
  return candidates
    .map(q => {
      const r = quoteRate(q);
      return {
        q,
        rate: r > 0 ? r : Number.POSITIVE_INFINITY,
        expired: isExpiredQuote(q, today),
      };
    })
    .sort((a, b) => {
      if (a.expired !== b.expired) return a.expired ? 1 : -1;
      return a.rate - b.rate;
    })
    .map(x => x.q);
};

const DEFAULT_LANDED_HEADER: LandedHeader = {
  fxRate: 1, pickupTotal: 0, oceanTotal: 0, deliveryTotal: 0,
  insuranceTotal: 0, portClearTotal: 0, dutyPct: 0,
  shipmentType: 'EXPORT', freightType: 'PORT_TO_PORT', marginPct: 15,
  pod: '', pol: '',
};

const Step2LandedCost: React.FC<{
  /** Picked offer from step 1. When set and no PO is yet saved, landed
   *  cost is computed against the offer directly (pre-purchase mode). */
  picked: SupplierOffer | null;
  /** Optional PO id — after step 3 saves a PO, step 2 pivots into
   *  "edit landed cost on saved PO" mode for re-runs. */
  savedPOId: string | null;
  /** Lifted header state so step 3 can read it when creating the PO. */
  header: LandedHeader | null;
  lines: LandedLine[];
  onHeaderChange: (h: LandedHeader | null) => void;
  onLinesChange: (l: LandedLine[]) => void;
  /** Swap the source offer without bouncing back to step 1 — lets a
   *  user who landed on Landed cost directly choose what to compute
   *  against. */
  onSelectOffer: (offer: SupplierOffer | null) => void;
  onBack: () => void;
  onNext: () => void;
}> = ({ picked, savedPOId, header: headerProp, lines: linesProp, onHeaderChange, onLinesChange, onSelectOffer, onBack, onNext }) => {
  const toast = useToast();
  const pos = usePurchaseOrders();
  const offers = useSupplierOffers();
  const quotes = useFreightQuotes();
  const qc = useQueryClient();

  // AI best-guess for ocean freight when no quote matches the lane.
  // Uses the same gemini-proxy the other AI features go through, so
  // the key stays server-side.
  const [aiGuess, setAiGuess] = useState<{ rate: number; note: string } | null>(null);
  const aiMutation = useMutation<{ rate: number; note: string } | null, Error, { pol: string; pod: string; container: string }>({
    mutationFn: async ({ pol, pod, container }) => {
      const ai = new GoogleGenAI({ apiKey: 'proxy' });
      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{
          role: 'user',
          parts: [{ text:
            `You are an international freight-rate estimator for an ocean-shipping trading ERP.\n` +
            `Lane: POL "${pol}" → POD "${pod}"\n` +
            `Equipment: ${container}\n` +
            `Return ONLY a JSON object: {"rate_usd": <number, best-guess current market rate for this single container on this lane, port-to-port all-in, round to nearest $50>, "assumptions": "<one short sentence about what the estimate is based on>"}.\n` +
            `No markdown, no commentary, no currency symbols.`,
          }],
        }],
        config: { responseMimeType: 'application/json', temperature: 0.1 },
      });
      const text = (result as { text?: string }).text ?? '';
      let parsed: { rate_usd?: unknown; assumptions?: unknown };
      try { parsed = JSON.parse(text); } catch {
        const stripped = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
        parsed = JSON.parse(stripped);
      }
      const rate = typeof parsed.rate_usd === 'number' ? parsed.rate_usd : Number(parsed.rate_usd);
      if (!Number.isFinite(rate) || rate <= 0) return null;
      const note = typeof parsed.assumptions === 'string' ? parsed.assumptions : '';
      return { rate: Math.round(rate), note };
    },
    onSuccess: (data) => { if (data) setAiGuess(data); },
    onError: (err) => toast.push({ kind: 'error', title: 'AI rate failed', description: err.message }),
  });

  // PO selector — only active when no picked offer drives the step.
  // Coming from step 1 we always operate on the picked offer; the
  // dropdown is hidden so the user doesn't accidentally jump to some
  // other PO mid-flow.
  const [poId, setPoId] = useState<string>(savedPOId ?? '');
  useEffect(() => {
    if (picked) return;
    if (poId) return;
    const list = pos.data ?? [];
    if (savedPOId && list.some(p => p.id === savedPOId)) setPoId(savedPOId);
    else if (list[0]) setPoId(list[0].id);
  }, [pos.data, savedPOId, poId, picked]);

  const po = useMemo(
    () => (picked ? null : (pos.data?.find(p => p.id === poId) ?? null)),
    [picked, pos.data, poId],
  );

  // Items array that feeds computeLinesFromItems — offer first, then PO.
  const items = useMemo<LandedLineInput[]>(() => {
    if (picked) return picked.items.map(it => ({
      productName: it.productName,
      quantity: Number(it.quantity) || 0,
      unitPrice: Number(it.unitPrice) || 0,
      hsCode: it.hsCode ?? undefined,
      grade: it.grade ?? undefined,
    }));
    if (po) return po.items.map(it => ({
      productName: it.productName,
      quantity: Number(it.quantity) || 0,
      unitPrice: Number(it.unitPrice) || 0,
      hsCode: (it as { hsCode?: string }).hsCode,
      grade: (it as { grade?: string }).grade,
    }));
    return [];
  }, [picked, po]);

  const currency = picked?.currency ?? po?.currency ?? 'USD';

  // Local header state mirrored to the lifted state — keeps typing
  // responsive while still syncing up to the wizard after each change.
  const [header, setHeader] = useState<LandedHeader>(headerProp ?? DEFAULT_LANDED_HEADER);

  // Seed the header the first time we see a picked offer or a PO —
  // for offers we use defaults, for saved POs we rehydrate from their
  // persisted landed fields.
  useEffect(() => {
    if (headerProp) return; // already seeded
    if (picked) {
      const next: LandedHeader = {
        ...DEFAULT_LANDED_HEADER,
        fxRate: picked.currency === 'USD' ? 1 : 1,
        freightType:
          picked.freightType === 'DOOR_TO_PORT' ? 'DOOR_TO_PORT' :
          picked.freightType === 'PORT_TO_DOOR' ? 'PORT_TO_DOOR' :
          picked.freightType === 'DOOR_TO_DOOR' ? 'DOOR_TO_DOOR' : 'PORT_TO_PORT',
        pod: picked.destinationPort ?? '',
        pol: picked.originPort ?? '',
      };
      setHeader(next);
      onHeaderChange(next);
      return;
    }
    if (po) {
      const a = po as unknown as Record<string, unknown>;
      const next: LandedHeader = {
        fxRate:         po.currency === 'USD' ? 1 : (Number(a.fxRateToUsd) || 1),
        pickupTotal:    Number(a.freightPickupTotalUsd)   || 0,
        oceanTotal:     Number(a.freightOceanTotalUsd)    || 0,
        deliveryTotal:  Number(a.freightDeliveryTotalUsd) || 0,
        insuranceTotal: Number(a.insuranceTotalUsd)       || 0,
        portClearTotal: Number(a.portClearanceTotalUsd)   || 0,
        dutyPct:        Number(a.dutyRatePct)             || 0,
        shipmentType:
          a.shipmentType === 'LOCAL'  ? 'LOCAL'  :
          a.shipmentType === 'IMPORT' ? 'IMPORT' : 'EXPORT',
        freightType:
          a.freightType === 'DOOR_TO_PORT' ? 'DOOR_TO_PORT' :
          a.freightType === 'PORT_TO_DOOR' ? 'PORT_TO_DOOR' :
          a.freightType === 'DOOR_TO_DOOR' ? 'DOOR_TO_DOOR' : 'PORT_TO_PORT',
        marginPct:      Number(a.marginPct) || 15,
        pod:            (a.destinationPort as string | null | undefined) ?? '',
        pol:            (a.originPort as string | null | undefined) ?? '',
      };
      setHeader(next);
      onHeaderChange(next);
    }
  }, [picked?.id, po?.id, headerProp, onHeaderChange]);

  const patch = <K extends keyof LandedHeader>(k: K, v: LandedHeader[K]) => {
    setHeader(prev => {
      const next = { ...prev, [k]: v };
      onHeaderChange(next);
      return next;
    });
  };

  const lines = useMemo(() => computeLinesFromItems(items, header), [items, header]);
  useEffect(() => { onLinesChange(lines); }, [lines, onLinesChange]);

  // All freight quotes whose lane matches the current POL/POD, sorted
  // cheapest-first. The first is the auto-pick; the full list powers
  // the "Other" dropdown so the user can override the pick.
  const laneQuotes = useMemo(
    () => matchingQuotes(quotes.data ?? [], header.pol, header.pod),
    [quotes.data, header.pol, header.pod],
  );
  // User-chosen override (by quote id). When null, we default to the
  // cheapest match.
  const [pickedQuoteId, setPickedQuoteId] = useState<string | null>(null);
  const todayIso = new Date().toISOString().slice(0, 10);
  const bestQuote = useMemo(() => {
    if (pickedQuoteId) {
      const match = laneQuotes.find(q => q.id === pickedQuoteId);
      if (match) return match;
    }
    // Auto-pick skips expired; if every match is expired, return null
    // so the AI-fallback chip shows instead of defaulting to stale data.
    const active = laneQuotes.find(q => !isExpiredQuote(q, todayIso));
    return active ?? null;
  }, [laneQuotes, pickedQuoteId, todayIso]);
  const [showOtherQuotes, setShowOtherQuotes] = useState(false);

  // Clear a stale AI guess + any manual pick whenever the lane
  // changes — prevents a stale number lingering after user edits
  // POL/POD.
  useEffect(() => {
    setAiGuess(null);
    setPickedQuoteId(null);
    setShowOtherQuotes(false);
  }, [header.pol, header.pod]);

  const totalQty  = lines.reduce((s, l) => s + l.quantity, 0);
  const fobGrand  = lines.reduce((s, l) => s + l.fobUnit * l.quantity, 0);
  const logTotal  = header.pickupTotal + header.oceanTotal + header.deliveryTotal + header.insuranceTotal + header.portClearTotal;
  const dutyGrand = lines.reduce((s, l) => s + l.dutyUnit * l.quantity, 0);
  const landedGrand = lines.reduce((s, l) => s + l.landedTotal, 0);

  const [saving, setSaving] = useState(false);

  const loadingLocation = picked?.loadingLocation ?? (po as unknown as Record<string, unknown> | null)?.loadingLocation as string | null | undefined;
  const originPort      = picked?.originPort      ?? (po as unknown as Record<string, unknown> | null)?.originPort as string | null | undefined;
  const destinationPort = picked?.destinationPort ?? (po as unknown as Record<string, unknown> | null)?.destinationPort as string | null | undefined;

  const hasInput = !!picked || !!po;

  // Only available in "edit existing PO" mode — saves landed fields
  // onto the PO row and rewrites cost_calculations for it. In offer
  // mode the save happens in step 3 when the PO is created.
  const saveLanded = async () => {
    if (!po) return;
    setSaving(true);
    const sb = getSupabaseClient();
    try {
      // Update the PO jsonb items + header landed fields.
      const nextItems = po.items.map((it, i) => ({
        ...it,
        landedFobUnitUsd:       lines[i].fobUnit,
        landedPickupUnitUsd:    lines[i].allocPickup,
        landedOceanUnitUsd:     lines[i].allocOcean,
        landedDeliveryUnitUsd:  lines[i].allocDelivery,
        landedInsuranceUnitUsd: lines[i].allocInsurance,
        landedPortClearUnitUsd: lines[i].allocPortClear,
        landedDutyUnitUsd:      lines[i].dutyUnit,
        landedUnitPriceUsd:     lines[i].landedUnit,
        landedTotalUsd:         lines[i].landedTotal,
      }));
      const { error: poErr } = await sb.from('purchase_orders').update({
        items: nextItems,
        fxRateToUsd:             header.fxRate,
        freightPickupTotalUsd:   header.pickupTotal,
        freightOceanTotalUsd:    header.oceanTotal,
        freightDeliveryTotalUsd: header.deliveryTotal,
        insuranceTotalUsd:       header.insuranceTotal,
        portClearanceTotalUsd:   header.portClearTotal,
        dutyRatePct:             header.dutyPct,
        shipmentType:            header.shipmentType,
        freightType:             header.freightType,
        marginPct:               header.marginPct,
        landedGrandUsd:          landedGrand,
        originPort:              header.pol.trim() || (po as unknown as Record<string, unknown>).originPort,
        destinationPort:         header.pod.trim() || (po as unknown as Record<string, unknown>).destinationPort,
      }).eq('id', po.id);
      if (poErr) throw new Error(`PO update failed: ${poErr.message}`);

      // Mirror each line into cost_calculations → feeds step 4.
      const stamp = Date.now();
      const marginDec = Math.min(Math.max(header.marginPct / 100, 0), 0.999);
      const calcRows = lines.map((l, i) => ({
        id:                 `CA${stamp}-${i}`,
        companyId:          po.companyId,
        calculationNumber:  `CA-${String(stamp).slice(-7)}-${i + 1}`,
        date:               new Date().toISOString(),
        productName:        l.productName,
        hsCode:             l.hsCode ?? null,
        origin:             header.pol.trim() || ((po as unknown as Record<string, unknown>).originPort as string | null) || null,
        destination:        header.pod.trim() || ((po as unknown as Record<string, unknown>).destinationPort as string | null) || null,
        pickupLocation:     ((po as unknown as Record<string, unknown>).loadingLocation as string | null) ?? null,
        fobPrice:           l.fobUnit,
        quantity:           l.quantity,
        freightCost:        (l.allocPickup + l.allocOcean + l.allocDelivery) * l.quantity,
        insuranceCost:      l.allocInsurance * l.quantity,
        dutyPercent:        header.dutyPct,
        portClearanceCost:  l.allocPortClear * l.quantity,
        deliveryCost:       l.allocDelivery * l.quantity,
        marginPercent:      header.marginPct,
        totalLandedCost:    l.landedTotal,
        unitLandedCost:     l.landedUnit,
        recommendedSalesPrice: marginDec < 1 ? l.landedUnit / (1 - marginDec) : l.landedUnit,
        supplierName:       po.supplierName,
        poa:                header.pol.trim() || ((po as unknown as Record<string, unknown>).originPort as string | null) || null,
        pod:                header.pod.trim() || ((po as unknown as Record<string, unknown>).destinationPort as string | null) || null,
        deliveryMethod:     ((po as unknown as Record<string, unknown>).incoterm as string | null) ?? null,
      }));
      const { error: ccErr } = await sb.from('cost_calculations').upsert(calcRows, { onConflict: 'id' });
      if (ccErr) throw new Error(`Price list upsert failed: ${ccErr.message}`);

      void qc.invalidateQueries({ queryKey: ['purchaseOrders'] });
      void qc.invalidateQueries({ queryKey: ['costCalculations'] });
      toast.push({
        kind: 'success',
        title: 'Landed cost saved',
        description: `${po.id.slice(0, 14)} · ${calcRows.length} price entr${calcRows.length === 1 ? 'y' : 'ies'}`,
      });
    } catch (err) {
      toast.push({ kind: 'error', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Landed cost
          {picked && (
            <span className="ml-2 text-[11px] font-normal text-slate-500">
              · offer from <span className="text-slate-300">{shortName(picked.supplierName)}</span>
            </span>
          )}
          {!picked && savedPOId && (
            <span className="ml-2 text-[11px] font-normal text-slate-500">
              · editing saved PO
            </span>
          )}
        </CardTitle>
        <div className="flex items-center gap-3 flex-wrap">
          <OfferSelector
            offers={offers.data ?? []}
            value={picked?.id ?? ''}
            onChange={(id) => {
              if (!id) { onSelectOffer(null); return; }
              const o = (offers.data ?? []).find(x => x.id === id);
              if (o) onSelectOffer(o);
            }}
          />
          {!picked && <POSelector pos={pos.data ?? []} value={poId} onChange={setPoId} />}
        </div>
      </CardHeader>
      {!hasInput ? (
        <EmptyState
          title={pos.isLoading || offers.isLoading ? 'Loading…' : 'Pick a source for this calculation'}
          description="Choose a supplier offer above to compute landed cost before a purchase order exists — or load an existing PO to re-run costs against it."
          action={{ label: '← Back to Source', onClick: onBack }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="This offer has no line items"
          description="Go back to step 1, edit the offer, and add at least one product with a quantity and unit price so landed cost has something to compute."
          action={{ label: '← Back to Source', onClick: onBack }}
        />
      ) : (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10.5px] text-slate-500 uppercase tracking-wider mb-1">Port of loading (POL)</div>
              <SupabaseSelectField
                source={{ table: 'ports', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'code', scopeByCompany: true }}
                value={header.pol}
                onPick={v => patch('pol', v)}
                placeholder={loadingLocation || 'Pick or type a port…'}
                allowFreeText
              />
            </div>
            <div>
              <div className="text-[10.5px] text-slate-500 uppercase tracking-wider mb-1">Port of destination (POD)</div>
              <SupabaseSelectField
                source={{ table: 'ports', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'code', scopeByCompany: true }}
                value={header.pod}
                onPick={v => patch('pod', v)}
                placeholder="Pick or type a port…"
                allowFreeText
              />
            </div>
          </div>
          <div className={cn('grid gap-3', currency !== 'USD' ? 'grid-cols-6' : 'grid-cols-5')}>
            <div>
              <div className="text-[10.5px] text-slate-500 uppercase tracking-wider mb-1">Shipment type</div>
              <select value={header.shipmentType}
                onChange={e => patch('shipmentType', e.target.value as ShipmentType)}
                className="h-8 w-full text-[12.5px] bg-[#111111] border border-[#1f1f1f] text-slate-200 rounded-md px-2 appearance-none">
                <option value="IMPORT">Import (duty applies)</option>
                <option value="EXPORT">Export (no duty)</option>
                <option value="LOCAL">Local (no duty)</option>
              </select>
            </div>
            <div>
              <div className="text-[10.5px] text-slate-500 uppercase tracking-wider mb-1">Freight type</div>
              <select value={header.freightType}
                onChange={e => patch('freightType', e.target.value as FreightType)}
                className="h-8 w-full text-[12.5px] bg-[#111111] border border-[#1f1f1f] text-slate-200 rounded-md px-2 appearance-none">
                {(Object.keys(FREIGHT_TYPE_LABEL) as FreightType[]).map(k => (
                  <option key={k} value={k}>{FREIGHT_TYPE_LABEL[k]}</option>
                ))}
              </select>
            </div>
            {currency !== 'USD' && (
              <InlineNum label={`FX ${currency} → USD`} value={header.fxRate}
                onChange={v => patch('fxRate', v)} step={0.0001} suffix="×" />
            )}
            <InlineMoney label="Broker & port expenses" value={header.portClearTotal}
              onChange={v => patch('portClearTotal', v)} />
            <InlineNum label="Duty rate" value={header.dutyPct}
              onChange={v => patch('dutyPct', v)} step={0.1} suffix="%" />
            <div className="flex flex-col justify-end text-right">
              <div className="text-[10.5px] text-slate-500 uppercase tracking-wider">FOB subtotal (USD)</div>
              <div className="font-mono tabular-nums text-slate-100 text-[13px]">{usd(fobGrand)}</div>
            </div>
          </div>

          {/* Freight-quote assistant — auto-matches POL+POD against the
              freight_quotes table. If a matching quote exists, show it
              with an Apply button; if not, offer an AI best-guess. */}
          {header.pol.trim() && header.pod.trim() && (
            <div className="rounded-md border border-[#1f1f1f] bg-[#0b0b0b] px-3 py-2 flex flex-col gap-2 text-[11.5px]">
              {bestQuote ? (() => {
                const rate = quoteRate(bestQuote);
                const totalLbs = lines.reduce((s, l) => s + l.quantity, 0);
                const scaled = scaleRateToShipment(rate, totalLbs);
                const otherCount = Math.max(laneQuotes.length - 1, 0);
                return (
                  <>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 text-white">
                        <Check size={11} />
                        {pickedQuoteId ? 'Selected quote' : 'Best matching quote'}
                      </span>
                      <span className="text-white font-mono tabular-nums">{usd(rate)}</span>
                      <span className="text-white truncate">
                        {bestQuote.agentName ?? 'agent —'}
                        {bestQuote.containerType ? ` · ${bestQuote.containerType}` : ''}
                        {bestQuote.validUntil ? ` · valid until ${fmtDate(bestQuote.validUntil)}` : ''}
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        {laneQuotes.length > 1 && (
                          <Button
                            size="sm"
                            onClick={() => setShowOtherQuotes(v => !v)}
                            className="h-6 px-2 text-[11px] rounded-md"
                            style={{ backgroundColor: 'transparent', border: '1px solid #2a2a2a', color: '#fff' }}
                          >
                            {showOtherQuotes ? 'Hide' : `Other (${otherCount})`}
                          </Button>
                        )}
                        <Button size="sm" onClick={() => patch('oceanTotal', scaled)}
                          className="h-6 px-2 text-[11px] bg-indigo-600 text-white hover:bg-indigo-500 rounded-md">
                          Apply {usd(scaled)}
                        </Button>
                      </div>
                    </div>
                    {totalLbs > 0 && totalLbs !== CONTAINER_CAPACITY_LBS && rate > 0 && (
                      <div className="text-[10.5px]" style={{ color: '#94a3b8' }}>
                        Quote is per full container ({CONTAINER_CAPACITY_LBS.toLocaleString('en-US')} lbs).
                        Shipment is {Math.round(totalLbs).toLocaleString('en-US')} lbs → scaled ocean freight {usd(scaled)}.
                      </div>
                    )}
                    {showOtherQuotes && laneQuotes.length > 1 && (
                      <div
                        className="rounded border"
                        style={{ backgroundColor: '#0a0a0a', borderColor: '#1f1f1f', color: '#fff' }}
                      >
                        {laneQuotes.map((q, i) => {
                          const qRate = quoteRate(q);
                          const qScaled = scaleRateToShipment(qRate, totalLbs);
                          const isActive = q.id === bestQuote.id;
                          const expired = isExpiredQuote(q, todayIso);
                          return (
                            <div
                              key={q.id}
                              className="flex items-center gap-3 px-3 py-1.5"
                              style={{
                                color: '#fff',
                                borderTop: i === 0 ? 'none' : '1px solid #1f1f1f',
                                opacity: expired ? 0.65 : 1,
                              }}
                            >
                              <span className="font-mono tabular-nums w-[80px] text-right" style={{ color: '#fff' }}>{usd(qRate)}</span>
                              <span className="truncate flex-1" style={{ color: '#fff' }}>
                                {q.agentName ?? 'agent —'}
                                {q.containerType ? ` · ${q.containerType}` : ''}
                                {q.validUntil ? ` · valid until ${fmtDate(q.validUntil)}` : ''}
                              </span>
                              {expired && (
                                <span
                                  className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider rounded px-1.5 py-0.5"
                                  style={{ color: '#fca5a5', backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}
                                >
                                  expired
                                </span>
                              )}
                              {isActive ? (
                                <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: '#6ee7b7' }}>
                                  <Check size={10} /> in use
                                </span>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setPickedQuoteId(q.id);
                                    patch('oceanTotal', qScaled);
                                    setShowOtherQuotes(false);
                                  }}
                                  className="h-5 px-2 text-[10.5px] rounded"
                                  style={{ backgroundColor: '#161616', border: '1px solid #2a2a2a', color: '#e2e8f0' }}
                                  title={expired ? 'Quote is expired but you can still apply its rate' : `Apply ${usd(qScaled)} (scaled to ${Math.round(totalLbs).toLocaleString('en-US')} lbs)`}
                                >
                                  Use {usd(qScaled)}
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })() : aiGuess ? (() => {
                const totalLbs = lines.reduce((s, l) => s + l.quantity, 0);
                const scaled = scaleRateToShipment(aiGuess.rate, totalLbs);
                return (
                  <>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1.5 text-indigo-300">
                        <Sparkles size={11} /> AI best guess
                      </span>
                      <span className="text-slate-100 font-mono tabular-nums">{usd(aiGuess.rate)}</span>
                      <span className="text-slate-400 truncate italic" title={aiGuess.note}>{aiGuess.note || 'lane-only estimate'}</span>
                      <Button size="sm" onClick={() => patch('oceanTotal', scaled)}
                        className="ml-auto h-6 px-2 text-[11px] bg-indigo-600 text-white hover:bg-indigo-500 rounded-md">
                        Apply {usd(scaled)}
                      </Button>
                    </div>
                    {totalLbs > 0 && totalLbs !== CONTAINER_CAPACITY_LBS && aiGuess.rate > 0 && (
                      <div className="text-[10.5px]" style={{ color: '#94a3b8' }}>
                        Guess is per full container ({CONTAINER_CAPACITY_LBS.toLocaleString('en-US')} lbs).
                        Shipment is {Math.round(totalLbs).toLocaleString('en-US')} lbs → scaled ocean freight {usd(scaled)}.
                      </div>
                    )}
                  </>
                );
              })() : (
                <div className="flex items-center gap-3">
                  <span className="text-slate-500">
                    No freight quote matches this lane.
                  </span>
                  <Button
                    size="sm"
                    onClick={() => aiMutation.mutate({ pol: header.pol, pod: header.pod, container: '1 × 40ft container' })}
                    disabled={aiMutation.isPending}
                    className="ml-auto h-6 px-2 text-[11px] bg-indigo-600/80 text-white hover:bg-indigo-500 rounded-md inline-flex items-center gap-1.5"
                  >
                    {aiMutation.isPending
                      ? <><Loader2 size={10} className="animate-spin" /> Asking AI…</>
                      : <><Sparkles size={10} /> Ask AI for best-guess rate</>}
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-4 gap-3">
            <InlineMoney label="Pickup" value={header.pickupTotal}
              onChange={v => patch('pickupTotal', v)}
              disabled={!needsPickup(header.freightType)}
              sublabel={
                !needsPickup(header.freightType)
                  ? 'Not applicable for this freight type'
                  : `${cityCountry(loadingLocation ?? null) || '—'}${originPort ? ` → ${originPort}` : ''}`
              } />
            <InlineMoney label="Ocean freight" value={header.oceanTotal}
              onChange={v => patch('oceanTotal', v)} />
            <InlineMoney label="Delivery" value={header.deliveryTotal}
              onChange={v => patch('deliveryTotal', v)}
              disabled={!needsDelivery(header.freightType)}
              sublabel={
                !needsDelivery(header.freightType)
                  ? 'Not applicable for this freight type'
                  : (destinationPort ? `${destinationPort} → dest` : 'POD → dest')
              } />
            <InlineMoney label="Insurance" value={header.insuranceTotal}
              onChange={v => patch('insuranceTotal', v)} />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <InlineNum label="Sales margin" value={header.marginPct}
              onChange={v => patch('marginPct', v)} step={0.5} suffix="%" />
            <div className="col-span-3 flex items-end">
              <div className="text-[10.5px] text-slate-500 leading-relaxed">
                Sale price = landed ÷ (1 − margin).{' '}
                {picked
                  ? <>Saved into <span className="text-slate-400 font-mono">cost_calculations</span> when the PO is created in step 3.</>
                  : <>Saved into <span className="text-slate-400 font-mono">cost_calculations</span> when you hit Save, so step 4 picks each line up.</>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-3">
            <Summary label="Logistics total" value={usd(logTotal)} />
            <Summary label={`Duty (${(header.shipmentType === 'LOCAL' || header.shipmentType === 'EXPORT') ? 'waived' : header.dutyPct + '%'})`} value={usd(dutyGrand)} />
            <Summary label="Units (total qty)" value={totalQty.toLocaleString('en-US')} />
            <Summary label="Landed grand total" value={usd(landedGrand)} emphasize />
          </div>

          <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] overflow-hidden">
            <table className="w-full text-[11.5px]">
              <thead>
                <tr className="text-[10px] text-slate-500 uppercase tracking-wider border-b border-[#1f1f1f]">
                  <th className="px-3 py-1.5 text-left font-normal">Product</th>
                  <th className="px-3 py-1.5 text-right font-normal">Qty</th>
                  <th className="px-3 py-1.5 text-right font-normal">FOB /unit</th>
                  <th className="px-3 py-1.5 text-right font-normal">Pickup</th>
                  <th className="px-3 py-1.5 text-right font-normal">Ocean</th>
                  <th className="px-3 py-1.5 text-right font-normal">Deliv.</th>
                  <th className="px-3 py-1.5 text-right font-normal">Insur.</th>
                  <th className="px-3 py-1.5 text-right font-normal">Port</th>
                  <th className="px-3 py-1.5 text-right font-normal">Duty</th>
                  <th className="px-3 py-1.5 text-right font-normal">Landed /unit</th>
                  <th className="px-3 py-1.5 text-right font-normal">Landed total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1f1f1f]">
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 text-slate-100 max-w-[220px]">
                      <div className="truncate">{l.productName}</div>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-300">{l.quantity.toLocaleString('en-US')}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-300">{usd(l.fobUnit)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500">{usd(l.allocPickup)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500">{usd(l.allocOcean)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500">{usd(l.allocDelivery)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500">{usd(l.allocInsurance)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500">{usd(l.allocPortClear)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-500">{usd(l.dutyUnit)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-emerald-300">{usd(l.landedUnit)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-100">{usd(l.landedTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button size="sm" onClick={onBack}
              className="h-7 px-2.5 text-[12px] bg-transparent text-slate-400 hover:text-slate-200 border border-[#1f1f1f] rounded-md">
              ← Source
            </Button>
            {po && (
              <Button size="sm" onClick={saveLanded} loading={saving}
                className="h-7 px-2.5 text-[12px] bg-[#161616] text-slate-200 hover:bg-[#1f1f1f] border border-[#1f1f1f] rounded-md">
                Save landed cost
              </Button>
            )}
            <Button size="sm" onClick={onNext}
              className="h-7 px-2.5 text-[12px] bg-indigo-600 text-white hover:bg-indigo-500 rounded-md">
              Purchase order →
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

const Summary: React.FC<{ label: string; value: string; emphasize?: boolean }> = ({ label, value, emphasize }) => (
  <div>
    <div className="text-[10.5px] text-slate-500 uppercase tracking-wider">{label}</div>
    <div className={cn('text-[14px] mt-0.5 font-mono tabular-nums',
      emphasize ? 'text-emerald-300 font-semibold' : 'text-slate-100')}>
      {value}
    </div>
  </div>
);

// ───────────────── Step 4: Price list ─────────────────

const Step4PriceList: React.FC<{
  onBack: () => void;
  onRestart: () => void;
}> = ({ onBack, onRestart }) => {
  const toast = useToast();
  const calcs = useCostCalculations();
  const rows = calcs.data ?? [];

  const [search, setSearch] = useState('');
  const [unit, setUnit]     = useState<'LBS' | 'KGS' | 'BOTH'>('BOTH');
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(r =>
      (r.productName ?? '').toLowerCase().includes(needle) ||
      (r.hsCode ?? '').toLowerCase().includes(needle) ||
      (r.calculationNumber ?? '').toLowerCase().includes(needle) ||
      (r.origin ?? r.poa ?? '').toLowerCase().includes(needle) ||
      (r.destination ?? r.pod ?? '').toLowerCase().includes(needle),
    );
  }, [rows, search]);

  // "Puerto Quetzal (GTPRQ)" → "GTPRQ"; falls back to trimmed original.
  const portCode = (raw: string | null): string => {
    if (!raw) return '';
    const m = raw.match(/\(([A-Z0-9]{3,6})\)/);
    return m ? m[1] : raw.trim();
  };
  const loadCode = (r: typeof rows[number]) => portCode(r.origin || r.poa);
  const destFull = (r: typeof rows[number]) => (r.destination || r.pod || '').trim();

  // Saved prices are per lb (v1 convention). Convert to $/kg on display.
  const LB_PER_KG = 2.20462;
  const perLb = (p: number) => p;
  const perKg = (p: number) => p * LB_PER_KG;
  const fmtPrice = (p: number) =>
    p.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });

  const copy = async () => {
    const header = ['Product', 'Calc #', 'Incoterm', 'Load port', 'Destination', 'Qty (lbs)', 'Qty (kgs)', 'Price $/lb', 'Price $/kg', 'Date'].join('\t');
    const body = filtered.map(r => [
      r.productName,
      r.calculationNumber ?? r.id.slice(0, 10),
      r.deliveryMethod ?? '',
      loadCode(r),
      destFull(r),
      r.quantity ? Math.round(r.quantity).toLocaleString('en-US') : '',
      r.quantity ? Math.round(r.quantity / LB_PER_KG).toLocaleString('en-US') : '',
      r.recommendedSalesPrice ? fmtPrice(perLb(r.recommendedSalesPrice)) : '',
      r.recommendedSalesPrice ? fmtPrice(perKg(r.recommendedSalesPrice)) : '',
      r.date ? fmtDate(r.date) : '',
    ].join('\t')).join('\n');
    await navigator.clipboard.writeText([header, body].join('\n'));
    toast.push({ kind: 'success', title: 'Copied', description: `${filtered.length} line${filtered.length === 1 ? '' : 's'}` });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Price list · for sales
          <span className="ml-2 text-slate-500 text-[11px] font-normal">
            {rows.length} saved price{rows.length === 1 ? '' : 's'}
          </span>
        </CardTitle>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-[#1f1f1f] bg-[#111111] p-0.5">
            {(['LBS', 'KGS', 'BOTH'] as const).map(u => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                className={cn(
                  'px-2 py-0.5 text-[10.5px] font-medium rounded uppercase tracking-wider transition-colors',
                  unit === u
                    ? 'bg-indigo-500/20 text-indigo-200'
                    : 'text-slate-500 hover:text-slate-200',
                )}
              >
                {u === 'BOTH' ? 'Both' : u}
              </button>
            ))}
          </div>
          <Input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Product, HS, route, calc #"
            className="h-7 text-[12px] bg-[#111111] border-[#1f1f1f] text-slate-200 placeholder:text-slate-500 w-64"
          />
          <Button size="sm" onClick={copy} disabled={filtered.length === 0}
            className="h-7 px-2.5 text-[12px] bg-[#161616] text-slate-200 hover:bg-[#1f1f1f] border border-[#1f1f1f] rounded-md disabled:opacity-50">
            Copy to clipboard
          </Button>
        </div>
      </CardHeader>

      {calcs.isLoading ? (
        <div className="p-4 text-[12px] text-slate-500">Loading saved prices…</div>
      ) : calcs.error ? (
        <EmptyState tone="danger" title="Couldn't load prices" description={calcs.error.message}
          action={{ label: 'Retry', onClick: calcs.refetch }} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No saved prices yet"
          description="Save a landed-cost calculation in step 2 (or v1's Calculation Sheet) and it'll appear here."
          action={{ label: '← Landed cost', onClick: onBack }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matches" description={`Nothing matched "${search}".`}
          action={{ label: 'Clear search', onClick: () => setSearch('') }} />
      ) : (
        <div className="p-4 space-y-3">
          <div className="text-[10.5px] text-slate-600 leading-relaxed">
            Sales-facing view · Only the computed sale price is shown. Landed cost, margin, supplier and calc internals are hidden.
          </div>
          <DataTable
            columns={[
              { id: 'product', header: 'Product', sortable: true, filterable: true,
                value: r => r.productName,
                cell: r => (
                  <div>
                    <div className="text-slate-100 truncate max-w-[260px]">{r.productName}</div>
                    {r.hsCode && <div className="text-[10px] text-slate-500 mt-0.5">HS {r.hsCode}</div>}
                  </div>
                ) },
              { id: 'calc', header: 'Calc #', mono: true, sortable: true, filterable: true,
                value: r => r.calculationNumber ?? r.id.slice(0, 10),
                cell: r => <span className="text-slate-500 text-[11px]">{r.calculationNumber || r.id.slice(0, 10)}</span> },
              { id: 'incoterm', header: 'Incoterm', sortable: true, filterable: true,
                value: r => r.deliveryMethod ?? '',
                cell: r => r.deliveryMethod
                  ? <Badge variant="info">{r.deliveryMethod}</Badge>
                  : <span className="text-slate-600">—</span> },
              { id: 'route', header: 'Route', sortable: true, filterable: true,
                value: r => `${loadCode(r)} → ${destFull(r)}`,
                cell: r => (
                  <span className="text-slate-400 text-[11px]">
                    <span className="font-mono text-slate-300">{loadCode(r) || '—'}</span>
                    <span className="text-slate-600"> → </span>
                    <span>{destFull(r) || '—'}</span>
                  </span>
                ) },
              { id: 'qty', header: `Qty available${unit === 'BOTH' ? '' : ` (${unit.toLowerCase()})`}`, align: 'right', mono: true, sortable: true,
                value: r => r.quantity,
                cell: r => {
                  if (!r.quantity) return <span className="text-slate-600">—</span>;
                  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
                  const showLbs = unit !== 'KGS';
                  const showKgs = unit !== 'LBS';
                  return (
                    <div className="text-[11.5px]">
                      {showLbs && <div className="text-slate-300">{fmt(r.quantity)} <span className="text-slate-500">lbs</span></div>}
                      {showKgs && <div className="text-slate-300">{fmt(r.quantity / LB_PER_KG)} <span className="text-slate-500">kgs</span></div>}
                    </div>
                  );
                } },
              { id: 'price', header: `Sale price / unit${unit === 'BOTH' ? '' : ` (${unit.toLowerCase()})`}`, align: 'right', mono: true, sortable: true,
                value: r => r.recommendedSalesPrice,
                cell: r => {
                  if (!r.recommendedSalesPrice) return <span className="text-slate-600">—</span>;
                  const showLbs = unit !== 'KGS';
                  const showKgs = unit !== 'LBS';
                  return (
                    <div className="text-[11.5px]">
                      {showLbs && (
                        <div className="text-emerald-300">
                          {fmtPrice(perLb(r.recommendedSalesPrice))} <span className="text-slate-500">/lb</span>
                        </div>
                      )}
                      {showKgs && (
                        <div className="text-emerald-300">
                          {fmtPrice(perKg(r.recommendedSalesPrice))} <span className="text-slate-500">/kg</span>
                        </div>
                      )}
                    </div>
                  );
                } },
              { id: 'date', header: 'Date', align: 'right', sortable: true,
                value: r => r.date ?? '',
                cell: r => (
                  <span className="text-slate-500 font-mono tabular-nums text-[10.5px]">
                    {r.date ? fmtDate(r.date) : '—'}
                  </span>
                ) },
            ]}
            rows={filtered}
            getRowId={r => r.id}
            defaultSort={{ columnId: 'product', direction: 'asc' }}
          />
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button size="sm" onClick={onBack}
              className="h-7 px-2.5 text-[12px] bg-transparent text-slate-400 hover:text-slate-200 border border-[#1f1f1f] rounded-md">
              ← Landed cost
            </Button>
            <Button size="sm" onClick={onRestart}
              className="h-7 px-2.5 text-[12px] bg-transparent text-slate-400 hover:text-slate-200 border border-[#1f1f1f] rounded-md">
              New cycle
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

// ────────────── Supplier offer · AI OCR upload ──────────────

interface OfferSubDraft {
  offerNumber: string;
  notes: string;
  items: Array<{ productName: string; quantity: number | null; unitPrice: number | null }>;
}

interface OfferPackDraft {
  supplierName: string;
  quoteNumber: string;
  validUntil: string;
  paymentTerms: string;
  currency: string;
  incoterm: string;
  loadingLocation: string;
  originPort: string;
  destinationPort: string;
  notes: string;
  offers: OfferSubDraft[];
}

const emptyOfferDraft = (): OfferPackDraft => ({
  supplierName: '', quoteNumber: '', validUntil: '', paymentTerms: '',
  currency: 'USD', incoterm: '', loadingLocation: '', originPort: '',
  destinationPort: '', notes: '',
  offers: [{ offerNumber: '', notes: '', items: [] }],
});

const OFFER_PROMPT = `You are extracting fields from a supplier PROPOSAL, QUOTATION, PROFORMA
INVOICE, or OFFER LETTER that a buyer received. A single document may
contain ONE offer or MULTIPLE offers (e.g. "Offer #1", "Offer #2").
Return JSON exactly in the shape below; missing values must be null —
never guess.

Critical rules:
- supplierName: ALWAYS identify the seller. Look at the letterhead
  logo, masthead company name, footer disclaimer ("...Co.'s no
  claims policy", "Thank you for choosing X"), or email signature.
  On a proforma invoice the seller is the party whose name appears
  as the letterhead — NOT the "Bill To" / "Sold To" / "Ship To"
  address, which is always the buyer. Only leave supplierName null
  if you genuinely cannot identify the sender from the document.
- loadingLocation: the seller's mailing address. On a proforma
  invoice it is printed at the top of the document (under or near
  the letterhead), even when unlabeled. Extract it verbatim — e.g.
  "6546 Petropark Drive, Suite A, Houston, TX 77041". Do NOT use the
  buyer's Bill-To / Ship-To address here.
- When a product lists both GROSS and NET weight, use NET as the
  quantity. If only one weight is shown, use that.
- Freight surcharges, credits, discounts, deposits, and special
  conditions that don't fit a structured field go into \`notes\`
  (top-level for document-wide remarks, per-offer for per-offer remarks).
  DO NOT copy generic boilerplate disclaimers ("no claims and no
  returns policy", "all sales final", etc.) into notes — those are
  footer noise, not commercial terms.
- Header fields (supplierName, incoterm, loadingLocation, ports,
  paymentTerms, currency, validUntil) apply to every offer in the
  document — extract them once at the top level.
- \`offers\` must be a non-empty array, even for single-offer documents.
- Only these incoterms are valid: EXW, FAS, FOB, CFR, CIF, DDP. Map
  variants (FOBS, FCA, CIP, …) to the closest one or leave null.

{
  "supplierName":    string | null,
  "quoteNumber":     string | null,
  "validUntil":      string | null,   // YYYY-MM-DD
  "paymentTerms":    string | null,
  "currency":        string | null,   // ISO 4217
  "incoterm":        "EXW"|"FAS"|"FOB"|"CFR"|"CIF"|"DDP" | null,
  "loadingLocation": string | null,
  "originPort":      string | null,
  "destinationPort": string | null,
  "notes":           string | null,
  "offers": [
    {
      "offerNumber": string | null,     // per-offer ref e.g. "Offer #1" or "PI041326-1"
      "notes":       string | null,     // per-offer freight / discount / deposit
      "items": [
        { "productName": string, "quantity": number|null, "unitPrice": number|null }
      ]
    }
  ]
}

Return ONLY valid JSON — no markdown fences, no commentary.`;

function normalizeOfferJson(parsed: Record<string, unknown>): OfferPackDraft {
  const str = (k: string): string => {
    const v = parsed[k];
    return typeof v === 'string' ? v.trim() : '';
  };
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v.replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) && v.trim() !== '' ? n : null;
    }
    return null;
  };
  const parseItems = (rawItems: unknown): OfferSubDraft['items'] =>
    (Array.isArray(rawItems) ? rawItems : [])
      .map((it: any) => ({
        productName: typeof it?.productName === 'string' ? it.productName : '',
        quantity:    num(it?.quantity),
        unitPrice:   num(it?.unitPrice),
      }))
      .filter(it => it.productName);

  const rawOffers = Array.isArray((parsed as any).offers) ? (parsed as any).offers : [];
  let offers: OfferSubDraft[] = rawOffers.map((o: any, idx: number) => ({
    offerNumber: typeof o?.offerNumber === 'string' ? o.offerNumber.trim() : `Offer #${idx + 1}`,
    notes:       typeof o?.notes       === 'string' ? o.notes.trim()       : '',
    items:       parseItems(o?.items),
  }));

  // Legacy fallback — some responses may return flat `items` instead
  // of the new `offers` array. Wrap them into a single sub-offer.
  if (offers.length === 0 && Array.isArray((parsed as any).items)) {
    offers = [{
      offerNumber: typeof (parsed as any).offerNumber === 'string' ? (parsed as any).offerNumber.trim() : '',
      notes: '',
      items: parseItems((parsed as any).items),
    }];
  }

  // Guarantee at least one slot so the review UI renders something.
  if (offers.length === 0) {
    offers = [{ offerNumber: '', notes: '', items: [] }];
  }

  return {
    supplierName:    str('supplierName'),
    quoteNumber:     str('quoteNumber'),
    validUntil:      str('validUntil'),
    paymentTerms:    str('paymentTerms'),
    currency:        str('currency').toUpperCase() || 'USD',
    incoterm:        str('incoterm').toUpperCase(),
    loadingLocation: str('loadingLocation'),
    originPort:      str('originPort'),
    destinationPort: str('destinationPort'),
    notes:           str('notes'),
    offers,
  };
}

const offerInputCls = 'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200';
const OfferFieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Label className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">
    {children}
  </Label>
);

const SupplierOfferAiUpload: React.FC<{
  open: boolean;
  onOpenChange: (o: boolean) => void;
}> = ({ open, onOpenChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const qc = useQueryClient();
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'supplier_offers',
    listQueryKeys: ['supplierOffers'],
    idPrefix: 'OFFER',
    withCreatedAt: false,
  });
  if (!open) return null;
  return (
    <AiUploadModal<OfferPackDraft>
      open={open}
      onOpenChange={onOpenChange}
      config={{
        title: 'AI upload — supplier proposal',
        description: 'Drop a supplier proposal PDF, pick a file, or paste email text / a screenshot. Multi-offer docs (Offer #1, Offer #2…) land as separate rows.',
        emptyDraft: emptyOfferDraft,
        fromExtracted: (d) => d,
        extractSpec: { prompt: OFFER_PROMPT, normalize: normalizeOfferJson },
        extractSummary: (d) => {
          const total = d.offers.reduce((s, o) => s + o.items.length, 0);
          return [
            d.supplierName,
            `${d.offers.length} offer${d.offers.length === 1 ? '' : 's'}`,
            `${total} line${total === 1 ? '' : 's'}`,
          ].filter(Boolean).join(' · ');
        },
        validate: (d) => d.supplierName.trim() === '' ? 'Supplier is required.' : null,
        renderReview: (d, setD) => {
          const patchOffer = (i: number, patch: Partial<OfferSubDraft>) => {
            const next = d.offers.map((o, j) => j === i ? { ...o, ...patch } : o);
            setD({ ...d, offers: next });
          };
          return (
            <div className="grid grid-cols-2 gap-3">
              <FormField className="col-span-2">
                <OfferFieldLabel>Supplier *</OfferFieldLabel>
                <SupabaseSelectField
                  source={{ table: 'suppliers', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'country', scopeByCompany: true }}
                  value={d.supplierName}
                  onPick={v => setD({ ...d, supplierName: v })} />
              </FormField>
              <FormField>
                <OfferFieldLabel>Quote ref</OfferFieldLabel>
                <Input value={d.quoteNumber} onChange={e => setD({ ...d, quoteNumber: e.target.value })}
                  className={offerInputCls + ' font-mono'} />
              </FormField>
              <FormField>
                <OfferFieldLabel>Valid until</OfferFieldLabel>
                <Input type="date" value={d.validUntil?.slice(0, 10) ?? ''}
                  onChange={e => setD({ ...d, validUntil: e.target.value })}
                  className={offerInputCls} />
              </FormField>
              <FormField>
                <OfferFieldLabel>Currency</OfferFieldLabel>
                <Input value={d.currency} onChange={e => setD({ ...d, currency: e.target.value.toUpperCase() })}
                  className={offerInputCls + ' font-mono'} />
              </FormField>
              <FormField>
                <OfferFieldLabel>Incoterm</OfferFieldLabel>
                <Input value={d.incoterm} onChange={e => setD({ ...d, incoterm: e.target.value.toUpperCase() })}
                  className={offerInputCls + ' font-mono'} />
              </FormField>
              <FormField>
                <OfferFieldLabel>Payment terms</OfferFieldLabel>
                <Input value={d.paymentTerms} onChange={e => setD({ ...d, paymentTerms: e.target.value })}
                  className={offerInputCls} />
              </FormField>
              <FormField>
                <OfferFieldLabel>Pickup location</OfferFieldLabel>
                <Input value={d.loadingLocation} onChange={e => setD({ ...d, loadingLocation: e.target.value })}
                  className={offerInputCls} />
              </FormField>
              <FormField>
                <OfferFieldLabel>Origin port</OfferFieldLabel>
                <Input value={d.originPort} onChange={e => setD({ ...d, originPort: e.target.value })}
                  className={offerInputCls} />
              </FormField>
              <FormField>
                <OfferFieldLabel>Destination port</OfferFieldLabel>
                <Input value={d.destinationPort} onChange={e => setD({ ...d, destinationPort: e.target.value })}
                  className={offerInputCls} />
              </FormField>
              <FormField className="col-span-2">
                <OfferFieldLabel>Notes (applies to all offers)</OfferFieldLabel>
                <textarea value={d.notes} onChange={e => setD({ ...d, notes: e.target.value })} rows={2}
                  placeholder="Freight surcharges, credits, deposits, shared conditions…"
                  className="w-full bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 resize-y" />
              </FormField>

              <div className="col-span-2 space-y-2">
                <OfferFieldLabel>
                  {d.offers.length} offer{d.offers.length === 1 ? '' : 's'} detected
                </OfferFieldLabel>
                {d.offers.map((o, i) => (
                  <div key={i} className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500 uppercase tracking-wider w-10 shrink-0">#{i + 1}</span>
                      <Input
                        value={o.offerNumber}
                        onChange={e => patchOffer(i, { offerNumber: e.target.value })}
                        placeholder={`Offer #${i + 1} reference`}
                        className={offerInputCls + ' flex-1 font-mono'}
                      />
                    </div>
                    {o.items.length > 0 ? (
                      <div className="rounded-md border border-[#1f1f1f] bg-[#111111] divide-y divide-[#1f1f1f]">
                        {o.items.map((it, j) => (
                          <div key={j} className="grid grid-cols-[1fr_100px_120px] gap-2 px-2 py-1.5 text-[11.5px]">
                            <div className="text-slate-200 truncate">{it.productName}</div>
                            <div className="text-slate-400 font-mono tabular-nums text-right">
                              {it.quantity != null ? it.quantity.toLocaleString('en-US') : '—'}
                            </div>
                            <div className="text-slate-400 font-mono tabular-nums text-right">
                              {it.unitPrice != null ? it.unitPrice.toLocaleString('en-US', { style: 'currency', currency: d.currency, minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10.5px] text-slate-500 italic">No line items detected for this offer.</div>
                    )}
                    <textarea
                      value={o.notes}
                      onChange={e => patchOffer(i, { notes: e.target.value })}
                      placeholder="Per-offer notes (freight surcharge, deposit, discount)…"
                      rows={1}
                      className="w-full bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1 text-[11.5px] text-slate-200 resize-y placeholder:text-slate-600"
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        },
        save: async (d) => {
          const scopedCompany =
            currentCompanyId && currentCompanyId !== 'ALL' ? currentCompanyId : null;

          // De-dup products across every sub-offer before insert.
          const allItems = d.offers.flatMap(o =>
            o.items.map(it => ({
              productName: it.productName,
              unitPrice: it.unitPrice ?? 0,
              productId: undefined as string | undefined,
            }))
          );
          const ensured = await ensureProducts(
            allItems,
            { companyId: scopedCompany, supplierName: d.supplierName.trim() },
          );
          void qc.invalidateQueries({ queryKey: ['products'] });

          // Build a name→productId map from the ensureProducts result so
          // every sub-offer row can look up its FK by product name.
          const productIdByName = new Map<string, string>();
          for (const e of ensured) {
            const key = (e.productName ?? '').trim().toLowerCase();
            if (key && e.productId) productIdByName.set(key, e.productId);
          }

          for (let i = 0; i < d.offers.length; i++) {
            const o = d.offers[i];
            const subtotal = o.items.reduce((s, it) =>
              s + (it.quantity ?? 0) * (it.unitPrice ?? 0), 0);
            const combinedNotes = [d.notes, o.notes].filter(n => n && n.trim()).join('\n\n');
            const payload: Record<string, unknown> = {
              offerNumber:      o.offerNumber || null,
              quoteNumber:      d.quoteNumber || null,
              supplierName:     d.supplierName.trim(),
              validUntil:       d.validUntil || null,
              paymentTerms:     d.paymentTerms || null,
              currency:         d.currency || 'USD',
              incoterm:         d.incoterm || null,
              loadingLocation:  d.loadingLocation || null,
              originPort:       d.originPort || null,
              destinationPort:  d.destinationPort || null,
              notes:            combinedNotes || null,
              status:           'RECEIVED',
              items: o.items.map(it => ({
                productId:   productIdByName.get(it.productName.trim().toLowerCase()) ?? null,
                productName: it.productName,
                quantity:    it.quantity ?? 0,
                unitPrice:   it.unitPrice ?? 0,
                total:       (it.quantity ?? 0) * (it.unitPrice ?? 0),
              })),
              totalAmount: subtotal,
            };
            if (scopedCompany) payload.companyId = scopedCompany;
            await insert.mutateAsync(payload);
          }

          toast.push({
            kind: 'success',
            title: d.offers.length === 1 ? 'Offer created' : `${d.offers.length} offers created`,
            description: d.supplierName,
          });
        },
      }}
    />
  );
};

export default PurchaseCostWizardV2;
