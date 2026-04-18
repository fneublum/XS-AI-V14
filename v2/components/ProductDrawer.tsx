// Phase 3B — Product editor drawer.
//
// Full v1 parity: cross-company sharing (ADMIN), image upload (max 3,
// compressed to 600px/0.7), TDS PDF upload (5MB cap), supplier picker
// with inline "Quick Add Supplier", technical specs, price / stock /
// product type, dedup-by-name-on-create. Matches the v1 Products.tsx
// form section 1:1 — new fields added here must stay in sync with
// services/schema.ts.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X as XIcon, Plus, Upload, Loader2, Image as ImageIcon, Share2, Download } from 'lucide-react';
import {
  Drawer, Input, FormField, Label, Button, Badge, ConfirmDialog,
} from '../primitives';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useSuppliers, Supplier } from '../queries/useSuppliers';
import { useProducts, Product, ProductSpecs } from '../queries/useProducts';
import {
  useCompanyImages, useAddCompanyImage, useDeleteCompanyImage,
} from '../queries/useCompanyImages';
import { useEntityUpdate, useEntityInsert, useEntityDelete } from '../queries/useEntityMutations';
import { compressImage } from '../utils/compressImage';
import type { EditorMode } from '../providers/EditorProvider';

interface Props {
  product: Product | null;
  mode: EditorMode;
  onOpenChange: (open: boolean) => void;
}

const CATEGORIES = ['Resin', 'Fiber Textile', 'Cotton Waste', 'Plastic Scrap'];
const FORMS = ['Pellets', 'Powder', 'Bale', 'Spool', 'Regrind'];
const STOCK_STATUSES = ['Available', 'Low Stock', 'Backorder'];
const PRODUCT_TYPES = [
  { v: 'resale', l: 'Resale' },
  { v: 'commission', l: 'Commission' },
];

const inputClass =
  'h-8 text-[12.5px] bg-[#111111] border-[#1f1f1f] text-slate-200 rounded-md px-2 ' +
  'placeholder:text-slate-600 focus:ring-1 focus:ring-indigo-500 outline-none';

const labelClass = 'text-[11px] text-slate-500 uppercase tracking-wider font-medium';

const sectionClass = 'p-3 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] space-y-3';

const MAX_IMAGES = 3;
const MAX_IMG_WIDTH = 600;
const IMG_QUALITY = 0.7;
const MAX_TDS_BYTES = 5 * 1024 * 1024;

