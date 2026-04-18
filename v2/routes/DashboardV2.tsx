// Phase 3B — v2 Dashboard embeds v1's Dashboard component directly.
//
// v1's Dashboard (pages/Dashboard.tsx) is a thin wrapper that renders
// the AI Agent assistant (AiDashboard), DailyBriefing,
// SmartSuggestionsBar and the WhatsAppChatWidget. Rebuilding those
// natively in v2 would be thousands of LOC; since both shells share
// the same bundle we just import the v1 component and render it inside
// a v2 wrapper that supplies the required auth / company context.
//
// The wrapper reads `xs_current_user` directly so v1 sees the same
// User shape it already expects. Ports + callbacks are stubbed — the
// AI agent keeps working against the live Supabase data it already
// fetches on its own; the CRUD callbacks only fire when the user asks
// the agent to create / update records, and will be wired to the v2
// mutation hooks in the next pass.

import React, { useMemo } from 'react';
import V1Dashboard from '../../pages/Dashboard';
import type { User, Role } from '../../types';
import { useCompany } from '../providers/CompanyProvider';
import { useCompanies } from '../queries/useCompanies';

const readV1User = (): User | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('xs_current_user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<User> & Record<string, unknown>;
    // v1 User requires a few fields — supply defaults if missing.
    return {
      id: String(parsed.id ?? ''),
      name: String(parsed.name ?? parsed.username ?? 'User'),
      username: String(parsed.username ?? parsed.name ?? ''),
      role: (parsed.role as Role) ?? ('USER' as Role),
      avatarInitials: typeof parsed.avatarInitials === 'string' && parsed.avatarInitials
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
        Signing in… if this persists, open Settings → refresh the page.
      </div>
    );
  }

  // v1 Dashboard owns its own padding / overflow, so we wrap in a
  // light-themed isolation box so its Tailwind classes don't collide
  // with v2's dark shell. The negative margin cancels AppShell's
  // `p-6` so the embed stretches to the viewport.
  return (
    <div className="-m-6 h-[calc(100vh-3.5rem)] bg-slate-50 text-slate-900 overflow-hidden">
      <div className="h-full p-4 flex flex-col overflow-hidden">
        <V1Dashboard
          currentUser={currentUser}
          currentCompanyId={currentCompanyId}
          availableCompanies={availableCompanies}
          // Data arrays — passed empty for now. AiDashboard falls back
          // to reading from Supabase directly inside its own hooks, so
          // the chat still has full context even without these props.
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
    </div>
  );
};

export default DashboardV2;
