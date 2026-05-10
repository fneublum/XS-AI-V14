// Agent v2 — server-side loop (Deno edge-function port).
//
// The browser version (v2/agent/runAgent.ts) can't run inside the
// whatsapp-webhook function, so this module mirrors the essential
// pieces in Deno: it reads the entity catalog, calls Claude directly
// via anthropic API, executes READ tools against Supabase, and
// records any write/destructive tool_use as a pending agent_actions
// row for the user to resolve in the in-app panel.
//
// Intentionally narrower than the browser loop:
//   - Reads run.
//   - Writes ALWAYS return "awaiting_human_approval" to Claude and
//     insert an agent_actions pending row. The user resolves in-app.
//   - No preview composition beyond the standard "Create/Update X".

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_STEPS = 6;

export interface EntityDef {
  key: string;
  table: string;
  idPrefix: string;
  searchColumns: string[];
  writableColumns: string[];
  summaryColumns: string[];
  companyScoped: boolean;
  humanLabel: string;
}

// Keep in sync with v2/agent/entityCatalog.ts. Duplicated by design —
// edge functions can't share TypeScript modules with the browser tree.
export const ENTITIES: EntityDef[] = [
  { key: 'customer', table: 'customers', idPrefix: 'CUST', searchColumns: ['name', 'nickname', 'taxId', 'email'], writableColumns: ['name', 'nickname', 'taxId', 'contactPerson', 'email', 'email2', 'email3', 'phone', 'location', 'city', 'state', 'zip', 'country', 'pod', 'creditLimit', 'paymentTerms', 'status', 'totalVolumeLBS', 'brokerName', 'brokerEmail'], summaryColumns: ['id', 'name', 'email', 'phone', 'country', 'status'], companyScoped: true, humanLabel: 'customer' },
  { key: 'supplier', table: 'suppliers', idPrefix: 'SUP', searchColumns: ['name', 'taxId', 'email'], writableColumns: ['name', 'taxId', 'contactPerson', 'email', 'phone', 'location', 'city', 'state', 'zip', 'country', 'paymentTerms', 'status'], summaryColumns: ['id', 'name', 'email', 'country', 'status'], companyScoped: true, humanLabel: 'supplier' },
  { key: 'product', table: 'products', idPrefix: 'PRD', searchColumns: ['sku', 'description', 'grade'], writableColumns: ['sku', 'description', 'grade', 'resin', 'color', 'melt', 'moisture', 'additives', 'origin', 'basePriceUSD', 'listPriceUSD', 'status', 'notes'], summaryColumns: ['id', 'sku', 'description', 'grade', 'listPriceUSD'], companyScoped: true, humanLabel: 'product' },
  { key: 'sales_order', table: 'sales_orders', idPrefix: 'SO', searchColumns: ['orderNumber', 'customerName', 'status'], writableColumns: ['orderNumber', 'orderDate', 'customerId', 'customerName', 'deliveryMethod', 'paymentTerms', 'incoterms', 'pod', 'pol', 'status', 'notes', 'bankId', 'notifyParty'], summaryColumns: ['id', 'orderNumber', 'customerName', 'orderDate', 'status'], companyScoped: true, humanLabel: 'sales order' },
  { key: 'invoice', table: 'invoices', idPrefix: 'INV', searchColumns: ['invoiceNumber', 'billToName', 'consignee', 'status'], writableColumns: ['invoiceNumber', 'invoiceDate', 'billToName', 'soldTo', 'consignee', 'shipTo', 'status', 'paymentTerms', 'incoterms', 'pod', 'pol', 'notes', 'bookingNumber', 'transportRef'], summaryColumns: ['id', 'invoiceNumber', 'billToName', 'invoiceDate', 'status'], companyScoped: true, humanLabel: 'invoice' },
  { key: 'purchase_order', table: 'purchase_orders', idPrefix: 'PO', searchColumns: ['poNumber', 'supplierName', 'status'], writableColumns: ['poNumber', 'orderDate', 'supplierId', 'supplierName', 'paymentTerms', 'incoterms', 'status', 'notes'], summaryColumns: ['id', 'poNumber', 'supplierName', 'orderDate', 'status'], companyScoped: true, humanLabel: 'purchase order' },
  { key: 'packing_list', table: 'packing_lists', idPrefix: 'PL', searchColumns: ['plNumber', 'blNumber', 'soNumber', 'consignee'], writableColumns: ['plNumber', 'blNumber', 'soNumber', 'consignee', 'containerNumber', 'carrier', 'scheduledShipDate', 'status', 'date', 'notes'], summaryColumns: ['id', 'plNumber', 'blNumber', 'consignee', 'status'], companyScoped: true, humanLabel: 'packing list' },
  { key: 'bill_of_lading', table: 'bill_of_ladings', idPrefix: 'BL', searchColumns: ['blNumber', 'consignee', 'containerNumber'], writableColumns: ['blNumber', 'consignee', 'shipper', 'carrier', 'containerNumber', 'vessel', 'voyage', 'pol', 'pod', 'etd', 'eta', 'agentName', 'status', 'notes'], summaryColumns: ['id', 'blNumber', 'consignee', 'carrier', 'status'], companyScoped: true, humanLabel: 'bill of lading' },
  { key: 'freight_quote', table: 'freight_quotes', idPrefix: 'FQ', searchColumns: ['quote_number', 'agent_name', 'origin', 'destination'], writableColumns: ['quote_number', 'agent_name', 'origin', 'destination', 'container_type', 'rate_usd', 'valid_until', 'notes', 'status'], summaryColumns: ['id', 'quote_number', 'agent_name', 'origin', 'destination', 'rate_usd'], companyScoped: true, humanLabel: 'freight quote' },
  { key: 'booking', table: 'bookings', idPrefix: 'BK', searchColumns: ['bookingNumber', 'agentName', 'customerName'], writableColumns: ['bookingNumber', 'agentName', 'customerName', 'containerNumber', 'vessel', 'voyage', 'pol', 'pod', 'etd', 'eta', 'status', 'notes'], summaryColumns: ['id', 'bookingNumber', 'agentName', 'pol', 'pod', 'status'], companyScoped: true, humanLabel: 'booking' },
  { key: 'receivable', table: 'receivables', idPrefix: 'AR', searchColumns: ['invoiceNumber', 'customerName'], writableColumns: ['invoiceNumber', 'customerName', 'amount', 'dueDate', 'status', 'notes'], summaryColumns: ['id', 'invoiceNumber', 'customerName', 'amount', 'dueDate', 'status'], companyScoped: true, humanLabel: 'receivable' },
  { key: 'payable', table: 'payables', idPrefix: 'AP', searchColumns: ['billNumber', 'supplierName'], writableColumns: ['billNumber', 'supplierName', 'amount', 'dueDate', 'status', 'notes'], summaryColumns: ['id', 'billNumber', 'supplierName', 'amount', 'dueDate', 'status'], companyScoped: true, humanLabel: 'payable' },
  { key: 'commission', table: 'commissions', idPrefix: 'COM', searchColumns: ['orderNumber', 'agentName', 'customerName'], writableColumns: ['orderNumber', 'agentName', 'customerName', 'amount', 'rate', 'status', 'notes'], summaryColumns: ['id', 'orderNumber', 'agentName', 'amount', 'status'], companyScoped: true, humanLabel: 'commission' },
  { key: 'cargo_agent', table: 'cargo_agents', idPrefix: 'CAG', searchColumns: ['name', 'email'], writableColumns: ['name', 'email', 'phone', 'contactPerson', 'country', 'notes'], summaryColumns: ['id', 'name', 'email', 'country'], companyScoped: true, humanLabel: 'cargo agent' },
  { key: 'payment_term', table: 'payment_terms', idPrefix: 'PT', searchColumns: ['description', 'code'], writableColumns: ['description', 'code', 'daysNet', 'notes'], summaryColumns: ['id', 'code', 'description', 'daysNet'], companyScoped: true, humanLabel: 'payment term' },
];

