# Phase 3B → v2 cutover plan

**Goal:** migrate from v1 (legacy App.tsx) to v2 (Linear/Vercel shell)
as the default experience for every user, without forcing a big-bang
switch that risks a production incident.

**Opt-in today:** `?v2=1` in any URL mounts v2. Without it, v1 renders.
That's the starting state — nothing on production switches until we
move through this plan.

## Mechanism

The `v2/services/featureFlags.ts` store controls the default mount:

```
Precedence, highest wins:
  1. URL param ?v2=1  → always v2
  2. URL param ?v2=0  → always v1
  3. localStorage xs_feature_flags['v2-default'] = true  → v2
  4. Default          → v1
```

Each user controls their own flag via **Settings → Preview → "Make v2
default"**. Escape hatches (1) and (2) always work, even if the flag
is broken or a v2 page throws — a user who can't use v2 just types
`?v2=0` and is back on v1.

## Rollout phases

### Phase A — silent preview (today → 1 week)
- Do nothing. The `?v2=1` opt-in has been live since Phase 3A.
- Share the URL with 1-2 trusted users in your team.
- Collect a "what's missing / confusing" list from them.
- Exit criterion: at least one trusted user uses v2 for a full day
  without falling back to v1.

### Phase B — internal default (week 2)
- Flip the "Make v2 default" toggle yourself.
- Use v2 for your daily work for a full week.
- Keep v1 accessible with `?v2=0` if you hit a blocker.
- Report blockers through the existing ticket process; each blocker
  is either a real v2 bug OR a gap that justifies keeping v1 for
  that specific workflow.
- Exit criterion: you go 5 consecutive business days without needing
  `?v2=0` to complete a core task.

### Phase C — opt-in rollout to staff (week 3-4)
- Add an admin control on Admin → Companies → [company] → "Default
  to v2" per-user or per-company. (Not yet built — Phase 3B+.)
- Turn it on for one power user first, gather feedback for 2 days.
- Expand to ~25% of active users.
- Monitor Cloud Run logs + Supabase Edge Function error rates for a
  bump. If v2-related error rate > 2× v1 baseline for > 1 hour,
  toggle affected user(s) back.
- Exit criterion: ≥ 25% of active users on v2, error rate ≤ 1.2× v1.

### Phase D — default for new sessions (week 5)
- Update `featureFlags.ts` DEFAULTS so `v2-default = true`.
- v1 still reachable with `?v2=0`.
- Drop the admin toggle's "set to v2" option (it's the default now);
  keep the "revert to v1" escape hatch per-user.
- Announce: "v2 is now the default. If anything breaks, use `?v2=0`
  and tell us."

### Phase E — retire v1 (once stable)
- Delete v1 routes, components, services unique to v1.
- Delete `App.tsx` entirely (v2 becomes the only shell).
- Update `index.tsx` to drop the v1 import and the feature-flag branch.
- Rename `v2/` → `src/` or similar, drop the "v2" prefix from every
  component (CustomersV2 → Customers, etc.).
- Delete the Big 3 `RebuildPendingV2` pointers once their rebuilds
  ship.
- Exit criterion: two consecutive weeks with zero v1 page loads in
  Cloud Run logs.

## Rollback

At every phase, rollback is a single-line change:

- **Phase B/C (per-user flag):** user runs `localStorage.removeItem
  ('xs_feature_flags')` or flips the Settings toggle off.
- **Phase D (global default):** change `DEFAULTS['v2-default']` back
  to `false` in `featureFlags.ts`, redeploy. Takes one Cloud Run
  build + deploy (~3 min).
- **Phase E:** git revert. v1 code returns.

## Known blockers before Phase D can begin

These need rebuilds, not polish:

1. **SOPICIComissions** (~9,900 LOC, v1). Currently routes to
   `RebuildPendingV2` with an "Open in v1" link — fine for Phase C
   but blocks Phase D if sales staff use it daily.
2. **PL Invoice Engine** (~5,900 LOC). Same situation.
3. **Cost / Profit AI** — first iteration ships in this sprint, but
   needs parity review with the v1 feature list before it replaces
   the v1 version.

Each is a separate multi-sprint effort. Don't block cutover of the
30+ other routes on them — keep the v1 path alive until they ship.

## Open questions

- **Invoice create flow** currently uses a generated ID. QuickBooks
  sync may need a human-entered invoice number; confirm before
  Phase C.
- **Phase 1d RLS** is still draft. Going to Phase D without RLS
  means anyone with the anon key + JWT can read any company's data,
  which is the current v1 state — acceptable only if we accept the
  risk for the cutover window, explicitly.
- **Login UX** — v2 Login is functional. Do we want email magic-link
  (Supabase Auth) before cutover, or stick with the v1 username +
  password bridge?
