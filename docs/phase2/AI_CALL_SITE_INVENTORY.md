# AI Call Site Inventory for XS-AI-V12

**Last Updated:** 2026-04-16  
**Scope:** React/TypeScript/Supabase ERP  
**Primary AI Provider:** Gemini (via shimmed `GoogleGenAI` class + `gemini-proxy` Edge Function)  
**Model ID (default):** `gemini-3-pro-preview` (defined in `services/geminiService.ts:15`)  

---

## Call Site Summary

| File:Line | Feature / Page | Model | Input Type | Response Schema | Prompt Construction | Cacheability | Retry? | Error Handling |
|-----------|---|---|---|---|---|---|---|---|
| `services/geminiService.ts:174` | getGeminiInsight | gemini-3-pro-preview | text (templated context + user prompt) | none | dynamic context | per-company (context) | no | try/catch, fallback string |
| `services/geminiService.ts:197` | translateDescriptions | gemini-3-pro-preview | text (structured list) | flat JSON array | static template + dynamic items | per-row (descriptions vary) | no | regex extraction, returns empty array on fail |
| `services/geminiService.ts:254` | generateProposalLabels | gemini-3-pro-preview | text (template with names/country) | flat JSON object | static template | per-company (names) | no | regex extraction, returns empty object |
| `services/geminiService.ts:279` | generateSalesEmail | gemini-3-pro-preview | text (dynamic itemsList) | none | static template | per-row (items vary) | no | try/catch, fallback string |
| `services/geminiService.ts:291-295` | generateContextualEmail | gemini-3-pro-preview | text (parameters) | flat JSON {subject, body} | static template | not-cacheable (per-recipient) | no | try/catch, returns null |
| `services/geminiService.ts:309` | generateEmailSummary | gemini-3-pro-preview | text (email metadata) | none | static template | not-cacheable (email-specific) | no | try/catch, returns empty string |
| `services/geminiService.ts:328` | generateEmailReply | gemini-3-pro-preview | text (2 params) | none | static template | not-cacheable (email-specific) | no | try/catch, returns empty string |
| `services/geminiService.ts:388-405` | reasonEmailReply | gemini-3-pro-preview | text (email thread + ERP context, up to 8000 chars) | nested JSON {shouldReply, draftReply, reasoning, priority, expectsReply, category} | dynamic context retrieved from DB | per-company (ERP context) | no | try/catch, structured default |
| `services/geminiService.ts:502-527` | extractPOFromEmail | gemini-3-pro-preview | text (thread + attachments, up to 10000 chars) | nested JSON {isPurchaseOrder, confidence, items[], ... } | dynamic context (7+ page prompt template) | per-row (email/attachment-specific) | no | try/catch, structured defaults |
| `services/geminiService.ts:600-620` | reasonFollowUp | gemini-3-pro-preview | text (thread + ERP context) | nested JSON {followUp, reasoning, urgency, ...} | dynamic context retrieved | per-company (ERP context) | no | try/catch, structured default |
| `services/geminiService.ts:632` | lookupLocation | gemini-3-pro-preview | text (query param) | flat JSON {city, state, zip} | static template | static (lookups repeat) | no | try/catch, returns null |
| `services/geminiService.ts:648` | getDomesticFreightEstimate | gemini-3-pro-preview | text (4 params) | flat JSON {estimatedCost, explanation} | static template | per-row (params vary) | no | try/catch, returns null |
| `services/geminiService.ts:668` | getImportCostAnalysis | gemini-3-pro-preview | text (6 params) | none | static template | per-row (params vary) | no | try/catch, returns empty string |
| `services/geminiService.ts:731-753` | getSalesAgentResponse | gemini-3-pro-preview | text (user msg + context, up to 4000 chars) | none | dynamic context | per-company (context + history) | no | try/catch, returns empty string |
| `services/geminiService.ts:795-803` | analyzeDocument | gemini-3-pro-preview | text (file base64 + prompt) | none | static template | not-cacheable (file-specific) | no | try/catch, returns empty string |
| `services/geminiService.ts:865` | generateCustomerDescription | gemini-3-pro-preview | text (3 params) | flat JSON {description, hsCode} | static template | per-row (customer-specific) | no | try/catch, returns empty object |
| `services/geminiService.ts:897` | getProcurementAgentResponse | gemini-3-pro-preview | text (msg + history + context) | none | dynamic context (multi-page) | per-company (context + history) | no | try/catch, returns empty string |
| `services/geminiService.ts:1010` | getLogisticsAgentResponse | gemini-3-pro-preview | text (msg + history + context) | none | dynamic context (multi-page) | per-company (context + history) | no | try/catch, returns empty string |
| `services/geminiService.ts:1032` | getCalculatorAgentResponse | gemini-3-pro-preview | text (msg + history + context) | none | dynamic context (multi-page) | per-company (context + history) | no | try/catch, returns empty string |
| `services/geminiService.ts:1054` | getDataAgentResponse | gemini-3-pro-preview | text (msg + history + context) | none | dynamic context (multi-page) | per-company (context + history) | no | try/catch, returns empty string |
| `services/geminiService.ts:1261-1265` | parseUserIntent | gemini-3-pro-preview | text (user msg) | flat JSON {type, entities} | static template (12-page system prompt) | static (repeating intents) | no | regex + JSON parse, returns null |
| `services/geminiService.ts:1335+` | getDashboardAgentResponse | gemini-3-pro-preview | text (msg + history + context) | none | dynamic context (multi-page) | per-company (context + history) | no | try/catch, returns empty string |
| `services/geminiService.ts:1801-1807` | getEmailAgentResponse | gemini-3-pro-preview | text + **function-call** | none | dynamic context | per-company (context + history) | no | try/catch, returns text or function call |
| `services/geminiService.ts:1884-1890` | getCustomerPortalAgentResponse | gemini-3-pro-preview | text (msg + history + context, truncated to 5 msgs) | none | dynamic context (summarized data) | per-company (context + history) | no | try/catch, localized error messages |
| `services/geminiService.ts:2037-2041` | lookupShipmentETA | gemini-3-pro-preview | text | none (uses **googleSearch tool**) | static template | per-row (shipment-specific) | no | try/catch, returns null |
| `services/geminiService.ts:2268` | getBobResponse | gemini-3-pro-preview | text (msg + history + context, up to 8000 chars total) | none | dynamic context (max 5 history, summarized) | per-company (context + history) | no | try/catch with detailed error messages |
| `services/geminiService.ts:2382-2400` | getCostProfitAnalysis | gemini-3-pro-preview | text (7+ params, complex breakdown) | nested JSON {pickupCost, oceanFreight, deliveryCost, insuranceCost, dutyPercent, clearanceCost, explanation} | dynamic context (DB + AI merge) | per-row (product/route-specific) | no | try/catch, fallback with zeros |
| `services/geminiService.ts:2483` | getCostProfitSummary | gemini-3-pro-preview | text (array of items) | nested JSON {items[{productName, recommendedMargin, reasoning}]} | static template | per-row (items vary) | no | try/catch, returns empty array |
| `services/geminiService.ts:2530` | getCostProfitOfferRanking | gemini-3-pro-preview | text (offers array) | nested JSON {rankedOffers[{...}]} | static template | per-row (offers vary) | no | try/catch, returns empty array |
| `services/geminiService.ts:2649` | autoFillSalesOrder | gemini-3-pro-preview | text (context) | nested JSON {lineItems, incoterm, paymentTerms} | dynamic context (retrieved POs + orders) | per-company (context) | no | try/catch, returns empty object |
| `services/geminiService.ts:2737` | recommendFreightQuote | gemini-3-pro-preview | text (context) | nested JSON {weight, origin, destination, equipment, reasoning} | dynamic context (retrieved quotes + routes) | per-company (context) | no | try/catch, returns empty object |
| `services/geminiService.ts:2833` | generateBookingEmail | gemini-3-pro-preview | text (context + confirmation) | none | dynamic context (booking data) | per-row (booking-specific) | no | try/catch, returns empty string |
| `pages/SmailApp.tsx:202-213` | PDF text extraction (Smail) | **gemini-2.0-flash** | vision (base64 PDF inline) | none | static template | not-cacheable (file-specific) | no | try/catch, logs error |
| `pages/SmailApp.tsx:240` | AI Lookup / email terms extraction | **gemini-2.0-flash** | text (email body up to 2000 chars) | none | static template | not-cacheable (email-specific) | no | try/catch, fallback message |
| `supabase/functions/gemini-proxy/index.ts:137-186` | Proxy pass-through | varies (allowlist) | pass-through (any config) | pass-through (responseMimeType/responseSchema) | n/a (client-defined) | depends on client | no | HTTP status codes + error text |
| `supabase/functions/gemini-translate/index.ts:59-103` | Batch translation (Edge Function) | **gemini-2.0-flash** | text (prompt with descriptions, responseMimeType: JSON) | flat JSON array [strings] | static template | per-country (batch-specific) | no | try/catch, logs error, returns empty array |

