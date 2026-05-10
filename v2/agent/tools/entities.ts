// Agent v2 — generic CRUD tools over every entity in the catalog.
//
// Five tools cover read + write across all 15 entities instead of 80
// hand-crafted per-entity tools. Claude picks the entity via the
// `entity` arg; the tool resolves it via entityCatalog and runs the
// matching Supabase query.

import { defineTool } from '../registry';
import { getSupabaseClient } from '../../../services/supabase';
import {
  ENTITIES, entityKeys, getEntityDef, sanitizePayload,
} from '../entityCatalog';
import type { ToolContext, ToolResult } from '../types';

const ENTITY_ENUM_DESC = `Must be one of: ${entityKeys().join(', ')}.`;

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function executeList(
  input: { entity: string; search?: string; limit?: number; filters?: Record<string, unknown> },
  ctx: ToolContext,
): Promise<ToolResult> {
  const ent = getEntityDef(input.entity);
  if (!ent) return { kind: 'error', summary: `Unknown entity: ${input.entity}` };

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const supabase = getSupabaseClient();
  let q = supabase
    .from(ent.table)
    .select(ent.summaryColumns.join(','))
    .limit(limit);

  if (ent.companyScoped && ctx.companyId !== 'ALL') {
    q = q.eq('companyId', ctx.companyId);
  }

  if (input.search && ent.searchColumns.length > 0) {
    const s = `%${input.search.trim()}%`;
    const orExpr = ent.searchColumns.map(c => `${c}.ilike.${s}`).join(',');
    q = q.or(orExpr);
  }

  if (input.filters) {
    for (const [k, v] of Object.entries(input.filters)) {
      if (v === null || v === undefined) continue;
      q = q.eq(k, v as never);
    }
  }

  const { data, error } = await q;
  if (error) return { kind: 'error', summary: `List failed: ${error.message}` };

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  return {
    kind: 'ok',
    summary: `Found ${rows.length} ${ent.humanLabel}${rows.length === 1 ? '' : 's'}`,
    data: { entity: ent.key, count: rows.length, rows },
  };
}

async function executeGet(
  input: { entity: string; id: string },
  _ctx: ToolContext,
): Promise<ToolResult> {
  const ent = getEntityDef(input.entity);
  if (!ent) return { kind: 'error', summary: `Unknown entity: ${input.entity}` };
  if (!input.id) return { kind: 'error', summary: 'id is required' };

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(ent.table)
    .select('*')
    .eq('id', input.id)
    .maybeSingle();
  if (error) return { kind: 'error', summary: `Get failed: ${error.message}` };
  if (!data) return { kind: 'error', summary: `${ent.humanLabel} ${input.id} not found` };

  return {
    kind: 'ok',
    summary: `Loaded ${ent.humanLabel} ${input.id}`,
    data,
  };
}

async function executeCreate(
  input: { entity: string; data: Record<string, unknown> },
  ctx: ToolContext,
): Promise<ToolResult> {
  const ent = getEntityDef(input.entity);
  if (!ent) return { kind: 'error', summary: `Unknown entity: ${input.entity}` };
  if (!input.data || typeof input.data !== 'object') {
    return { kind: 'error', summary: 'data (object) is required' };
  }

  const { clean, dropped } = sanitizePayload(ent, input.data);
  if (Object.keys(clean).length === 0) {
    return { kind: 'error', summary: `No writable fields in payload. Dropped: ${dropped.join(', ') || '(none)'}` };
  }

  if (!ctx.approved) {
    return {
      kind: 'needs_confirmation',
      summary: `Create ${ent.humanLabel} requires confirmation`,
      preview: {
        action: `Create ${ent.humanLabel}`,
        details: clean,
      },
    };
  }

  const id = makeId(ent.idPrefix);
  const payload: Record<string, unknown> = {
    id,
    ...clean,
    createdAt: new Date().toISOString(),
  };
  if (ent.companyScoped && ctx.companyId !== 'ALL') {
    payload.companyId = ctx.companyId;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from(ent.table).insert(payload);
  if (error) return { kind: 'error', summary: `Create failed: ${error.message}` };

  return {
    kind: 'ok',
    summary: `Created ${ent.humanLabel} ${id}`,
    data: { id, dropped },
  };
}

async function executeUpdate(
  input: { entity: string; id: string; patch: Record<string, unknown> },
  ctx: ToolContext,
): Promise<ToolResult> {
  const ent = getEntityDef(input.entity);
  if (!ent) return { kind: 'error', summary: `Unknown entity: ${input.entity}` };
  if (!input.id) return { kind: 'error', summary: 'id is required' };

  const { clean, dropped } = sanitizePayload(ent, input.patch ?? {});
  if (Object.keys(clean).length === 0) {
    return { kind: 'error', summary: `No writable fields in patch. Dropped: ${dropped.join(', ') || '(none)'}` };
  }

  if (!ctx.approved) {
    return {
      kind: 'needs_confirmation',
      summary: `Update ${ent.humanLabel} ${input.id} requires confirmation`,
      preview: {
        action: `Update ${ent.humanLabel} ${input.id}`,
        details: clean,
      },
    };
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from(ent.table).update(clean).eq('id', input.id);
  if (error) return { kind: 'error', summary: `Update failed: ${error.message}` };

  return {
    kind: 'ok',
    summary: `Updated ${ent.humanLabel} ${input.id}`,
    data: { id: input.id, patched: clean, dropped },
  };
}

async function executeDelete(
  input: { entity: string; id: string },
  ctx: ToolContext,
): Promise<ToolResult> {
  const ent = getEntityDef(input.entity);
  if (!ent) return { kind: 'error', summary: `Unknown entity: ${input.entity}` };
  if (!input.id) return { kind: 'error', summary: 'id is required' };

  if (!ctx.approved) {
    return {
      kind: 'needs_confirmation',
      summary: `Delete ${ent.humanLabel} ${input.id} (destructive, requires confirmation)`,
      preview: {
        action: `Delete ${ent.humanLabel}`,
        details: { id: input.id, note: 'Related records that reference this row may break.' },
      },
    };
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from(ent.table).delete().eq('id', input.id);
  if (error) return { kind: 'error', summary: `Delete failed: ${error.message}` };

  return {
    kind: 'ok',
    summary: `Deleted ${ent.humanLabel} ${input.id}`,
    data: { id: input.id },
  };
}

// Exposed for unit tests; the real loop uses defineTool registrations below.
export const _impl = { executeList, executeGet, executeCreate, executeUpdate, executeDelete };

defineTool({
  name: 'list_entities',
  description:
    'List or search entities of a given type. Use this to find records ' +
    'before read/update/delete. Supports fuzzy search across the entity\'s ' +
    'searchable columns. ' + ENTITY_ENUM_DESC,
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      entity: { type: 'string', enum: entityKeys(), description: 'Entity type.' },
      search: { type: 'string', description: 'Optional free-text search across name/number/etc.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      filters: {
        type: 'object',
        description: 'Optional column=value filters. Column names must match exactly.',
        additionalProperties: true,
      },
    },
    required: ['entity'],
  },
  execute: (input, ctx) => executeList(input as never, ctx),
});

defineTool({
  name: 'get_entity',
  description:
    'Fetch a single entity by id, returning all columns. Use after ' +
    'list_entities narrows down to one record. ' + ENTITY_ENUM_DESC,
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      entity: { type: 'string', enum: entityKeys() },
      id: { type: 'string' },
    },
    required: ['entity', 'id'],
  },
  execute: (input, ctx) => executeGet(input as never, ctx),
});

