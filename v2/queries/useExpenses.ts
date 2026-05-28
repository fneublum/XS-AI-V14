// Phase 1 — Expenses query (general operational expenses).
//
// Backed by public.expenses (see scripts/migration-add-expenses-table.sql).
// Separate from usePayables which reads invoices_suppliers — expenses
// are freeform overhead (utilities, fuel, office, travel, broker fees)
// while supplier-invoice bills are shipment-tied.
//
// Pattern matches usePayables: a single useSupabaseQuery returning the
// row list, scoped by the active company from useCompany(), with a
// case-insensitive search on vendor/category.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';
import type { Expense, ExpenseCategory, ExpensePaymentStatus } from '../../types';

interface Raw {
  id: string;
  companyId: string | null;
  date: string | null;
  vendor: string | null;
  amount: number | string | null;
  currency: string | null;
  category: string | null;
  notes: string | null;
  attachmentUrl: string | null;
  paymentStatus: string | null;
  paidDate: string | null;
  paymentReceiptUrl: string | null;
  createdAt: string | null;
  createdBy: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

export function useExpenses(search?: string) {
  const { currentCompanyId } = useCompany();
  const needle = search?.trim() ?? '';

  return useSupabaseQuery<Expense[]>(
    ['expenses', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase.from('expenses')
          .select(
            'id, "companyId", date, vendor, amount, currency, category, ' +
            'notes, "attachmentUrl", "paymentStatus", "paidDate", ' +
            '"paymentReceiptUrl", "createdAt", "createdBy"',
          )
          .order('date', { ascending: false, nullsFirst: false })
          .limit(500),
        currentCompanyId,
      );
      if (needle) {
        // Free-text match against vendor + notes (category is a fixed
        // enum so the dropdown filter on the UI handles that path).
        q = q.or(`vendor.ilike.*${needle}*,notes.ilike.*${needle}*`) as typeof q;
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as unknown as Raw[] | null) ?? []).map(r => ({
        id: r.id,
        companyId: r.companyId ?? '',
        date: r.date ?? '',
        vendor: r.vendor ?? '',
        amount: Number(r.amount) || 0,
        currency: r.currency ?? 'USD',
        category: (r.category as ExpenseCategory) ?? 'OTHER',
        notes: r.notes,
        attachmentUrl: r.attachmentUrl,
        paymentStatus: (r.paymentStatus as ExpensePaymentStatus) ?? 'UNPAID',
        paidDate: r.paidDate,
        paymentReceiptUrl: r.paymentReceiptUrl,
        createdAt: r.createdAt ?? '',
        createdBy: r.createdBy,
      }));
    },
  );
}