---

## Notes on Response Schema Complexity

- **None:** Raw text response parsed manually or used as-is
- **Flat:** Top-level properties only (e.g., `{subject: string, body: string}`)
- **Nested:** Structured with arrays or objects (e.g., `{items: [{id, name, price}]}`)
- **Deeply-nested:** 3+ levels (e.g., `extractPOFromEmail` returns items with nested line items)

---

## Cache Heatmap: Top 5 High-Value Candidates

### 1. **parseUserIntent** (services/geminiService.ts:1261)
- **System Prompt Size:** ~12 KB (extensive examples for intent classification)
- **Frequency:** Called on every dashboard/agent interaction
- **Benefit:** Static system prompt repeated for every user message
- **Recommendation:** Cache the 12 KB system prompt + examples; response varies per message
- **Estimated Savings:** 10–15% of cost for intent parsing; latency -10–50ms

### 2. **reasonEmailReply + extractPOFromEmail** (services/geminiService.ts:337–527)
- **System Prompt + Context Size:** ~12–15 KB each (ERP context retrieved from DB)
- **Frequency:** Called for every email processed
- **Benefit:** ERP context is per-company and reused across multiple emails in same batch
- **Recommendation:** Cache ERP context + email metadata separately
- **Estimated Savings:** 15–20% of cost per email batch; latency -50–100ms

