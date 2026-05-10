// Browser-side scheduler for the background autonomy loop.
//
// Runs while the app tab is open. Two cadences:
//   - Inbox triage: every 15 min (plus once at mount)
//   - Booking monitor: every 60 min (consumes the latest triage pass)
//
// Results are broadcast via custom events so any panel can subscribe
// without prop-drilling. No server-side cron needed for the MVP —
// when the user closes the tab, scanning pauses, which is fine since
// they can't act on alerts offline anyway.

import { useEffect, useRef } from 'react';
import { scanInbox, TriageItem } from '../services/inboxAutoTriage';
import { processTriageItems, ProcessResult } from '../services/inboxProcessor';
import { runReplyDrafter, ReplyResult } from '../services/replyDrafter';
import { appendInboxLog } from '../services/inboxLog';
import { checkBookings, BookingAlert, formatBookingAlert } from '../services/bookingMonitor';
import { getAccountFor, getGoogleAccount } from '../../services/smailAuth';

export const TRIAGE_UPDATE_EVENT = 'xs-triage-update';
export const BOOKING_ALERTS_EVENT = 'xs-booking-alerts';
export const EMAIL_PROCESSED_EVENT = 'xs-email-processed';
export const REPLY_DRAFTED_EVENT = 'xs-reply-drafted';

interface TriageSnapshot {
  items: TriageItem[];
  scannedAt: string;
}

interface BookingSnapshot {
  alerts: BookingAlert[];
  scannedAt: string;
}

interface ProcessSnapshot {
  results: ProcessResult[];
  scannedAt: string;
}

interface ReplySnapshot {
  results: ReplyResult[];
  scannedAt: string;
}

// In-memory cache so remounts don't lose the last result.
let lastTriage: TriageSnapshot = { items: [], scannedAt: '' };
let lastBookings: BookingSnapshot = { alerts: [], scannedAt: '' };
let lastProcess: ProcessSnapshot = { results: [], scannedAt: '' };
let lastReplies: ReplySnapshot = { results: [], scannedAt: '' };

export const getLastTriage = () => lastTriage;
export const getLastBookingAlerts = () => lastBookings;
export const getLastProcess = () => lastProcess;
export const getLastReplies = () => lastReplies;

const INBOX_INTERVAL_MS = 15 * 60 * 1000;
const BOOKING_INTERVAL_MS = 60 * 60 * 1000;

function hasAnyEmailProvider(): boolean {
  return !!getAccountFor('automation') || !!getAccountFor('my') || !!getGoogleAccount();
}

