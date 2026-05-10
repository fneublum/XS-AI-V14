// AI Inbox — single focused surface for the autonomous email pipeline.
//
// Left rail: queues (needs review / saved / attached / drafts / history)
// Middle: list of entries in the selected queue
// Right: detail + action buttons (send draft, re-classify, attach to…,
//        discard, open in Outlook).
//
// Backed by the localStorage log in `v2/services/inboxLog.ts`; pulls
// auth + connection state from `services/smailAuth` to render the top
// status bar.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Inbox, FileText, Paperclip, Send, SendHorizontal, Clock, RefreshCw, Play, Pause,
  CheckCircle2, XCircle, AlertCircle, ExternalLink, Check, Trash2, X,
  Sparkles, FileStack, Wrench, ArrowRight,
} from 'lucide-react';
import { cn } from '../primitives/utils';
import { Button } from '../primitives/Button';
import { useToast } from '../primitives/Toast';
import { useEditor } from '../providers/EditorProvider';
import {
  listInboxLog, filterByQueue, queueCounts, patchInboxLog,
  InboxLogEntry, InboxQueue,
} from '../services/inboxLog';
import {
  triggerInboxScanNow,
  TRIAGE_UPDATE_EVENT, BOOKING_ALERTS_EVENT, EMAIL_PROCESSED_EVENT, REPLY_DRAFTED_EVENT,
} from '../hooks/useBackgroundJobs';
import { sendDraft } from '../services/replyDrafter';
import { applyCorrection, fieldLabel } from '../services/correctionsEngine';
import { getAccountFor, getGoogleAccount } from '../../services/smailAuth';

// ─── Connection status ────────────────────────────────────────────

interface ConnState {
  outlook: { connected: boolean; email?: string };
  gmail: { connected: boolean; email?: string };
}

function readConnState(): ConnState {
  const ol1 = getAccountFor('automation');
  const ol2 = getAccountFor('my');
  const gm = getGoogleAccount();
  return {
    outlook: {
      connected: !!(ol1 || ol2),
      email: ol1?.username ?? ol2?.username,
    },
    gmail: {
      connected: !!gm,
      email: gm?.email,
    },
  };
}

// ─── Queue config ─────────────────────────────────────────────────

interface QueueDef {
  id: InboxQueue;
  label: string;
  icon: React.ElementType;
  tone: string;
  description: string;
}

const QUEUES: QueueDef[] = [
  { id: 'corrections',  label: 'Corrections',  icon: Wrench,          tone: 'text-rose-300',    description: 'Senders reporting a field is wrong — approve or reject.' },
  { id: 'saved',        label: 'OCR - Saved',  icon: FileText,        tone: 'text-emerald-300', description: 'OCR-extracted docs the AI saved as new records.' },
  { id: 'attached',     label: 'Attached',     icon: Paperclip,       tone: 'text-indigo-300',  description: 'Existing records that got a PDF attached.' },
  { id: 'drafts',       label: 'Reply drafts', icon: Send,            tone: 'text-violet-300',  description: 'Pre-built replies waiting in your outbox.' },
  { id: 'needs_review', label: 'Needs review', icon: Sparkles,        tone: 'text-amber-300',   description: 'AI couldn\'t act alone — pick a target manually.' },
  { id: 'sent',         label: 'Sent',         icon: SendHorizontal,  tone: 'text-sky-300',     description: 'Replies you pushed through — delivered via Outlook/Gmail.' },
  { id: 'history',      label: 'History',      icon: Clock,           tone: 'text-slate-400',   description: 'Everything the AI touched, newest first.' },
];

// ─── Action helpers ───────────────────────────────────────────────

