// Phase 3B — Per-row action icons: View / Edit / Delete.
//
// Rendered inside a DataTable's "actions" column. Clicks call
// stopPropagation so they don't trigger the row's own onRowClick.
// Pass `undefined` for any handler to hide that icon.

import React from 'react';
import { Eye, Pencil, Trash2, Mail, FileText } from 'lucide-react';

interface Props {
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onEmail?: () => void;
  /** Opens a "documents" flow for the row — Delivery Docs on Invoices,
   *  Proforma on Sales Orders, etc. */
  onDeliveryDocs?: () => void;
  /** Custom tooltip/aria for the documents icon. Default: "Delivery documents". */
  deliveryDocsLabel?: string;
  disabled?: boolean;
}

const iconBtn =
  'p-1 rounded-sm text-slate-500 hover:text-slate-100 hover:bg-[#1a1a1a] ' +
  'transition-colors disabled:opacity-40 disabled:cursor-not-allowed outline-none ' +
  'focus-visible:ring-1 focus-visible:ring-indigo-500';

const dangerBtn =
  'p-1 rounded-sm text-slate-500 hover:text-red-400 hover:bg-red-500/10 ' +
  'transition-colors disabled:opacity-40 disabled:cursor-not-allowed outline-none ' +
  'focus-visible:ring-1 focus-visible:ring-red-500';

const stop = (fn?: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation();
  e.preventDefault();
  fn?.();
};

export const RowActions: React.FC<Props> = ({
  onView, onEdit, onDelete, onEmail, onDeliveryDocs,
  deliveryDocsLabel = 'Delivery documents',
  disabled,
}) => (
  <div className="flex items-center justify-end gap-0.5">
    {onDeliveryDocs && (
      <button
        type="button"
        onClick={stop(onDeliveryDocs)}
        disabled={disabled}
        title={deliveryDocsLabel}
        aria-label={deliveryDocsLabel}
        className={iconBtn}
      >
        <FileText size={14} />
      </button>
    )}
    {onView && (
      <button
        type="button"
        onClick={stop(onView)}
        disabled={disabled}
        title="View"
        aria-label="View"
        className={iconBtn}
      >
        <Eye size={14} />
      </button>
    )}
    {onEdit && (
      <button
        type="button"
        onClick={stop(onEdit)}
        disabled={disabled}
        title="Edit"
        aria-label="Edit"
        className={iconBtn}
      >
        <Pencil size={14} />
      </button>
    )}
    {onEmail && (
      <button
        type="button"
        onClick={stop(onEmail)}
        disabled={disabled}
        title="Send email"
        aria-label="Send email"
        className={iconBtn}
      >
        <Mail size={14} />
      </button>
    )}
    {onDelete && (
      <button
        type="button"
        onClick={stop(onDelete)}
        disabled={disabled}
        title="Delete"
        aria-label="Delete"
        className={dangerBtn}
      >
        <Trash2 size={14} />
      </button>
    )}
  </div>
);
