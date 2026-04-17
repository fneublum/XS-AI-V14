# Phase 3A — Frontend Rebuild Foundation scaffold

**Status:** SCAFFOLD (opt-in via `?v2=1`)
**Entry point:** `v2/AppV2.tsx`
**No v1 behavior changes.** `App.tsx` untouched.

## Shipped

```
v2/
├── AppV2.tsx                        — shell, ≈ 35 LOC
├── README.md                        — how the parallel mount works
├── tokens/
│   ├── colors.ts                    — brand/neutral/status palette
│   ├── spacing.ts                   — 4px base scale
│   ├── typography.ts                — Inter + Roboto Mono
│   └── index.ts
├── primitives/
│   ├── Button.tsx                   — shadcn-compatible API, 5 variants, 3 sizes
│   ├── Input.tsx                    — invalid-state aware
│   ├── Table.tsx                    — presentational; logic → Phase 3B
│   ├── Modal.tsx                    — keyboard + backdrop dismissal
│   ├── Toast.tsx                    — provider + useToast() hook
│   ├── Form.tsx                     — FormField / Label / Description / ErrorText
│   ├── utils.ts                     — cn() helper
│   └── index.ts
├── providers/
│   ├── AuthProvider.tsx             — reads v1 session (temporary)
│   ├── CompanyProvider.tsx          — current-company context
│   └── QueryProvider.tsx            — TanStack-Query stub
├── state/
│   └── uiStore.ts                   — Zustand-compatible minimal store
├── queries/
│   └── useCustomers.ts              — example query hook using Supabase directly (stub)
└── routes/
    └── DashboardV2.tsx              — placeholder route
```

## Wiring change

`index.tsx` checks `?v2=1` and lazy-loads `./v2/AppV2` instead of `./App`. If the flag is absent, v2 bundle never downloads.

## Deliberate non-goals for Phase 3A

- **No npm installs.** The scaffold compiles against only what v1 already ships (React 19, TypeScript). Adding `@tanstack/react-query`, `zustand`, `@radix-ui/react-*`, `react-router-dom`, `tailwindcss`, `class-variance-authority`, `tailwind-merge`, `clsx` is Phase 3B's first commit.
- **No shadcn CLI install.** Primitives are hand-written with shadcn-compatible props so a later `npx shadcn add button dialog toast form input table` can overwrite these files without touching consumer code.
- **No page migrations.** See the rebuild-first list in `FRONTEND_AUDIT.md` (Logistics / Dashboard / FreightQuotes) for the intended order.
- **No Tailwind build config.** v2 pages use Tailwind classes that the CDN Tailwind in v1's `index.html` already resolves. When Phase 3B installs Tailwind locally, the CDN line in `index.html:10` can be dropped.
- **No tests.** Primitives' accessible behavior (focus ring, aria-invalid, aria-live toasts) is asserted in code comments. Tests ship with Phase 3B component migrations.

## Turn-on checklist

1. `npm i @tanstack/react-query zustand react-router-dom @radix-ui/react-dialog @radix-ui/react-toast clsx tailwind-merge class-variance-authority`
2. `npm i -D tailwindcss postcss autoprefixer`
3. `npx tailwindcss init -p` and import `v2/tokens/*` into `tailwind.config.ts`.
4. Replace `QueryProvider.tsx` stub with real `QueryClientProvider`.
5. Replace `state/uiStore.ts` inline-created store with `import { create } from 'zustand'`.
6. Pick one v1 page from the rebuild-first list, port to `v2/routes/`, wire a link from `DashboardV2.tsx`.
7. QA under `?v2=1` against the same page in v1.

## Verification

- `npx tsc --noEmit` passes.
- Visiting any URL without `?v2=1` renders v1 unchanged.
- Visiting the same URL with `?v2=1` renders the v2 shell + placeholder Dashboard. No v1 side effects run.
