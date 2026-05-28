// Phase 3B — Shared View / Edit / Delete wiring for list pages.
//
// List pages that don't have a bespoke editor drawer use this hook to
// get (a) a rowActions renderer for the DataTable and (b) the matching
// drawers/confirms to mount at the end of the route. Centralises the
// useState plumbing so each page only declares the field schema.

import React, { useState } from 'react';
import { ConfirmDialog } from '../primitives';
import { useToast } from '../primitives/Toast';
import { useEntityDelete } from '../queries/useEntityMutations';
import { RowActions } from './RowActions';
import { InspectDrawer, InspectMode } from './InspectDrawer';
import { FieldDef } from './QuickCreateDrawer';

interface Config<T extends { id: string }> {
  table: string;
  listQueryKeys: string[];
  /** Human-facing label for this row (e.g. the order number or name). */
  rowLabel: (row: T) => string;
  /** Field schema shown in the inspect / edit drawer. */
  fields: FieldDef[];
  /** Drawer title. Defaults to rowLabel. */
  title?: (row: T) => string;
  /** Called after delete. Use to close external drawers etc. */
  onDeleted?: (row: T) => void;
  /** If provided, adds a Mail icon to row actions that calls this. */
  onEmail?: (row: T) => void;
  /** If provided, adds a Copy icon that calls this with the source row. */
  onDuplicate?: (row: T) => void;
  /** Override the eye-icon behavior. Receives a callback that opens the
   *  default inspect drawer so the override can fall back when needed
   *  (e.g. row has no PDF attached). When omitted, eye opens the
   *  drawer as before. */
  onView?: (row: T, openDrawer: () => void) => void;
  /** Per-row tint for the eye-icon. Used to flag rows that have a
   *  stored document (e.g. Expenses row with an OCR'd PDF gets a
   *  green eye). Returning undefined keeps the default neutral tint. */
  viewToneByRow?: (row: T) => string | undefined;
  /** Per-row tooltip override for the eye-icon. */
  viewTitleByRow?: (row: T) => string | undefined;
  /** Override the View button's icon globally for this hook instance.
   *  Use on lists where "View" means something specific (Payables: a
   *  payment statement; not a generic record inspector). */
  viewIcon?: React.ReactNode;
  /** Optional content rendered inside the inspect drawer below the
   *  field list. Used by Payables to surface an "Edit payments"
   *  drill-in next to the record-fields editor — single Edit icon,
   *  both flows accessible. Receives the row being edited. */
  extraEditSection?: (row: T) => React.ReactNode;
  /** Override the pencil-icon behavior. Same fallback contract as
   *  onView — when omitted, edit opens the default inspect drawer in
   *  edit mode. Pages that need a bespoke editor (e.g. Receivables
   *  editing the linked transactions rather than the invoice fields)
   *  use this to take over without losing the rest of the row-actions
   *  cluster. */
  onEdit?: (row: T, openDrawer: () => void) => void;
}

interface Result<T> {
  rowActions: (row: T) => React.ReactNode;
  drawers: React.ReactElement;
  /** Imperative open-in-edit-mode (useful for wiring "Edit" from elsewhere). */
  openEdit: (row: T) => void;
  /** Imperative open-in-view-mode. */
  openView: (row: T) => void;
}

export function useRowCrud<T extends { id: string }>({
  table, listQueryKeys, rowLabel, fields, title, onDeleted, onEmail, onDuplicate, onView, onEdit,
  viewToneByRow, viewTitleByRow, viewIcon, extraEditSection,
}: Config<T>): Result<T> {
  const toast = useToast();
  const [inspectRow, setInspectRow] = useState<T | null>(null);
  const [inspectMode, setInspectMode] = useState<InspectMode>('view');
  const [deleteRow, setDeleteRow] = useState<T | null>(null);

  const del = useEntityDelete({ table, listQueryKeys });

  const openDrawerView = (row: T) => { setInspectRow(row); setInspectMode('view'); };
  const openDrawerEdit = (row: T) => { setInspectRow(row); setInspectMode('edit'); };
  // When the caller provided an override, run it and let it decide
  // whether to also open the default drawer. Otherwise fall back to
  // the drawer-only behavior the hook always had.
  const openView = (row: T) => {
    if (onView) onView(row, () => openDrawerView(row));
    else openDrawerView(row);
  };
  const openEdit = (row: T) => {
    if (onEdit) onEdit(row, () => openDrawerEdit(row));
    else openDrawerEdit(row);
  };

  const rowActions = (row: T): React.ReactNode => (
    <RowActions
      onView={() => openView(row)}
      onEdit={() => openEdit(row)}
      onEmail={onEmail ? () => onEmail(row) : undefined}
      onDuplicate={onDuplicate ? () => onDuplicate(row) : undefined}
      onDelete={() => setDeleteRow(row)}
      viewClassName={viewToneByRow?.(row)}
      viewTitle={viewTitleByRow?.(row)}
      viewIcon={viewIcon}
    />
  );

  const resolveTitle = (row: T) => title ? title(row) : rowLabel(row);

  const drawers = (
    <>
      <InspectDrawer
        open={!!inspectRow}
        onOpenChange={(o) => !o && setInspectRow(null)}
        mode={inspectMode}
        onModeChange={setInspectMode}
        title={inspectRow ? resolveTitle(inspectRow) : ''}
        table={table}
        listQueryKeys={listQueryKeys}
        row={inspectRow as unknown as Record<string, unknown> | null}
        fields={fields}
        extraSection={inspectRow && extraEditSection ? extraEditSection(inspectRow) : undefined}
      />
      <ConfirmDialog
        open={!!deleteRow}
        onOpenChange={(o) => !o && setDeleteRow(null)}
        title={`Delete ${deleteRow ? rowLabel(deleteRow) : ''}?`}
        description="This removes the record permanently. Related records that reference it may break until fixed."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={() => {
          if (!deleteRow) return;
          const label = rowLabel(deleteRow);
          del.mutate(deleteRow.id, {
            onSuccess: () => {
              toast.push({ kind: 'success', title: 'Deleted', description: label });
              onDeleted?.(deleteRow);
              setDeleteRow(null);
            },
            onError: (err) => {
              toast.push({
                kind: 'error', title: 'Delete failed', description: err.message,
              });
              setDeleteRow(null);
            },
          });
        }}
      />
    </>
  );

  return { rowActions, drawers, openView, openEdit };
}
