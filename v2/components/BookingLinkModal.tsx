// Modal — link an AVAILABLE booking to a Sales Order.
//
// Surfaces only bookings whose pol/pod match the sales order's poa/pod
// (port codes normalized: first 5-letter UN/LOCODE in each side wins).
// Falls back to "showing all AVAILABLE" with a toggle when no port-matched
// bookings exist (common when the SO was created before the booking).
//
// Saving writes sales_orders.bookingNumber via the supplied onSave handler.

import React, { useMemo, useState } from 'react';
import { Ship, Check, X as XIcon, Anchor, Filter } from 'lucide-react';
import { Modal } from '../primitives/Modal';
import { Button } from '../primitives/Button';
import { useBookings } from '../queries/useBookings';
import { formatDate } from '../lib/formatDate';
import { cn } from '../primitives/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The sales order's poa (origin) and pod (destination) — used to filter
   *  the AVAILABLE bookings list. Either may be null. */
  soPoa: string | null;
  soPod: string | null;
  /** Optional sales-order label so the modal header shows context. */
  soLabel?: string;
  /** Currently-linked booking number, if any (for "linked" highlight). */
  currentBookingNumber?: string | null;
  /** Called when user picks a booking; receives bookingNumber or null
   *  (null clears the link). */
  onSave: (bookingNumber: string | null) => void | Promise<void>;
}

// Extract the first 5-letter UN/LOCODE from a port string like "USHOU",
// "USHOU - Houston", "Houston, Texas (USHOU)", etc. Returns '' if none.
function extractLocode(raw: string | null | undefined): string {
  if (!raw) return '';
  const m = raw.match(/\b[A-Z]{5}\b/);
  return m ? m[0] : '';
}