export const ProductDrawer: React.FC<Props> = ({ product, mode, onOpenChange }) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();
  const suppliers = useSuppliers();
  const existingProducts = useProducts();
  const images = useCompanyImages('PRODUCT');
  const addImage = useAddCompanyImage();
  const deleteImage = useDeleteCompanyImage();

  const update = useEntityUpdate<{ id: string } & Record<string, unknown>>({
    table: 'products', listQueryKeys: ['products'],
  });
  const insert = useEntityInsert<Record<string, unknown>>({
    table: 'products', listQueryKeys: ['products'], idPrefix: 'P',
    withCreatedAt: false,
  });
  const del = useEntityDelete({ table: 'products', listQueryKeys: ['products'] });
  const insertSupplier = useEntityInsert<Record<string, unknown>>({
    table: 'suppliers', listQueryKeys: ['suppliers'], idPrefix: 'SUP',
    withCreatedAt: false,
  });

  // Form state — mirrors v1 Products.tsx:120-148.
  const [companyId, setCompanyId]       = useState<string>(currentCompanyId !== 'ALL' ? currentCompanyId : '');
  const [name, setName]                 = useState('');
  const [supplierProductName, setSupplierProductName] = useState('');
  const [sku, setSku]                   = useState('');
  const [hsCode, setHsCode]             = useState('');
  const [supplier, setSupplier]         = useState('');
  const [category, setCategory]         = useState<string>('Resin');
  const [grade, setGrade]               = useState('');
  const [price, setPrice]               = useState<string>('0');
  const [stockStatus, setStockStatus]   = useState<string>('Available');
  const [productType, setProductType]   = useState<string>('resale');
  const [tdsFile, setTdsFile]           = useState<string | null>(null);
  const [tdsUrl, setTdsUrl]             = useState<string | null>(null);
  const [sharedWith, setSharedWith]     = useState<string[]>([]);
  const [imageIds, setImageIds]         = useState<string[]>([]);
  const [specs, setSpecs]               = useState<ProductSpecs>({ form: 'Pellets' });

  // UX state
  const [showCustomName, setShowCustomName] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isSavingFile, setIsSavingFile]     = useState(false);
  const [quickSupplierOpen, setQuickSupplierOpen] = useState(false);
  const [newSupplierName, setNewSupplierName]     = useState('');
  const [confirmDelete, setConfirmDelete]         = useState(false);
  const [deleteImgId, setDeleteImgId]             = useState<string | null>(null);

  // Hydrate when product changes.
  useEffect(() => {
    if (!product) return;
    setCompanyId(product.companyId ?? (currentCompanyId !== 'ALL' ? currentCompanyId : ''));
    setName(product.name ?? '');
    setSupplierProductName(product.supplierProductName ?? '');
    setSku(product.sku ?? '');
    setHsCode(product.hsCode ?? '');
    setSupplier(product.supplier ?? '');
    setCategory(product.category ?? 'Resin');
    setGrade(product.grade ?? '');
    setPrice(product.price === null || product.price === undefined ? '0' : String(product.price));
    setStockStatus(product.stockStatus ?? 'Available');
    setProductType(product.productType ?? 'resale');
    setTdsFile(product.tdsFile);
    setTdsUrl(product.tdsUrl);
    setSharedWith(product.sharedWith ?? []);
    setImageIds(product.imageIds ?? []);
    setSpecs(product.specs ?? {});
    setShowCustomName(false);
  }, [product?.id, mode]);

  const isAdmin = true; // v2 role gating lands with Phase 1d; open for now.
  const availableCompanies = companies.data ?? [];
  const isSystem = currentCompanyId === 'ALL';

  const setSpec = (k: keyof ProductSpecs, v: string) =>
    setSpecs(prev => ({ ...prev, [k]: v }));

  // --- Image upload ---
  const getImageUrl = (id: string): string | null =>
    images.data?.find(i => i.id === id)?.url ?? null;

  const processImageFile = async (file: File) => {
    if (imageIds.length >= MAX_IMAGES) {
      toast.push({ kind: 'warning', title: `Max ${MAX_IMAGES} images per product` });
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.push({ kind: 'error', title: 'Only image files are accepted' });
      return;
    }
    setUploadingImage(true);
    try {
      const compressed = await compressImage(file, MAX_IMG_WIDTH, IMG_QUALITY);
      const newImg = await addImage.mutateAsync({
        companyId: companyId || 'ALL',
        url: compressed,
        name: file.name,
        type: 'PRODUCT',
      });
      setImageIds(prev => [...prev, newImg.id]);
    } catch (err) {
      toast.push({
        kind: 'error', title: 'Failed to process image',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUploadingImage(false);
    }
  };

  const onImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processImageFile(e.target.files[0]);
      // Allow re-selecting the same file later.
      e.target.value = '';
    }
  };

  const onImageDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    setIsDraggingImage(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processImageFile(e.dataTransfer.files[0]);
    }
  };

  const removeImage = (id: string) => setDeleteImgId(id);
  const confirmRemoveImage = async () => {
    if (!deleteImgId) return;
    setImageIds(prev => prev.filter(x => x !== deleteImgId));
    try { await deleteImage.mutateAsync(deleteImgId); } catch { /* noop */ }
    setDeleteImgId(null);
  };

  // --- TDS PDF upload ---
  const onTdsFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_TDS_BYTES) {
      toast.push({ kind: 'error', title: 'TDS file too large', description: 'Maximum 5MB.' });
      return;
    }
    setIsSavingFile(true);
    const reader = new FileReader();
    reader.onloadend = () => {
      setTdsFile(f.name);
      setTdsUrl(reader.result as string);
      setIsSavingFile(false);
    };
    reader.onerror = () => {
      toast.push({ kind: 'error', title: 'Error reading file' });
      setIsSavingFile(false);
    };
    reader.readAsDataURL(f);
  };

  const downloadTds = () => {
    if (!tdsUrl) return;
    const link = document.createElement('a');
    link.href = tdsUrl;
    link.download = tdsFile || 'Technical_Data_Sheet.pdf';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- Cross-company share toggle ---
  const toggleShare = (id: string) => {
    setSharedWith(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  // --- Quick-add supplier ---
  const addQuickSupplier = async () => {
    const trimmed = newSupplierName.trim();
    if (!trimmed) return;
    try {
      await insertSupplier.mutateAsync({
        companyId: companyId || 'ALL',
        name: trimmed,
        email: null,
        phone: null,
        country: null,
        categories: [],
        rating: 3,
        paymentTerms: 'Net 30',
      });
      setSupplier(trimmed);
      setNewSupplierName('');
      setQuickSupplierOpen(false);
      toast.push({ kind: 'success', title: 'Supplier added', description: trimmed });
    } catch (err) {
      toast.push({
        kind: 'error', title: 'Add supplier failed',
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // --- Name picker ---
  const existingNames = useMemo(() => {
    const names = new Set<string>();
    for (const p of existingProducts.data ?? []) if (p.name) names.add(p.name);
    return Array.from(names).sort();
  }, [existingProducts.data]);

  // --- Save ---
  const canSave = name.trim() !== '' && supplier.trim() !== '' && grade.trim() !== '';
  const pending = update.isPending || insert.isPending || del.isPending;

  const buildPayload = () => ({
    companyId: companyId || currentCompanyId,
    name: name.trim(),
    supplierProductName: supplierProductName || null,
    sku: sku || null,
    hsCode: hsCode || null,
    category,
    grade: grade.trim(),
    supplier: supplier.trim(),
    price: Number(price) || 0,
    stockStatus,
    // `productType` is in the v1 types but not all live DBs have the
    // column — omit from payload to avoid insert errors. Add back
    // once the column migration lands.
    specs,
    tdsFile,
    tdsUrl,
    sharedWith,
    imageIds,
  });

  const save = () => {
    if (!canSave) {
      toast.push({ kind: 'warning', title: 'Name, grade and supplier are required' });
      return;
    }
    const payload = buildPayload();
    if (mode === 'create' && product) {
      // Dedup by name within the same company (v1 parity).
      const targetCompany = payload.companyId;
      const dup = (existingProducts.data ?? []).find(
        p => p.name.toLowerCase() === payload.name.toLowerCase()
          && p.companyId === targetCompany,
      );
      if (dup) {
        update.mutate({ id: dup.id, ...payload }, {
          onSuccess: () => {
            toast.push({ kind: 'success', title: 'Updated existing', description: payload.name });
            onOpenChange(false);
          },
          onError: (err) => toast.push({
            kind: 'error', title: 'Save failed', description: err.message,
          }),
        });
        return;
      }
      insert.mutate(payload, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Created', description: payload.name });
          onOpenChange(false);
        },
        onError: (err) => toast.push({
          kind: 'error', title: 'Create failed', description: err.message,
        }),
      });
    } else if (product) {
      update.mutate({ id: product.id, ...payload }, {
        onSuccess: () => {
          toast.push({ kind: 'success', title: 'Saved', description: payload.name });
          onOpenChange(false);
        },
        onError: (err) => toast.push({
          kind: 'error', title: 'Save failed', description: err.message,
        }),
      });
    }
  };

  const deleteProduct = () => {
    if (!product) return;
    del.mutate(product.id, {
      onSuccess: () => {
        toast.push({ kind: 'success', title: 'Deleted', description: product.name });
        setConfirmDelete(false);
        onOpenChange(false);
      },
      onError: (err) => {
        toast.push({ kind: 'error', title: 'Delete failed', description: err.message });
        setConfirmDelete(false);
      },
    });
  };

  if (!product) return null;

  return (
    <>
      <Drawer
        open={!!product}
        onOpenChange={onOpenChange}
        title={mode === 'create' ? 'New product' : (product.name || 'Product')}
        description={mode === 'create'
          ? 'Catalog a new resin grade or fiber specification.'
          : `${product.grade ?? ''}${product.specs?.type ? ` · ${product.specs.type}` : ''}`}
        widthClass="w-[min(96vw,720px)]"
        footer={
          <>
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
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={!canSave || pending}
              loading={pending}
              className="ml-auto bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
            >
              {pending ? 'Saving…' : mode === 'create' ? 'Create product' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Company assignment (System view only) */}
          {isSystem && availableCompanies.length > 0 && (
            <div className={sectionClass}>
              <Label className={labelClass}>Assign to company</Label>
              <select
                value={companyId}
                onChange={e => setCompanyId(e.target.value)}
                className={inputClass + ' w-full appearance-none'}
              >
                <option value="">Select…</option>
                {[...availableCompanies].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Cross-Company Visibility (ADMIN + multi-company) */}
          {isAdmin && availableCompanies.length > 1 && (
            <div className={sectionClass}>
              <div className="flex items-center gap-2">
                <Share2 size={12} className="text-indigo-400" />
                <Label className={labelClass}>Cross-company visibility</Label>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Other companies that can see and use this product.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {availableCompanies
                  .filter(c => c.id !== companyId)
                  .map(c => {
                    const on = sharedWith.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleShare(c.id)}
                        className={
                          on
                            ? 'px-2.5 py-1 rounded-md text-[11px] font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30'
                            : 'px-2.5 py-1 rounded-md text-[11px] text-slate-400 border border-[#1f1f1f] hover:text-slate-200 hover:border-[#2a2a2a]'
                        }
                      >
                        {c.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Images */}
          <div
            className={
              (isDraggingImage
                ? 'border-indigo-500/60 bg-indigo-500/5 '
                : 'border-[#1f1f1f] bg-[#0f0f0f] ')
              + 'p-3 rounded-md border-2 border-dashed space-y-3'
            }
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingImage(true); }}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingImage(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDraggingImage(false); }}
            onDrop={onImageDrop}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon size={12} className="text-slate-500" />
                <Label className={labelClass}>Product images</Label>
              </div>
              <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                {imageIds.length} / {MAX_IMAGES}
              </span>
            </div>

            <div className="flex gap-2 flex-wrap">
              {imageIds.map(id => {
                const url = getImageUrl(id);
                if (!url) {
                  return (
                    <div key={id} className="w-20 h-20 rounded-md border border-[#1f1f1f] bg-[#0a0a0a] flex items-center justify-center">
                      <Loader2 size={16} className="animate-spin text-slate-600" />
                    </div>
                  );
                }
                return (
                  <div key={id} className="relative w-20 h-20 rounded-md overflow-hidden border border-[#1f1f1f] bg-[#0a0a0a] group">
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(id)}
                      className="absolute -top-1 -right-1 rounded-full bg-red-600 text-white p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                      aria-label="Remove image"
                    >
                      <XIcon size={12} />
                    </button>
                  </div>
                );
              })}

              {imageIds.length < MAX_IMAGES && (
                <label className={
                  'w-20 h-20 rounded-md border-2 border-dashed flex flex-col items-center justify-center cursor-pointer ' +
                  (isDraggingImage ? 'border-indigo-500/60 bg-indigo-500/10 ' : 'border-[#1f1f1f] bg-[#0a0a0a] hover:bg-[#111111] ') +
                  (uploadingImage ? 'opacity-50 pointer-events-none' : '')
                }>
                  {uploadingImage
                    ? <Loader2 size={16} className="animate-spin text-slate-400" />
                    : <Plus size={16} className="text-slate-500" />}
                  <span className="text-[10px] mt-1 text-slate-500">
                    {uploadingImage ? 'Saving…' : isDraggingImage ? 'Drop' : 'Add'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onImageFileChange}
                    disabled={uploadingImage}
                  />
                </label>
              )}
            </div>
          </div>

          {/* Name + supplier product name */}
          <div className="grid grid-cols-2 gap-3">
            <FormField>
              <Label className={labelClass}>
                System product name <span className="text-red-400 ml-1">*</span>
              </Label>
              {mode === 'edit' || showCustomName ? (
                <div className="flex gap-1">
                  <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="System product name"
                    className={inputClass + ' flex-1'}
                    autoFocus={showCustomName}
                  />
                  {mode === 'create' && (
                    <button
                      type="button"
                      onClick={() => setShowCustomName(false)}
                      className="text-slate-500 hover:text-slate-200 px-1"
                      title="Back to list"
                    >
                      <XIcon size={14} />
                    </button>
                  )}
                </div>
              ) : (
                <select
                  value={name}
                  onChange={e => {
                    if (e.target.value === '__ADD__') {
                      setShowCustomName(true);
                      setName('');
                    } else {
                      setName(e.target.value);
                    }
                  }}
                  className={inputClass + ' w-full appearance-none'}
                >
                  <option value="">Select…</option>
                  <option value="__ADD__" className="font-semibold text-indigo-300 bg-[#0f0f0f]">
                    + Add new
                  </option>
                  {existingNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              )}
            </FormField>

            <FormField>
              <Label className={labelClass}>Supplier product name</Label>
              <Input
                value={supplierProductName}
                onChange={e => setSupplierProductName(e.target.value)}
                placeholder="Supplier's internal name"
                className={inputClass}
              />
            </FormField>
          </div>

          {/* SKU / HS Code */}
          <div className="grid grid-cols-2 gap-3">
            <FormField>
              <Label className={labelClass}>SKU</Label>
              <Input
                value={sku}
                onChange={e => setSku(e.target.value)}
                placeholder="OPT-123"
                className={inputClass + ' font-mono tabular-nums'}
              />
            </FormField>
            <FormField>
              <Label className={labelClass}>HS code</Label>
              <Input
                value={hsCode}
                onChange={e => setHsCode(e.target.value)}
                placeholder="3908.10"
                className={inputClass + ' font-mono tabular-nums'}
              />
            </FormField>
          </div>

          {/* Supplier picker (with quick-add) */}
          <FormField>
            <Label className={labelClass}>
              Supplier <span className="text-red-400 ml-1">*</span>
            </Label>
            <select
              value={supplier}
              onChange={e => {
                if (e.target.value === '__ADD__') {
                  setQuickSupplierOpen(true);
                } else {
                  setSupplier(e.target.value);
                }
              }}
              className={inputClass + ' w-full appearance-none'}
            >
              <option value="">Select supplier…</option>
              <option value="__ADD__" className="font-semibold text-indigo-300 bg-[#0f0f0f]">
                + Add new supplier
              </option>
              {[...(suppliers.data ?? [])]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </FormField>

          {/* Technical specs section */}
          <div className={sectionClass}>
            <Label className={labelClass}>Technical specs</Label>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>Category</Label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className={inputClass + ' w-full appearance-none'}
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormField>
              <FormField>
                <Label className={labelClass}>Type</Label>
                <Input
                  value={specs.type ?? ''}
                  onChange={e => setSpec('type', e.target.value)}
                  placeholder="PA66"
                  className={inputClass}
                />
              </FormField>
              <FormField>
                <Label className={labelClass}>Form</Label>
                <select
                  value={specs.form ?? 'Pellets'}
                  onChange={e => setSpec('form', e.target.value)}
                  className={inputClass + ' w-full appearance-none'}
                >
                  {FORMS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>
                  Grade <span className="text-red-400 ml-1">*</span>
                </Label>
                <Input
                  value={grade}
                  onChange={e => setGrade(e.target.value)}
                  placeholder="H-3500"
                  className={inputClass + ' font-mono tabular-nums'}
                />
              </FormField>
              <FormField>
                <Label className={labelClass}>Color</Label>
                <Input
                  value={specs.color ?? ''}
                  onChange={e => setSpec('color', e.target.value)}
                  placeholder="Natural"
                  className={inputClass}
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Reinforced</Label>
                <Input
                  value={specs.reinforced ?? ''}
                  onChange={e => setSpec('reinforced', e.target.value)}
                  placeholder="30% GF"
                  className={inputClass}
                />
              </FormField>
              <FormField>
                <Label className={labelClass}>Additives</Label>
                <Input
                  value={specs.additives ?? ''}
                  onChange={e => setSpec('additives', e.target.value)}
                  placeholder="UV stabilizer"
                  className={inputClass}
                />
              </FormField>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <FormField>
                <Label className={labelClass}>RV</Label>
                <Input
                  value={specs.rv ?? ''}
                  onChange={e => setSpec('rv', e.target.value)}
                  placeholder="2.7"
                  className={inputClass + ' font-mono tabular-nums'}
                />
              </FormField>
              <FormField>
                <Label className={labelClass}>MFR</Label>
                <Input
                  value={specs.mfr ?? ''}
                  onChange={e => setSpec('mfr', e.target.value)}
                  placeholder="25"
                  className={inputClass + ' font-mono tabular-nums'}
                />
              </FormField>
              <FormField>
                <Label className={labelClass}>Origin</Label>
                <Input
                  value={specs.origin ?? ''}
                  onChange={e => setSpec('origin', e.target.value)}
                  placeholder="Country"
                  className={inputClass}
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FormField>
                <Label className={labelClass}>Process</Label>
                <Input
                  value={specs.process ?? ''}
                  onChange={e => setSpec('process', e.target.value)}
                  placeholder="Injection, Extrusion…"
                  className={inputClass}
                />
              </FormField>
              <FormField>
                <Label className={labelClass}>Packages</Label>
                <Input
                  value={specs.packages ?? ''}
                  onChange={e => setSpec('packages', e.target.value)}
                  placeholder="25kg Bag"
                  className={inputClass}
                />
              </FormField>
            </div>
          </div>

          {/* Commerce fields */}
          <div className="grid grid-cols-3 gap-3">
            <FormField>
              <Label className={labelClass}>Base price ($/LB)</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={price}
                onChange={e => setPrice(e.target.value)}
                className={inputClass + ' font-mono tabular-nums'}
              />
            </FormField>
            <FormField>
              <Label className={labelClass}>Stock</Label>
              <select
                value={stockStatus}
                onChange={e => setStockStatus(e.target.value)}
                className={inputClass + ' w-full appearance-none'}
              >
                {STOCK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </FormField>
            <FormField>
              <Label className={labelClass}>Type</Label>
              <select
                value={productType}
                onChange={e => setProductType(e.target.value)}
                className={inputClass + ' w-full appearance-none'}
              >
                {PRODUCT_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </FormField>
          </div>

          {/* TDS upload */}
          <div className={sectionClass}>
            <Label className={labelClass}>Technical Data Sheet (PDF)</Label>
            <div className="flex items-center gap-2">
              <label className={
                'inline-flex items-center gap-2 px-2.5 py-1 rounded-md cursor-pointer text-[12px] ' +
                'border border-[#1f1f1f] bg-[#0a0a0a] text-slate-200 hover:bg-[#161616] ' +
                (isSavingFile ? 'opacity-50 pointer-events-none' : '')
              }>
                {isSavingFile
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Upload size={12} />}
                <span>{tdsFile ? 'Change file' : 'Upload TDS'}</span>
                <input
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={onTdsFileChange}
                  disabled={isSavingFile}
                />
              </label>
              {tdsFile ? (
                <>
                  <span className="text-[11.5px] text-slate-300 truncate max-w-[240px]" title={tdsFile}>
                    {tdsFile}
                  </span>
                  {tdsUrl && (
                    <button
                      type="button"
                      onClick={downloadTds}
                      className="inline-flex items-center gap-1 text-indigo-300 text-[11.5px] hover:text-indigo-200"
                      title="Download current TDS"
                    >
                      <Download size={12} /> Download
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setTdsFile(null); setTdsUrl(null); }}
                    className="text-slate-500 hover:text-red-400 text-[11.5px]"
                    title="Remove TDS"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="text-[11.5px] text-slate-500">No file selected</span>
              )}
            </div>
          </div>

          {/* Footer meta */}
          <div className="pt-2 border-t border-[#1f1f1f] text-[11px] text-slate-500 flex items-center gap-2">
            <Badge variant="neutral">products</Badge>
            <span className="ml-auto font-mono tabular-nums text-slate-600">
              {mode === 'create' ? 'new' : `#${product.id.slice(0, 8)}`}
            </span>
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${product?.name ?? ''}?`}
        description="Removes the product catalog entry. Inventory and price history rows that reference it may break."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={deleteProduct}
      />

      <ConfirmDialog
        open={!!deleteImgId}
        onOpenChange={(o) => !o && setDeleteImgId(null)}
        title="Remove this image?"
        description="The photo is deleted from storage and the product."
        confirmLabel="Remove"
        onConfirm={confirmRemoveImage}
      />

      {quickSupplierOpen && (
        <ConfirmDialog
          open={quickSupplierOpen}
          onOpenChange={setQuickSupplierOpen}
          title="Quick-add supplier"
          description={(
            <div className="pt-2 space-y-2">
              <Input
                value={newSupplierName}
                onChange={e => setNewSupplierName(e.target.value)}
                placeholder="Supplier name"
                className={inputClass + ' w-full'}
                autoFocus
              />
              <p className="text-[11px] text-slate-500">
                Seeds a minimal supplier record. Open Suppliers after to fill contact + terms.
              </p>
            </div>
          )}
          confirmLabel="Add supplier"
          tone="neutral"
          loading={insertSupplier.isPending}
          onConfirm={addQuickSupplier}
        />
      )}
    </>
  );
};
