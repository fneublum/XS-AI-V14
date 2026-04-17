# Phase 2A — AI Autonomy Foundation scaffold

**Status:** SCAFFOLD (gated off)
**Entry point:** `services/ai/index.ts`
**Config flag:** `orchestratorConfig.enabled = false` in `services/ai/config.ts`
**No existing callers migrated.** Nothing changes at runtime.

## What shipped

```
services/ai/
├── index.ts                      — public exports
├── orchestrator.ts               — runAi() entry; cache + retry + breaker + telemetry
├── config.ts                     — routing, models, TTLs, thresholds (gated off)
├── types.ts                      — AiRequest, AiResponse, TaskType
├── cache.ts                      — in-memory LRU (Supabase persist = Phase 2B)
├── retry.ts                      — exponential backoff + full jitter
├── circuitBreaker.ts             — per-provider breaker (closed/open/half-open)
├── telemetry.ts                  — fire-and-forget batch write
└── providers/
    ├── anthropicProvider.ts      — routes through `anthropic-proxy` edge fn (NOT YET DEPLOYED)
    └── geminiProvider.ts         — delegates to existing geminiClient shim
```

## Default routing (config.ts)

| Task | Provider | Reason |
|---|---|---|
| parseIntent | Claude Opus 4.7 | Needs reasoning over ambiguous user text |
| reasonEmailReply | Claude Opus 4.7 | Tone + context window |
| agentStep | Claude Opus 4.7 | Tool-use loops |
| generateInsight | Claude Opus 4.7 | Cross-table reasoning |
| extractFromEmail | Gemini 3 Pro | Cheaper structured extraction |
| extractFromPdf | Gemini 3 Pro | Multimodal + cheaper |
| classifyDocument | Gemini 3 Pro | High-volume low-complexity |
| summarize | Gemini 3 Pro | Cost sensitivity |

## What's NOT in Phase 2A (deliberately)

- **No migration of existing AI call sites.** The 37 call sites cataloged
  in `AI_CALL_SITE_INVENTORY.md` still call `services/geminiService.ts`
  directly. Migration is Phase 2B work.
- **No Supabase persistent cache.** Only the in-tab LRU is live. A
  misbehaving cache cannot corrupt the DB because there is no DB write.
- **No streaming.** `runAi()` returns a single final response. Streaming
  is Phase 2B.
- **No tool-use loops.** `AiToolCall[]` is returned raw — the caller is
  responsible for executing tools and looping. Autonomous agents land
  in Phase 2C.
- **No `anthropic-proxy` Edge Function.** The provider adapter expects
  it at `supabase/functions/anthropic-proxy/`. First Anthropic call will
  fail loudly until that function is deployed — deliberate so the gap
  is visible, not silent.

## Turn-on checklist (when ready)

1. Deploy `supabase/functions/anthropic-proxy/` (template: copy
   `gemini-proxy/` and adapt to the Anthropic Messages API).
2. Create `ai_telemetry` table in Supabase with columns matching
   `AiTelemetryEvent`.
3. Flip `orchestratorConfig.enabled = true`.
4. Migrate one low-risk call site (e.g. `summarize` for activity logs)
   and verify cache hits + telemetry rows appear.
5. Expand migration module by module per Phase 2B plan.

## Testing guidance

Nothing here has runtime callers, so there's nothing to smoke-test in
Phase 2A. Unit tests should cover:
- Cache key determinism (same request → same key).
- Cache LRU eviction at MAX_IN_MEMORY_ENTRIES.
- Retry gives up after maxAttempts on non-retryable errors.
- Retry succeeds on the second attempt after one 503.
- Circuit breaker opens at failureThreshold and closes after probe.

Tests land alongside Phase 2B migrations — `__tests__/ai/*.test.ts`.