defineTool({
  name: 'create_entity',
  description:
    'Create a new record. Requires human confirmation the first time ' +
    '(the runtime will pause with a preview). ' + ENTITY_ENUM_DESC,
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      entity: { type: 'string', enum: entityKeys() },
      data: {
        type: 'object',
        description: 'Column=value payload. Non-writable columns are ignored.',
        additionalProperties: true,
      },
    },
    required: ['entity', 'data'],
  },
  execute: (input, ctx) => executeCreate(input as never, ctx),
});

defineTool({
  name: 'update_entity',
  description:
    'Patch fields on an existing record. Requires human confirmation. ' +
    ENTITY_ENUM_DESC,
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      entity: { type: 'string', enum: entityKeys() },
      id: { type: 'string' },
      patch: {
        type: 'object',
        description: 'Fields to update. Non-writable columns are ignored.',
        additionalProperties: true,
      },
    },
    required: ['entity', 'id', 'patch'],
  },
  execute: (input, ctx) => executeUpdate(input as never, ctx),
});

defineTool({
  name: 'delete_entity',
  description:
    'Delete a record permanently. DESTRUCTIVE — always requires human ' +
    'confirmation. Related records that reference this row may break. ' +
    ENTITY_ENUM_DESC,
  mode: 'destructive',
  inputSchema: {
    type: 'object',
    properties: {
      entity: { type: 'string', enum: entityKeys() },
      id: { type: 'string' },
    },
    required: ['entity', 'id'],
  },
  execute: (input, ctx) => executeDelete(input as never, ctx),
});

// Entity metadata helper — lets the agent discover writable columns
// for an entity without guessing. Useful before create/update.
defineTool({
  name: 'describe_entity',
  description:
    'Return the writable columns, searchable columns, and summary ' +
    'columns for a given entity. Use this if unsure what fields the ' +
    'create/update tools accept. ' + ENTITY_ENUM_DESC,
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      entity: { type: 'string', enum: entityKeys() },
    },
    required: ['entity'],
  },
  execute: async (input) => {
    const ent = getEntityDef((input as { entity: string }).entity);
    if (!ent) return { kind: 'error', summary: `Unknown entity: ${(input as { entity: string }).entity}` };
    return {
      kind: 'ok',
      summary: `Schema for ${ent.humanLabel}`,
      data: {
        key: ent.key,
        table: ent.table,
        humanLabel: ent.humanLabel,
        writableColumns: ent.writableColumns,
        searchColumns: ent.searchColumns,
        summaryColumns: ent.summaryColumns,
        companyScoped: ent.companyScoped,
      },
    };
  },
});

defineTool({
  name: 'list_entity_types',
  description:
    'Return the list of entity types the agent can manipulate, along ' +
    'with a one-line description of each. Use to remind yourself what ' +
    'is reachable.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  execute: async () => ({
    kind: 'ok',
    summary: `${ENTITIES.length} entity types available`,
    data: ENTITIES.map(e => ({
      key: e.key,
      humanLabel: e.humanLabel,
      table: e.table,
      companyScoped: e.companyScoped,
    })),
  }),
});