export const BookingLinkModal: React.FC<Props> = ({
  open, onClose, soPoa, soPod, soLabel, currentBookingNumber, onSave,
}) => {
  const { data: bookings, isLoading } = useBookings();
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(currentBookingNumber ?? null);
  const [saving, setSaving] = useState(false);

  // Reset state when the modal re-opens for a different SO.
  React.useEffect(() => {
    if (open) {
      setPicked(currentBookingNumber ?? null);
      setShowAll(false);
    }
  }, [open, currentBookingNumber]);

  const soPolCode = useMemo(() => extractLocode(soPoa), [soPoa]);
  const soPodCode = useMemo(() => extractLocode(soPod), [soPod]);

  // AVAILABLE bookings only.
  const available = useMemo(
    () => (bookings ?? []).filter(b => (b.status ?? '').toUpperCase() === 'AVAILABLE'),
    [bookings],
  );

  // Match by port code on both sides when both sides have codes;
  // fall back to either-side match when only one is known.
  const matched = useMemo(() => {
    if (!soPolCode && !soPodCode) return available;
    return available.filter(b => {
      const bPol = extractLocode(b.pol);
      const bPod = extractLocode(b.pod);
      if (soPolCode && bPol !== soPolCode) return false;
      if (soPodCode && bPod !== soPodCode) return false;
      return true;
    });
  }, [available, soPolCode, soPodCode]);

  const list = showAll ? available : matched;
  const noMatches = !isLoading && matched.length === 0 && available.length > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(picked);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await onSave(null);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="!w-[min(96vw,820px)] !max-h-[88vh] !bg-[#0a0a0a] !text-slate-200 !border !border-[#1f1f1f] !p-0"
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-3 border-b border-[#1f1f1f] flex items-start gap-3">
        <Ship size={18} className="text-sky-300 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-slate-100">Link to AVAILABLE booking</div>
          <div className="text-[11.5px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
            {soLabel && <span className="font-mono">{soLabel}</span>}
            {soPolCode && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-[#0f0f0f] border border-[#1f1f1f]">
                <Anchor size={9} /> POA <span className="text-slate-300 font-mono">{soPolCode}</span>
              </span>
            )}
            {soPodCode && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-[#0f0f0f] border border-[#1f1f1f]">
                <Anchor size={9} /> POD <span className="text-slate-300 font-mono">{soPodCode}</span>
              </span>
            )}
            <span>
              {showAll
                ? `${available.length} AVAILABLE total`
                : `${matched.length} match POA/POD${noMatches ? ' (none)' : ''}`}
            </span>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="p-1 rounded text-slate-500 hover:text-slate-200">
          <XIcon size={16} />
        </button>
      </div>

      {/* Body — booking picker */}
      <div className="px-5 py-4 overflow-y-auto" style={{ maxHeight: 'calc(88vh - 160px)' }}>
        {noMatches && !showAll && (
          <div className="mb-3 p-3 rounded-md border border-amber-500/30 bg-amber-500/5 text-[12px] text-amber-200 flex items-center justify-between gap-3">
            <span>No AVAILABLE bookings match the SO's POA/POD.</span>
            <Button
              size="sm" variant="secondary"
              onClick={() => setShowAll(true)}
              className="bg-transparent border border-amber-500/30 text-amber-200 hover:bg-amber-500/10"
            >
              <Filter size={11} className="mr-1.5" /> Show all AVAILABLE
            </Button>
          </div>
        )}
        {!noMatches && available.length > 0 && (
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">Pick the booking to link</span>
            <button
              onClick={() => setShowAll(s => !s)}
              className="text-[11px] text-slate-500 hover:text-slate-300"
            >
              {showAll ? 'Show only matching POA/POD' : 'Show all AVAILABLE'}
            </button>
          </div>
        )}
        {isLoading && (
          <div className="p-6 text-center text-[13px] text-slate-500">Loading bookings…</div>
        )}
        {!isLoading && list.length === 0 && (
          <div className="p-6 text-center text-[13px] text-slate-500">
            No AVAILABLE bookings to link.
          </div>
        )}
        {!isLoading && list.length > 0 && (
          <ul className="rounded-md border border-[#1f1f1f] bg-[#0f0f0f] divide-y divide-[#1a1a1a]">
            {list.map(b => {
              const isPicked = picked === b.bookingNumber;
              return (
                <li
                  key={b.id}
                  onClick={() => setPicked(b.bookingNumber)}
                  className={cn(
                    'px-3 py-2 cursor-pointer transition-colors flex items-center gap-3',
                    isPicked ? 'bg-sky-500/10' : 'hover:bg-[#161616]',
                  )}
                >
                  <span className={cn(
                    'w-4 h-4 rounded-full border flex items-center justify-center shrink-0',
                    isPicked ? 'border-sky-400 bg-sky-500' : 'border-[#2a2a2a]',
                  )}>
                    {isPicked && <Check size={10} className="text-white" />}
                  </span>
                  <div className="flex-1 min-w-0 grid grid-cols-[120px_1fr_auto] gap-3 items-center text-[12px]">
                    <span className="font-mono text-slate-100">#{b.bookingNumber}</span>
                    <span className="text-slate-400 truncate" title={b.customer ?? ''}>
                      {b.customer ?? '—'}
                    </span>
                    <span className="font-mono text-slate-400 text-[11px]">
                      {extractLocode(b.pol) || '??'} → {extractLocode(b.pod) || '??'}
                    </span>
                  </div>
                  <div className="text-[10.5px] text-slate-500 font-mono tabular-nums shrink-0 w-[150px] text-right">
                    {b.equipment ?? ''} · ETD {b.etd ? formatDate(b.etd) : '—'}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-[#1f1f1f] bg-[#0d0d0d] flex items-center gap-2 flex-wrap">
        <Button
          size="sm" variant="secondary"
          onClick={onClose}
          className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
        >
          Cancel
        </Button>
        {currentBookingNumber && (
          <Button
            size="sm" variant="secondary"
            onClick={handleClear}
            disabled={saving}
            className="bg-transparent border border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
            title={`Unlink current booking #${currentBookingNumber}`}
          >
            <XIcon size={13} className="mr-1.5" /> Unlink
          </Button>
        )}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || !picked || picked === currentBookingNumber}
          loading={saving}
          className="ml-auto bg-sky-600 hover:bg-sky-500 text-white"
        >
          <Ship size={13} className="mr-1.5" />
          {picked && picked !== currentBookingNumber ? `Link to #${picked}` : 'Link booking'}
        </Button>
      </div>
    </Modal>
  );
};

export default BookingLinkModal;

// Helper exported for tests / callers that want the same logic.
export { extractLocode };
