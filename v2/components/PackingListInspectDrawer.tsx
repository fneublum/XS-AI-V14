// Inspect / edit drawer for a saved packing list.
//
// Fetches the full `packing_lists` row by id, converts it into a PLDraft,
// and renders the same PLReviewForm the AI upload modal uses — so the
// view/edit UX stays consistent with OCR intake.

import React, { useEffect, useState } from 'react';
import { Drawer } from '../primitives/Drawer';
import { Button } from '../primitives/Button';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { useToast } from '../primitives/Toast';
import { useCompany } from '../providers/CompanyProvider';
import { useEntityUpdate, useEntityDelete } from '../queries/useEntityMutations';
import { getSupabaseClient } from '../../services/supabase';
import {
  PLDraft, emptyPLDraft, PLReviewForm, plRowToDraft,
  packingListPayload, savePackingListPayload,
} from '../routes/packingListShared';

export type PLInspectMode = 'view' | 'edit';

interface Props {
  open: boolean;
  rowId: string | null;
  mode: PLInspectMode;
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: PLInspectMode) => void;
  onDeleted?: (id: string) => void;
}

export const PackingListInspectDrawer: React.FC<Props> = ({
  open, rowId, mode, onOpenChange, onModeChange, onDeleted,
}) => {
  const toast = useToast();
  const { currentCompanyId } = useCompany();
  const update = useEntityUpdate<Record<string, unknown>>({
    table: 'packing_lists',
    listQueryKeys: ['packingLists', 'logisticsDocs'],
  });
  const del = useEntityDelete({
    table: 'packing_lists',
    listQueryKeys: ['packingLists', 'logisticsDocs'],
  });

  const [draft, setDraft] = useState<PLDraft>(emptyPLDraft);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open || !rowId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      const { data, error } = await getSupabaseClient()
        .from('packing_lists')
        .select('*')
        .eq('id', rowId)
        .single();
      if (cancelled) return;
      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      setDraft(plRowToDraft((data ?? {}) as Record<string, unknown>));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, rowId]);

  // PLReviewForm's shipper-default effect writes the logged-in company.
  // In view mode we want to honor the saved shipper exactly, so we
  // suppress that override when not editing by feeding a fresh setter.
  const setDraftGuarded: React.Dispatch<React.SetStateAction<PLDraft>> = (updater) => {
    if (mode === 'view') return;
    setDraft(updater as any);
  };

  const onSave = async () => {
    if (!rowId) return;
    if (draft.plNumber.trim() === '') {
      toast.push({ kind: 'warning', title: 'PL # is required' });
      return;
    }
    setSaving(true);
    try {
      const payload = packingListPayload(draft, currentCompanyId);
      await savePackingListPayload(
        { mutateAsync: (p) => update.mutateAsync({ id: rowId, ...p }) },
        payload,
      );
      toast.push({ kind: 'success', title: 'Packing list saved', description: draft.plNumber });
      onOpenChange(false);
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Save failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const onConfirmDelete = () => {
    if (!rowId) return;
    del.mutate(rowId, {
      onSuccess: () => {
        toast.push({ kind: 'success', title: 'Deleted', description: draft.plNumber });
        setConfirmDelete(false);
        onDeleted?.(rowId);
        onOpenChange(false);
      },
      onError: (err) => {
        toast.push({
          kind: 'error',
          title: 'Delete failed',
          description: err instanceof Error ? err.message : String(err),
        });
        setConfirmDelete(false);
      },
    });
  };

  const title = mode === 'edit' ? `Edit ${draft.plNumber || 'packing list'}` : (draft.plNumber || 'Packing list');
  const description = mode === 'edit'
    ? 'Update fields and Save. Fields match the AI upload form.'
    : 'Read-only view. Switch to Edit to change fields.';

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={(o) => !o && !saving && onOpenChange(false)}
        title={title}
        description={description}
        widthClass="w-[min(96vw,880px)]"
        footer={
          <>
            <Button
              size="sm" variant="secondary"
              onClick={() => setConfirmDelete(true)}
              disabled={saving || !rowId}
              className="bg-transparent border border-[#1f1f1f] text-red-300 hover:bg-red-500/10"
            >
              Delete
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm" variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={saving}
                className="bg-transparent border border-[#1f1f1f] text-slate-300 hover:bg-[#161616]"
              >
                Close
              </Button>
              {mode === 'view' ? (
                <Button
                  size="sm"
                  onClick={() => onModeChange('edit')}
                  className="bg-indigo-600 text-white hover:bg-indigo-500"
                >
                  Edit
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={onSave}
                  disabled={saving}
                  loading={saving}
                  className="bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-600/40"
                >
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              )}
            </div>
          </>
        }
      >
        {loading ? (
          <div className="text-[12.5px] text-slate-500 py-6 text-center">Loading…</div>
        ) : loadError ? (
          <div className="text-[12.5px] text-red-400 py-6 text-center">Could not load: {loadError}</div>
        ) : (
          <PLReviewForm
            draft={draft}
            setDraft={mode === 'view' ? setDraftGuarded : setDraft}
          />
        )}
      </Drawer>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(false)}
        title={`Delete ${draft.plNumber || 'packing list'}?`}
        description="This removes the record permanently. Related invoices that reference it may break until fixed."
        confirmLabel="Delete"
        loading={del.isPending}
        onConfirm={onConfirmDelete}
      />
    </>
  );
};
