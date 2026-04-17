# XS-AI-V12 Frontend Audit: Ground-Up Rebuild with shadcn/ui + Tailwind + TanStack Query + Zustand

**Audit Date:** April 17, 2026  
**Scope:** Lines of Code analysis, state propagation mapping, server-state patterns, rebuild strategy  
**Goal:** Safe, module-by-module migration path from React 18 + useState/prop-drilling to modern stack

---

## 1. Page LOC Ranking (Top 20)

All files under `/Users/felipeneublum/Desktop/XS-AI-V12/pages/*.tsx`

| Rank | File | LOC | Rebuild Priority | Difficulty Note |
|------|------|-----|------------------|-----------------|
| 1 | SOPICIComissions.tsx | 9,945 | **LAST** | 137x useState: multi-step wizard (PROPOSAL→UPLOAD_CONTRACT→CREATE_PROFORMA→UPLOAD_PL→EDIT_PL→CREATE_INVOICE) mixing document upload, packing list edit, invoice generation, email composition, PDF export. Extreme state chaining. |
| 2 | PLInvoiceEngine.tsx | 5,943 | **LAST** | 78x useState: packing list + invoice creation + AI augmentation. Heavy PDF/Excel export logic interleaved. Form mutations cascade across sub-modules. |
| 3 | CostProfitAI.tsx | 5,071 | **LAST** | 118x useState: cost calculation wizard with 4+ parallel form states (sheet, import, export, local). Supplier quote→cost calc→freight quote→sales order chaining. AI enrichment at each step. |
| 4 | InvoiceEngine.tsx | 3,764 | **LAST** | 51x useState: list + detail + form in one. Inline editing, multi-currency, payment terms auto-fetch, bank details, PDF generation, email send. No view-mode separation. |
| 5 | Commissions.tsx | 3,626 | **REBUILD 2** | 29x useState: commission rule engine + sales order filter + commission calc. Moderate coupling but self-contained. |
| 6 | FreightQuotes.tsx | 3,206 | **REBUILD 2** | 24x useState: quote request + quote response + carrier selection. Moderate complexity, good service boundary. |
| 7 | Logistics.tsx | 2,964 | **REBUILD 1** | 27x useState: shipment tracking + booking list + carrier interface. Heavy prop drilling (currentCompanyId, currentUser, ports, carriers). Candidate for early extraction. |
| 8 | SalesOrders.tsx | 2,826 | **REBUILD 1** | 53x useState: order list + detail form + workflow triggers + fulfillment check. Imports 22+ types, 8+ data arrays. Heavy interdependency but core to sales flow. Mixes view modes. |
| 9 | PLEngine.tsx | 2,179 | **REBUILD 3** | 18x useState: packing list simple CRUD + PDF. Lower risk. |
| 10 | CalculationSheet.tsx | 2,154 | **REBUILD 2** | 16x useState: cost sheet with editable rows. Isolated calculation logic. |
| 11 | ShipmentPipeline.tsx | 1,999 | **REBUILD 2** | 14x useState: kanban-style shipment view. Self-contained, single data source. |
| 12 | AiEmailAssistant.tsx | 1,966 | **REBUILD 3** | Service integration (Gemini + email send). Light state, heavy external API coupling. |
| 13 | AiDashboard.tsx | 1,924 | **LAST** | 42x useState: dashboard with 8+ card widgets, AI briefing, suggestions. Monolithic render tree. All state is at top level. |
| 14 | AiLogisticsManager.tsx | 1,676 | Defer | AI agent + shipment data. Can wait until Logistics refactored. |
| 15 | FinancePayables.tsx | 1,542 | **REBUILD 3** | 11x useState: payment list + form. Straightforward. |
| 16 | FinanceReceivables.tsx | 1,480 | **REBUILD 3** | 10x useState: invoice receivables. Straightforward. |
| 17 | PurchaseOrders.tsx | 1,418 | **REBUILD 2** | 15x useState: PO list + detail + lineitem editing. Moderate. |
| 18 | SalesFollowUp.tsx | 1,321 | **REBUILD 3** | 8x useState: follow-up task tracking. Low complexity. |
| 19 | LogisticsDocuments.tsx | 1,235 | **REBUILD 2** | 9x useState: doc list + preview. Clean separation. |
| 20 | AiEmailProcessor.tsx | 1,219 | **REBUILD 3** | 7x useState: email ingestion wrapper. Service-driven. |

