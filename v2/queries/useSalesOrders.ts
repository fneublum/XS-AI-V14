// Phase 3B — Sales orders. Full v1 field parity including items.

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';
import type { LineItem } from '../components/LineItemsEditor';

export interface SalesOrder {
  id: string;
  companyId: string | null;
  customerId: string | null;
  customerName: string;
  orderNumber: string;
  orderDate: string | null;
  orderType: string | null;
  status: string;
  items: LineItem[];
  totalAmount: number;
  currency: string;
  paymentTerms: string | null;
  incoterm: string | null;
  notes: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  createdAt: string;
  saleType: string | null;
  deliveryMethod: string | null;
  deliveryAddress: string | null;
  deliveryDate: string | null;
  pod: string | null;
  poa: string | null;
  pickupLocation: string | null;
  bankId: string | null;
  notifyPartyId: string | null;
  notifyPartyName: string | null;
  bookingNumber: string | null;
}

interface RawRow {
  id: string;
  companyId: string | null;
  customerId: string | null;
  customerName: string | null;
  orderNumber: string | null;
  orderDate: string | null;
  orderType: string | null;
  status: string | null;
  items: unknown;
  totalAmount: number | string | null;
  currency: string | null;
  paymentTerms: string | null;
  incoterm: string | null;
  notes: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  createdAt: string | null;
  saleType: string | null;
  deliveryMethod: string | null;
  deliveryAddress: string | null;
  deliveryDate: string | null;
  pod: string | null;
  poa: string | null;
  pickupLocation: string | null;
  bankId: string | null;
  notifyPartyId: string | null;
  notifyPartyName: string | null;
  bookingNumber: string | null;
}

function scopeByCompany<Q extends { eq: Function; or: Function }>(q: Q, companyId: string): Q {
  // 'ALL' scope means no filter. Otherwise include rows scoped to the
  // current company AND system-wide rows (companyId='ALL') so legacy /
  // imported sales orders that weren't tagged with a specific company
  // still surface in the list.
  if (companyId === 'ALL') return q;
  return (q.or(`"companyId".eq.${companyId},"companyId".eq.ALL`) as Q);
}

const parseItems = (raw: unknown): LineItem[] => {
  try {
    let arr: unknown = raw;
    if (typeof raw === 'string') arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((r: any) => ({
      productId: r?.productId ?? undefined,
      productName: r?.productName ?? r?.name ?? '',
      customerDescription: r?.customerDescription ?? r?.description ?? '',
      hsCode: r?.hsCode ?? '',
      grade: r?.grade ?? '',
      quantity: Number(r?.quantity) || 0,
      unitPrice: Number(r?.unitPrice ?? r?.price) || 0,
      total: Number(r?.total) || ((Number(r?.quantity) || 0) * (Number(r?.unitPrice ?? r?.price) || 0)),
    }));
  } catch {
    return [];
  }
};

export interface UseSalesOrdersOptions {
  statusFilter?: string;
  search?: string;
  limit?: number;
}

export function useSalesOrders({
  statusFilter = 'ALL',
  search = '',
  limit = 200,
}: UseSalesOrdersOptions = {}) {
  const { currentCompanyId } = useCompany();
  const normalizedSearch = search.trim();

  return useSupabaseQuery<SalesOrder[]>(
    ['salesOrders', currentCompanyId, statusFilter, normalizedSearch, limit],
    async () => {
      const supabase = getSupabaseClient();
      let q = scopeByCompany(
        supabase
          .from('sales_orders')
          .select('*')
          .order('createdAt', { ascending: false })
          .limit(limit),
        currentCompanyId,
      );

      if (statusFilter && statusFilter !== 'ALL') {
        q = q.eq('status', statusFilter) as typeof q;
      }

      if (normalizedSearch) {
        q = q.or(
          `orderNumber.ilike.*${normalizedSearch}*,customerName.ilike.*${normalizedSearch}*`,
        ) as typeof q;
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      return ((data as RawRow[] | null) ?? []).map(r => ({
        id: r.id,
        companyId: r.companyId,
        customerId: r.customerId,
        customerName: r.customerName ?? '—',
        orderNumber: r.orderNumber ?? r.id,
        orderDate: r.orderDate,
        orderType: r.orderType,
        status: r.status ?? 'PENDING',
        items: parseItems(r.items),
        totalAmount: Number(r.totalAmount) || 0,
        currency: r.currency ?? 'USD',
        paymentTerms: r.paymentTerms,
        incoterm: r.incoterm,
        notes: r.notes,
        createdBy: r.createdBy,
        approvedBy: r.approvedBy,
        createdAt: r.createdAt ?? '',
        saleType: r.saleType,
        deliveryMethod: r.deliveryMethod,
        deliveryAddress: r.deliveryAddress,
        deliveryDate: r.deliveryDate,
        pod: r.pod,
        poa: r.poa,
        pickupLocation: r.pickupLocation,
        bankId: r.bankId,
        notifyPartyId: r.notifyPartyId,
        notifyPartyName: r.notifyPartyName,
        bookingNumber: r.bookingNumber,
      }));
    },
  );
}