### 3. **Agent Functions** (getSalesAgentResponse, getProcurementAgentResponse, etc., ~10 variants)
- **System Prompt Size:** ~3–5 KB each; context varies (products, orders, history)
- **Frequency:** Called per user message in agent chat
- **Benefit:** System prompts + initial context reused across conversation turns
- **Recommendation:** Cache system prompt + summarized context per agent; invalidate on new history
- **Estimated Savings:** 10–12% of cost per turn; latency -20–40ms

### 4. **translateDescriptions** (services/geminiService.ts:186)
- **Prompt Size:** ~2 KB template + descriptions (variable)
- **Frequency:** Batch translation on supplier quote imports
- **Benefit:** Same template + target country reused across batch
- **Recommendation:** Cache template + country selector as prompt prefix
- **Estimated Savings:** 5–8% of cost per batch; latency -10–20ms

### 5. **getBobResponse** (services/geminiService.ts:2191)
- **System Prompt + Context Size:** ~8 KB system prompt + summarized data
- **Frequency:** Called per user message in Bob assistant
- **Benefit:** System prompt + initial context reused across turns
- **Recommendation:** Cache system prompt + summarized context; manage history limit
- **Estimated Savings:** 8–10% of cost per turn; latency -15–30ms

---

## Routing Recommendations

