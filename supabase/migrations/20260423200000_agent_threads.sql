-- Agent v2 — thread + message + action + allowlist tables.
--
-- Separate from wa_messages (WhatsApp cloud-store mirror) and the
-- `memories` / chat UIs that other AI features already use. The agent
-- runtime persists every turn here so we can resume, audit, and
-- replay conversations across channels (in-app + WhatsApp).
--
-- Idempotent. No RLS yet — Phase 1d will layer it on like the other
-- camelCase tables.

-- ── agent_threads ─────────────────────────────────────────────────────
-- One row per conversation. The same thread can carry both in-app and
-- WhatsApp turns (a power user could start in WhatsApp and continue
-- in-app); `channel` tracks the most recent channel for UI hinting.
CREATE TABLE IF NOT EXISTS agent_threads (
  id           text PRIMARY KEY,
  "userId"     text NOT NULL,
  "companyId"  text,
  channel      text NOT NULL DEFAULT 'in_app',
  title        text,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "updatedAt"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_threads_user_idx
  ON agent_threads ("userId", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS agent_threads_company_idx
  ON agent_threads ("companyId", "updatedAt" DESC);

-- ── agent_messages ────────────────────────────────────────────────────
-- Mirror of AgentMessageContent. `content` holds the full JSON blob
-- (text + toolCalls[] + toolResults[]) so replay is loss-free.
CREATE TABLE IF NOT EXISTS agent_messages (
  id           text PRIMARY KEY,
  "threadId"   text NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('user', 'assistant')),
  content      jsonb NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_messages_thread_idx
  ON agent_messages ("threadId", "createdAt");

-- ── agent_actions ─────────────────────────────────────────────────────
-- Audit trail for every write/destructive tool call. Captures the
-- preview the user saw, the resolution (approved/rejected/expired),
-- and the resulting summary. Purely additive — never update existing
-- rows in place, write a new row on state change.
CREATE TABLE IF NOT EXISTS agent_actions (
  id             text PRIMARY KEY,
  "threadId"     text NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  "toolUseId"    text NOT NULL,
  "toolName"     text NOT NULL,
  mode           text NOT NULL CHECK (mode IN ('read', 'write', 'destructive')),
  input          jsonb NOT NULL,
  preview        jsonb,
  status         text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'failed', 'expired')),
  "resultSummary" text,
  "userId"       text NOT NULL,
  "companyId"    text,
  "createdAt"    timestamptz NOT NULL DEFAULT now(),
  "resolvedAt"   timestamptz
);

CREATE INDEX IF NOT EXISTS agent_actions_thread_idx
  ON agent_actions ("threadId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS agent_actions_status_idx
  ON agent_actions (status) WHERE status = 'pending';

-- ── agent_allowed_phones ──────────────────────────────────────────────
-- WhatsApp allowlist. Any inbound message from a number NOT in this
-- table falls through to the legacy WhatsApp handler (or gets silently
-- dropped by the webhook). Opt-in, not opt-out, because the agent can
-- mutate the database.
CREATE TABLE IF NOT EXISTS agent_allowed_phones (
  phone        text PRIMARY KEY,
  "userId"     text NOT NULL,
  "companyId"  text,
  note         text,
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);