const BY_KEY = new Map(ENTITIES.map(e => [e.key, e]));
const ENTITY_KEYS = ENTITIES.map(e => e.key);

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function buildSystemPrompt(companyId: string): string {
  const table = ENTITIES.map(e => `  - ${e.key}: ${e.humanLabel}`).join('\n');
  return `You are the XS Agent, replying on WhatsApp inside a plastics-trading ERP.

Keep messages under 300 characters, plain text. No markdown tables.

You can act on these entities:
${table}

For writes and deletes, Claude should call the tool — it will return "awaiting_human_approval" and the user will confirm in the in-app panel. Reads (list/get) run immediately. Don't speculate: find records via list_entities before touching them.

Scope: company ${companyId}.`;
}

// ── Tools exposed to Claude ──────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_entities',
    description: `List or search entities. Must be one of: ${ENTITY_KEYS.join(', ')}.`,
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: ENTITY_KEYS },
        search: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      required: ['entity'],
    },
  },
  {
    name: 'get_entity',
    description: `Fetch a record by id. Must be one of: ${ENTITY_KEYS.join(', ')}.`,
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: ENTITY_KEYS },
        id: { type: 'string' },
      },
      required: ['entity', 'id'],
    },
  },
  {
    name: 'create_entity',
    description: `Create a record — returns awaiting_human_approval. Must be one of: ${ENTITY_KEYS.join(', ')}.`,
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: ENTITY_KEYS },
        data: { type: 'object', additionalProperties: true },
      },
      required: ['entity', 'data'],
    },
  },
  {
    name: 'update_entity',
    description: `Update a record — returns awaiting_human_approval. Must be one of: ${ENTITY_KEYS.join(', ')}.`,
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: ENTITY_KEYS },
        id: { type: 'string' },
        patch: { type: 'object', additionalProperties: true },
      },
      required: ['entity', 'id', 'patch'],
    },
  },
  {
    name: 'delete_entity',
    description: `Delete a record — returns awaiting_human_approval. Must be one of: ${ENTITY_KEYS.join(', ')}.`,
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: ENTITY_KEYS },
        id: { type: 'string' },
      },
      required: ['entity', 'id'],
    },
  },
];