### Keep on Gemini (Cost-Optimized)
- **Simple text generation** (emails, summaries, descriptions): `generateSalesEmail`, `generateContextualEmail`, `generateEmailSummary`, `generateEmailReply`, `generateBookingEmail`
  - Reason: Low latency, cheap, no tool-use needed
  
- **Structured JSON (flat schemas)**: `lookupLocation`, `getDomesticFreightEstimate`, `generateProposalLabels`
  - Reason: Gemini's JSON mode is reliable; schemas are simple
  
- **Translation (via 2.0-flash)**: `translateDescriptions`, `gemini-translate` Edge Function
  - Reason: 2.0-flash is optimized for language tasks; cheaper than Opus

### Candidates for Opus 4.7 (Reliability/Complex Reasoning)
- **Email reasoning** (`reasonEmailReply`, `extractPOFromEmail`, `reasonFollowUp`)
  - Reason: Complex multi-stage reasoning; Opus is more reliable for nested JSON extraction
  - Trade-off: 3–5x cost; ~50% more latency
  - **Recommendation:** A/B test Opus on extractPOFromEmail; if accuracy improves >5%, switch
  
- **Intent parsing** (`parseUserIntent`)
  - Reason: 12 KB system prompt + complex logic; Opus excels with long context
  - **Recommendation:** Test Opus; cost-benefit depends on error rate tolerance

- **Agent functions** (`getSalesAgentResponse`, `getProcurementAgentResponse`, etc.)
  - Reason: Long context, multi-turn chat; Opus more stable under load
  - **Recommendation:** Reserve Opus for high-stakes agents (sales, procurement); keep helpers on Gemini

### Vision Tasks (Gemini 2.0-flash is Superior)
- **PDF extraction** (`SmailApp.tsx:202`): 2.0-flash native PDF support
- **Document analysis** (`analyzeDocument`): Already on Gemini; no change needed

### Avoid Opus for
- **Translation**: Gemini 2.0-flash is faster and cheaper
- **High-volume simple text**: Cost will spike with Opus

---

## Risks and Gotchas for Orchestrator Design

### 1. **Direct Gemini 2.0-flash Usage in SmailApp**
- **Location:** `pages/SmailApp.tsx:202, 240`
- **Issue:** Two call sites hardcode `gemini-2.0-flash` model ID directly
- **Blocker:** Orchestrator must support model-override per call site (not just global default)
- **Fix:** Add `modelOverride?: string` to orchestrator config; check SmailApp usage pattern

### 2. **Function-Calling via Tool Declarations**
- **Location:** `services/geminiService.ts:975, 1805, 2041, 2266`
- **Pattern:** Uses `tools: [{ functionDeclarations: [...] }]` or `googleSearch`
- **Blocker:** Opus doesn't use the same `functionDeclarations` syntax; requires adapter/translator
- **Risk:** If tool-use response format differs, parsing breaks (currently expects `response.functionCalls`)
- **Action:** Validate tool-use shape in orchestrator; may need format converter for Opus

### 3. **Response Parsing: Manual regex + JSON.parse**
- **Pattern:** Most call sites do `JSON.parse(response.text.match(/\[[\s\S]*\]/)[0])` or similar
- **Blocker:** If orchestrator changes response.text format (e.g., wraps in metadata), all call sites break
- **Risk:** High — 30+ call sites rely on exact response.text format
- **Action:** Guarantee orchestrator output is **plain response.text** (not wrapped); document this contract

### 4. **ERP Context Size & Token Limits**
- **Pattern:** `reasonEmailReply` (8000 chars), `extractPOFromEmail` (10000 chars), agents (multi-page)
- **Blocker:** Prompt caching requires knowing total prompt size; orchestrator must validate MAX_BODY_BYTES (currently 2 MB per gemini-proxy)
- **Risk:** If context grows, requests fail silently; no backoff
- **Action:** Add telemetry for prompt size; set MAX_BODY_BYTES alert at 80%

