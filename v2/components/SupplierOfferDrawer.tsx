// Phase 3C — Supplier offer editor drawer.
//
// Header + commercial + lane + items, mirroring the PO drawer pattern
// but against the `supplier_offers` table. Launched from the Purchase &
// cost wizard, step 1 (Source).

import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Drawer, Input, FormField, Label, Button, Badge, ConfirmDialog,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { SupplierOffer } from '../queries/useSupplierOffers';
import { useEntityUpdate, useEntityInsert, useEntityDelete } from '../queries/useEntityMutations';
import { LineItemsEditor, LineItem, computeSubtotal, sanitizeItems } from './LineItemsEditor';
import { SupabaseSelectField } from './SupabaseSelectField';
import { ensureProducts } from '../lib/ensureProducts';
import { INCOTERMS, INCOTERM_LABELS } from '../lib/incoterms';

type DrawerMode = 'view' | 'edit' | 'create';

const STATUS_OPTIONS = ['RECEIVED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'EXPIRED'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'BRL', 'MXN', 'CNY', 'INR'];

const inputClass =
  'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 rounded-md px-2 ' +
  'placeholder:text-slate-600 focus:ring-1 focus:ring-indigo-500 outline-none';
const labelClass = 'text-[11px] text-slate-500 uppercase tracking-wider font-medium';
const sectionClass = 'p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] space-y-3';

const fmtMoney = (n: number, currency: string) => {
  try {
    return n.toLocaleString('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  } catch { return `${currency} ${n.toFixed(2)}`; }
};

const offerToItems = (o: SupplierOffer): LineItem[] =>
  o.items.map((it) => ({
    productId: it.productId ?? undefined,
    productName: it.productName,
    customerDescription: '',
    hsCode: it.hsCode ?? '',
    grade: it.grade ?? '',
    quantity: Number(it.quantity) || 0,
    unitPrice: Number(it.unitPrice) || 0,
    total: Number(it.total) || (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
  }));

export const EMPTY_SUPPLIER_OFFER: SupplierOffer = {
  id: '',
  offerNumber: '',
  companyId: null,
  supplierId: null,
  supplierName: '',
  items: [],
  totalAmount: 0,
  currency: 'USD',
  incoterm: null,
  loadingLocation: null,
  originPort: null,
  destinationPort: null,
  validUntil: null,
  paymentTerms: null,
  status: 'RECEIVED',
  notes: null,
  quoteNumber: null,
  freightType: null,
};

const FREIGHT_TYPES = [
  { value: 'PORT_TO_PORT', label: 'Port to port' },
  { value: 'DOOR_TO_PORT', label: 'Door to port' },
  { value: 'PORT_TO_DOOR', label: 'Port to door' },
  { value: 'DOOR_TO_DOOR', label: 'Door to door' },
] as const;

interface Props {
  offer: SupplierOffer | null;
  mode: DrawerMode;
  onOpenChange: (open: boolean) => void;
  onModeChange?: (m: DrawerMode) => void;
}

export const SupplierOfferDrawer: React.FC<Props> = ({ offer, mode, onOpenChange, onModeChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();

  const readOnly = mode === 'view';

  const [companyId, setCompanyId]     = useState<string>(currentCompanyId !== 'ALL' ? currentCompanyId : '');
  const [offerNumber, setOfferNumber] = useState('');
  const [supplierId, setSupplierId]   = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [status, setStatus]           = useState('RECEIVED');
  const [validUntil, setValidUntil]   = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [currency, setCurrency]       = useState('USD');
  const [incoterm, setIncoterm]       = useState('');
  const [loadingLocation, setLoadingLoc] = useState('');
  const [originPort, setOriginPort]   = useState('');
  const [destPort, setDestPort]       = useState('');
  const [quoteNumber, setQuoteNumber] = useState('');
  const [freightType, setFreightType] = useState('PORT_TO_PORT');
  const [items, setItems]             = useState<LineItem[]>([]);
  const [notes, setNotes]             = useState('');

  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = useEntityUpdate<{ id: string } & Record<string, unknown>>({
    table: 'supplier_offers', listQueryKeys: ['supplierOffers'],
  });
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'supplier_offers', listQueryKeys: ['supplierOffers'], idPrefix: 'OFFER',
    withCreatedAt: false,
  });
  const del = useEntityDelete({
    table: 'supplier_offers', listQueryKeys: ['supplierOffers'],
  });

  useEffect(() => {
    if (!offer) return;
    setCompanyId(offer.companyId ?? (currentCompanyId !== 'ALL' ? currentCompanyId : ''));
    setOfferNumber(offer.offerNumber ?? '');
    setSupplierId(offer.supplierId ?? '');
    setSupplierName(offer.supplierName ?? '');
    setStatus(offer.status ?? 'RECEIVED');
    setValidUntil(offer.validUntil ?? '');
    setPaymentTerms(offer.paymentTerms ?? '');
    setCurrency(offer.currency ?? 'USD');
    setIncoterm(offer.incoterm ?? '');
    setLoadingLoc(offer.loadingLocation ?? '');
    setOriginPort(offer.originPort ?? '');
    setDestPort(offer.destinationPort ?? '');
    setQuoteNumber(offer.quoteNumber ?? '');
    setFreightType(offer.freightType ?? 'PORT_TO_PORT');
    setItems(offerToItems(offer));
    setNotes(offer.notes ?? '');
  }, [offer?.id, mode]);

  const subtotal = useMemo(() => computeSubtotal(items), [items]);
  const pickupRequired = !['FOB', 'FAS'].includes(incoterm.toUpperCase());
  const destPortApplies = ['CFR', 'CIF'].includes(incoterm.toUpperCase());
  const canSave =
    supplierName.trim() !== '' &&
    (incoterm ?? '').trim() !== '' &&
    (freightType ?? '').trim() !== '' &&
    (!pickupRequired || (loadingLocation ?? '').trim() !== '') &&
    (originPort ?? '').trim() !== '' &&
    (!destPortApplies || (destPort ?? '').trim() !== '');
  const pending = update.isPending || insert.isPending || del.isPending;
  const qc = useQueryClient();

  const buildPayload = (resolvedItems: LineItem[]) => ({
    companyId: companyId || currentCompanyId,
    offerNumber: offerNumber || null,
    supplierId: supplierId || null,
    supplierName: supplierName.trim(),
    items: resolvedItems.map(it => ({
      productId: it.productId ?? null,
      productName: it.productName,
      hsCode: it.hsCode ?? null,
      grade: it.grade ?? null,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      total: it.total,
    })),
    totalAmount: subtotal,
    currency,
    incoterm: incoterm || null,
    loadingLocation: loadingLocation || null,
    originPort: originPort || null,
    destinationPort: destPort || null,
    validUntil: validUntil || null,
    paymentTerms: paymentTerms || null,
    status,
    notes: notes || null,
    quoteNumber: quoteNumber || null,
    freightType,
  });

  const save = async () => {
    if (!canSave) {
      const missing: string[] = [];
      if (supplierName.trim() === '')          missing.push('Supplier');
      if ((incoterm ?? '').trim() === '')      missing.push('Incoterm');
      if ((freightType ?? '').trim() === '')   missing.push('Freight type');
      if (pickupRequired && (loadingLocation ?? '').trim() === '') missing.push('Pickup location');
      if ((originPort ?? '').trim() === '')    missing.push('Port origin');
      if (destPortApplies && (destPort ?? '').trim() === '') missing.push('Destination port');
      toast.push({
        kind: 'warning',
        title: 'Missing required fields',
        description: missing.join(', '),
      });
      return;
    }
    const scopedCompany =
      companyId || (currentCompanyId !== 'ALL' ? currentCompanyId : null);
    let resolved: LineItem[] = sanitizeItems(items);
    try {
      resolved = await ensureProducts(resolved, {
        companyId: scopedCompany,
        supplierName: supplierName.trim(),
      });
      // Propagate back into drawer state so the user sees the linked ids.
      setItems(prev => prev.map(orig => {
        const match = resolved.find(r =>
          r.productName.trim().toLowerCase() === (orig.productName ?? '').trim().toLowerCase()
        );
        return match?.productId && !orig.productId
          ? { ...orig, productId: match.productId }
          : orig;
      }));
      void qc.invalidateQueries({ queryKey: ['products'] });
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Product catalog sync failed',
        description: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const payload = buildPayload(resolved);
    if (mode === 'create') {
      insert.mutate(payload, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Offer created', description: payload.supplierName });
          onOpenChange(false);
        },
        onError: (err) => toast.push({ kind: 'error', title: 'Create failed', description: err.message }),
      });
    } else if (offer) {
      update.mutate({ id: offer.id, ...payload }, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Saved', description: payload.supplierName });
          onOpenChange(false);
        },
        onError: (err) => toast.push({ kind: 'error', title: 'Save failed', description: err.message }),
      });
    }
  };

  const doDelete = () => {
    if (!offer) return;
    del.mutate(offer.id, {
      onSuccess: () => {
        toast.push({ kind: 'success', title: 'Deleted', description: offer.supplierName });
        setConfirmDelete(false);
        onOpenChange(false);
      },
      onError: (err) => {
        toast.push({ kind: 'error', title: 'Delete failed', description: err.message });
        setConfirmDelete(false);
      },
    });
  };

  if (!offer) return null;

  const titleText =
    mode === 'create' ? 'New supplier offer'
    : mode === 'view' ? `Offer ${offer.offerNumber || offer.id.slice(0, 12)}`
    : `Edit ${offer.offerNumber || offer.id.slice(0, 12)}`;

  return (
    <>
      <Drawer
        open={!!offer}
        onOpenChange={onOpenChange}
        title={titleText}
        description={supplierName ? `${supplierName} · ${status}` : 'Supplier offer'}
        widthClass="w-[min(98vw,960px)]"
        footer={
          <>
            {mode === 'view' && onModeChange && (
              <Button
                variant="secondary" size="sm"
                onClick={() => onModeChange('edit')}
                className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
              >
                Edit
              </Button>
            )}
            {mode === 'edit' && (
              <Button
                variant="secondary" size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={pending}
                className="bg-transparent border border-red-500/30 text-red-400 hover:bg-red-500/10"
              >
                Delete
              </Button>
            )}
            <Button
              variant="secondary" size="sm"
              onClick={() => onOpenChange(false)}
              disabled={pending}
              className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
            >
              {mode === 'view' ? 'Close' : 'Cancel'}
            </Button>
            {mode !== 'view' && (
              <Button
                size="sm"
                onClick={save}
                disabled={!canSave || pending}
                loading={pending}
                className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
              >
                {pending ? 'Saving…' : mode === 'create' ? 'Create offer' : 'Save changes'}
              </Button>
            )}
          </>
        }
      >
        <fieldset disabled={readOnly} className="space-y-4">
          <div className={sectionClass}>
            <Label className={labelClass}>Header</Label>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>Offer #</Label>
                <Input value={offerNumber} onChange={e => setOfferNumber(e.target.value)}
                  placeholder="auto" className={inputClass + ' font-mono'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Quote ref</Label>
                <Input value={quoteNumber} onChange={e => setQuoteNumber(e.target.value)}
                  className={inputClass + ' font-mono'} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Status</Label>
                <select value={status} onChange={e => setStatus(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Supplier <span className="text-red-400 ml-1">*</span></Label>
                <SupabaseSelectField
                  source={{
                    table: 'suppliers', valueColumn: 'name', labelColumn: 'name',
                    secondaryColumn: 'country', scopeByCompany: true,
                    writeAlso: [
                      { sourceColumn: 'id',       targetKey: 'supplierId' },
                      { sourceColumn: 'city',     targetKey: '_supplierCity' },
                      { sourceColumn: 'country',  targetKey: '_supplierCountry' },
                      { sourceColumn: 'location', targetKey: '_supplierLocation' },
                      { sourceColumn: 'paymentTerms', targetKey: '_supplierTerms' },
                    ],
                  }}
                  value={supplierName}
                  onPick={(v, extras) => {
                    setSupplierName(v);
                    if (extras.supplierId) setSupplierId(extras.supplierId);
                    // Auto-fill pickup location from supplier's address if
                    // the field is still empty. Prefer "City, Country",
                    // fall back to the supplier's free-text `location`.
                    if (!loadingLocation.trim()) {
                      const cc = [extras._supplierCity, extras._supplierCountry]
                        .filter(Boolean).join(', ');
                      const seed = cc || extras._supplierLocation || '';
                      if (seed) setLoadingLoc(seed);
                    }
                    if (!paymentTerms.trim() && extras._supplierTerms) {
                      setPaymentTerms(extras._supplierTerms);
                    }
                  }}
                />
              </FormField>
              <FormField>
                <Label className={labelClass}>Valid until</Label>
                <Input type="date" value={validUntil ? validUntil.slice(0, 10) : ''}
                  onChange={e => setValidUntil(e.target.value)} className={inputClass} />
              </FormField>
            </div>
          </div>

          <div className={sectionClass}>
            <Label className={labelClass}>Lane &amp; Incoterm</Label>
            <div className="grid grid-cols-4 gap-2">
              <FormField>
                <Label className={labelClass}>Incoterm <span className="text-red-400 ml-1">*</span></Label>
                <select value={incoterm} onChange={e => setIncoterm(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  <option value="">—</option>
                  {INCOTERMS.map(x => <option key={x} value={x}>{INCOTERM_LABELS[x]}</option>)}
                </select>
              </FormField>
              <FormField>
                <Label className={labelClass}>Freight type <span className="text-red-400 ml-1">*</span></Label>
                <select value={freightType} onChange={e => setFreightType(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  {FREIGHT_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </FormField>
              <FormField>
                <Label className={labelClass}>
                  Pickup location
                  {pickupRequired
                    ? <span className="text-red-400 ml-1">*</span>
                    : <span className="text-slate-600 ml-1 normal-case tracking-normal">(optional · {incoterm.toUpperCase()})</span>}
                </Label>
                <Input value={loadingLocation} onChange={e => setLoadingLoc(e.target.value)}
                  placeholder={pickupRequired ? 'City, Country' : `Not required for ${incoterm.toUpperCase()}`}
                  className={inputClass} />
              </FormField>
              <FormField>
                <Label className={labelClass}>Port origin <span className="text-red-400 ml-1">*</span></Label>
                <SupabaseSelectField
                  source={{ table: 'ports', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'country' }}
                  value={originPort}
                  onPick={v => setOriginPort(v)}
                />
              </FormField>
              {destPortApplies && (
                <FormField className="col-span-4">
                  <Label className={labelClass}>
                    Destination port <span className="text-red-400 ml-1">*</span>
                  </Label>
                  <SupabaseSelectField
                    source={{ table: 'ports', valueColumn: 'name', labelColumn: 'name', secondaryColumn: 'country' }}
                    value={destPort}
                    onPick={v => setDestPort(v)}
                  />
                </FormField>
              )}
            </div>
          </div>

          <div className={sectionClass}>
            <Label className={labelClass}>Line items</Label>
            <LineItemsEditor
              items={items}
              onChange={setItems}
              currency={currency}
              showCustomerDescription={false}
            />
          </div>

          <div className={sectionClass}>
            <Label className={labelClass}>Commercial</Label>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Currency</Label>
                <select value={currency} onChange={e => setCurrency(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormField>
              <FormField>
                <Label className={labelClass}>Payment terms</Label>
                <SupabaseSelectField
                  source={{
                    table: 'payment_terms', valueColumn: 'description', labelColumn: 'description',
                    secondaryColumn: 'code', scopeByCompany: true,
                  }}
                  value={paymentTerms}
                  onPick={v => setPaymentTerms(v)}
                />
              </FormField>
            </div>
          </div>

          <div className={sectionClass}>
            <Label className={labelClass}>Notes</Label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              className="bg-[#111111] border border-[#1f1f1f] rounded-md px-2 py-1.5 text-[12.5px] text-slate-200 placeholder:text-slate-600 resize-y leading-relaxed w-full"
              placeholder="Internal notes for this offer" />
          </div>

          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
            <Badge variant="neutral">supplier_offers</Badge>
            <span className="text-slate-600">
              Subtotal <span className="font-mono tabular-nums text-slate-300">{fmtMoney(subtotal, currency)}</span>
            </span>
            <span className="ml-auto font-mono tabular-nums text-slate-600">
              {mode === 'create' ? 'new' : `#${offer.id.slice(0, 8)}`}
            </span>
          </div>
        </fieldset>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete offer ${offer?.offerNumber || offer?.id.slice(0, 12)}?`}
        description="Removes the supplier offer permanently."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={doDelete}
      />
    </>
  );
};