**Pages/Components LOC Summary (top-level root):**
- **Root-level files:** App.tsx (1,595 LOC) + types.ts (884 LOC) = 2,479 LOC
- **Pages/** total: 85,508 LOC
- **Components/** total: 5,176 LOC
- **Grand total (excluding node_modules):** ~93,000 LOC

---

## 2. Component LOC Ranking (Top 10)

All files under `/Users/felipeneublum/Desktop/XS-AI-V12/components/*.tsx`

| Rank | File | LOC | Rebuild Priority | Difficulty Note |
|------|------|-----|------------------|-----------------|
| 1 | WhatsAppChatWidget.tsx | 735 | **LAST** | Heavy third-party integration (WhatsApp API). Extract to feature flag. |
| 2 | TalkingAvatar.tsx | 600 | **LAST** | ElevenLabs integration + animation state. AI-driven, can wait. |
| 3 | Dock.tsx | 540 | **REBUILD 3** | Sidebar dock/menu. Self-contained, good candidate for shadcn Sidebar component. |
| 4 | AiCopilotSidebar.tsx | 432 | **REBUILD 3** | AI chat interface. Heavy service integration. Extract after core pages. |
| 5 | TopNavigation.tsx | 422 | **REBUILD 1** | Root nav bar. Drilled: currentUser, currentCompanyId, activeModule, handlers. Needs Provider extraction early. |
| 6 | PDFPreviewModal.tsx | 307 | **REBUILD 2** | PDF modal wrapper. Service boundary clear (jsPDF). Low risk. |
| 7 | HelpCenter.tsx | 298 | **REBUILD 3** | Help UI + modal. Isolated, low priority. |
| 8 | NotificationCenter.tsx | 282 | **REBUILD 3** | Notification toast list. Extract to toast library early (shadcn/ui toast). |
| 9 | PendingDocsBanner.tsx | 235 | **REBUILD 2** | Banner component. Simple conditional render. |
| 10 | WorkflowWizard.tsx | 233 | **REBUILD 2** | Multi-step wizard scaffold. Reusable, low LOC. |

---

## 3. App.tsx Anatomy

**File:** `/Users/felipeneublum/Desktop/XS-AI-V12/App.tsx` (1,595 LOC)

### Section Breakdown

**Lines 1–42: Lazy Loading & Code-Split Setup**
- `lazyWithRetry()` wrapper handles stale-cache auto-reload on deploy
- 30+ lazy-loaded page components
- **Belongs in:** `<Router />` provider or Vite dynamic imports with error boundary

**Lines 134–142: Authentication State**
- `currentUser` (restored from sessionStorage)
- `dbConnectionStatus` check
- **Belongs in:** `<AuthProvider />` context → Zustand auth store

**Lines 144–150: Navigation State**
- `activeModule`, `subModule`, `currentCompanyId`
- `pendingCalcOffer`, `pendingEditOfferId`, `costViewMode`
- **Belongs in:** Zustand navigation store

**Lines 152–154: Help/Sidebar UI State**
- `showHelp`, `showAiSidebar`
- **Belongs in:** Zustand UI store

**Lines 156–227: Server-State (useSupabase Hooks)**
- 32+ `useSupabase<T>()` calls covering users, companies, customers, suppliers, products, ports, banks, etc.
- Lazy-enabled: opportunities, costCalculations, supplierQuotes, shipments, documents, commissions
- **Total data fetched in App.tsx:** ~50 arrays at any time
- **Belongs in:** TanStack Query (React Query) with shared `queryClient`
  - Each table → one query key family (e.g., `['users']`, `['customers', { companyId }]`)
  - useSupabase hook → wrap TQ `useQuery`, `useMutation`

**Lines 230–243: Effects (refetch on navigation, auto-backup)**
- Supabase connection check
- Auto-backup trigger for ADMIN users
- **Belongs in:** TanStack Query refetch policies + background task store

**Lines 245–289: Auth Handlers (login/logout + activity logging)**
- `handleLogin()` → sets user, sessionStorage, clears chat, routes to role-specific home
- `handleLogout()` → flushes activity log
- **Belongs in:** `<AuthProvider />` or Zustand auth actions

**Lines 297–325: Data Filter Functions**
- `filterByCompany()`, `filterByCompanyStrict()`, `filterByProductCategory()`, `filterSalesOrdersByCreator()`, `filterOpportunitiesBySales()`, `filterCommissionsBySales()`, `filterCustomersBySales()`
- **Current**: Applied in useMemo after fetch (client-side filtering)
- **Belongs in:** TanStack Query select/enabled options (server-side filtering via Supabase RLS + prepared queries)

**Lines 363–401: Memoized Filtered Data**
- 40+ `useMemo()` blocks re-filtering data based on `currentCompanyId`, `currentUser`
- Example: `mCustomers = useMemo(() => filterByCompany(customers.data), [customers.data, currentCompanyId])`
- **Current**: Expensive if datasets are large; causes waterfall renders
- **Belongs in:** TanStack Query `select` callbacks + Zustand selector memoization

**Lines 414–1595: renderContent() Switch**
- Monster switch statement routing 50+ pages
- Each case drills 10–30 props to the page component
- Example (Dashboard case): 50+ props including all data arrays + CRUD callbacks

### Key Issues Identified

1. **Root Prop Drilling:** Dashboard, SalesOrders, InvoiceEngine each receive 40+ props from App.tsx
2. **No Provider Pattern:** currentUser, currentCompanyId passed as props through entire tree
3. **useSupabase in App:** All 32 data hooks live in root, making App.tsx 1,595 LOC
4. **No Query Deduplication:** If two pages both use `customers` data, both must receive it as prop

---

## 4. State Propagation Map

### Worst Offenders (3+ levels deep)

**currentCompanyId**
- Location: App.tsx (useState)
- Drilled to: TopNavigation, Sidebar, Dock, **53 pages**
- Count: ~60 files reference it
- **Solution**: Zustand `useCompanyStore().currentCompanyId` or TQ query filter

**currentUser**
- Location: App.tsx (useState)
- Drilled to: TopNavigation, AiCopilotSidebar, **50+ pages**
- Sub-properties accessed: `.id`, `.role`, `.name`, `.allowed_company_ids`, `.allowed_product_categories`
- Count: ~55 files
- **Solution**: Zustand `useAuthStore().user` or context provider

**availableCompanies**
- Drilled to: 30+ pages for company selector dropdowns
- Count: ~35 files
- **Solution**: TQ query `useCompanies()` or Zustand store

**Memoized Data Arrays (customers, suppliers, products, etc.)**
- Each array is re-drilled to 5–15 pages
- Example: `mCustomers` → Customers.tsx, SalesOrders.tsx, Commissions.tsx, Dashboard.tsx, AiDashboard.tsx (5 copies of same prop drilling)
- **Current depth:** App.tsx → TopNavigation.tsx → Sidebar.tsx → NavItem.tsx (3 levels)
- **Solution**: Remove drilling entirely; use TQ `useQuery('customers', ...)` in each page

### Sample Drill Chain

```
App.tsx
  └─ renderContent() → SalesOrders component
      └─ SalesOrders props: currentUser, currentCompanyId, customers, suppliers, products, bookings, ports, invoices, banks
          └─ OrderForm sub-component (internal, no re-drill)
              └─ CustomerSelector sub-component (accesses customers via parent prop)
                  └─ CustomerOption list item (accesses customer via parent prop)
```

**Depth:** 3 levels (App → SalesOrders → OrderForm)  
**Props at SalesOrders level:** 18 (see line 40-61 of pages/SalesOrders.tsx)

---

## 5. Server-State Patterns

### Current Approach: Custom useSupabase Hook

**Location:** `/Users/felipeneublum/Desktop/XS-AI-V12/hooks/useSupabase.ts` (284 LOC)

**Call Sites:**
- App.tsx: 32 instances
- SalesOrders.tsx: 4 instances (custom queries for linked invoices)
- FreightQuotes.tsx: 2 instances
- AdminBranding.tsx: 3 instances
- 6 other files with inline `supabase.from()` calls

**Total direct Supabase calls:** ~26 (grep result)  
**Total useSupabase calls:** ~106 (heavily in App.tsx)

### Features of useSupabase

✅ Pagination support (pageSize, loadMore)  
✅ Enabled/lazy-load flag  
✅ Optimistic updates  
✅ Activity logging integration  
✅ Basic error handling + schema error detection  
✅ Deduplication by id

### Gaps (TanStack Query advantages)

❌ No automatic refetch on focus/reconnect  
❌ No cache invalidation strategy  
❌ No request deduplication (multiple useSupabase('customers') calls = multiple fetches)  
❌ No background sync  
❌ No dev tools for debugging state updates  
❌ No built-in offline support

### Duplicated Fetch Patterns

1. **Fetch in App.tsx, re-fetch in page:** SalesOrders.tsx calls `useSupabase('sales_orders')` again despite App.tsx already fetching it.
2. **Inline Supabase calls:** FinancePayables.tsx, FinanceReceivables.tsx, emailAgentService.ts each do `supabase.from(table).select()` instead of using useSupabase.
3. **Filter logic repeated:** Each page re-implements `filterByCompany()`, `filterBySalesRole()` locally instead of centralizing.

---

## 6. Rebuild Order Recommendation

### Phase 0: Foundational (Non-Page)
1. **Auth Provider** (Zustand + context) — replace App.tsx auth state
2. **Navigation Store** (Zustand) — replace activeModule, subModule, currentCompanyId
3. **TanStack Query** setup — create queryClient, hooks for each table
4. **shadcn/ui** component lib imported — Button, Card, Dialog, etc.

### Phase 1: Rebuild First (Smallest, Lowest Risk, High Value)

**1. Logistics.tsx (2,964 LOC, 27 useState)**
- Why: Core shipment page, self-contained UI, moderate data deps
- Depends on: shipments, bookings, carriers, ports (all in App.tsx already)
- Risk: Low. Single domain (logistics flow).
- Rebuild path: Extract shipment list → detail view → TQ useQuery('shipments', { companyId }) → shadcn/ui Table for list
- **Estimated effort:** 3–4 days

**2. Dashboard.tsx (215 LOC, minimal state)**
- Why: Entry point, low LOC, mostly child component composition
- Depends on: AiDashboard + other sub-components
- Risk: Very low. Wrapper page.
- Rebuild path: Keep as router entry, extract AiDashboard independently
- **Estimated effort:** 1 day

**3. FreightQuotes.tsx (3,206 LOC, 24 useState)**
- Why: Self-contained domain (quotes only), good service boundary (quotation logic)
- Depends on: suppliers, products, ports, carriers (all core data)
- Risk: Low. No cross-page state.
- Rebuild path: List → detail → quote form → TQ mutations
- **Estimated effort:** 4–5 days

### Phase 2: Rebuild Second (Medium Complexity, Strategic Value)

**1. SalesOrders.tsx (2,826 LOC, 53 useState)**
- Why: Core sales flow, high strategic value, but heavy interdependency
- Depends on: customers, products, bookings, invoices, banks, ports, payment terms, AI enrichment
- Risk: Medium. Order→Invoice cascade, workflow triggers.
- Rebuild path: Separate list, detail, form. Extract workflow hook to Zustand. Implement fulfillment check via TQ query.
- **Estimated effort:** 5–7 days

**2. Commissions.tsx (3,626 LOC, 29 useState)**
- Why: Self-contained domain, clear business logic (rule engine + calc)
- Depends on: sales_orders, customers, commission_rules
- Risk: Medium. Rule evaluation state chaining.
- Rebuild path: Filter state → rule list → calc results → TQ mutations
- **Estimated effort:** 4–5 days

**3. CalculationSheet.tsx (2,154 LOC, 16 useState)**
- Why: Isolated component, single responsibility
- Depends on: cost_calculations, products
- Risk: Low.
- **Estimated effort:** 3 days

### Phase 3: Rebuild Last (Highest Risk, Longest Pages)

**1. SOPICIComissions.tsx (9,945 LOC, 137 useState)**
- Why: **EXTREME** complexity. 6-step wizard. Document upload → packing list → invoice → email composition → PDF → SQL insert.
- Depends on: All core data + AI (Gemini) + PDF libs (jsPDF) + email service
- Risk: **CRITICAL**. Cascading state mutations. Any bug breaks entire commission flow.
- Rebuild strategy:
  - Do NOT attempt as monolith
  - Extract each wizard step as separate form component
  - Use React Hook Form + Zod for validation per step
  - Store wizard state in Zustand (not component useState)
  - Only rebuild AFTER Commissions, SalesOrders, InvoiceEngine are stable
- **Estimated effort:** 15–20 days (must break into 6 sub-tasks)

**2. PLInvoiceEngine.tsx (5,943 LOC, 78 useState)**
- Why: Heavy state chaining. Packing list edit → invoice generation → validation → PDF/email
- Depends on: packing_lists, invoices, cost_calculations, AI services, PDF libs
- Risk: **CRITICAL**. One state change cascades through form.
- Rebuild strategy:
  - Extract PackingListEditor, InvoiceLineItemForm, PDFPreview as separate components
  - Use React Hook Form per sub-form
  - Zustand for multi-step state
  - Implement only AFTER SalesOrders refactored
- **Estimated effort:** 12–15 days

**3. InvoiceEngine.tsx (3,764 LOC, 51 useState)**
- Why: List + detail + form merged. Multi-currency, payment terms, PDF, email, inline editing.
- Depends on: invoices, companies, banks, payment_terms, customers, AI services
- Risk: **HIGH**. Inline editing + form state mixed.
- Rebuild strategy:
  - Separate InvoiceList (TQ), InvoiceDetail (read-only), InvoiceEditForm (React Hook Form)
  - Use shadcn/ui Sheet for drawer edit view
  - PDF/email as services, not state
- **Estimated effort:** 8–10 days

**4. CostProfitAI.tsx (5,071 LOC, 118 useState)**
- Why: 4+ parallel form modes (sheet, import, export, local). Each mode has separate state tree.
- Depends on: cost_calculations, suppliers, products, freight_quotes, sales_orders, AI services
- Risk: **CRITICAL**. State mode switching = prop hell.
- Rebuild strategy:
  - Create separate route for each mode (e.g., `/cost/sheet`, `/cost/import`, `/cost/export`)
  - Use Zustand for form state per mode
  - Shared validation schema
- **Estimated effort:** 14–18 days

---

## 7. Feature-Flag Strategy: v2 Tree Deployment

### Proposal: URL-Based Feature Flag with Dual-Mount

**Flag:** `?v2=1` query parameter  
**Entry Point:** `index.tsx` (line 13, already has popup detection logic)  
**Pattern:**

```tsx
// index.tsx (updated)
const isV2Mode = new URLSearchParams(window.location.search).get('v2') === '1';

if (isV2Mode) {
  // Mount AppV2.tsx (new shadcn/ui + Zustand + TQ tree)
  root.render(<AppV2 />);
} else {
  // Keep existing App.tsx
  root.render(<App />);
}
```

### Shared Resources (v1 ↔ v2)

| Resource | Strategy | Rationale |
|----------|----------|-----------|
| **Auth** | Shared sessionStorage key + context bridge | User must not re-login when switching |
| **Supabase Client** | Shared `services/supabase.ts` getSupabaseClient() | Single RLS policy, single connection |
| **Types** | Shared `/types.ts` | Single source of truth for domain models |
| **Constants** | Shared `/constants.ts` | PAYMENT_TERM_OPTIONS, etc. |
| **Icons** | lucide-react (both use) | No change |
| **Tailwind** | Shared Tailwind CDN (index.html) + shadcn/ui defaults | v2 adds shadcn components, v1 unchanged |

### Duplicated Resources per Tree (v1 only / v2 only)

| Resource | v1 (Existing) | v2 (Rebuilt) | Reason |
|----------|---------------|--------------|--------|
| **Stores** | useState props | Zustand stores | Different state management |
| **Queries** | useSupabase hooks | TanStack Query hooks | Different server-state approach |
| **Form handling** | Inline onChange + useState | React Hook Form + Zod | Different patterns |
| **Components** | Existing in /components | shadcn/ui + new in /components/v2 | Different design system |
| **Pages** | /pages/Dashboard.tsx | /pages/v2/Dashboard.tsx | Can't share monolithic pages |
| **Router** | In App.tsx (Router component) | React Router v6 in AppV2.tsx | Different routing approach |

### Transition Path

1. **Week 1–2:** Build AppV2 + Zustand stores + TQ setup in parallel
2. **Week 3:** Rebuild 2–3 small pages (Logistics, Dashboard, FreightQuotes) behind flag
3. **Week 4–6:** Rebuild medium pages (SalesOrders, Commissions) + add inter-page navigation
4. **Week 7–10:** Rebuild giant pages (CostProfitAI, InvoiceEngine, PLInvoiceEngine)
5. **Week 11–12:** User testing + bug fixes
6. **Week 13:** Flip flag to `?v2=1` as default; v1 remains as `?v2=0` fallback
7. **Week 14–15:** Monitor, collect feedback, deprecate v1

### Navigation Between v1 ↔ v2

**Goal:** Users can test v2 for specific pages, fall back to v1 for unbuilt pages

**Implementation:**

```tsx
// In AppV2.tsx, if page not built:
<Link to={`/?v2=0&module=UNBUILT_PAGE`}>
  Switch to v1 for this page
</Link>

// In App.tsx, if page is tested in v2:
<Link to={`/?v2=1&module=REBUILT_PAGE`}>
  Try new v2 for this page
</Link>
```

---

## 8. Quick Reference: Migration Checklist

### Before You Start
- [ ] Backup current App.tsx (→ App.v1.tsx)
- [ ] Create AppV2.tsx skeleton
- [ ] Set up Zustand stores (auth, nav, ui, forms)
- [ ] Set up TanStack Query queryClient
- [ ] Install shadcn/ui + dependencies

### Per-Page Rebuild
- [ ] Extract page component to `/pages/v2/ComponentName.tsx`
- [ ] Replace useSupabase with TQ hooks
- [ ] Replace useState with Zustand stores
- [ ] Replace custom inputs with shadcn/ui components
- [ ] Migrate form handling to React Hook Form
- [ ] Test behind `?v2=1` flag
- [ ] Verify data filtering (RLS, not client-side)

### Post-Rebuild
- [ ] Merge v1 + v2 navigation
- [ ] Monitor error logs
- [ ] Deprecate v1 after 4–6 weeks
- [ ] Remove old files, commit cleanup

---

## 9. Key Metrics & Summaries

| Metric | Value | Notes |
|--------|-------|-------|
| **Total LOC (Pages)** | 85,508 | 70 files |
| **Total LOC (Components)** | 5,176 | 18 files |
| **App.tsx LOC** | 1,595 | Root shell, monster switch statement |
| **Avg LOC per page** | 1,222 | Range: 41 (MyMailProcessorPage) → 9,945 (SOPICIComissions) |
| **Avg useState per page** | ~20 | Range: 1 → 137 |
| **Data arrays in App.tsx** | 32+ | All fetched via useSupabase |
| **Prop drilling depth** | 3–4 levels | currentUser, currentCompanyId worst offenders |
| **Files using currentCompanyId** | ~60 | ~90% of codebase |
| **Files using currentUser** | ~55 | ~85% of codebase |
| **useSupabase call sites** | ~106 | Mostly App.tsx (32), some pages (custom queries) |
| **Direct supabase.from() calls** | ~26 | Finance pages, email service, edge functions |
| **Custom filter functions** | 7 | Repeated client-side filtering logic |
| **Estimated rebuild time (v2 complete)** | 15–20 weeks | 3 devs, parallel on different pages |

---

## 10. Surprise Findings

1. **Tailwind via CDN, not PostCSS:** index.html loads `https://cdn.tailwindcss.com` script. This means:
   - No `tailwind.config.js` processing
   - Config is hardcoded in `<script>` block in index.html
   - shadcn/ui (which expects PostCSS + config.js) will need build-time setup
   - **Action:** Migrate to Vite + Tailwind PostCSS during v2 setup

2. **No React Router:** App.tsx uses custom switch-case routing, not React Router. Pages are lazy-loaded with custom `lazyWithRetry()`.
   - **Impact:** v2 should adopt React Router v6 for consistency with modern React patterns
   - **Risk:** Navigation state stored in App.tsx useState, not URL

3. **No Context Providers:** Despite 50+ pages receiving 40+ props each, there are NO context providers. Only 1 MsalProvider in MyEmailProcessor.
   - **Implication:** Auth, company, user all drilled as props
   - **Solution:** Implement AuthProvider + CompanyProvider early in rebuild

4. **Supabase RLS disabled (likely):** All filtering is client-side (in App.tsx useMemo, or in pages). No evidence of RLS policies in code.
   - **Risk:** Data leakage if user roles are not enforced server-side
   - **Action:** Implement Supabase RLS policies before deploying TQ queries that assume server-side filtering

5. **Gemini API called directly from pages:** Many pages call `generateCustomerDescription()`, `analyzeDocument()` from Gemini service. These services fetch from Gemini, not Supabase Edge Functions.
   - **Discovery:** No API key is in the client (good). Edge functions likely relay, but not documented in this audit.
   - **Action:** Verify Gemini calls go through Supabase Edge Functions, not client.

6. **Activity logging integrated deeply:** `activityLogger` (from `services/activityLogService.ts`) is called in:
   - useSupabase.ts (on every CRUD)
   - App.tsx (on login/logout/nav)
   - ~10 pages (on specific actions)
   - **Impact:** Every rebuild must preserve activity logging. Consider adding as middleware in TQ mutationFn.

7. **Session storage used for user state:** `sessionStorage.setItem('xs_current_user', ...)` on login. Persists across page reloads within same tab, cleared on tab close.
   - **Implication:** No persistent login across sessions (good for security). v2 should do the same.

---

## 11. Rebuild Success Criteria

A rebuilt page is **complete** when:

1. ✅ Page works identically to v1 (visual + functional parity)
2. ✅ Zustand store holds all UI state (no useState)
3. ✅ TanStack Query holds all server state (no useSupabase)
4. ✅ React Hook Form manages all forms (no onChange handlers)
5. ✅ shadcn/ui components used for 90%+ of UI (not custom Tailwind)
6. ✅ Zero prop drilling (all state via hooks)
7. ✅ Data filtering by Supabase RLS (not client-side filter functions)
8. ✅ Activity logging preserved (TQ mutation middleware)
9. ✅ Error boundaries in place (shadcn/ui + Zod validation)
10. ✅ Passes manual testing behind `?v2=1` flag with 3+ users

---

## 12. Files to Review During Rebuild

**Core files (read/understand before starting):**
- `/App.tsx` — understand current prop drilling & state mgmt
- `/hooks/useSupabase.ts` — understand pagination, optimistic updates, error handling
- `/types.ts` — all domain models (TypeScript interfaces)
- `/pages/Dashboard.tsx` — simplest page (good template)
- `/pages/SalesOrders.tsx` — medium complexity (good reference)
- `/services/supabase.ts` — Supabase client factory
- `/services/activityLogService.ts` — logging integration
- `/constants.ts` — shared constants (payment terms, etc.)
- `index.html` — Tailwind config, CSP, imports

**Support services (used by multiple pages):**
- `/services/geminiService.ts` — AI enrichment
- `/services/emailService.ts` — send email
- `/services/backupService.ts` — auto-backup on interval
- `/services/memoryService.ts` — clear session storage

---

**Document Version:** 0.1  
**Last Updated:** April 17, 2026  
**Maintainer:** Frontend Rebuild Task Force  