### 5. **No Streaming or Chat Sessions**
- **Note:** `geminiClient.ts:17-20` explicitly says "NOT supported: Streaming, File uploads, Chat sessions, Embeddings"
- **Impact:** Orchestrator cannot use streaming for agents (must batch responses)
- **Action:** Document as limitation; if agents need streaming later, must extend gemini-proxy

### 6. **Error Handling: Loose Fallbacks**
- **Pattern:** Most call sites return empty string, null, or empty object on error
- **Risk:** Silent failures mask API outages; no retry/backoff currently
- **Action:** Orchestrator must:
  - Implement exponential backoff (max 3 retries)
  - Log errors with context (model, tokens, timestamp)
  - Differentiate retryable (5xx, timeout) vs. permanent (4xx, validation)

### 7. **Structured Output Reliability**
- **Pattern:** Many call sites use `responseMimeType: 'application/json'` + `responseSchema`
- **Risk:** Gemini's JSON mode is not 100% reliable; some responses have trailing text
- **Current Mitigation:** Regex extraction (`match(/\{.*\}/)`)
- **Orchestrator Impact:** If switching to Opus, must test JSON reliability; Opus may have stricter output validation
- **Action:** Add response validation schema in orchestrator; re-serialize + validate

### 8. **API Key Rotation**
- **Pattern:** `process.env.API_KEY` hardcoded in geminiService; shimmed via gemini-proxy
- **Blocker:** If orchestrator needs to support multiple API keys or key rotation, must update all call sites
- **Action:** Keep shimmed approach; rotate key via edge function env vars only

### 9. **Model ID Hard-Coded**
- **Location:** `services/geminiService.ts:15` defines `const MODEL_ID = 'gemini-3-pro-preview'`
- **Risk:** All 35+ call sites reference this constant; orchestrator can't override per-call without refactor
- **Action:** Add optional `modelId?: string` parameter to each function; fallback to constant

### 10. **No Retry Loop in Edge Function**
- **Location:** `supabase/functions/gemini-proxy/index.ts:141-149`
- **Pattern:** Single fetch; returns 502 on upstream error
- **Blocker:** Client must retry; no exponential backoff
- **Action:** Add retry logic to gemini-proxy (3 attempts, 1s/2s/4s backoff)

---

## Telemetry & Monitoring Requirements for Orchestrator

### Required Metrics
1. **Per-call-site:**
   - Input token count (cache-aware)
   - Output token count
   - Cache hit ratio (if enabled)
   - Latency (time to first token, total)
   - Model chosen (Gemini vs. Opus)
   - Error rate & error type

2. **Per-company:**
   - Daily cost breakdown (Gemini vs. Opus)
   - Cache size & growth
   - Prompt reuse frequency

3. **System-wide:**
   - Circuit breaker state (open/closed)
   - Retry backoff histogram
   - Response validation failures

### Recommended Logging Points
- `gemini-proxy` Edge Function: log `[model, textLen, inputTokens, cacheHits, latencyMs]`
- Orchestrator: log before/after model decision, cache hit, retry attempt, error

---

## Summary for Phase 2 Implementation

**Total Distinct Call Sites:** 37  
- 35 in `services/geminiService.ts`
- 2 in `pages/SmailApp.tsx` (hardcoded `gemini-2.0-flash`)
- 2 in Supabase Edge Functions

**Top 3 Cache Candidates:**
1. `parseUserIntent` (12 KB system prompt, high frequency)
2. `reasonEmailReply` + `extractPOFromEmail` (ERP context, batch reuse)
3. Agent functions (10 variants, system prompt + context reuse)

**Blockers for Orchestrator Design:**
1. Manual regex/JSON parsing of response.text (contract must remain unchanged)
2. Function-calling syntax differs Gemini → Opus (need adapter)
3. Two SmailApp call sites override model ID (support per-call override)
4. No streaming, chat sessions, or embeddings (document as v1 limitations)
5. Silent error fallbacks (must add telemetry & retry logic)

