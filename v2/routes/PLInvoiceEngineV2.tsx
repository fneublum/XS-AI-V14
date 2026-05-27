// Phase 3B — PL Invoice Engine (first iteration rebuild).
//
// Replaces the Phase 3B placeholder with a working PL → Invoice
// generator. Not full parity with v1's 5,943-LOC 3-step wizard —
// first iteration focuses on the core loop: pick an existing
// packing list, review the derived invoice, save it to the
// `invoices` table.

import React, { useEffect, useState } from 'react';
import { Sparkles, Download } from 'lucide-react';
import {
  Card, CardHeader, CardTitle, CardBody, Badge, Button, Skeleton,
  Input, FormField, Label, EmptyState,
} from '../primitives';
import { usePackingLists, PackingList } from '../queries/usePackingLists';
import { useEntityInsert, useEntityDelete, useEntityUpdate } from '../queries/useEntityMutations';
import { useEditor } from '../providers/EditorProvider';
import { useCompanies } from '../queries/useCompanies';
import { useProducts } from '../queries/useProducts';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { cn } from '../primitives/utils';
import { QuickCreateDrawer } from '../components/QuickCreateDrawer';
import { AiUploadModal } from '../components/AiUploadModal';
import { PackingListBatchUploadModal } from '../components/PackingListBatchUploadModal';
import { RowActions } from '../components/RowActions';
import { getSupabaseClient } from '../../services/supabase';
import {
  PLDraft, emptyPLDraft, PLReviewForm, packingListFields, plRowToDraft,
  packingListPayload, savePackingListPayload,
  buildPackingListAiUploadConfig,
} from './packingListShared';
import { generatePLPerProductPdf, generatePLPerContainerPdf } from '../services/pdf/plResumePdf';

// Per-company INV-#### generator lives in v2/services/invoiceNumbering
// so both this PL → Invoice flow and the "+ New invoice" button in
// InvoicesV2 share one sequence-per-company implementation.
import { generateNextInvoiceNumber } from '../services/invoiceNumbering';

