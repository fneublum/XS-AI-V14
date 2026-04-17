# Phase 3A — Frontend v2 scaffold

**Status:** SCAFFOLD (opt-in via `?v2=1` query param)
**Nothing in v1 changes.** The existing App.tsx, all pages, all components keep working as-is.

## Why a parallel mount

The v1 app is 85,508 LOC across 70 pages with the three heaviest files (SOPICIComissions, PLInvoiceEngine, CostProfitAI) exceeding 5,000 LOC each. Rewriting in place would churn the whole team and break production. A parallel v2 shell at `?v2=1` lets us:

1. Build new primitives without touching v1.
2. Port one page at a time behind the flag.
3. Compare v1 vs v2 screens side-by-side during development.
4. Flip the flag to default on when v2 covers the critical path.

## Stack

- **shadcn/ui** — copy-in primitives (not a runtime dep), built on Radix.
- **Radix UI** — unstyled, accessible primitives.
- **Tailwind v3** — utility CSS. Compiled at build time, not loaded from CDN.
- **TanStack Query v5** — server state + caching.
- **Zustand v4** — client UI state.
- **react-router v6** — routing (v1 uses a bespoke nav config).

## Directory layout

```
v2/
├── AppV2.tsx                     — top-level shell (≈ 150 LOC replacement for 1595-LOC App.tsx)
├── tokens/                       — design tokens (colors, spacing, type)
│   └── tailwind.config.ts        — imported by Tailwind
├── primitives/                   — accessible UI primitives (button, input, table, modal, toast, form)
├── providers/                    — query client, theme provider, auth provider
├── state/                        — Zustand stores (UI state only; server state → TanStack)
├── queries/                      — TanStack Query hooks (thin wrappers over Supabase RPC/REST)
└── routes/                       — lazy-loaded route components (each page = one file)
```

## How `?v2=1` works

`index.tsx` checks `new URLSearchParams(location.search).get('v2') === '1'` and dynamic-imports either `./App` (v1) or `./v2/AppV2` (v2). Neither bundle pulls in the other — code splitting isolates them.

## What's in this scaffold

- Design tokens (3 files).
- Six primitives (Button, Input, Table, Modal, Toast, Form).
- QueryClientProvider + a single example query hook.
- Zustand UI store (sidebar collapsed, theme).
- AppV2 shell with a single `/dashboard` placeholder route.

## What's NOT in this scaffold

- No page migrations. Porting individual v1 pages is Phase 3B/C work.
- No real data wiring beyond the example query.
- No Tailwind build configuration changes — v2's tokens are authored but
  Tailwind still loads from CDN in v1. Phase 3B plans to bundle Tailwind
  at compile time and drop the CDN script.
- No `shadcn` CLI install. The primitives are hand-written minimal
  versions that match the shadcn API so we can swap to real shadcn later.

## Turn-on checklist

1. Add `@radix-ui/react-*`, `@tanstack/react-query`, `zustand`, `react-router-dom` to package.json dependencies.
2. Install Tailwind v3 locally and switch `index.html` to build-time CSS (drop the CDN).
3. Port one low-risk page (e.g. Dashboard) into `v2/routes/Dashboard.tsx`.
4. QA side-by-side with `?v2=1` toggle.
5. Repeat per Phase 3B migration order (rebuild-first list from the frontend audit).
