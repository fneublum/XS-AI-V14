// Phase 3B — Shared status-badge intensifier.
//
// The default `<Badge variant="success" />` primitive renders a 10%
// soft-wash tint that's too pale for status chips that need to read at
// a glance in a dense logistics grid (bookings, freight quotes, BLs).
// This helper returns a Tailwind override that tw-merges into the
// variant classes to produce a solid tint for the success / warning
// tones while leaving info / danger / neutral on the default soft look.
//
// Used by BookingsV2, AgentPortalV2, FreightQuotesV2.

export type BadgeTone = 'success' | 'info' | 'warning' | 'neutral' | 'danger';

export const vividStatusClass = (tone: BadgeTone): string => {
  if (tone === 'success') return 'bg-emerald-600/90 text-white border-emerald-500';
  if (tone === 'warning') return 'bg-amber-500/90 text-slate-900 border-amber-400';
  if (tone === 'danger')  return 'bg-red-600/90 text-white border-red-500';
  return '';
};
