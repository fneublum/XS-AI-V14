// Dashboard banner for the autonomous background jobs.
//
// Shows a single collapsed line when everything's quiet ("No pending
// reviews") and an expandable panel when either the inbox triage
// surfaced matches or the booking monitor flagged an overdue
// shipment. Click a row to open the underlying entity in v2's editor
// drawer or route.

import React, { useEffect, useState } from 'react';
import { Inbox, Ship, Sparkles, RefreshCw, ChevronDown, ChevronUp, FileText, Send } from 'lucide-react';
import { useEditor } from '../providers/EditorProvider';
import { useToast } from '../primitives/Toast';
import {
  TRIAGE_UPDATE_EVENT, BOOKING_ALERTS_EVENT, EMAIL_PROCESSED_EVENT, REPLY_DRAFTED_EVENT,
  getLastTriage, getLastBookingAlerts, getLastProcess, getLastReplies,
  triggerInboxScanNow,
} from '../hooks/useBackgroundJobs';
import type { TriageItem } from '../services/inboxAutoTriage';
import type { BookingAlert } from '../services/bookingMonitor';

function formatAge(scannedAt: string): string {
  if (!scannedAt) return 'never';
  const ms = Date.now() - Date.parse(scannedAt);
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export const TriageBanner: React.FC<{ navigate?: (id: string) => void }> = ({ navigate }) => {
  // Fallback navigator — uses the global event bus wired in AppV2 when
  // no explicit `navigate` prop was threaded.
  const go = (id: string) => {
    if (navigate) return navigate(id);
    window.dispatchEvent(new CustomEvent('xs-v2-navigate', { detail: { id } }));
  };
  const [, force] = useState(0);
  const tick = () => force(n => n + 1);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { openInvoice } = useEditor();

  useEffect(() => {
    const onTick = () => tick();
    window.addEventListener(TRIAGE_UPDATE_EVENT, onTick);
    window.addEventListener(BOOKING_ALERTS_EVENT, onTick);
    window.addEventListener(EMAIL_PROCESSED_EVENT, onTick);
    window.addEventListener(REPLY_DRAFTED_EVENT, onTick);
    // Re-render every 30s so "scanned Xm ago" stays fresh.
    const t = window.setInterval(tick, 30_000);
    return () => {
      window.removeEventListener(TRIAGE_UPDATE_EVENT, onTick);
      window.removeEventListener(BOOKING_ALERTS_EVENT, onTick);
      window.removeEventListener(EMAIL_PROCESSED_EVENT, onTick);
      window.removeEventListener(REPLY_DRAFTED_EVENT, onTick);
      window.clearInterval(t);
    };
  }, []);

  const { items: triageItems, scannedAt: inboxScannedAt } = getLastTriage();
  const { alerts: bookingAlerts, scannedAt: bookingsScannedAt } = getLastBookingAlerts();
  const { results: processResults } = getLastProcess();
  const { results: replyResults } = getLastReplies();

  const matched = triageItems.filter(i => !!i.match);
  const unmatched = triageItems.filter(i => !i.match);
  const savedNew = processResults.filter(r => r.action.startsWith('saved_new_')).length;
  const attachedExisting = processResults.filter(r => r.action === 'attached_to_existing').length;
  const draftedReplies = replyResults.filter(r => r.action === 'drafted').length;
  const totalCount = matched.length + bookingAlerts.length + savedNew + attachedExisting + draftedReplies;

  const scanNow = async () => {
    setBusy(true);
    try {
      await triggerInboxScanNow();
      toast.push({ kind: 'info', title: 'Inbox scan complete', description: `${getLastTriage().items.length} attachment(s) reviewed` });
    } finally {
      setBusy(false);
    }
  };

  const openEntity = (m: TriageItem) => {
    if (!m.match) return;
    switch (m.match.kind) {
      case 'invoice':
        openInvoice({ id: m.match.id } as any);
        break;
      case 'sales_order':
        go('sales-orders');
        break;
      case 'purchase_order':
        go('purchase-orders');
        break;
      case 'booking':
        go('bookings');
        break;
      case 'bill_of_ladings':
      default:
        go('bol');
    }
    toast.push({ kind: 'info', title: m.match.label, description: `From ${m.from}` });
  };

  if (totalCount === 0 && !inboxScannedAt && !bookingsScannedAt) {
    // Hasn't run yet — render a single tiny placeholder so the user
    // knows the service exists.
    return (
      <div className="flex items-center gap-2 text-[11.5px] text-slate-500 px-3 py-1.5 rounded-md border border-[#1f1f1f] bg-[#0f0f0f]">
        <Sparkles size={12} className="text-indigo-400" />
        <span>Auto-triage idle — will scan when your inbox is connected.</span>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] text-[12px]">
      <div className="flex items-center gap-3 px-3 py-2">
        <Sparkles size={13} className="text-indigo-300" />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {savedNew > 0 && (
            <span className="inline-flex items-center gap-1 text-slate-200">
              <FileText size={12} className="text-emerald-300" />
              {savedNew} saved
            </span>
          )}
          {attachedExisting > 0 && (
            <span className="inline-flex items-center gap-1 text-slate-200">
              <Inbox size={12} className="text-indigo-300" />
              {attachedExisting} attached
            </span>
          )}
          {draftedReplies > 0 && (
            <span className="inline-flex items-center gap-1 text-slate-200">
              <Send size={12} className="text-violet-300" />
              {draftedReplies} reply draft{draftedReplies === 1 ? '' : 's'}
            </span>
          )}
          {bookingAlerts.length > 0 && (
            <span className="inline-flex items-center gap-1 text-slate-200">
              <Ship size={12} className="text-amber-300" />
              {bookingAlerts.length} booking{bookingAlerts.length === 1 ? '' : 's'} need attention
            </span>
          )}
          {totalCount === 0 && (
            <span className="text-slate-500">Inbox idle — no pending actions.</span>
          )}
          <span className="text-slate-600 ml-auto truncate">
            Inbox · {formatAge(inboxScannedAt)} · Bookings · {formatAge(bookingsScannedAt)}
          </span>
        </div>
        <button
          onClick={scanNow}
          disabled={busy}
          title="Scan now"
          className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-[#1a1a1a] disabled:opacity-50"
        >
          <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => setOpen(v => !v)}
          className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-[#1a1a1a]"
        >
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>
      {open && (
        <div className="border-t border-[#1f1f1f] divide-y divide-[#1f1f1f]">
          {matched.map(m => (
            <button
              key={m.messageId + m.attachmentName}
              onClick={() => openEntity(m)}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-[#141414]"
            >
              <Inbox size={11} className="text-indigo-300" />
              <span className="text-slate-200 truncate flex-1">
                {m.docType} <span className="text-slate-500">·</span> {m.extractedRef ?? '—'} →{' '}
                <span className="text-indigo-300">{m.match!.label}</span>
              </span>
              <span className="text-[10.5px] text-slate-500 shrink-0">{m.from}</span>
            </button>
          ))}
          {unmatched.length > 0 && (
            <div className="px-3 py-1.5 text-[10.5px] text-slate-500">
              + {unmatched.length} attachment{unmatched.length === 1 ? '' : 's'} scanned but no matching record.
            </div>
          )}
          {bookingAlerts.map(a => (
            <button
              key={a.bookingId}
              onClick={() => go('bookings')}
              className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-[#141414]"
            >
              <Ship size={11} className="text-amber-300" />
              <span className="text-slate-200 truncate flex-1">
                {a.bookingNumber}
                {a.customerName ? <span className="text-slate-500"> · {a.customerName}</span> : null}
                {' '}
                <span className="text-amber-300">
                  {a.eta ? (a.daysPastEta > 0 ? `${a.daysPastEta}d past ETA` : 'at ETA') : 'no ETA'}
                </span>
              </span>
              {a.suggestedBl && (
                <span className="text-[10.5px] text-indigo-300 shrink-0">BL in inbox</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
