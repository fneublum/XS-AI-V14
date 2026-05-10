// Correction intent handler.
//
// Given an invoice row and a CorrectionClaim from the email
// classifier, decide whether:
//   • the claim matches current state (already correct)
//   • the claim differs AND targets a whitelisted field (propose)
//   • the claim targets a sensitive field or is unparseable (manual)
//
// Also exports `applyCorrection` — called only from the UI when the
// user approves. Never runs in the background scanner.

import { getSupabaseClient } from '../../services/supabase';
import type { CorrectionField } from './replyDrafter';

export type CorrectionDecision =
  | { kind: 'already_correct'; current: string | number }
  | { kind: 'propose';         current: string | number | null; requested: string | number; field: CorrectionField; column: string; table: string }
  | { kind: 'manual';          reason: string };

// ─── Field whitelist — safe to auto-propose (user still approves) ─

interface FieldSpec {
  table: 'invoices';
  column: string;
  kind: 'number' | 'string';
  label: string;
}

const INVOICE_FIELD_MAP: Record<CorrectionField, FieldSpec | null> = {
  grossWeight:  { table: 'invoices', column: 'grossWeight',  kind: 'number', label: 'Gross weight (kg)' },
  netWeight:    { table: 'invoices', column: 'netWeight',    kind: 'number', label: 'Net weight (kg)' },
  totalVolumes: { table: 'invoices', column: 'totalVolumes', kind: 'number', label: 'Total volumes' },
  incoterm:     { table: 'invoices', column: 'incoterm',     kind: 'string', label: 'Incoterm' },
  paymentTerms: { table: 'invoices', column: 'paymentTerms', kind: 'string', label: 'Payment terms' },
  poa:          { table: 'invoices', column: 'poa',          kind: 'string', label: 'Port of origin' },
  pod:          { table: 'invoices', column: 'pod',          kind: 'string', label: 'Port of destination' },
  billToName:   { table: 'invoices', column: 'billToName',   kind: 'string', label: 'Bill-to name' },
  soldTo:       { table: 'invoices', column: 'soldTo',       kind: 'string', label: 'Sold-to name' },
  other:        null,
};

// ─── Helpers ──────────────────────────────────────────────────────

const parseNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.\-]/g, ''));
    if (Number.isFinite(n) && v.trim() !== '') return n;
  }
  return null;
};

const normalizeStr = (v: unknown): string => String(v ?? '').trim();

/** Fuzzy-match — two numeric values are "the same" within 0.5% or 2 units. */
function numbersMatch(a: number, b: number): boolean {
  if (a === b) return 0 === 0;
  const diff = Math.abs(a - b);
  const rel = Math.abs(a) > 1 ? diff / Math.abs(a) : diff;
  return rel < 0.005 || diff < 2;
}

function stringsMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

// ─── Decision ─────────────────────────────────────────────────────

export function decideCorrection(
  invoice: Record<string, unknown>,
  claim: { field: CorrectionField; requestedValue: string | number | null },
): CorrectionDecision {
  if (claim.field === 'other') {
    return { kind: 'manual', reason: 'Field is not in the auto-proposable whitelist.' };
  }
  const spec = INVOICE_FIELD_MAP[claim.field];
  if (!spec) {
    return { kind: 'manual', reason: 'Unknown field.' };
  }
  if (claim.requestedValue == null) {
    return { kind: 'manual', reason: 'AI could not extract a concrete requested value.' };
  }

  const currentRaw = invoice[spec.column];

  if (spec.kind === 'number') {
    const current = parseNum(currentRaw);
    const requested = parseNum(claim.requestedValue);
    if (requested == null) return { kind: 'manual', reason: 'Requested value is not numeric.' };
    if (current != null && numbersMatch(current, requested)) {
      return { kind: 'already_correct', current };
    }
    return {
      kind: 'propose',
      current,
      requested,
      field: claim.field,
      column: spec.column,
      table: spec.table,
    };
  }

  // string
  const current = currentRaw == null ? '' : normalizeStr(currentRaw);
  const requested = normalizeStr(claim.requestedValue);
  if (!requested) return { kind: 'manual', reason: 'Requested value is empty.' };
  if (current && stringsMatch(current, requested)) {
    return { kind: 'already_correct', current };
  }
  return {
    kind: 'propose',
    current: current || null,
    requested,
    field: claim.field,
    column: spec.column,
    table: spec.table,
  };
}

// ─── Apply (user-approved only) ──────────────────────────────────

export interface ApplyResult {
  ok: boolean;
  error?: string;
  /** Before-value we overwrote — captured for the audit trail. */
  before?: string | number | null;
}

export async function applyCorrection(
  entityId: string,
  field: CorrectionField,
  requestedValue: string | number,
): Promise<ApplyResult> {
  const spec = INVOICE_FIELD_MAP[field];
  if (!spec) return { ok: false, error: 'Field not in whitelist' };

  const sb = getSupabaseClient();

  // Read current value for audit.
  const { data: before, error: readErr } = await sb
    .from(spec.table)
    .select(spec.column)
    .eq('id', entityId)
    .single();
  if (readErr) {
    // `totalVolumes` might not exist on the schema yet — detect and
    // surface a clean error so the UI can fall back to manual edit.
    if (spec.column === 'totalVolumes' && /column/i.test(readErr.message)) {
      return { ok: false, error: `Column "${spec.column}" does not exist on the invoices table. Add it or edit manually.` };
    }
    return { ok: false, error: readErr.message };
  }

  // Normalize the value to the right kind before writing.
  const nextValue =
    spec.kind === 'number'
      ? parseNum(requestedValue)
      : normalizeStr(requestedValue);
  if (nextValue == null || nextValue === '') {
    return { ok: false, error: 'Requested value normalized to empty — refusing to write.' };
  }

  const { error: writeErr } = await sb
    .from(spec.table)
    .update({ [spec.column]: nextValue })
    .eq('id', entityId);
  if (writeErr) {
    if (spec.column === 'totalVolumes' && /column/i.test(writeErr.message)) {
      return { ok: false, error: `Column "${spec.column}" does not exist on the invoices table. Add it or edit manually.` };
    }
    return { ok: false, error: writeErr.message };
  }

  const beforeValue = (before as Record<string, unknown> | null)?.[spec.column] as string | number | null | undefined;
  return {
    ok: true,
    before: beforeValue == null ? null : (spec.kind === 'number' ? parseNum(beforeValue) : normalizeStr(beforeValue)),
  };
}

/** Human label for a field, for diff views. */
export function fieldLabel(field: CorrectionField): string {
  return INVOICE_FIELD_MAP[field]?.label ?? field;
}
