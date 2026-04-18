# Phase 2A — AI Autonomy Foundation

**Status:** ACTIVATED
**Entry point:** `services/ai/index.ts`
**Config flag:** `orchestratorConfig.enabled = true` in `services/ai/config.ts`
**Proxy status:** gemini-proxy deployed (Phase 1c); anthropic-proxy code
written, deployment pending — see *Deploy anthropic-proxy* below.

## What shipped

```
services/ai/
├── index.ts                      — public exports
├── orchestrator.ts               — runAi() entry; cache + retry + breaker + telemetry
├── config.ts                     — routing, models, TTLs, thresholds (ENABLED)
├── types.ts                      — AiRequest, AiResponse, TaskType
├── cache.ts                      — in-memory LRU (Supabase persist = Phase 2B)
├── retry.ts                      — exponential backoff + full jitter
├── circuitBreaker.ts             — per-provider breaker (closed/open/half-open)
├── telemetry.ts                  — fire-and-forget batch write
└── providers/
    ├── anthropicProvider.ts      — routes through `anthropic-proxy` edge fn
    └── geminiProvider.ts         — delegates to existing geminiClient shim
```

```
supabase/
├── functions/anthropic-proxy/index.ts             — new (ships to deploy)
└── migrations/DRAFT_20260417200000_ai_telemetry.sql — new (apply when ready)
```

## Current routing (config.ts)

Every task type is routed to **Gemini** today because `gemini-proxy` is
already deployed and works for all 37 cataloged call sites. Claude
routing flips on when the two conditions in the next section are met.

| Task | Provider | Reason |
|---|---|---|
| parseIntent | Gemini → Claude (pending) | Reasoning over ambiguous user text |
| reasonEmailReply | Gemini → Claude (pending) | Tone + context window |
| agentStep | Gemini → Claude (pending) | Tool-use loops |
| generateInsight | Gemini → Claude (pending) | Cross-table reasoning |
| extractFromEmail | Gemini | Cheaper structured extraction |
| extractFromPdf | Gemini | Multimodal + cheaper |
| classifyDocument | Gemini | High-volume low-complexity |
| summarize | Gemini | Cost sensitivity |

## Deploy anthropic-proxy (flip `ANTHROPIC_READY` when done)

```bash
# 1. Set the API key as an Edge Function secret
echo -n 'sk-ant-...' | supabase secrets set --stdin ANTHROPIC_API_KEY \
  --project-ref qfskvevighylzzmyiwre

# 2. Deploy the proxy
supabase functions deploy anthropic-proxy --project-ref qfskvevighylzzmyiwre

# 3. Smoke-test
curl -s -X POST \
  -H "apikey: <anon-key>" \
  -H "Authorization: Bearer <user-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4-7","max_tokens":64,"messages":[{"role":"user","content":"Say hi in 3 words."}]}' \
  https://qfskvevighylzzmyiwre.supabase.co/functions/v1/anthropic-proxy

# 4. Flip the feature flag in services/ai/config.ts
#    Change:  const ANTHROPIC_READY = false;
#    To:      const ANTHROPIC_READY = true;
#    Commit + deploy.
```

Until step 4 lands, every Anthropic task transparently routes to
Gemini. No call site sees a 500, no user sees a broken feature — the
orchestrator just falls back to the working proxy.

## Create the ai_telemetry table

The orchestrator writes one row per AI call. The table is a draft
migration (`supabase/migrations/DRAFT_20260417200000_ai_telemetry.sql`)
and until applied, telemetry inserts fail silently (`telemetry.ts` is
explicitly best-effort). To activate:

```bash
supabase db push --include-all --project-ref qfskvevighylzzmyiwre
# or apply the specific file against the DB, then rename the DRAFT_ prefix.
```

## What's still NOT in Phase 2A (deliberately)

- **No migration of existing AI call sites.** The 37 call sites cataloged
  in `AI_CALL_SITE_INVENTORY.md` still call `services/geminiService.ts`
  directly. Migration is Phase 2B.
- **No Supabase persistent cache.** Only the in-tab LRU is live. The
  `ai_response_cache` table + adapter lands with Phase 2B.
- **No streaming.** `runAi()` returns a single final response. Streaming
  is Phase 2B.
- **No multimodal first-class support.** `v2/queries/useGeminiExtract`
  still calls `GeminiClient` directly because it needs `inlineData`
  attachments. Orchestrator needs an `attachments[]` field before this
  migrates cleanly — Phase 2B.
- **No tool-use loops.** `AiToolCall[]` is returned raw — the caller is
  responsible for executing tools and looping. Autonomous agents land
  in Phase 2C.

## Phase 2B migration plan (next)

1. Deploy `anthropic-proxy` and apply the telemetry table.
2. Flip `ANTHROPIC_READY = true` in `config.ts`.
3. Migrate call sites in priority order from the inventory:
   - `services/geminiService.ts::parseUserIntent` (highest value)
   - `services/emailAgentService.ts` reply drafting
   - `services/aiAssistantService.ts` entity extraction
4. Add `attachments[]` to `AiRequest` so `useGeminiExtract` can
   migrate too.
5. Replace in-memory LRU with a Supabase-backed cache so results
   cross tabs.
6. Open a v2 AI telemetry dashboard at `Settings → Data` showing
   token usage by task type and cache hit rate.
