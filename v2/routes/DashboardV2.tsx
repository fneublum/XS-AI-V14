// Phase 3B — v2 Dashboard.
//
// Minimalist pass-through: v1's Dashboard component owns the entire
// surface (header, Daily Briefing, Smart Suggestions, AI agent,
// WhatsApp). The v2 route contributes only the dark-mode bridge that
// re-maps v1's light Tailwind classes to the v2 palette, plus the
// sessionStorage → v1 User adapter. No duplicate titles, no static
// insight pills, no placeholder quick-actions.

import React, { useCallback, useMemo } from 'react';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useCustomers } from '../queries/useCustomers';
import { useSuppliers } from '../queries/useSuppliers';
import { useProducts } from '../queries/useProducts';
import { DashboardDropzone } from '../components/DashboardDropzone';
import V1Dashboard from '../../pages/Dashboard';
import { getSupabaseClient } from '../../services/supabase';
import type { User, Role } from '../../types';

const readV1User = (): User | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('xs_current_user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<User> & Record<string, unknown>;
    return {
      id: String(parsed.id ?? ''),
      name: String(parsed.name ?? parsed.username ?? 'User'),
      username: String(parsed.username ?? parsed.name ?? ''),
      role: (parsed.role as Role) ?? ('USER' as Role),
      avatarInitials:
        typeof parsed.avatarInitials === 'string' && parsed.avatarInitials
          ? parsed.avatarInitials
          : String(parsed.name ?? parsed.username ?? 'U').slice(0, 2).toUpperCase(),
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
      allowed_company_ids:
        (parsed as any).allowed_company_ids
        ?? (parsed as any).allowedCompanyIds
        ?? undefined,
      allowed_modules: (parsed as any).allowed_modules as string[] | undefined,
    } as User;
  } catch {
    return null;
  }
};

// ─── Dark-mode bridge for the embedded v1 surface ──────────────
//
// v1's Dashboard tree uses hundreds of light-mode Tailwind classes
// (bg-white, text-slate-800, bg-slate-50, …). Rather than fork every
// component, we mount under `.v2-dark-scope` and rewrite the class
// mapping via scoped CSS.

// Only applies under `html.dark` — in light mode the embedded v1
// surface keeps its native light palette, which already matches the
// v2 light theme.
const DARK_SCOPE_STYLE = `
  html.dark .v2-dark-scope {
    color-scheme: dark;
    color: #e2e8f0;
    background: #0a0a0a;
  }
  html.dark .v2-dark-scope .bg-white,
  html.dark .v2-dark-scope .bg-slate-50,
  html.dark .v2-dark-scope .bg-slate-100 {
    background-color: #0a0a0a !important;
  }
  html.dark .v2-dark-scope .bg-slate-200 {
    background-color: #161616 !important;
  }
  html.dark .v2-dark-scope .bg-slate-800,
  html.dark .v2-dark-scope .bg-slate-900 {
    background-color: #0a0a0a !important;
  }
  html.dark .v2-dark-scope .text-slate-900,
  html.dark .v2-dark-scope .text-slate-800,
  html.dark .v2-dark-scope .text-slate-700 {
    color: #f1f5f9 !important;
  }
  html.dark .v2-dark-scope .text-slate-600 {
    color: #cbd5e1 !important;
  }
  html.dark .v2-dark-scope .text-slate-500 {
    color: #94a3b8 !important;
  }
  html.dark .v2-dark-scope .text-slate-400 {
    color: #64748b !important;
  }
  html.dark .v2-dark-scope .border-slate-100,
  html.dark .v2-dark-scope .border-slate-200 {
    border-color: #1f1f1f !important;
  }
  html.dark .v2-dark-scope .border-slate-300 {
    border-color: #2a2a2a !important;
  }
  html.dark .v2-dark-scope .divide-slate-100 > * + *,
  html.dark .v2-dark-scope .divide-slate-200 > * + * {
    border-color: #1f1f1f !important;
  }
  html.dark .v2-dark-scope .shadow,
  html.dark .v2-dark-scope .shadow-sm,
  html.dark .v2-dark-scope .shadow-md,
  html.dark .v2-dark-scope .shadow-lg,
  html.dark .v2-dark-scope .shadow-xl {
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.02) inset !important;
  }
  html.dark .v2-dark-scope input,
  html.dark .v2-dark-scope textarea,
  html.dark .v2-dark-scope select {
    background-color: #0f0f0f !important;
    color: #e2e8f0 !important;
    border-color: #1f1f1f !important;
  }
  html.dark .v2-dark-scope input::placeholder,
  html.dark .v2-dark-scope textarea::placeholder {
    color: #475569 !important;
  }
  html.dark .v2-dark-scope .bg-blue-50,
  html.dark .v2-dark-scope .bg-indigo-50,
  html.dark .v2-dark-scope .bg-emerald-50,
  html.dark .v2-dark-scope .bg-amber-50 {
    background-color: rgba(79, 70, 229, 0.08) !important;
  }
  html.dark .v2-dark-scope .hover\\:bg-slate-100:hover,
  html.dark .v2-dark-scope .hover\\:bg-slate-50:hover,
  html.dark .v2-dark-scope .hover\\:bg-white:hover {
    background-color: #141414 !important;
  }
`;

