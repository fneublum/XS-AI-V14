// V2 Dashboard — mirrors the V1 layout: greeting header on top, then
// a full-viewport two-column workspace (XS Agent chat on the left,
// document dropzone + WhatsApp widget on the right). No KPI tiles or
// jump-to links — those used to live here but the user wanted the
// surface to match V1 exactly.

import React, { useCallback, useMemo } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { useCustomers } from '../queries/useCustomers';
import { useSuppliers } from '../queries/useSuppliers';
import { useProducts } from '../queries/useProducts';
import { DashboardDropzone } from '../components/DashboardDropzone';
import V1Dashboard from '../../pages/Dashboard';
import { getSupabaseClient } from '../../services/supabase';
import type { User, Role, Company } from '../../types';

// ─── Adapter: V2 session → V1 User shape ────────────────────────
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
        (parsed as { allowed_company_ids?: string[]; allowedCompanyIds?: string[] }).allowed_company_ids
        ?? (parsed as { allowedCompanyIds?: string[] }).allowedCompanyIds
        ?? undefined,
      allowed_modules: (parsed as { allowed_modules?: string[] }).allowed_modules,
    } as User;
  } catch {
    return null;
  }
};

const greetingForHour = (h: number): string =>
  h < 5 ? 'Burning the midnight oil' :
  h < 12 ? 'Good morning' :
  h < 17 ? 'Good afternoon' :
  h < 22 ? 'Good evening' :
           'Working late';

const firstName = (full: string): string => full.trim().split(/\s+/)[0] || '';

// ─── Dark-mode bridge for embedded V1 surface ──────────────────
// V1's chat / dropzone / WhatsApp widget render with light Tailwind
// classes (bg-white, text-slate-800, etc.). The CSS below remaps them
// to the V2 dark palette only when html.dark is active.
const DARK_SCOPE_STYLE = `
  html.dark .v2-dark-scope {
    color-scheme: dark;
    color: #e2e8f0;
    background: #0a0a0a;
  }
  html.dark .v2-dark-scope .bg-white,
  html.dark .v2-dark-scope .bg-slate-50,
  html.dark .v2-dark-scope .bg-slate-100 { background-color: #0a0a0a !important; }
  html.dark .v2-dark-scope .bg-slate-200 { background-color: #161616 !important; }
  html.dark .v2-dark-scope .bg-slate-800,
  html.dark .v2-dark-scope .bg-slate-900 { background-color: #0a0a0a !important; }
  html.dark .v2-dark-scope .text-slate-900,
  html.dark .v2-dark-scope .text-slate-800,
  html.dark .v2-dark-scope .text-slate-700 { color: #f1f5f9 !important; }
  html.dark .v2-dark-scope .text-slate-600 { color: #cbd5e1 !important; }
  html.dark .v2-dark-scope .text-slate-500 { color: #94a3b8 !important; }
  html.dark .v2-dark-scope .text-slate-400 { color: #64748b !important; }
  html.dark .v2-dark-scope .border-slate-100,
  html.dark .v2-dark-scope .border-slate-200 { border-color: #1f1f1f !important; }
  html.dark .v2-dark-scope .border-slate-300 { border-color: #2a2a2a !important; }
  html.dark .v2-dark-scope .divide-slate-100 > * + *,
  html.dark .v2-dark-scope .divide-slate-200 > * + * { border-color: #1f1f1f !important; }
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
  html.dark .v2-dark-scope textarea::placeholder { color: #475569 !important; }
  html.dark .v2-dark-scope .bg-blue-50,
  html.dark .v2-dark-scope .bg-indigo-50,
  html.dark .v2-dark-scope .bg-emerald-50,
  html.dark .v2-dark-scope .bg-amber-50 {
    background-color: rgba(79, 70, 229, 0.08) !important;
  }
  html.dark .v2-dark-scope .hover\\:bg-slate-100:hover,
  html.dark .v2-dark-scope .hover\\:bg-slate-50:hover,
  html.dark .v2-dark-scope .hover\\:bg-white:hover { background-color: #141414 !important; }
`;

const DashboardV2: React.FC = () => {
  const { currentCompanyId } = useCompany();
  const companiesQ = useCompanies();

  // Data hooks the V1 XS Agent expects in props. Without these the
  // agent reports "Customer creation not available." on intent matches.
  const customersQ = useCustomers();
  const suppliersQ = useSuppliers();
  const productsQ = useProducts();

  const currentUser = useMemo(readV1User, []);
  const userName = useMemo(() => firstName(currentUser?.name ?? ''), [currentUser]);
  const greeting = useMemo(() => greetingForHour(new Date().getHours()), []);

  const availableCompanies: Company[] = useMemo(
    () => (companiesQ.data ?? []).map(c => c as unknown as Company),
    [companiesQ.data],
  );

  // OCR save handlers — AiDashboard only auto-saves when the matching
  // prop is wired; without these the dropzone reports
  // "No save handler available for BILL OF LADING." after extracting.
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
  const onAddCustomer      = useMemo(() => makeAdder('customers'),        [makeAdder]);
  const onUpdateCustomer   = useMemo(() => makeUpdater('customers'),      [makeUpdater]);
  const onAddSupplier      = useMemo(() => makeAdder('suppliers'),        [makeAdder]);
  const onUpdateSupplier   = useMemo(() => makeUpdater('suppliers'),      [makeUpdater]);
  const onAddProduct       = useMemo(() => makeAdder('products'),         [makeAdder]);
  const onAddSalesOrder    = useMemo(() => makeAdder('sales_orders'),     [makeAdder]);
  const onAddPurchaseOrder = useMemo(() => makeAdder('purchase_orders'),  [makeAdder]);
  const onAddBooking       = useMemo(() => makeAdder('bookings'),         [makeAdder]);
  const onAddCargoAgent    = useMemo(() => makeAdder('cargo_agents'),     [makeAdder]);

  if (!currentUser) {
    return (
      <div className="text-[13px] text-slate-500">
        Signing in… refresh if this persists.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-3">
      <style dangerouslySetInnerHTML={{ __html: DARK_SCOPE_STYLE }} />

      {/* V2-styled greeting */}
      <div className="shrink-0 flex items-center gap-2">
        <LayoutDashboard size={18} className="text-indigo-300" />
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-100">
          {greeting}{userName ? `, ${userName}` : ''}
        </h1>
        <span className="text-slate-600">·</span>
        <span className="text-[13px] text-slate-500">
          {currentCompanyId === 'ALL' ? 'All companies' : `Company ${currentCompanyId}`}
        </span>
      </div>

      {/* V1 workspace — XS Agent chat on the left, file dropzone +
          WhatsApp on the right. Fills the remaining viewport so the
          chat list and WhatsApp message list both scroll naturally.
          hideInsights + hideHeader strip V1's own greeting and the
          Daily Briefing / Smart Suggestions strip so we don't double
          up with the V2 greeting above. */}
      <div className="flex-1 min-h-0">
        <div className="v2-dark-scope h-full">
          <V1Dashboard
            hideInsights
            hideHeader
            whatsAppHeader={<DashboardDropzone />}
            currentUser={currentUser}
            currentCompanyId={currentCompanyId}
            availableCompanies={availableCompanies}
            customers={customersQ.data ?? []}
            suppliers={suppliersQ.data ?? []}
            products={productsQ.data ?? []}
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
      </div>
    </div>
  );
};

export default DashboardV2;
