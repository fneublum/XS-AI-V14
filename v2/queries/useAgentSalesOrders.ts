// Agent Sales Orders query.
//
// Master table is commission_sales_orders. All reads/writes for this
// module stay inside the commission_* tables — the general
// sales_orders and invoices tables are NOT used.
//
// The list surfaces each commission row enriched with:
//   - hasOffer / hasProforma      — from commissions_proformas
//   - hasCustomerInvoice          — from commission_customer_invoices
//   - hasCommissionInvoice        — from commission_sales_orders.commissionInvoicePdfUrl
//   - derived pipeline stage

import { useCompany } from '../providers/CompanyProvider';
import { getSupabaseClient } from '../../services/supabase';
import { useSupabaseQuery } from './useSupabaseQuery';
import {
  derivePipelineStage, PipelineStage, CommissionType,
} from '../lib/agentPipelineStage';

export interface AgentLineItem {
  productName?: string;
  description?: string;
  customerDescription?: string;
  hsCode?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  amount?: number;
  total?: number;
  grossLbs?: number;
  netLbs?: number;
  grossKg?: number;
  netKg?: number;
  /** Container / package count (e.g. 600). Separate from `quantity`
   *  which is the priced unit count. */
  volumeCount?: number;
  /** Container unit — "Bales" / "Bags" / "Pcs" / "Sets". */
  volumeUnit?: string;
}

export interface AgentOrderRow {
  id: string;
  companyId: string | null;
  orderNumber: string;
  sellerName: string;
  customerName: string;
  status: string;
  incoterm: string | null;
  paymentTerms: string | null;
  pod: string | null;
  deliveryDate: string | null;
  items: AgentLineItem[];
  totalQuantity: number;
  orderTotal: number;
  commissionRate: number | null;
  commissionType: CommissionType | null;
  commissionAmount: number;
  originalDocumentUrl: string | null;
  blDocumentUrl: string | null;
  plDocumentUrl: string | null;
  signedDocumentUrl: string | null;
  paymentStatus: string | null;
  invoiceStatus: string | null;
  commissionPaymentStatus: string | null;
  invoiceNumber: string | null;
  commissionInvoiceNumber: string | null;
  commissionInvoiceDate: string | null;
  commissionInvoicePdfUrl: string | null;
  approvedBy: string | null;
  createdAt: string;
  stage: PipelineStage;

  // Joined summary fields.
  hasOffer: boolean;
  hasProforma: boolean;
  hasCustomerInvoice: boolean;
  offerProformaId: string | null;
  proformaId: string | null;
  customerInvoiceId: string | null;
  customerInvoiceNumber: string | null;
}

interface RawCSO {
  id: string;
  companyId: string | null;
  orderNumber: string | null;
  sellerName: string | null;
  customerName: string | null;
  status: string | null;
  incoterm: string | null;
  paymentTerms: string | null;
  pod: string | null;
  deliveryDate: string | null;
  items: unknown;
  totalQuantity: number | string | null;
  orderTotal: number | string | null;
  commissionRate: number | string | null;
  commissionType: string | null;
  commissionAmount: number | string | null;
  originalDocumentUrl: string | null;
  blDocumentUrl: string | null;
  plDocumentUrl: string | null;
  signedDocumentUrl: string | null;
  paymentStatus: string | null;
  invoiceStatus: string | null;
  commissionPaymentStatus: string | null;
  invoiceNumber: string | null;
  commissionInvoiceNumber: string | null;
  commissionInvoiceDate: string | null;
  commissionInvoicePdfUrl: string | null;
  approvedBy: string | null;
  createdAt: string | null;
}

interface RawProforma {
  id: string;
  pi_number: string | null;
  contract_id: string | null;
  status: string | null;
}

interface RawCustomerInvoice {
  id: string;
  invoiceNumber: string | null;
  soNumber: string | null;
}

function scopeByCompany<Q extends { eq: Function }>(q: Q, companyId: string): Q {
  return companyId === 'ALL' ? q : (q.eq('"companyId"', companyId) as Q);
}

const parseItems = (raw: unknown): AgentLineItem[] => {
  try {
    let arr: unknown = raw;
    if (typeof raw === 'string') arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((r: any) => ({
      productName: r?.productName ?? r?.description ?? r?.name ?? '',
      description: r?.description ?? '',
      customerDescription: r?.customerDescription ?? r?.description ?? '',
      hsCode: r?.hsCode ?? '',
      quantity: Number(r?.quantity) || 0,
      unit: r?.unit ?? 'Lbs',
      unitPrice: Number(r?.unitPrice ?? r?.price) || 0,
      amount: Number(r?.amount) || 0,
      total: Number(r?.total ?? r?.amount) || (Number(r?.quantity || 0) * Number(r?.unitPrice || 0)),
      grossLbs: Number(r?.grossLbs) || 0,
      netLbs: Number(r?.netLbs) || 0,
      grossKg: Number(r?.grossKg) || 0,
      netKg: Number(r?.netKg) || 0,
    }));
  } catch {
    return [];
  }
};

