// Phase 3B — v2 Dashboard.
//
// Minimalist pass-through: v1's Dashboard component owns the entire
// surface (header, Daily Briefing, Smart Suggestions, AI agent,
// WhatsApp). The v2 route contributes only the dark-mode bridge that
// re-maps v1's light Tailwind classes to the v2 palette, plus the
// sessionStorage → v1 User adapter. No duplicate titles, no static
// insight pills, no placeholder quick-actions.

import React, { useMemo } from 'react';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';
import { DashboardDropzone } from '../components/DashboardDropzone';
import V1Dashboard from '../../pages/Dashboard';
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

const DARK_SCOPE_STYLE = `
  .v2-dark-scope {
    color-scheme: dark;
    color: #e2e8f0;
    background: #0a0a0a;
  }
  .v2-dark-scope .bg-white,
  .v2-dark-scope .bg-slate-50,
  .v2-dark-scope .bg-slate-100 {
    background-color: #0a0a0a !important;
  }
  .v2-dark-scope .bg-slate-200 {
    background-color: #161616 !important;
  }
  .v2-dark-scope .bg-slate-800,
  .v2-dark-scope .bg-slate-900 {
    background-color: #0a0a0a !important;
  }
  .v2-dark-scope .text-slate-900,
  .v2-dark-scope .text-slate-800,
  .v2-dark-scope .text-slate-700 {
    color: #f1f5f9 !important;
  }
  .v2-dark-scope .text-slate-600 {
    color: #cbd5e1 !important;
  }
  .v2-dark-scope .text-slate-500 {
    color: #94a3b8 !important;
  }
  .v2-dark-scope .text-slate-400 {
    color: #64748b !important;
  }
  .v2-dark-scope .border-slate-100,
  .v2-dark-scope .border-slate-200 {
    border-color: #1f1f1f !important;
  }
  .v2-dark-scope .border-slate-300 {
    border-color: #2a2a2a !important;
  }
  .v2-dark-scope .divide-slate-100 > * + *,
  .v2-dark-scope .divide-slate-200 > * + * {
    border-color: #1f1f1f !important;
  }
  .v2-dark-scope .shadow,
  .v2-dark-scope .shadow-sm,
  .v2-dark-scope .shadow-md,
  .v2-dark-scope .shadow-lg,
  .v2-dark-scope .shadow-xl {
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.02) inset !important;
  }
  .v2-dark-scope input,
  .v2-dark-scope textarea,
  .v2-dark-scope select {
    background-color: #0f0f0f !important;
    color: #e2e8f0 !important;
    border-color: #1f1f1f !important;
  }
  .v2-dark-scope input::placeholder,
  .v2-dark-scope textarea::placeholder {
    color: #475569 !important;
  }
  .v2-dark-scope .bg-blue-50,
  .v2-dark-scope .bg-indigo-50,
  .v2-dark-scope .bg-emerald-50,
  .v2-dark-scope .bg-amber-50 {
    background-color: rgba(79, 70, 229, 0.08) !important;
  }
  .v2-dark-scope .hover\\:bg-slate-100:hover,
  .v2-dark-scope .hover\\:bg-slate-50:hover,
  .v2-dark-scope .hover\\:bg-white:hover {
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
      <div className="v2-dark-scope h-full">
        <V1Dashboard
          hideInsights
          hideHeader
          whatsAppHeader={<DashboardDropzone />}
          currentUser={currentUser}
          currentCompanyId={currentCompanyId}
          availableCompanies={availableCompanies}
          customers={[]}
          suppliers={[]}
          products={[]}
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
        />
      </div>
    </>
  );
};

export default DashboardV2;