async function runInboxPass() {
  // No-op when no provider is connected — avoids hammering the
  // MSAL/Gmail token paths before the user signs in.
  if (!hasAnyEmailProvider()) return;
  try {
    const items = await scanInbox();
    lastTriage = { items, scannedAt: new Date().toISOString() };
    window.dispatchEvent(new CustomEvent(TRIAGE_UPDATE_EVENT, { detail: lastTriage }));

    // Action loop — save / attach / mark-read. Persist every action
    // into the inbox log so the AI Inbox UI can queue-filter them.
    if (items.length > 0) {
      const results = await processTriageItems(items);
      lastProcess = { results, scannedAt: new Date().toISOString() };
      window.dispatchEvent(new CustomEvent(EMAIL_PROCESSED_EVENT, { detail: lastProcess }));
      for (const r of results) {
        appendInboxLog({
          messageId: r.item.messageId,
          source: r.item.source,
          from: r.item.from,
          subject: r.item.subject,
          receivedAt: r.item.receivedAt,
          docType: r.item.docType,
          refNumber: r.item.extractedRef,
          attachmentName: r.item.attachmentName,
          action: r.action,
          entityKind: r.item.match?.kind,
          entityId: r.entityId ?? r.item.match?.id,
          entityLabel: r.item.match?.label,
          message: r.message,
          error: r.error,
        });
        // High-signal actions only in XS Agent chat — save / attach.
        if (r.action.startsWith('saved_new_') || r.action === 'attached_to_existing') {
          window.dispatchEvent(new CustomEvent('sx-doc-saved', { detail: { message: r.message } }));
        }
      }
    }

    // Reply drafter — independent of attachments.
    const replies = await runReplyDrafter();
    lastReplies = { results: replies, scannedAt: new Date().toISOString() };
    window.dispatchEvent(new CustomEvent(REPLY_DRAFTED_EVENT, { detail: lastReplies }));
    for (const r of replies) {
      appendInboxLog({
        messageId: r.messageId,
        source: r.source,
        from: r.from,
        fromAddress: r.fromAddress,
        subject: r.subject,
        receivedAt: r.receivedAt ?? new Date().toISOString(),
        refNumber: r.analysis.refNumber,
        docType: r.analysis.docType ?? undefined,
        action: r.action as any,
        draftId: r.draftId,
        replyTo: r.replyTo,
        replySubject: r.replySubject,
        entityKind: r.entityKind,
        entityId: r.entityId,
        entityLabel: r.entityLabel,
        // Correction payload — only set for correction_* actions.
        correctionField: r.correctionField,
        correctionCurrent: r.correctionCurrent,
        correctionRequested: r.correctionRequested,
        message: r.message,
        error: r.error,
      });
      // High-signal outcomes hit the XS Agent chat:
      //   • drafted reply ready for review
      //   • correction proposed — the user should look before it goes out
      // Skipped/no_match/manual-only live in the queues only.
      if (r.action === 'drafted' || r.action === 'correction_proposed') {
        window.dispatchEvent(new CustomEvent('sx-doc-saved', { detail: { message: r.message } }));
      }
    }
  } catch (err) {
    console.warn('[bgJobs] inbox pass failed', err);
  }
}

async function runBookingPass() {
  try {
    const alerts = await checkBookings(lastTriage.items);
    lastBookings = { alerts, scannedAt: new Date().toISOString() };
    window.dispatchEvent(new CustomEvent(BOOKING_ALERTS_EVENT, { detail: lastBookings }));

    // Also pipe the most urgent alert into the XS Agent chat so the
    // user gets a nudge in their main surface. Only fire for the
    // top-overdue row and only once per scan to keep noise low.
    const top = alerts[0];
    if (top && (top.daysPastEta > 0 || top.suggestedBl)) {
      const extras = alerts.length - 1;
      // Include the aggregate count in the chat message so the user
      // sees the full shape of the queue (e.g. "+ 12 more need
      // attention") now that the standalone TriageBanner is gone.
      const message = extras > 0
        ? `${formatBookingAlert(top)} (+ ${extras} more booking${extras === 1 ? '' : 's'} need attention)`
        : formatBookingAlert(top);
      window.dispatchEvent(new CustomEvent('sx-doc-saved', {
        detail: { message },
      }));
    }
  } catch (err) {
    console.warn('[bgJobs] booking check failed', err);
  }
}

let jobsMounted = 0;

/** Mount once at the app shell. Idempotent — multiple mounts share
 *  the same timers via a refcount so StrictMode double-invocation
 *  doesn't double the Gemini spend. */
export function useBackgroundJobs() {
  const inboxTimerRef = useRef<number | null>(null);
  const bookingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    jobsMounted += 1;
    if (jobsMounted > 1) return () => { jobsMounted -= 1; };

    // Kick both jobs right away, then schedule.
    void runInboxPass().then(() => runBookingPass());

    inboxTimerRef.current = window.setInterval(() => { void runInboxPass(); }, INBOX_INTERVAL_MS);
    bookingTimerRef.current = window.setInterval(() => { void runBookingPass(); }, BOOKING_INTERVAL_MS);

    return () => {
      jobsMounted -= 1;
      if (jobsMounted > 0) return;
      if (inboxTimerRef.current) window.clearInterval(inboxTimerRef.current);
      if (bookingTimerRef.current) window.clearInterval(bookingTimerRef.current);
      inboxTimerRef.current = null;
      bookingTimerRef.current = null;
    };
  }, []);
}

/** Manual trigger — wired to the banner's "Scan now" button. */
export async function triggerInboxScanNow(): Promise<TriageSnapshot> {
  await runInboxPass();
  await runBookingPass();
  return lastTriage;
}