function timeAgo(iso: string): string {
  if (!iso) return '—';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function actionBadge(entry: InboxLogEntry): { label: string; tone: string } {
  switch (entry.action) {
    case 'saved_new_invoice':              return { label: 'OCR · Invoice',    tone: 'bg-emerald-500/15 text-emerald-200' };
    case 'saved_new_purchase_order':       return { label: 'OCR · PO',         tone: 'bg-emerald-500/15 text-emerald-200' };
    case 'saved_new_bill_of_lading':       return { label: 'OCR · BL',         tone: 'bg-emerald-500/15 text-emerald-200' };
    case 'saved_new_packing_list':         return { label: 'OCR · PL',         tone: 'bg-emerald-500/15 text-emerald-200' };
    case 'attached_to_existing':           return { label: 'Attached',         tone: 'bg-indigo-500/15 text-indigo-200' };
    case 'drafted':                        return { label: 'Reply draft',      tone: 'bg-violet-500/15 text-violet-200' };
    case 'skipped_unclassified':           return { label: 'Unclassified',     tone: 'bg-amber-500/15 text-amber-200' };
    case 'no_match':                       return { label: 'No match',         tone: 'bg-amber-500/15 text-amber-200' };
    case 'failed':                         return { label: 'Failed',           tone: 'bg-red-500/15 text-red-200' };
    case 'correction_proposed':            return { label: 'Correction · pending', tone: 'bg-rose-500/15 text-rose-200' };
    case 'correction_confirmed_current':   return { label: 'Correction · already correct', tone: 'bg-emerald-500/15 text-emerald-200' };
    case 'correction_manual_only':         return { label: 'Correction · manual', tone: 'bg-amber-500/15 text-amber-200' };
    case 'correction_applied':             return { label: 'Correction · applied', tone: 'bg-sky-500/15 text-sky-200' };
    default:                               return { label: entry.action,       tone: 'bg-slate-500/15 text-slate-200' };
  }
}

function outlookDeepLink(messageId: string): string {
  return `https://outlook.office.com/mail/inbox/id/${encodeURIComponent(messageId)}`;
}
function gmailDeepLink(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${messageId}`;
}

// ─── Component ────────────────────────────────────────────────────

const AiInboxV2: React.FC = () => {
  const toast = useToast();
  const { openInvoice } = useEditor();
  const [activeQueue, setActiveQueue] = useState<InboxQueue>('corrections');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [conn, setConn] = useState<ConnState>(() => readConnState());
  const [, force] = useState(0);
  const refresh = () => force(n => n + 1);

  useEffect(() => {
    const onTick = () => { refresh(); setConn(readConnState()); };
    window.addEventListener(TRIAGE_UPDATE_EVENT, onTick);
    window.addEventListener(BOOKING_ALERTS_EVENT, onTick);
    window.addEventListener(EMAIL_PROCESSED_EVENT, onTick);
    window.addEventListener(REPLY_DRAFTED_EVENT, onTick);
    const t = window.setInterval(onTick, 30_000);
    return () => {
      window.removeEventListener(TRIAGE_UPDATE_EVENT, onTick);
      window.removeEventListener(BOOKING_ALERTS_EVENT, onTick);
      window.removeEventListener(EMAIL_PROCESSED_EVENT, onTick);
      window.removeEventListener(REPLY_DRAFTED_EVENT, onTick);
      window.clearInterval(t);
    };
  }, []);

  const allEntries = useMemo(() => listInboxLog(), [/* tick trigger */]);
  const counts = useMemo(() => queueCounts(allEntries), [allEntries]);
  const visible = useMemo(
    () => filterByQueue(allEntries, activeQueue),
    [allEntries, activeQueue],
  );
  const selected = visible.find(e => e.id === selectedId) ?? null;

  const scanNow = async () => {
    setScanBusy(true);
    try {
      await triggerInboxScanNow();
      toast.push({ kind: 'info', title: 'Scan complete', description: 'Queues refreshed' });
      refresh();
    } finally {
      setScanBusy(false);
    }
  };

  // ── Detail-pane actions ────────────────────────────────────────

  const actionSendDraft = async (entry: InboxLogEntry) => {
    if (!entry.draftId) { toast.push({ kind: 'warning', title: 'No draft id on record' }); return; }
    setBusyAction('send');
    try {
      const ok = await sendDraft(entry.source, entry.draftId);
      if (ok) {
        patchInboxLog(entry.id, { status: 'sent' });
        toast.push({ kind: 'success', title: 'Reply sent', description: entry.replyTo ?? entry.from });
        refresh();
      } else {
        toast.push({ kind: 'error', title: 'Send failed', description: 'Mail API rejected the request' });
      }
    } finally { setBusyAction(null); }
  };

  const actionApplyCorrection = async (entry: InboxLogEntry) => {
    if (!entry.entityId || !entry.correctionField || entry.correctionRequested == null) {
      toast.push({ kind: 'warning', title: 'Missing correction payload' });
      return;
    }
    setBusyAction('apply');
    try {
      const res = await applyCorrection(entry.entityId, entry.correctionField as any, entry.correctionRequested);
      if (res.ok) {
        patchInboxLog(entry.id, {
          action: 'correction_applied',
          correctionBefore: res.before ?? null,
          message: `🛠️  Applied correction: ${fieldLabel(entry.correctionField as any)} ${res.before ?? '—'} → ${entry.correctionRequested}`,
        });
        toast.push({ kind: 'success', title: 'Correction applied', description: `${fieldLabel(entry.correctionField as any)} → ${entry.correctionRequested}` });
        refresh();
      } else {
        toast.push({ kind: 'error', title: 'Apply failed', description: res.error ?? 'Unknown error' });
      }
    } finally { setBusyAction(null); }
  };

  const actionRejectCorrection = (entry: InboxLogEntry) => {
    patchInboxLog(entry.id, { status: 'discarded' });
    toast.push({ kind: 'info', title: 'Correction rejected', description: entry.subject });
    refresh();
    setSelectedId(null);
  };

  const actionDiscard = (entry: InboxLogEntry) => {
    patchInboxLog(entry.id, { status: 'discarded' });
    toast.push({ kind: 'info', title: 'Discarded', description: entry.subject });
    refresh();
    setSelectedId(null);
  };

  const actionOpenEntity = (entry: InboxLogEntry) => {
    if (!entry.entityId || !entry.entityKind) return;
    if (entry.entityKind === 'invoice') openInvoice({ id: entry.entityId } as any);
    else {
      // For other kinds, navigate to the list route.
      const navMap: Record<string, string> = {
        sales_order: 'sales-orders',
        purchase_order: 'purchase-orders',
        booking: 'bookings',
        bill_of_ladings: 'bol',
        packing_list: 'packing-lists',
      };
      const route = navMap[entry.entityKind];
      if (route) {
        window.dispatchEvent(new CustomEvent('xs-v2-navigate', { detail: { id: route } }));
      }
    }
  };

  const actionOpenInMail = (entry: InboxLogEntry) => {
    const url = entry.source === 'outlook' ? outlookDeepLink(entry.messageId) : gmailDeepLink(entry.messageId);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">
      {/* Top status bar */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 rounded-md border border-[#1f1f1f] bg-[#0f0f0f] mb-3">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-slate-100">
          <Inbox size={14} className="text-indigo-300" />
          AI Inbox
        </div>
        <StatusPill
          label="Outlook"
          connected={conn.outlook.connected}
          email={conn.outlook.email}
        />
        <StatusPill
          label="Gmail"
          connected={conn.gmail.connected}
          email={conn.gmail.email}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm" variant="secondary"
            onClick={scanNow}
            disabled={scanBusy}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
          >
            <RefreshCw size={12} className={scanBusy ? 'animate-spin' : ''} /> Scan now
          </Button>
        </div>
      </div>

      {/* 3-column main */}
      <div className="flex-1 min-h-0 grid grid-cols-[200px_minmax(280px,1fr)_minmax(300px,1fr)] gap-3">
        {/* Left: queues */}
        <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] p-2 overflow-y-auto custom-scrollbar">
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-medium px-2 pb-1">Queues</div>
          {QUEUES.map(q => {
            const QIcon = q.icon;
            const count = counts[q.id];
            const active = q.id === activeQueue;
            return (
              <button
                key={q.id}
                onClick={() => { setActiveQueue(q.id); setSelectedId(null); }}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 text-[12.5px] transition-colors',
                  active ? 'bg-[#161616] text-slate-100' : 'text-slate-400 hover:bg-[#141414] hover:text-slate-200',
                )}
                title={q.description}
              >
                <QIcon size={13} className={q.tone} />
                <span className="flex-1 truncate">{q.label}</span>
                {count > 0 && (
                  <span className="text-[10.5px] font-mono tabular-nums text-slate-500">{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Middle: list */}
        <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] overflow-y-auto custom-scrollbar">
          {visible.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center p-6">
              <div className="max-w-[220px]">
                <Sparkles size={18} className="mx-auto mb-2 text-slate-600" />
                <div className="text-[12px] text-slate-500">
                  {conn.outlook.connected || conn.gmail.connected
                    ? 'Nothing here yet. Wait for the next scan or click Scan now.'
                    : 'Connect an email account in the Connections tab to start processing.'}
                </div>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-[#1f1f1f]">
              {visible.map(e => {
                const badge = actionBadge(e);
                const isSel = e.id === selectedId;
                return (
                  <li key={e.id}>
                    <button
                      onClick={() => setSelectedId(e.id)}
                      className={cn(
                        'w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors',
                        isSel ? 'bg-[#161616]' : 'hover:bg-[#141414]',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-slate-200 truncate flex-1">{e.from}</span>
                        <span className="text-[10.5px] text-slate-600 shrink-0">{timeAgo(e.createdAt)}</span>
                      </div>
                      <div className="text-[11.5px] text-slate-400 truncate">{e.subject}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={cn('px-1.5 py-0.5 rounded text-[9.5px] font-medium', badge.tone)}>
                          {badge.label}
                        </span>
                        {e.entityLabel && (
                          <span className="text-[10.5px] text-slate-500 truncate">→ {e.entityLabel}</span>
                        )}
                        {e.status !== 'active' && (
                          <span className="text-[9.5px] text-slate-600 uppercase tracking-wider">{e.status}</span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Right: detail */}
        <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] overflow-y-auto custom-scrollbar">
          {!selected ? (
            <div className="h-full flex items-center justify-center p-6 text-center">
              <div className="max-w-[260px]">
                <FileStack size={22} className="mx-auto mb-2 text-slate-600" />
                <div className="text-[12px] text-slate-500">Pick an email from the list to see details and actions.</div>
              </div>
            </div>
          ) : (
            <DetailPane
              entry={selected}
              busyAction={busyAction}
              onSendDraft={() => actionSendDraft(selected)}
              onDiscard={() => actionDiscard(selected)}
              onOpenEntity={() => actionOpenEntity(selected)}
              onOpenInMail={() => actionOpenInMail(selected)}
              onApplyCorrection={() => actionApplyCorrection(selected)}
              onRejectCorrection={() => actionRejectCorrection(selected)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Status pill ──────────────────────────────────────────────────

const StatusPill: React.FC<{ label: string; connected: boolean; email?: string }> = ({ label, connected, email }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border',
      connected
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
        : 'border-[#1f1f1f] bg-[#141414] text-slate-500',
    )}
    title={email ?? ''}
  >
    {connected ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
    {label}
    {email && <span className="text-slate-400 truncate max-w-[120px]">· {email.split('@')[0]}</span>}
  </span>
);

// ─── Detail pane ──────────────────────────────────────────────────

const DetailPane: React.FC<{
  entry: InboxLogEntry;
  busyAction: string | null;
  onSendDraft: () => void;
  onDiscard: () => void;
  onOpenEntity: () => void;
  onOpenInMail: () => void;
  onApplyCorrection: () => void;
  onRejectCorrection: () => void;
}> = ({ entry, busyAction, onSendDraft, onDiscard, onOpenEntity, onOpenInMail, onApplyCorrection, onRejectCorrection }) => {
  const badge = actionBadge(entry);
  const canSend = entry.action === 'drafted' && entry.status === 'active' && !!entry.draftId;
  const canApplyCorrection = entry.action === 'correction_proposed' && entry.status === 'active'
    && !!entry.entityId && !!entry.correctionField && entry.correctionRequested != null;
  const canOpenEntity = !!entry.entityId && !!entry.entityKind;

  return (
    <div className="p-4 flex flex-col gap-3 text-[12.5px] text-slate-200">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-600 font-medium mb-0.5">From</div>
        <div className="text-slate-100 font-medium">{entry.from}</div>
        {entry.fromAddress && entry.fromAddress !== entry.from && (
          <div className="text-[11px] text-slate-500 font-mono">{entry.fromAddress}</div>
        )}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-600 font-medium mb-0.5">Subject</div>
        <div className="text-slate-200">{entry.subject}</div>
      </div>

      <div className="flex items-center gap-2">
        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium', badge.tone)}>{badge.label}</span>
        <span className="text-[10.5px] text-slate-500">
          {timeAgo(entry.createdAt)} · {entry.source}
          {entry.status !== 'active' && ` · ${entry.status}`}
        </span>
      </div>

      {entry.entityLabel && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-medium mb-0.5">Linked record</div>
          <button
            onClick={onOpenEntity}
            disabled={!canOpenEntity}
            className="text-[12px] text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1 disabled:opacity-50"
          >
            {entry.entityLabel} <ExternalLink size={11} />
          </button>
        </div>
      )}

      {entry.attachmentName && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-medium mb-0.5">Attachment</div>
          <div className="text-[11.5px] text-slate-400 font-mono truncate">{entry.attachmentName}</div>
        </div>
      )}

      {entry.docType && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 font-medium mb-0.5">Classifier</div>
          <div className="text-[11.5px] text-slate-300">{entry.docType}{entry.refNumber ? ` · ${entry.refNumber}` : ''}</div>
        </div>
      )}

      {entry.error && (
        <div className="flex items-start gap-1.5 px-2 py-1.5 rounded border border-red-500/30 bg-red-500/10">
          <AlertCircle size={12} className="shrink-0 mt-0.5 text-red-300" />
          <div className="text-[11.5px] text-red-200">{entry.error}</div>
        </div>
      )}

      {/* Correction diff card — shown when the entry is a correction-* action */}
      {(entry.correctionField || entry.action.startsWith('correction_')) && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5">
          <div className="text-[10px] uppercase tracking-widest text-rose-300/80 font-medium mb-1.5 flex items-center gap-1">
            <Wrench size={10} /> Correction
          </div>
          <div className="text-[11.5px] text-slate-300 mb-1.5">
            {entry.correctionField ? fieldLabel(entry.correctionField as any) : '—'}
          </div>
          <div className="flex items-center gap-2 text-[12px]">
            <div className="flex-1 min-w-0">
              <div className="text-[9.5px] uppercase tracking-widest text-slate-600">Current</div>
              <div className="font-mono tabular-nums text-slate-200 truncate">
                {entry.correctionBefore != null
                  ? String(entry.correctionBefore)
                  : (entry.correctionCurrent != null ? String(entry.correctionCurrent) : '—')}
              </div>
            </div>
            <ArrowRight size={14} className="text-slate-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[9.5px] uppercase tracking-widest text-slate-600">
                {entry.action === 'correction_applied' ? 'Applied' : 'Requested'}
              </div>
              <div className={cn(
                'font-mono tabular-nums truncate',
                entry.action === 'correction_applied' ? 'text-sky-200' : 'text-rose-200',
              )}>
                {entry.correctionRequested != null ? String(entry.correctionRequested) : '—'}
              </div>
            </div>
          </div>
          {entry.action === 'correction_confirmed_current' && (
            <div className="mt-2 text-[10.5px] text-emerald-300/80">
              Sender\'s claimed value matches our record — reply to confirm.
            </div>
          )}
          {entry.action === 'correction_manual_only' && (
            <div className="mt-2 text-[10.5px] text-amber-300/80">
              Flagged for manual review — field not in auto-approve whitelist.
            </div>
          )}
        </div>
      )}

      <div className="h-px bg-[#1f1f1f] my-1" />

      {/* Actions */}
      <div className="flex flex-col gap-1.5">
        {canApplyCorrection && (
          <Button
            size="sm"
            onClick={onApplyCorrection}
            disabled={busyAction === 'apply'}
            className="bg-rose-600 text-white hover:bg-rose-500 w-full justify-start"
          >
            <Check size={12} /> Apply correction
          </Button>
        )}
        {entry.action === 'correction_proposed' && entry.status === 'active' && (
          <Button
            size="sm" variant="secondary"
            onClick={onRejectCorrection}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616] w-full justify-start"
          >
            <X size={12} /> Reject correction
          </Button>
        )}
        {canSend && (
          <Button
            size="sm"
            onClick={onSendDraft}
            disabled={busyAction === 'send'}
            className="bg-indigo-600 text-white hover:bg-indigo-500 w-full justify-start"
          >
            <Check size={12} /> Send draft now
          </Button>
        )}
        {canOpenEntity && (
          <Button
            size="sm" variant="secondary"
            onClick={onOpenEntity}
            className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616] w-full justify-start"
          >
            <ExternalLink size={12} /> Open {entry.entityKind?.replace('_', ' ')}
          </Button>
        )}
        <Button
          size="sm" variant="secondary"
          onClick={onOpenInMail}
          className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616] w-full justify-start"
        >
          <ExternalLink size={12} /> Open in {entry.source === 'outlook' ? 'Outlook' : 'Gmail'}
        </Button>
        {entry.status === 'active' && (
          <Button
            size="sm" variant="secondary"
            onClick={onDiscard}
            className="bg-transparent border border-red-500/30 text-red-300 hover:bg-red-500/10 w-full justify-start"
          >
            <Trash2 size={12} /> Discard
          </Button>
        )}
      </div>
    </div>
  );
};

export default AiInboxV2;
