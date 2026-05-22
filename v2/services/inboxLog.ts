// Per-browser log of autonomous email actions — what the bg loop did
// and the state of anything pending (drafts, unclassified, discards).
//
// localStorage-backed so the log survives page reloads without a DB
// migration. Key shape: `xs_ai_inbox_log_<userId>`. Retention: last
// 500 entries (oldest pruned) — plenty for a week of activity at the
// 15-min cadence.
//
// When the `ai_inbox_log` DB table eventually ships, this file can
// add a mirror-write; the consumer UI already tolerates either source.

export type InboxAction =
  | 'attached_to_existing'
  | 'saved_new_invoice'
  | 'saved_new_purchase_order'
  | 'saved_new_bill_of_lading'
  | 'saved_new_packing_list'
  | 'skipped_unclassified'
  | 'drafted'
  | 'no_match'
  | 'failed'
  // Correction-request outcomes — the classifier identified a request
  // to change a field value. Applied mutations are UI-gated.
  | 'correction_proposed'
  | 'correction_confirmed_current'
  | 'correction_manual_only'
  | 'correction_applied';

export type InboxStatus = 'active' | 'discarded' | 'sent' | 'undone' | 'superseded';

/** Actions that conclude a message's processing. Once an entry with
 *  one of these actions lands, any prior non-terminal entries for the
 *  same messageId get archived so they stop cluttering "Needs review". */
const TERMINAL_ACTIONS = new Set<InboxAction>([
  'saved_new_invoice',
  'saved_new_purchase_order',
  'saved_new_bill_of_lading',
  'saved_new_packing_list',
  'saved_new_booking',
  'attached_to_existing',
  'drafted',
  'correction_proposed',
  'correction_applied',
  'correction_confirmed_current',
]);

export interface InboxLogEntry {
  id: string;                   // uuid
  messageId: string;
  source: 'outlook' | 'gmail';
  from: string;
  fromAddress?: string;
  subject: string;
  receivedAt: string;           // ISO from original email
  docType?: string;             // INVOICE / PO / BL / PL / null
  refNumber?: string | null;
  attachmentName?: string;

  action: InboxAction;
  status: InboxStatus;

  // Saved / attached
  entityKind?: string;          // 'invoice' | 'sales_order' | ...
  entityId?: string;
  entityLabel?: string;

  // Drafted reply
  draftId?: string;             // Graph/Gmail draft id — needed to send later
  replyTo?: string;
  replySubject?: string;

  // Correction payload (only for correction_* actions).
  correctionField?: string;
  correctionCurrent?: string | number | null;
  correctionRequested?: string | number | null;
  /** Audit of the value that was overwritten on apply. */
  correctionBefore?: string | number | null;

  message: string;              // human line surfaced in chat / list
  error?: string;

  createdAt: string;
}

const MAX_ENTRIES = 500;

const storageKey = (userId?: string) => `xs_ai_inbox_log_${userId ?? 'guest'}`;

let _userId: string | undefined;

export function setInboxLogUser(userId: string | undefined): void {
  _userId = userId;
}

function readAll(): InboxLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(_userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeAll(entries: InboxLogEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Trim to the most-recent MAX_ENTRIES.
    const trimmed = entries.slice(-MAX_ENTRIES);
    localStorage.setItem(storageKey(_userId), JSON.stringify(trimmed));
  } catch { /* quota or disabled — noop */ }
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `ent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Public API ───────────────────────────────────────────────────

export function listInboxLog(): InboxLogEntry[] {
  return readAll().slice().reverse(); // newest first
}

/** Add a new entry — de-duped on (messageId, action, attachmentName).
 *  Returns the final id (either newly created, or the existing one
 *  if a duplicate was detected). */
export function appendInboxLog(
  entry: Omit<InboxLogEntry, 'id' | 'createdAt' | 'status'> & { status?: InboxStatus },
): InboxLogEntry {
  const all = readAll();
  const dupIdx = all.findIndex(e =>
    e.messageId === entry.messageId &&
    e.action === entry.action &&
    (e.attachmentName ?? '') === (entry.attachmentName ?? '')
  );
  if (dupIdx >= 0) return all[dupIdx];
  const full: InboxLogEntry = {
    ...entry,
    id: uuid(),
    status: entry.status ?? 'active',
    createdAt: new Date().toISOString(),
  };
  // If this new entry is a terminal action (success / draft / correction),
  // mark any prior non-terminal entries for the same messageId as
  // superseded so they no longer clutter "Needs review". Without this,
  // a re-scan that finally finds a BOOKING save path leaves the stale
  // "skipped_unclassified" row hanging in the queue.
  if (TERMINAL_ACTIONS.has(full.action) && full.messageId) {
    for (const prior of all) {
      if (
        prior.messageId === full.messageId &&
        prior.status === 'active' &&
        !TERMINAL_ACTIONS.has(prior.action)
      ) {
        prior.status = 'superseded';
      }
    }
  }
  all.push(full);
  writeAll(all);
  return full;
}

export function patchInboxLog(id: string, patch: Partial<InboxLogEntry>): InboxLogEntry | null {
  const all = readAll();
  const idx = all.findIndex(e => e.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...patch };
  writeAll(all);
  return all[idx];
}

export function findInboxLog(id: string): InboxLogEntry | null {
  return readAll().find(e => e.id === id) ?? null;
}

/** Filters an entry list by UI queue. Pure — call with the output
 *  of `listInboxLog()` so it doesn't re-read storage each tick. */
export type InboxQueue =
  | 'needs_review'
  | 'saved'
  | 'attached'
  | 'drafts'
  | 'sent'
  | 'corrections'
  | 'history';

export function filterByQueue(entries: InboxLogEntry[], queue: InboxQueue): InboxLogEntry[] {
  switch (queue) {
    case 'needs_review':
      // Includes classifier failures + correction requests that need
      // manual review (sensitive field / unparseable requested value).
      return entries.filter(e =>
        e.status === 'active' &&
        (e.action === 'skipped_unclassified' ||
         e.action === 'no_match' ||
         e.action === 'failed' ||
         e.action === 'correction_manual_only')
      );
    case 'saved':
      return entries.filter(e =>
        e.status === 'active' &&
        (e.action === 'saved_new_invoice' ||
         e.action === 'saved_new_purchase_order' ||
         e.action === 'saved_new_bill_of_lading' ||
         e.action === 'saved_new_packing_list' ||
         e.action === 'saved_new_booking')
      );
    case 'attached':
      return entries.filter(e => e.status === 'active' && e.action === 'attached_to_existing');
    case 'drafts':
      // Reply drafts waiting for approval — NOT yet sent.
      return entries.filter(e => e.status === 'active' && e.action === 'drafted');
    case 'sent':
      return entries.filter(e => e.status === 'sent');
    case 'corrections':
      // Auto-proposable corrections + the "already correct" confirmations
      // (user may still want to ack the sender).
      return entries.filter(e =>
        e.status === 'active' &&
        (e.action === 'correction_proposed' ||
         e.action === 'correction_confirmed_current' ||
         e.action === 'correction_applied')
      );
    case 'history':
      return entries;
  }
}

export function queueCounts(entries: InboxLogEntry[]): Record<InboxQueue, number> {
  return {
    needs_review: filterByQueue(entries, 'needs_review').length,
    saved: filterByQueue(entries, 'saved').length,
    attached: filterByQueue(entries, 'attached').length,
    drafts: filterByQueue(entries, 'drafts').length,
    sent: filterByQueue(entries, 'sent').length,
    corrections: filterByQueue(entries, 'corrections').length,
    history: entries.length,
  };
}
