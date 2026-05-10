// Phase 3B — Shared line-items editor.
//
// Sales Orders, Purchase Orders and Invoices each maintain a
// jsonb `items` array of `{ productName, quantity, unitPrice, total }`
// rows (with optional hsCode / customerDescription / grade). This
// component manages the entire array: add row, remove row, edit cells,
// live subtotal. The parent owns the value via `items` + `onChange`.

import React, { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Input } from '../primitives/Input';
import { Button } from '../primitives/Button';
import { useProducts, Product } from '../queries/useProducts';

export interface LineItem {
  productId?: string;
  productName: string;
  customerDescription?: string;
  hsCode?: string;
  grade?: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface Props {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  currency?: string;
  showHsCode?: boolean;
  showGrade?: boolean;
  showCustomerDescription?: boolean;
  /** Read-only mode (hides inputs, shows values). */
  readOnly?: boolean;
}

const cellInput =
  'h-7 text-[12px] bg-[#111111] border border-[#1f1f1f] text-slate-200 rounded-sm px-1.5 ' +
  'placeholder:text-slate-600 focus:ring-1 focus:ring-indigo-500 outline-none w-full';

const cellInputMono = cellInput + ' font-mono tabular-nums';

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

// Stored values are LBS-based. The KG inputs are derived on display
// and converted back on edit so there's only one canonical column.
const LB_TO_KG = 0.453592;
const lbsToKgs   = (lbs: number): number => Math.round(lbs * LB_TO_KG);
const kgsToLbs   = (kgs: number): number => round2(kgs / LB_TO_KG);
const pricePerLbToKg = (p: number): number => round2(p / LB_TO_KG);
const pricePerKgToLb = (p: number): number => round4(p * LB_TO_KG);

/** Format a quantity as 999,999.9 — commas + 1 decimal. */
const fmtQty = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Numeric quantity input — shows 999,999.9 format when blurred, raw
 *  digits while focused so typing stays responsive. Emits a number. */
const QtyInput: React.FC<{
  value: number;
  onChange: (next: number) => void;
  className?: string;
  title?: string;
}> = ({ value, onChange, className, title }) => {
  const [focused, setFocused] = React.useState(false);
  const display = focused
    ? (value === 0 ? '' : String(value))
    : (value === 0 ? '' : fmtQty(value));
  return (
    <Input
      type={focused ? 'number' : 'text'}
      inputMode="decimal"
      min={0}
      step={1}
      value={display}
      title={title}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={e => {
        const raw = e.target.value.replace(/,/g, '');
        onChange(Number(raw) || 0);
      }}
      className={className}
    />
  );
};

const fmtMoney = (n: number, currency = 'USD') => {
  try {
    return n.toLocaleString('en-US', {
      style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
};

export const LineItemsEditor: React.FC<Props> = ({
  items, onChange, currency = 'USD',
  showHsCode = true, showGrade = false, showCustomerDescription = true,
  readOnly = false,
}) => {
  const products = useProducts();
  const productOptions = products.data ?? [];

  const subtotal = useMemo(
    () => round2(items.reduce((s, it) => s + (Number(it.total) || 0), 0)),
    [items],
  );

  const totalQty = useMemo(
    () => round2(items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)),
    [items],
  );

  const update = (idx: number, patch: Partial<LineItem>) => {
    const next = items.map((it, i) => {
      if (i !== idx) return it;
      const merged: LineItem = { ...it, ...patch };
      const q = Number(merged.quantity) || 0;
      const p = Number(merged.unitPrice) || 0;
      merged.total = round2(q * p);
      return merged;
    });
    onChange(next);
  };

  const addRow = () => {
    onChange([
      ...items,
      { productName: '', quantity: 0, unitPrice: 0, total: 0 },
    ]);
  };

  const removeRow = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const selectProduct = (idx: number, product: Product | undefined) => {
    if (!product) {
      update(idx, { productId: undefined, productName: '', hsCode: '', grade: '' });
      return;
    }
    update(idx, {
      productId: product.id,
      productName: product.name,
      hsCode: product.hsCode ?? '',
      grade: product.grade ?? '',
      unitPrice: product.price ?? 0,
    });
  };

  return (
    <div className="space-y-2">
      <div className="border border-[#1f1f1f] rounded-md overflow-x-auto bg-[#0a0a0a]">
        <table className="w-full text-[11.5px] leading-[16px]">
          <thead>
            <tr className="border-b border-[#1f1f1f] bg-[#0f0f0f]">
              <th className="px-2 py-1 text-[10px] font-normal text-slate-500 uppercase tracking-wider text-left w-8">#</th>
              <th className="px-2 py-1 text-[10px] font-normal text-slate-500 uppercase tracking-wider text-left">Original / system product</th>
              {showCustomerDescription && (
                <th className="px-2 py-1 text-[10px] font-normal text-slate-500 uppercase tracking-wider text-left">Description</th>
              )}
              {showGrade && (
                <th className="px-2 py-1 text-[10px] font-normal text-slate-500 uppercase tracking-wider text-left w-[90px]">Grade</th>
              )}
              {showHsCode && (
                <th className="px-2 py-1 text-[10px] font-normal text-slate-500 uppercase tracking-wider text-left w-[90px]">HS code</th>
              )}
              <th className="px-2 py-1 text-[10px] font-normal text-slate-500 uppercase tracking-wider text-right w-[120px]">Qty (lbs / kgs)</th>
              <th className="px-2 py-1 text-[10px] font-normal text-slate-500 uppercase tracking-wider text-right w-[140px]">Rate ($/lb · $/kg)</th>
              <th className="px-2 py-1 text-[10px] font-normal text-slate-500 uppercase tracking-wider text-right w-[120px]">Total</th>
              {!readOnly && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={
                    4
                    + (showCustomerDescription ? 1 : 0)
                    + (showGrade ? 1 : 0)
                    + (showHsCode ? 1 : 0)
                    + (readOnly ? 0 : 1)
                  }
                  className="px-2 py-4 text-center text-slate-600 text-[12px]"
                >
                  No line items yet. Click “Add row” to start.
                </td>
              </tr>
            ) : items.map((it, i) => (
              <tr key={i} className={i < items.length - 1 ? 'border-b border-[#1f1f1f]' : ''}>
                <td className="px-2 py-1 text-slate-500 font-mono tabular-nums">{i + 1}</td>
                <td className="px-2 py-1 align-top">
                  {readOnly ? (
                    <div className="space-y-0.5">
                      <div className="text-slate-100 whitespace-normal break-words">
                        {it.productName || '—'}
                      </div>
                      {it.productId && (
                        <div className="text-[10.5px] text-indigo-300/80 whitespace-normal break-words">
                          → {productOptions.find(p => p.id === it.productId)?.name ?? it.productId}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Input
                        value={it.productName}
                        onChange={e => update(i, { productName: e.target.value })}
                        placeholder="Original product name (OCR or type)"
                        title="Raw name as it appears on the supplier doc"
                        className={cellInput + ' w-full'}
                      />
                      <select
                        value={it.productId ?? ''}
                        onChange={e => {
                          const id = e.target.value;
                          if (!id) { update(i, { productId: undefined }); return; }
                          const found = productOptions.find(p => p.id === id);
                          if (!found) return;
                          // Enrich only blank companion fields — don't
                          // overwrite the original product name.
                          update(i, {
                            productId: found.id,
                            hsCode:    it.hsCode    || found.hsCode    || '',
                            grade:     it.grade     || found.grade     || '',
                            unitPrice: it.unitPrice || found.price     || 0,
                          });
                        }}
                        className={cellInput + ' w-full appearance-none'}
                        title="Link to a product in the system catalog"
                      >
                        <option value="">— link to system product —</option>
                        {productOptions.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </td>
                {showCustomerDescription && (
                  <td className="px-2 py-1">
                    {readOnly ? (
                      <span className="text-slate-400">{it.customerDescription || '—'}</span>
                    ) : (
                      <Input
                        value={it.customerDescription ?? ''}
                        onChange={e => update(i, { customerDescription: e.target.value })}
                        placeholder="Customer PO ref / description"
                        className={cellInput}
                      />
                    )}
                  </td>
                )}
                {showGrade && (
                  <td className="px-2 py-1">
                    {readOnly ? (
                      <span className="text-slate-400 font-mono tabular-nums">{it.grade || '—'}</span>
                    ) : (
                      <Input
                        value={it.grade ?? ''}
                        onChange={e => update(i, { grade: e.target.value })}
                        className={cellInputMono}
                      />
                    )}
                  </td>
                )}
                {showHsCode && (
                  <td className="px-2 py-1">
                    {readOnly ? (
                      <span className="text-slate-400 font-mono tabular-nums">{it.hsCode || '—'}</span>
                    ) : (
                      <Input
                        value={it.hsCode ?? ''}
                        onChange={e => update(i, { hsCode: e.target.value })}
                        className={cellInputMono}
                      />
                    )}
                  </td>
                )}
                <td className="px-2 py-1 text-right align-top">
                  {readOnly ? (
                    <div className="font-mono tabular-nums text-slate-200">
                      <div>{fmtQty(Number(it.quantity) || 0)} lbs</div>
                      <div className="text-slate-500 text-[10.5px]">
                        {fmtQty(lbsToKgs(Number(it.quantity) || 0))} kgs
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1">
                        <QtyInput
                          value={Number(it.quantity) || 0}
                          onChange={(n) => update(i, { quantity: n })}
                          className={cellInputMono + ' text-right flex-1'}
                          title="Quantity in pounds"
                        />
                        <span className="text-[10px] text-slate-500 w-6 text-left">lbs</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <QtyInput
                          value={lbsToKgs(Number(it.quantity) || 0)}
                          onChange={(kgs) => update(i, { quantity: kgsToLbs(kgs) })}
                          className={cellInputMono + ' text-right flex-1'}
                          title="Quantity in kilograms"
                        />
                        <span className="text-[10px] text-slate-500 w-6 text-left">kgs</span>
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-2 py-1 text-right align-top">
                  {readOnly ? (
                    <div className="font-mono tabular-nums text-slate-200">
                      <div>{fmtMoney(Number(it.unitPrice) || 0, currency)} /lb</div>
                      <div className="text-slate-500 text-[10.5px]">
                        {fmtMoney(pricePerLbToKg(Number(it.unitPrice) || 0), currency)} /kg
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          step={0.0001}
                          value={it.unitPrice || ''}
                          onChange={e => update(i, { unitPrice: Number(e.target.value) || 0 })}
                          className={cellInputMono + ' text-right flex-1'}
                          title="Price per pound"
                        />
                        <span className="text-[10px] text-slate-500 w-6 text-left">/lb</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          value={pricePerLbToKg(Number(it.unitPrice) || 0) || ''}
                          onChange={e => {
                            const pkg = Number(e.target.value) || 0;
                            update(i, { unitPrice: pricePerKgToLb(pkg) });
                          }}
                          className={cellInputMono + ' text-right flex-1'}
                          title="Price per kilogram"
                        />
                        <span className="text-[10px] text-slate-500 w-6 text-left">/kg</span>
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-100">
                  {fmtMoney(Number(it.total) || 0, currency)}
                </td>
                {!readOnly && (
                  <td className="px-1 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      title="Remove row"
                      className="p-1 rounded-sm text-slate-500 hover:text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            <tr className="border-t border-[#1f1f1f] bg-[#0f0f0f]">
              <td className="px-2 py-1" colSpan={
                2
                + (showCustomerDescription ? 1 : 0)
                + (showGrade ? 1 : 0)
                + (showHsCode ? 1 : 0)
              } />
              <td className="px-2 py-1 text-right text-slate-500 uppercase tracking-wider text-[10px]">
                <div>Total {totalQty.toLocaleString('en-US')} lbs</div>
                <div>{lbsToKgs(totalQty).toLocaleString('en-US')} kgs</div>
              </td>
              <td className="px-2 py-1 text-right text-[10px] text-slate-500 uppercase tracking-wider">Subtotal</td>
              <td className="px-2 py-1 text-right font-mono tabular-nums text-indigo-300 font-semibold">
                {fmtMoney(subtotal, currency)}
              </td>
              {!readOnly && <td />}
            </tr>
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="flex items-center justify-between">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={addRow}
            className="bg-[#161616] border border-[#1f1f1f] text-slate-200 hover:bg-[#1a1a1a] h-7 px-2.5 text-[12px]"
          >
            <Plus size={12} /> Add row
          </Button>
          <span className="text-[11px] text-slate-500">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
        </div>
      )}
    </div>
  );
};

export const computeSubtotal = (items: LineItem[]): number =>
  round2(items.reduce((s, it) => s + (Number(it.total) || 0), 0));

export const sanitizeItems = (items: LineItem[]): LineItem[] =>
  items
    .filter(it => (Number(it.quantity) || 0) > 0 || (it.productName ?? '').trim() !== '')
    // Spread the raw item first so downstream consumers (PDF generators,
    // BR-mode adjuster, packing-list summaries) still see unmapped
    // fields — `grossKg`/`grossLbs`/`netKg`/`netLbs`/`volumes`/
    // `containerNo`/`sealNo`/`supplier`/`blNumber`/etc. Without this
    // spread, the very first drawer save wiped every per-item weight
    // the OCR pipeline captured, leaving only the 8 canonical fields.
    // Explicit properties below still win so the canonical shape is
    // unchanged.
    .map((it: any) => {
      const q = Number(it.quantity) || 0;
      const p = Number(it.unitPrice) || 0;
      const total = round2(q * p);
      return {
        ...it,
        productId: it.productId,
        productName: (it.productName ?? '').trim(),
        customerDescription: it.customerDescription ?? '',
        hsCode: it.hsCode ?? '',
        grade: it.grade ?? '',
        quantity: q,
        unitPrice: p,
        total,
        // Resync OCR-origin duplicate fields from the canonical ones.
        // The PDF generator prefers item.netLbs / item.amount over
        // quantity / total; without this sync, drawer edits wouldn't
        // flow into the generated PDF.
        netLbs: q,
        netKg: round2(q * LB_TO_KG),
        amount: total,
      };
    });