const normalizeCommissionType = (v: string | null): CommissionType | null => {
  const s = (v ?? '').toUpperCase();
  if (s === 'PERCENT' || s === 'PER_LBS' || s === 'PER_KGS') return s;
  return null;
};

export function useAgentSalesOrders(search = '') {
  const { currentCompanyId } = useCompany();
  const needle = search.trim();

  return useSupabaseQuery<AgentOrderRow[]>(
    ['agentSalesOrders', currentCompanyId, needle],
    async () => {
      const supabase = getSupabaseClient();

      let csoQ = scopeByCompany(
        supabase.from('commission_sales_orders')
          .select('*')
          .order('createdAt', { ascending: false, nullsFirst: false })
          .limit(200),
        currentCompanyId,
      );
      if (needle) {
        csoQ = csoQ.or(
          `orderNumber.ilike.*${needle}*,customerName.ilike.*${needle}*,sellerName.ilike.*${needle}*`,
        ) as typeof csoQ;
      }
      const { data: csoRows, error: csoErr } = await csoQ;
      if (csoErr) throw new Error(csoErr.message);

      const orders = (csoRows as RawCSO[] | null) ?? [];
      const orderNumbers = orders.map(o => o.orderNumber).filter((x): x is string => !!x);
      const orderIds = orders.map(o => o.id);

      const [proformaRes, invRes] = await Promise.all([
        orderIds.length
          ? supabase.from('commissions_proformas')
              .select('id, pi_number, contract_id, status')
              .in('contract_id', orderIds)
          : Promise.resolve({ data: [] as RawProforma[] }),
        orderNumbers.length
          ? supabase.from('commission_customer_invoices')
              .select('id, invoiceNumber, soNumber')
              .in('soNumber', orderNumbers)
          : Promise.resolve({ data: [] as RawCustomerInvoice[] }),
      ]);

      const proformaByOrder = new Map<string, RawProforma[]>();
      for (const p of (proformaRes.data as RawProforma[] | null) ?? []) {
        if (!p.contract_id) continue;
        const list = proformaByOrder.get(p.contract_id) ?? [];
        list.push(p);
        proformaByOrder.set(p.contract_id, list);
      }
      const invByOrder = new Map<string, RawCustomerInvoice>();
      for (const i of (invRes.data as RawCustomerInvoice[] | null) ?? []) {
        if (i.soNumber) invByOrder.set(i.soNumber, i);
      }

      return orders.map<AgentOrderRow>(r => {
        const proformas = proformaByOrder.get(r.id) ?? [];
        const draft = proformas.find(p => (p.status ?? '').toUpperCase() === 'DRAFT');
        const finalized = proformas.find(p => (p.status ?? '').toUpperCase() !== 'DRAFT');
        const hasOffer = proformas.length > 0;
        const hasProforma = !!finalized
          || (hasOffer && r.commissionRate !== null && r.commissionRate !== undefined);
        const invRow = invByOrder.get(r.orderNumber ?? '');
        const hasCustomerInvoice = !!invRow;
        const hasCommissionInvoice = !!r.commissionInvoicePdfUrl;
        const stage = derivePipelineStage({
          status: r.status ?? '',
          hasOffer,
          hasProforma,
          hasCustomerInvoice,
          paymentStatus: r.paymentStatus,
          commissionPaymentStatus: r.commissionPaymentStatus,
          hasCommissionInvoice,
        });

        return {
          id: r.id,
          companyId: r.companyId,
          orderNumber: r.orderNumber ?? r.id,
          sellerName: r.sellerName ?? '—',
          customerName: r.customerName ?? '—',
          status: r.status ?? 'DRAFT',
          incoterm: r.incoterm,
          paymentTerms: r.paymentTerms,
          pod: r.pod,
          deliveryDate: r.deliveryDate,
          items: parseItems(r.items),
          totalQuantity: Number(r.totalQuantity) || 0,
          orderTotal: Number(r.orderTotal) || 0,
          commissionRate: r.commissionRate == null ? null : Number(r.commissionRate),
          commissionType: normalizeCommissionType(r.commissionType),
          commissionAmount: Number(r.commissionAmount) || 0,
          originalDocumentUrl: r.originalDocumentUrl,
          blDocumentUrl: r.blDocumentUrl,
          plDocumentUrl: r.plDocumentUrl,
          signedDocumentUrl: r.signedDocumentUrl,
          paymentStatus: r.paymentStatus,
          invoiceStatus: r.invoiceStatus,
          commissionPaymentStatus: r.commissionPaymentStatus,
          invoiceNumber: r.invoiceNumber,
          commissionInvoiceNumber: r.commissionInvoiceNumber,
          commissionInvoiceDate: r.commissionInvoiceDate,
          commissionInvoicePdfUrl: r.commissionInvoicePdfUrl,
          approvedBy: r.approvedBy,
          createdAt: r.createdAt ?? '',
          stage,
          hasOffer,
          hasProforma,
          hasCustomerInvoice,
          offerProformaId: draft?.id ?? null,
          proformaId: finalized?.id ?? proformas[0]?.id ?? null,
          customerInvoiceId: invRow?.id ?? null,
          customerInvoiceNumber: invRow?.invoiceNumber ?? null,
        };
      });
    },
  );
}
