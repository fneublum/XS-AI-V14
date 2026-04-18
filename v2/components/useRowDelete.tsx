// Phase 3B — Row-level Delete flow for pages that have their own
// View/Edit drawer already (Customers, Suppliers, Sales Orders, etc).
// The full CRUD wiring (`useRowCrud`) is overkill there; this hook is
// just the confirm-dialog + delete-mutation pair.

import React, { useState } from 'react';
import { ConfirmDialog } from '../primitives';
import { useToast } from '../primitives/Toast';
import { useEntityDelete } from '../queries/useEntityMutations';

interface Config<T extends { id: string }> {
  table: string;
  listQueryKeys: string[];
  rowLabel: (row: T) => string;
}

interface Result<T> {
  confirmDelete: (row: T) => void;
  deleteDialog: React.ReactElement;
  isDeleting: boolean;
}

export function useRowDelete<T extends { id: string }>({
  table, listQueryKeys, rowLabel,
}: Config<T>): Result<T> {
  const toast = useToast();
  const [row, setRow] = useState<T | null>(null);
  const del = useEntityDelete({ table, listQueryKeys });

  const deleteDialog = (
    <ConfirmDialog
      open={!!row}
      onOpenChange={(o) => !o && setRow(null)}
      title={`Delete ${row ? rowLabel(row) : ''}?`}
      description="This removes the record permanently. Related records that reference it may break until fixed."
      confirmLabel="Delete"
      loading={del.isPending}
      onConfirm={() => {
        if (!row) return;
        const label = rowLabel(row);
        del.mutate(row.id, {
          onSuccess: () => {
            toast.push({ kind: 'success', title: 'Deleted', description: label });
            setRow(null);
          },
          onError: (err) => {
            toast.push({ kind: 'error', title: 'Delete failed', description: err.message });
            setRow(null);
          },
        });
      }}
    />
  );

  return {
    confirmDelete: setRow,
    deleteDialog,
    isDeleting: del.isPending,
  };
}
