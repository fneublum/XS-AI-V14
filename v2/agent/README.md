# XS Agent v2 — wake-up summary

Built overnight per your approval: all 6 phases are in place. Nothing is committed — branch is dirty so you can review and adjust before merging.

## What you need to do before it works

1. **Apply the migration** — creates `agent_threads`, `agent_messages`, `agent_actions`, `agent_allowed_phones`:

   ```
   supabase db push
   # or, if you'd rather review first:
   cat supabase/migrations/20260423200000_agent_threads.sql
   ```

2. **Deploy the updated webhook + new agent module** (only needed to exercise the WhatsApp path):

   ```
   supabase functions deploy whatsapp-webhook --project-ref qfskvevighylzzmyiwre
   ```

3. **Add yourself to the allowlist** to test WhatsApp routing:

   ```sql
   insert into agent_allowed_phones (phone, "userId", "companyId", note)
   values ('+15551234567', '<your-supabase-user-id>', 'COMPANY_ID_OR_NULL', 'initial test');
   ```

4. **Flip the flag in-app** by appending `?agent=1` to the URL, or set
   `localStorage.xs_feature_flags = '{"agent-v2":true}'`. The default is **off**.

## What exists

### Browser (v2/agent/)
- `types.ts` — shared types (ToolDef, ToolContext, ToolResult, RunAgentInput/Output).
- `entityCatalog.ts` — declarative catalog of the 15 entities the agent can touch. Each entry defines writable columns, search columns, summary columns, id prefix, company-scoping.
- `registry.ts` — in-memory tool registry + `toolsForClaude()` serializer.
- `anthropicClient.ts` — wrapper over the `anthropic-proxy` edge function; speaks the full Messages API (tool_use, tool_result, image blocks).
- `systemPrompt.ts` — terse per-channel system prompt. Lists entities; tells Claude how confirmations work.
- `tools/entities.ts` — 7 generic CRUD tools covering all 15 entities: `list_entities`, `get_entity`, `create_entity`, `update_entity`, `delete_entity`, `describe_entity`, `list_entity_types`. Writes call `sanitizePayload` to strip non-allowlisted columns, and return `needs_confirmation` when `ctx.approved=false`.
- `runAgent.ts` — main loop. Translates history to Claude messages, iterates `callClaude → exec tools → feed results back`, pauses on `needs_confirmation`, supports `pendingApproval` resume.
- `multimodal.ts` — voice + file adapter via gemini-proxy. `transcribeAudio(blob)`, `extractFromFile(blob)`, `composeUserTurnText({text, audio, file})`.
- `runtime.ts` — browser bridge: load history from DB, call `runAgent`, persist all new turns to `agent_messages`, record any needs_confirmation in `agent_actions`.

### Server (Deno, supabase/functions/)
- `_shared/agentServer.ts` — Deno port of the loop. Reads run directly; writes ALWAYS return `awaiting_human_approval` and insert a pending row so the in-app UI can confirm. Also includes `transcribeWhatsAppAudio` (Meta Graph API → Gemini) and `sendWhatsAppReply`.
- `whatsapp-webhook/index.ts` — patched. Every inbound message checks `agent_allowed_phones`; if found, routes through the agent and replies with `sendWhatsAppReply`. Falls through to the legacy wa_messages path on any error.

### UI (v2/components/, v2/layout/)
- `AgentPanel.tsx` — right-side drawer. Shows thread history, pending confirm cards (approve/reject), input field, 🎤 push-to-record, 📎 file attach, Send.
- `AppShell.tsx` — mounts a floating ✦ button + AgentPanel when `shouldMountAgentV2()` is true.
- `services/featureFlags.ts` — adds `agent-v2` flag (default false) + `shouldMountAgentV2()` helper (honors `?agent=1`/`?agent=0`).

### Queries (v2/queries/)
- `useAgentThreads.ts` — hooks + service helpers (`insertAgentMessage`, `loadAgentHistory`, `getOrCreateThreadForWhatsApp`).
- `useAgentActions.ts` — hooks + service helpers (`recordPendingAction`, `markActionCompleted`).

## How it fits together

**In-app path**
```
User types → AgentPanel.send() → composeUserTurnText (audio/file → text)
  → invokeAgent (runtime.ts)
     → insertAgentMessage (user)
     → runAgent → Claude (via anthropic-proxy)
        → tool_use blocks → executeCRUD → tool_result → Claude … until end_turn
        → if write: returns needs_confirmation → recordPendingAction
     → insertAgentMessage (each new turn)
  → UI re-renders: new messages + pending confirm card
User clicks Approve → useResolveAgentAction → invokeAgent({pendingApproval}) → resume
```

**WhatsApp path**
```
Meta → whatsapp-webhook (POST) → signature check → messages[]
  → phone ∈ agent_allowed_phones?
     YES → upsert agent_threads (THR-WA-<digits>)
         → runAgentFromWhatsApp (agentServer.ts) — NO browser
             → Claude via anthropic.com directly
             → reads execute server-side; writes → agent_actions pending
         → sendWhatsAppReply
     NO  → legacy wa_messages insert
```

## What I did NOT do

- **No RLS** on the new tables. Phase 1d parity will need policies on `agent_threads`, `agent_messages`, `agent_actions`, `agent_allowed_phones`. For now, service-role (webhook) and anon-with-JWT (browser) both have full access, which mirrors other v2 tables.
- **No quota / rate limiting** on the agent. A stuck tool loop will hit `DEFAULT_MAX_STEPS=8` (browser) or `6` (server) and give up — but each loop can burn a few Claude calls. Watch usage in the Anthropic dashboard if you give WhatsApp access to anyone untrusted.
- **No ElevenLabs reply voice** for WhatsApp. Replies are text-only. The browser panel uses the ERP's existing SpeechRecognition path for voice input; no TTS either.
- **No agent-v2 toggle UI** in Settings. Flip via `?agent=1` URL param or localStorage for now.
- **No tests yet.** Typecheck passes (`npx tsc --noEmit -p .` — only pre-existing errors in App.tsx / Dashboard / SOPICI remain, untouched). UI smoke test confirmed the panel mounts, inputs work, and the DB error surfaces correctly when migrations are missing.

## Quick test recipe (after migrations applied)

1. `?v2=1&agent=1` → click the ✦ button bottom-right.
2. Type: "list 3 customers". Should call `list_entities` and stream the result.
3. Type: "create a customer named Acme Corp in Miami". Should show a confirm card; approve to execute.
4. Type: "delete customer CUST-…". Destructive confirm card (rose border) should appear.
5. Hold 🎤 → say "find invoice one two three" → release. Should transcribe via Gemini and send.

For WhatsApp: add your phone to the allowlist, message the business number, agent replies within a few seconds.

## Known issues / rough edges

- `agentServer.ts` duplicates the entity catalog from `entityCatalog.ts`. Edge functions can't import from the v2 tree, so keep them in sync manually when you add entities.
- The in-app panel refetches pending actions every 2s (poll). Fine at 1–2 concurrent users; swap for a realtime subscription later.
- If a write returns `needs_confirmation` in the browser path, the loop breaks mid-batch. Parallel tool calls on the same turn are serialized around the pause — simpler reasoning, slight latency cost.
- User-turn `pendingApproval` resumes replay the entire history. Fine up to a few dozen turns; archive old threads if it becomes a token-cost issue.