function sanitize(ent: EntityDef, payload: Record<string, unknown>): { clean: Record<string, unknown>; dropped: string[] } {
  const clean: Record<string, unknown> = {};
  const dropped: string[] = [];
  const allowed = new Set(ent.writableColumns);
  for (const [k, v] of Object.entries(payload)) {
    if (allowed.has(k)) clean[k] = v; else dropped.push(k);
  }
  return { clean, dropped };
}

interface ToolCtx {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  threadId: string;
}

async function execTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolCtx,
): Promise<{ ok: boolean; summary: string; payload: unknown }> {
  const entKey = input.entity as string | undefined;
  const ent = entKey ? BY_KEY.get(entKey) : null;
  if (!ent) return { ok: false, summary: `Unknown entity: ${entKey}`, payload: null };

  if (name === 'list_entities') {
    const limit = Math.min(Math.max((input.limit as number) ?? 10, 1), 50);
    let q = ctx.supabase.from(ent.table).select(ent.summaryColumns.join(',')).limit(limit);
    if (ent.companyScoped && ctx.companyId !== 'ALL') q = q.eq('companyId', ctx.companyId);
    const search = (input.search as string | undefined)?.trim();
    if (search && ent.searchColumns.length > 0) {
      const s = `%${search}%`;
      q = q.or(ent.searchColumns.map(c => `${c}.ilike.${s}`).join(','));
    }
    const { data, error } = await q;
    if (error) return { ok: false, summary: `List failed: ${error.message}`, payload: null };
    return { ok: true, summary: `Found ${(data ?? []).length} ${ent.humanLabel}(s)`, payload: { rows: data ?? [] } };
  }

  if (name === 'get_entity') {
    const id = input.id as string;
    if (!id) return { ok: false, summary: 'id required', payload: null };
    const { data, error } = await ctx.supabase.from(ent.table).select('*').eq('id', id).maybeSingle();
    if (error) return { ok: false, summary: `Get failed: ${error.message}`, payload: null };
    if (!data) return { ok: false, summary: `${ent.humanLabel} ${id} not found`, payload: null };
    return { ok: true, summary: `Loaded ${ent.humanLabel} ${id}`, payload: data };
  }

  // All writes: record pending action, tell Claude to wait.
  if (name === 'create_entity' || name === 'update_entity' || name === 'delete_entity') {
    const mode = name === 'delete_entity' ? 'destructive' : 'write';
    const actionLabel =
      name === 'create_entity' ? `Create ${ent.humanLabel}`
      : name === 'update_entity' ? `Update ${ent.humanLabel} ${input.id ?? ''}`
      : `Delete ${ent.humanLabel} ${input.id ?? ''}`;
    let details: Record<string, unknown> = {};
    if (name === 'create_entity') {
      const { clean } = sanitize(ent, (input.data as Record<string, unknown>) ?? {});
      details = clean;
    } else if (name === 'update_entity') {
      const { clean } = sanitize(ent, (input.patch as Record<string, unknown>) ?? {});
      details = { id: input.id, ...clean };
    } else {
      details = { id: input.id, note: 'Delete is irreversible.' };
    }

    const toolUseId = `tu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await ctx.supabase.from('agent_actions').insert({
      id: makeId('AGA'),
      threadId: ctx.threadId,
      toolUseId,
      toolName: name,
      mode,
      input,
      preview: { action: actionLabel, details },
      status: 'pending',
      userId: ctx.userId,
      companyId: ctx.companyId === 'ALL' ? null : ctx.companyId,
    });

    return {
      ok: true,
      summary: `${actionLabel} — awaiting human approval (open the in-app panel to confirm)`,
      payload: { status: 'awaiting_human_approval', action: actionLabel, toolUseId },
    };
  }

  return { ok: false, summary: `Unknown tool: ${name}`, payload: null };
}

// ── Claude call ──────────────────────────────────────────────────────

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

interface ClaudeResp {
  stop_reason: string;
  content: Block[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function callClaude(messages: Array<{ role: 'user' | 'assistant'; content: string | Block[] }>, systemPrompt: string): Promise<ClaudeResp> {
  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      'x-api-key': ANTHROPIC_API_KEY,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages,
      tools: TOOLS,
    }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Claude ${resp.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as ClaudeResp;
}

// ── Public: runAgentFromWhatsApp ─────────────────────────────────────

export interface RunFromWhatsAppArgs {
  supabase: SupabaseClient;
  threadId: string;
  userId: string;
  companyId: string;
  userText: string;
}

export interface RunFromWhatsAppResult {
  replyText: string;
  messagesPersisted: number;
  awaitingApproval: boolean;
}

export async function runAgentFromWhatsApp(args: RunFromWhatsAppArgs): Promise<RunFromWhatsAppResult> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');

  // 1. Persist user turn.
  await args.supabase.from('agent_messages').insert({
    id: makeId('MSG'),
    threadId: args.threadId,
    role: 'user',
    content: { role: 'user', text: args.userText },
  });

  // 2. Load history.
  const { data: historyRows } = await args.supabase
    .from('agent_messages')
    .select('content')
    .eq('threadId', args.threadId)
    .order('createdAt', { ascending: true });

  const history: Array<{ role: 'user' | 'assistant'; content: string | Block[] }> = [];
  for (const r of historyRows ?? []) {
    const c = r.content as { role: 'user' | 'assistant'; text?: string; toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>; toolResults?: Array<{ toolUseId: string; result: { kind: string; summary: string; data?: unknown } }> };
    if (c.role === 'assistant') {
      const blocks: Block[] = [];
      if (c.text) blocks.push({ type: 'text', text: c.text });
      for (const tc of c.toolCalls ?? []) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      if (blocks.length) history.push({ role: 'assistant', content: blocks.length === 1 && blocks[0].type === 'text' ? blocks[0].text : blocks });
    } else {
      if (c.toolResults?.length) {
        const blocks: Block[] = c.toolResults.map(tr => ({
          type: 'tool_result',
          tool_use_id: tr.toolUseId,
          content: JSON.stringify(tr.result),
          is_error: tr.result.kind === 'error',
        }));
        if (c.text) blocks.unshift({ type: 'text', text: c.text });
        history.push({ role: 'user', content: blocks });
      } else if (c.text) {
        history.push({ role: 'user', content: c.text });
      }
    }
  }

  const systemPrompt = buildSystemPrompt(args.companyId);
  const ctx: ToolCtx = {
    supabase: args.supabase,
    companyId: args.companyId,
    userId: args.userId,
    threadId: args.threadId,
  };

  let replyText = '';
  let messagesPersisted = 0;
  let awaitingApproval = false;

  for (let step = 0; step < DEFAULT_MAX_STEPS; step++) {
    const resp = await callClaude(history, systemPrompt);

    let text = '';
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    for (const b of resp.content) {
      if (b.type === 'text') text += (text ? '\n' : '') + b.text;
      else if (b.type === 'tool_use') toolCalls.push({ id: b.id, name: b.name, input: b.input ?? {} });
    }

    const assistantBlocks: Block[] = [];
    if (text) assistantBlocks.push({ type: 'text', text });
    for (const tc of toolCalls) assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    history.push({ role: 'assistant', content: assistantBlocks.length === 1 && assistantBlocks[0].type === 'text' ? assistantBlocks[0].text : assistantBlocks });

    await args.supabase.from('agent_messages').insert({
      id: makeId('MSG'),
      threadId: args.threadId,
      role: 'assistant',
      content: {
        role: 'assistant',
        text: text || undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      },
    });
    messagesPersisted++;
    if (text) replyText = text;

    if (toolCalls.length === 0) break;

    const toolResults: Array<{ toolUseId: string; result: { kind: string; summary: string; data?: unknown } }> = [];
    const toolBlocks: Block[] = [];
    for (const call of toolCalls) {
      const out = await execTool(call.name, call.input, ctx);
      if (out.payload && typeof out.payload === 'object' && (out.payload as { status?: string }).status === 'awaiting_human_approval') {
        awaitingApproval = true;
      }
      const resultSummary = out.summary;
      toolResults.push({ toolUseId: call.id, result: { kind: out.ok ? 'ok' : 'error', summary: resultSummary, data: out.payload } });
      toolBlocks.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: JSON.stringify({ ok: out.ok, summary: resultSummary, data: out.payload }),
        is_error: !out.ok,
      });
    }
    history.push({ role: 'user', content: toolBlocks });
    await args.supabase.from('agent_messages').insert({
      id: makeId('MSG'),
      threadId: args.threadId,
      role: 'user',
      content: { role: 'user', toolResults },
    });
    messagesPersisted++;

    if (resp.stop_reason === 'end_turn') break;
    if (awaitingApproval) break;
  }

  // Touch thread.
  await args.supabase.from('agent_threads').update({ updatedAt: new Date().toISOString() }).eq('id', args.threadId);

  if (!replyText) {
    replyText = awaitingApproval
      ? 'I prepared that action — please open the in-app panel to approve.'
      : '(no response)';
  }

  return { replyText, messagesPersisted, awaitingApproval };
}

// ── WhatsApp audio + sending helpers ─────────────────────────────────

export async function transcribeWhatsAppAudio(mediaId: string, accessToken: string): Promise<string> {
  // Step 1: resolve media URL
  const metaResp = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!metaResp.ok) throw new Error(`media lookup ${metaResp.status}`);
  const meta = await metaResp.json() as { url?: string; mime_type?: string };
  if (!meta.url) throw new Error('no media url');

  // Step 2: download bytes
  const dl = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!dl.ok) throw new Error(`media download ${dl.status}`);
  const buf = new Uint8Array(await dl.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  const b64 = btoa(bin);

  // Step 3: gemini transcription directly (edge function → edge function call
  // would need a service JWT; simpler to hit Google directly here).
  const geminiKey = Deno.env.get('GEMINI_API_KEY') || '';
  if (!geminiKey) throw new Error('GEMINI_API_KEY not set');
  const gResp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: meta.mime_type || 'audio/ogg', data: b64 } },
            { text: 'Transcribe this audio verbatim. Output only the transcript, no preamble.' },
          ],
        }],
      }),
    },
  );
  if (!gResp.ok) throw new Error(`gemini ${gResp.status}: ${(await gResp.text()).slice(0, 200)}`);
  const gJson = await gResp.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const parts = gJson.candidates?.[0]?.content?.parts ?? [];
  return parts.map(p => p.text ?? '').join('').trim();
}

export async function sendWhatsAppReply(to: string, text: string): Promise<void> {
  const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || '';
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN') || '';
  if (!phoneId || !token) {
    console.error('[agent] WhatsApp send not configured');
    return;
  }
  const resp = await fetch(`https://graph.facebook.com/v22.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace('+', ''),
      type: 'text',
      text: { preview_url: false, body: text.slice(0, 4000) },
    }),
  });
  if (!resp.ok) {
    console.error('[agent] whatsapp send failed', resp.status, await resp.text());
  }
}