const DashboardV2: React.FC = () => {
  const { currentCompanyId } = useCompany();
  const companies = useCompanies();

  const currentUser = useMemo(readV1User, []);
  const availableCompanies = useMemo(
    () => (companies.data ?? []).map(c => c as unknown as import('../../types').Company),
    [companies.data],
  );

  // Dashboard OCR pipeline in AiDashboard only auto-saves when the
  // matching handler prop is truthy (`docType === 'BILL OF LADING' &&
  // onSaveBL`, etc.). v1's App.tsx wires these to useSupabase().addRecord;
  // the v2 shell never ported that wiring, which is why the agent used
  // to report "No save handler available for BILL OF LADING." We mint
  // thin inline handlers that insert straight into Supabase — AiDashboard
  // awaits them and surfaces any thrown error as "save failed: …".
  const makeSaver = useCallback(<T extends Record<string, unknown>>(table: string) => {
    return async (row: T) => {
      const sb = getSupabaseClient();
      if (!sb) throw new Error('Supabase client unavailable');
      const { error } = await sb.from(table).insert(row);
      if (error) throw new Error(error.message);
    };
  }, []);

  const onSaveBL              = useMemo(() => makeSaver('bill_landings'),         [makeSaver]);
  const onSaveBooking         = useMemo(() => makeSaver('bookings'),              [makeSaver]);
  const onSaveEstimate        = useMemo(() => makeSaver('estimates'),             [makeSaver]);
  const onSaveProforma        = useMemo(() => makeSaver('proforma_invoices'),     [makeSaver]);
  const onSavePO              = useMemo(() => makeSaver('purchase_order_extracts'), [makeSaver]);
  const onSaveInvoice         = useMemo(() => makeSaver('invoices'),              [makeSaver]);
  const onSaveSupplierInvoice = useMemo(() => makeSaver('invoices_suppliers'),    [makeSaver]);
  const onSavePackingList     = useMemo(() => makeSaver('packing_lists'),         [makeSaver]);
  const onAddFreightQuote     = useMemo(() => makeSaver('freight_quotes'),        [makeSaver]);

  // CRUD handlers for the XS Agent's CREATE_* actions. Without these
  // the agent reports "Customer creation not available." because
  // pages/AiDashboard.tsx falls through when crud.onAddCustomer is
  // undefined. AgentService.executeAction builds the row payload
  // (with id + companyId), so each saver just needs to insert it
  // and report truthy on success.
  const makeAdder = useCallback(<T extends Record<string, unknown>>(table: string) => {
    return async (row: T) => {
      const sb = getSupabaseClient();
      if (!sb) throw new Error('Supabase client unavailable');
      const { error } = await sb.from(table).insert(row);
      if (error) throw new Error(error.message);
      return row;
    };
  }, []);
  const makeUpdater = useCallback(<T extends { id: string }>(table: string) => {
    return async (row: T) => {
      const sb = getSupabaseClient();
      if (!sb) throw new Error('Supabase client unavailable');
      const { id, ...rest } = row;
      const { error } = await sb.from(table).update(rest).eq('id', id);
      if (error) throw new Error(error.message);
      return row;
    };
  }, []);

  const onAddCustomer        = useMemo(() => makeAdder('customers'),        [makeAdder]);
  const onUpdateCustomer     = useMemo(() => makeUpdater('customers'),      [makeUpdater]);
  const onAddSupplier        = useMemo(() => makeAdder('suppliers'),        [makeAdder]);
  const onUpdateSupplier     = useMemo(() => makeUpdater('suppliers'),      [makeUpdater]);
  const onAddProduct         = useMemo(() => makeAdder('products'),         [makeAdder]);
  const onAddSalesOrder      = useMemo(() => makeAdder('sales_orders'),     [makeAdder]);
  const onAddPurchaseOrder   = useMemo(() => makeAdder('purchase_orders'),  [makeAdder]);
  const onAddBooking         = useMemo(() => makeAdder('bookings'),         [makeAdder]);
  const onAddCargoAgent      = useMemo(() => makeAdder('cargo_agents'),     [makeAdder]);

  // Data arrays for the XS Agent's lookup-by-name flow. Without these
  // populated, DELETE_CUSTOMER / DELETE_SUPPLIER / UPDATE_* would fail
  // with "X not found" because findByName runs against an empty array.
  // Pulled directly via the v2 query hooks so company-scoping + cache
  // are honoured.
  const customersQ = useCustomers();
  const suppliersQ = useSuppliers();
  const productsQ  = useProducts();
  const customersData = useMemo(() => customersQ.data ?? [], [customersQ.data]);
  const suppliersData = useMemo(() => suppliersQ.data ?? [], [suppliersQ.data]);
  const productsData  = useMemo(() => productsQ.data  ?? [], [productsQ.data]);

  if (!currentUser) {
    return (
      <div className="text-[13px] text-slate-500">
        Signing in… refresh if this persists.
      </div>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: DARK_SCOPE_STYLE }} />
      {/* The background jobs (useBackgroundJobs) fire `sx-doc-saved`
       *  events whose messages are picked up by the XS Agent chat —
       *  that's where "13 bookings need attention" now lands. The old
       *  TriageBanner panel was removed so the XS Agent gets the full
       *  viewport on login without a page scroll. */}
      <div className="v2-dark-scope h-full overflow-hidden">
        <V1Dashboard
          hideInsights
          hideHeader
          whatsAppHeader={<DashboardDropzone />}
          currentUser={currentUser}
          currentCompanyId={currentCompanyId}
          availableCompanies={availableCompanies}
          customers={customersData}
          suppliers={suppliersData}
          products={productsData}
          inventory={[]}
          inventoryLogs={[]}
          purchaseOrders={[]}
          salesQuotes={[]}
          supplierQuoteRequests={[]}
          supplierOffers={[]}
          opportunities={[]}
          shipments={[]}
          salesOrdersData={[]}
          bookingsData={[]}
          billOfLadingsData={[]}
          cargoAgentsData={[]}
          freightQuotesData={[]}
          invoicesData={[]}
          estimatesData={[]}
          proformasData={[]}
          packingListsData={[]}
          supplierInvoicesData={[]}
          commissionsData={[]}
          ports={[]}
          onSaveBL={onSaveBL}
          onSaveBooking={onSaveBooking}
          onSaveEstimate={onSaveEstimate}
          onSaveProforma={onSaveProforma}
          onSavePO={onSavePO}
          onSaveInvoice={onSaveInvoice}
          onSaveSupplierInvoice={onSaveSupplierInvoice}
          onSavePackingList={onSavePackingList}
          onAddFreightQuote={onAddFreightQuote}
          onAddCustomer={onAddCustomer}
          onUpdateCustomer={onUpdateCustomer}
          onAddSupplier={onAddSupplier}
          onUpdateSupplier={onUpdateSupplier}
          onAddProduct={onAddProduct}
          onAddSalesOrder={onAddSalesOrder}
          onAddPurchaseOrder={onAddPurchaseOrder}
          onAddBooking={onAddBooking}
          onAddCargoAgent={onAddCargoAgent}
        />
      </div>
    </>
  );
};

export default DashboardV2;