const fmt = (n: number, c: string = 'USD') => {
  try {
    return n.toLocaleString('en-US', {
      style: 'currency', currency: c,
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  } catch { return `${c} ${n.toLocaleString('en-US')}`; }
};

const PLInvoiceEngineV2: React.FC = () => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PackingList | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSeed, setCreateSeed] = useState<Record<string, string> | undefined>(undefined);
  const [aiUploadOpen, setAiUploadOpen] = useState(false);
  const [batchUploadOpen, setBatchUploadOpen] = useState(false);
  const pls = usePackingLists(search);

  // Pick up the seed left by Sales Orders → Fill. The Fill action's
  // primary path is OCR'ing a real PL document, so we open the AI
  // Upload modal pre-seeded with SO context — the modal lets the user
  // drop the PDF for OCR and also exposes the full review form for
  // manual fields. Cleared after read so a refresh doesn't reopen it.
  useEffect(() => {
    const raw = (() => { try { return sessionStorage.getItem('xs_v2_pl_seed_from_so'); } catch { return null; } })();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { seed?: Record<string, string>; stampedAt?: number };
      if (!parsed?.seed || (parsed.stampedAt && Date.now() - parsed.stampedAt > 60_000)) {
        sessionStorage.removeItem('xs_v2_pl_seed_from_so');
        return;
      }
      setCreateSeed(parsed.seed);
      setAiUploadOpen(true);
      sessionStorage.removeItem('xs_v2_pl_seed_from_so');
    } catch {
      try { sessionStorage.removeItem('xs_v2_pl_seed_from_so'); } catch { /* noop */ }
    }
  }, []);

  const plInsert = useEntityInsert<Record<string, unknown>>({
    table: 'packing_lists',
    listQueryKeys: ['packingLists', 'logisticsDocs'],
    idPrefix: 'PL',
  });

  const plDelete = useEntityDelete({
    table: 'packing_lists',
    listQueryKeys: ['packingLists', 'logisticsDocs'],
  });
  const [deleteTarget, setDeleteTarget] = useState<PackingList | null>(null);

  const rowActions = (row: PackingList) => (
    <RowActions onDelete={() => setDeleteTarget(row)} />
  );

  return (
    <div className="bento-scope p-4" style={{ maxWidth: '1440px' }}>
      <div className="mb-6 flex items-end gap-4 flex-wrap pb-2">
        <div className="min-w-0 flex items-center gap-3">
          <span className="block w-1 h-9 rounded-full" style={{ background: 'var(--b-teal-2)' }} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="b-display font-semibold leading-none"
                  style={{ color: 'var(--b-text)', fontSize: '32px', fontVariationSettings: "'opsz' 64, 'wght' 600", letterSpacing: '-0.02em' }}>
                P&amp;L Invoice Engine
              </h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium b-mono"
                    style={{ background: 'var(--b-teal-soft)', color: 'var(--b-teal-2)' }}>
                v2 preview
              </span>
            </div>
            <p className="text-[13px] mt-1.5" style={{ color: 'var(--b-text-mute)' }}>
              Pick a packing list → preview the derived customer invoice → save.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setCreateOpen(true)}
            className="bg-indigo-600 text-white hover:bg-indigo-500 h-7 px-2.5 text-[12px] font-medium rounded-md">
            + New packing list
          </Button>
          <Button size="sm" onClick={() => setAiUploadOpen(true)}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-500 hover:to-purple-500 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
            <Sparkles size={12} />
            AI Upload
          </Button>
          <Button size="sm" onClick={() => setBatchUploadOpen(true)}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-500 hover:to-purple-500 h-7 px-2.5 text-[12px] font-medium rounded-md inline-flex items-center gap-1.5">
            <Sparkles size={12} />
            Batch upload
          </Button>
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
                  <li
                    key={pl.id}
                    className={cn(
                      'group flex items-start gap-2 px-3 py-2 border-t border-[#1f1f1f] hover:bg-[#141414]',
                      active && 'bg-[#161616]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(pl)}
                      className="flex-1 min-w-0 text-left"
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
                    <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      {rowActions(pl)}
                    </div>
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

      <QuickCreateDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New packing list"
        description="Create a packing list for an outgoing shipment."
        table="packing_lists"
        idPrefix="PL"
        listQueryKeys={['packingLists', 'logisticsDocs']}
        scopeByCompany
        fields={packingListFields}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.plNumber ?? 'packing list'}?`}
        description="This removes the record permanently. Linked invoices that reference it may break until fixed."
        confirmLabel="Delete"
        loading={plDelete.isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          const target = deleteTarget;
          plDelete.mutate(target.id, {
            onSuccess: () => {
              toast.push({ kind: 'success', title: 'Deleted', description: target.plNumber });
              if (selected?.id === target.id) setSelected(null);
              setDeleteTarget(null);
            },
            onError: (err) => {
              toast.push({
                kind: 'error',
                title: 'Delete failed',
                description: err instanceof Error ? err.message : String(err),
              });
              setDeleteTarget(null);
            },
          });
        }}
      />
      {aiUploadOpen && (
        <AiUploadModal<PLDraft>
          open={aiUploadOpen}
          onOpenChange={(o) => { setAiUploadOpen(o); if (!o) setCreateSeed(undefined); }}
          config={buildPackingListAiUploadConfig({
            insert: plInsert, toast, currentCompanyId,
            seed: createSeed as Partial<PLDraft> | undefined,
          })}
        />
      )}
      <PackingListBatchUploadModal
        open={batchUploadOpen}
        onOpenChange={setBatchUploadOpen}
        insert={plInsert}
        currentCompanyId={currentCompanyId}
      />
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
  const { openInvoiceCreate } = useEditor();
  const companies = useCompanies();
  const products = useProducts();
  const insert = useEntityInsert<{
    companyId: string; invoiceNumber: string; soldTo: string | null;
    billToName: string | null; invoiceDate: string;
    paymentTerms: string | null; incoterm: string | null;
    totalAmount: number; currency: string;
    soNumber: string | null; plNumber: string | null;
    bookingNumber: string | null;
  }>({ table: 'invoices', listQueryKeys: ['invoices', 'pl'], idPrefix: 'INV' });

  const plUpdate = useEntityUpdate<Record<string, unknown>>({
    table: 'packing_lists',
    listQueryKeys: ['packingLists', 'logisticsDocs'],
  });
  const [plSaving, setPlSaving] = useState(false);

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

  // Fetch the full packing_lists row so the right-pane preview uses
  // the same field set + layout as the AI upload / inspect drawer.
  const [plDraft, setPlDraft] = useState<PLDraft>(emptyPLDraft);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await getSupabaseClient()
        .from('packing_lists')
        .select('*')
        .eq('id', pl.id)
        .single();
      if (cancelled || error || !data) return;
      setPlDraft(plRowToDraft(data as Record<string, unknown>));
    })();
    return () => { cancelled = true; };
  }, [pl.id]);

  // Look up an existing invoice linked to this PL (if any). When found
  // we show the linked invoice summary instead of a blank "derived
  // invoice" draft — it would be misleading to pretend a new invoice
  // is being drafted when one already exists.
  interface LinkedInvoice {
    id: string;
    invoiceNumber: string | null;
    invoiceDate: string | null;
    totalAmount: number | null;
    currency: string | null;
    soldTo: string | null;
    billToName: string | null;
  }
  const [linkedInvoice, setLinkedInvoice] = useState<LinkedInvoice | null>(null);
  const [linkedChecked, setLinkedChecked] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  useEffect(() => {
    setLinkedInvoice(null);
    setLinkedChecked(false);
    setShowCreate(false);
    if (!pl.plNumber) { setLinkedChecked(true); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await getSupabaseClient()
        .from('invoices')
        .select('id, invoiceNumber, invoiceDate, totalAmount, currency, soldTo, billToName')
        .eq('plNumber', pl.plNumber)
        .order('invoiceDate', { ascending: false, nullsFirst: false })
        .limit(1);
      if (cancelled) return;
      if (!error && data && data.length > 0) {
        setLinkedInvoice(data[0] as LinkedInvoice);
      }
      setLinkedChecked(true);
    })();
    return () => { cancelled = true; };
  }, [pl.id, pl.plNumber]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Packing list</CardTitle>
          <div className="flex items-center gap-2 ml-auto">
            <Badge variant={pl.status.toUpperCase() === 'INVOICED' ? 'success' : 'neutral'} dot>
              {pl.status}
            </Badge>
            <Button
              size="sm"
              onClick={() => {
                if ((plDraft.containers ?? []).length === 0) {
                  toast.push({ kind: 'warning', title: 'No containers on this PL' });
                  return;
                }
                const { doc, fileName } = generatePLPerProductPdf(plDraft);
                doc.save(fileName);
              }}
              title="Download Resume per Product"
              className="bg-transparent border border-[#1f1f1f] text-slate-200 hover:bg-[#161616] h-7 px-2.5 text-[11.5px] gap-1.5"
            >
              <Download size={11} /> PL per Product
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if ((plDraft.containers ?? []).length === 0) {
                  toast.push({ kind: 'warning', title: 'No containers on this PL' });
                  return;
                }
                const { doc, fileName } = generatePLPerContainerPdf(plDraft);
                doc.save(fileName);
              }}
              title="Download Resume per Container"
              className="bg-transparent border border-[#1f1f1f] text-slate-200 hover:bg-[#161616] h-7 px-2.5 text-[11.5px] gap-1.5"
            >
              <Download size={11} /> PL per Container
            </Button>
            <Button
              size="sm"
              disabled={plSaving}
              loading={plSaving}
              onClick={async () => {
                if (plDraft.plNumber.trim() === '') {
                  toast.push({ kind: 'warning', title: 'PL # is required' });
                  return;
                }
                setPlSaving(true);
                try {
                  const payload = packingListPayload(plDraft, currentCompanyId);
                  await savePackingListPayload(
                    { mutateAsync: (p) => plUpdate.mutateAsync({ id: pl.id, ...p }) },
                    payload,
                  );
                  toast.push({ kind: 'success', title: 'Packing list saved', description: plDraft.plNumber });
                } catch (err) {
                  toast.push({
                    kind: 'error',
                    title: 'Save failed',
                    description: err instanceof Error ? err.message : String(err),
                  });
                } finally {
                  setPlSaving(false);
                }
              }}
              className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40 h-7 px-3 text-[12px]"
            >
              {plSaving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          <PLReviewForm draft={plDraft} setDraft={setPlDraft} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice</CardTitle>
          <span className="text-[11px] text-slate-500">
            {linkedInvoice ? 'Linked to this PL' : (linkedChecked ? 'Not yet created' : 'Checking…')}
          </span>
        </CardHeader>
        <CardBody>
          {!linkedChecked ? (
            <div className="text-[12.5px] text-slate-500 py-4 text-center">Checking for linked invoices…</div>
          ) : linkedInvoice ? (
            <div className="space-y-2 text-[12.5px]">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                <Row label="Invoice #" value={<span className="font-mono tabular-nums text-slate-100">{linkedInvoice.invoiceNumber ?? '—'}</span>} />
                <Row label="Date" value={<span className="font-mono tabular-nums">{linkedInvoice.invoiceDate?.slice(0, 10) ?? '—'}</span>} />
                <Row label="Bill to" value={linkedInvoice.billToName ?? linkedInvoice.soldTo ?? '—'} />
                <Row label="Total" value={<span className="font-mono tabular-nums">{linkedInvoice.totalAmount != null ? fmt(linkedInvoice.totalAmount, linkedInvoice.currency ?? 'USD') : '—'}</span>} />
              </div>
              <div className="pt-2 text-[11.5px] text-slate-500">
                This packing list is already invoiced. Edit the invoice from the Invoice & docs page.
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="text-[12.5px] text-slate-400 text-center">
                No invoice has been created for this PL yet.
              </div>
              <Button
                size="sm"
                onClick={async () => {
                  // Fetch prior invoices for the same customer so we can
                  // suggest the same unit price the customer paid last
                  // time for each product. The lookup is best-effort —
                  // failure just leaves the PL's OCR-extracted price.
                  const priorBySoldTo = plDraft.consignee;
                  // Index prior-paid unit prices by every name we can
                  // derive from the line item: productId, productName,
                  // customerDescription, plus their trim/lower forms.
                  // The most-recent invoice wins since we iterate in
                  // invoiceDate-desc order and only set if not already
                  // mapped.
                  const priorPriceByKey = new Map<string, number>();
                  try {
                    if (priorBySoldTo) {
                      // Use ilike + substring wildcards so trailing
                      // whitespace / casing differences between the PL's
                      // consignee and the invoices' soldTo / billToName
                      // / consignee still match.
                      const needle = priorBySoldTo.trim();
                      const { data } = await getSupabaseClient()
                        .from('invoices')
                        .select('items, invoiceDate, billToName, consignee')
                        .or(`soldTo.ilike.*${needle}*,billToName.ilike.*${needle}*,consignee.ilike.*${needle}*`)
                        .order('invoiceDate', { ascending: false, nullsFirst: false })
                        .limit(100);
                      const rows = (data as Array<{ items: unknown }> | null) ?? [];
                      for (const row of rows) {
                        let parsed: unknown = row.items;
                        if (typeof parsed === 'string') {
                          try { parsed = JSON.parse(parsed); } catch { continue; }
                        }
                        if (!Array.isArray(parsed)) continue;
                        for (const it of parsed as Array<Record<string, unknown>>) {
                          const price = typeof it.unitPrice === 'number' ? it.unitPrice : Number(it.unitPrice);
                          if (!Number.isFinite(price) || price <= 0) continue;
                          const pid = typeof it.productId === 'string' ? it.productId : '';
                          const pname = typeof it.productName === 'string' ? it.productName : '';
                          const cdesc = typeof it.customerDescription === 'string' ? it.customerDescription : '';
                          const put = (k: string) => { if (k && !priorPriceByKey.has(k)) priorPriceByKey.set(k, price); };
                          if (pid) put(`id:${pid}`);
                          if (pname) put(`nm:${pname.trim().toLowerCase()}`);
                          if (cdesc) put(`nm:${cdesc.trim().toLowerCase()}`);
                        }
                      }
                    }
                  } catch { /* best-effort; ignore */ }

                  // Map PL containers to invoice line items so the user
                  // lands in the Invoice drawer with products + weights
                  // already populated. When the PL picked a system
                  // product, resolve it against the products catalog
                  // so the invoice carries the product's id + hsCode.
                  const productList = products.data ?? [];
                  // Resolve the catalog product using a priority chain:
                  //   1. PL's explicitly-picked systemProduct
                  //   2. exact match on the free-text description
                  //   3. fuzzy "contains" match against description /
                  //      supplier (case-insensitive)
                  const lc = (s: string) => s.trim().toLowerCase();
                  const items = plDraft.containers.map((c) => {
                    const sysKey = lc(c.systemProduct);
                    const descKey = lc(c.description);
                    const suppKey = lc(c.supplier);
                    const linked =
                      (sysKey && productList.find(p => lc(p.name) === sysKey))
                      ?? (descKey && productList.find(p => lc(p.name) === descKey))
                      ?? (descKey && productList.find(p => lc(p.name).includes(descKey) || descKey.includes(lc(p.name))))
                      ?? (suppKey && productList.find(p => lc(p.name).includes(suppKey)))
                      ?? undefined;
                    // Pick the best price: last-paid price for this
                    // customer+product wins; otherwise fall back to the
                    // price the OCR found on the PL. Try the linked
                    // product id first, then every name variant we
                    // have — prior invoices often stored the raw OCR
                    // description instead of the catalog product name,
                    // so checking all of them catches more matches.
                    const nameKeys = [
                      linked?.name,
                      c.description,
                      c.supplier,
                      c.systemProduct,
                    ]
                      .map(s => (s ?? '').trim().toLowerCase())
                      .filter(Boolean);
                    let priorPrice: number | undefined;
                    if (linked?.id) priorPrice = priorPriceByKey.get(`id:${linked.id}`);
                    if (priorPrice == null) {
                      for (const key of nameKeys) {
                        const hit = priorPriceByKey.get(`nm:${key}`);
                        if (hit != null) { priorPrice = hit; break; }
                      }
                    }
                    // Last resort: fuzzy substring match across all
                    // name-keyed prior prices.
                    if (priorPrice == null && nameKeys.length > 0) {
                      for (const [k, v] of priorPriceByKey.entries()) {
                        if (!k.startsWith('nm:')) continue;
                        const kName = k.slice(3);
                        const hit = nameKeys.some(n => n.includes(kName) || kName.includes(n));
                        if (hit) { priorPrice = v; break; }
                      }
                    }
                    const suggestedPrice = priorPrice ?? c.unitPrice ?? 0;
                    const qty = c.netLbs ?? 0;
                    const total = priorPrice != null && qty > 0
                      ? Math.round(priorPrice * qty * 100) / 100
                      : (c.totalValue ?? 0);
                    return {
                      productId: linked?.id,
                      productName: c.description || c.supplier || '',
                      customerDescription: c.description || '',
                      quantity: qty,
                      unitPrice: suggestedPrice,
                      total,
                      hsCode: linked?.hsCode ?? '',
                      grade: linked?.grade ?? '',
                      netLbs: c.netLbs ?? undefined,
                      netKg: c.netKg ?? undefined,
                      grossLbs: c.grossLbs ?? undefined,
                      grossKg: c.grossKg ?? undefined,
                      volumes: c.volumes ?? undefined,
                      containerNo: c.containerNo || undefined,
                      sealNo: c.sealNo || undefined,
                      supplier: c.supplier || undefined,
                    };
                  });
                  const incotermCode = (plDraft.freightTerms || '').split(' ')[0] || 'FOB';
                  // Company defaults to the PL's shipper (which is one
                  // of the user's own companies). Fall back to the
                  // current scoped company if the shipper name doesn't
                  // match a company row. Must be resolved BEFORE the
                  // invoice-number generator runs so each company keeps
                  // its own INV sequence (GENRYO must NOT pull from
                  // EC4's pool — see commit fixing the cross-company
                  // numbering leak).
                  const companyByShipper = (companies.data ?? []).find(
                    c => c.name.trim().toLowerCase() === (plDraft.shipper || '').trim().toLowerCase(),
                  );
                  const seedCompanyId = companyByShipper?.id
                    ?? (currentCompanyId && currentCompanyId !== 'ALL' ? currentCompanyId : null);
                  // Auto-generate INV-#### scoped to the resolved
                  // company so each tenant has an independent sequence
                  // starting at INV-0001.
                  const nextInvoiceNumber = await generateNextInvoiceNumber(seedCompanyId);
                  openInvoiceCreate({
                    companyId: seedCompanyId,
                    invoiceNumber: nextInvoiceNumber,
                    invoiceDate: new Date().toISOString().slice(0, 10),
                    soldTo: plDraft.consignee || pl.consignee || null,
                    billToName: plDraft.consignee || pl.consignee || null,
                    consignee: plDraft.consignee || pl.consignee || null,
                    shipperName: plDraft.shipper || null,
                    soNumber: plDraft.soNumber || pl.soNumber || null,
                    plNumber: plDraft.plNumber || pl.plNumber,
                    bookingNumber: plDraft.bookingNumber || null,
                    customerPo: plDraft.poNumber || null,
                    incoterm: incotermCode,
                    incoterms: plDraft.freightTerms || null,
                    // Leave freightTerms (Collect / Prepaid) unset so
                    // the Invoice drawer derives it from the Incoterm
                    // (EXW/FAS/FOB → Collect, others → Prepaid).
                    freightTerms: null,
                    currency: plDraft.currency || 'USD',
                    grossWeight: plDraft.grossWeight || null,
                    netWeight: plDraft.netWeight || null,
                    items: items as any,
                  });
                }}
                className="bg-indigo-600 text-white hover:bg-indigo-500"
              >
                Create invoice from this PL
              </Button>
            </div>
          )}
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
