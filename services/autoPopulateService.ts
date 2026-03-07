/**
 * Auto-Population Service — Smart field pre-filling for XS-AI-ERP
 *
 * Reduces manual data entry by auto-filling form fields from:
 * - Master data (customer, supplier, product records)
 * - Historical data (last orders, prices, terms)
 * - Linked records (SO→Invoice, PO→Inventory, Booking→Shipment)
 */

import { getSupabaseClient } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export type EntityType =
  | 'sales_order' | 'purchase_order' | 'invoice'
  | 'booking' | 'shipment' | 'freight_quote'
  | 'packing_list' | 'cost_calculation';

export interface AutoPopulateInput {
  entityType: EntityType;
  companyId: string;
  hints: Record<string, any>; // Minimal user input (e.g., customerId, productIds)
}

export interface AutoPopulateResult {
  fields: Record<string, any>;
  source: Record<string, string>; // field → source description
  confidence: Record<string, number>; // field → 0-1 confidence
}

// ─── Service ─────────────────────────────────────────────────────────────────

class AutoPopulateService {
  private client = getSupabaseClient();

  /**
   * Auto-populate fields for a new record
   */
  async populate(input: AutoPopulateInput): Promise<AutoPopulateResult> {
    const result: AutoPopulateResult = { fields: {}, source: {}, confidence: {} };

    try {
      switch (input.entityType) {
        case 'sales_order':
          await this.populateSalesOrder(input, result);
          break;
        case 'purchase_order':
          await this.populatePurchaseOrder(input, result);
          break;
        case 'invoice':
          await this.populateInvoice(input, result);
          break;
        case 'booking':
          await this.populateBooking(input, result);
          break;
        case 'shipment':
          await this.populateShipment(input, result);
          break;
        case 'freight_quote':
          await this.populateFreightQuote(input, result);
          break;
        case 'packing_list':
          await this.populatePackingList(input, result);
          break;
        case 'cost_calculation':
          await this.populateCostCalculation(input, result);
          break;
      }
    } catch (err) {
      console.error('[AutoPopulate] Error:', err);
    }

    console.log(`[AutoPopulate] ${input.entityType}: filled ${Object.keys(result.fields).length} fields`);
    return result;
  }

  // ─── Sales Order ─────────────────────────────────────────────────────

  private async populateSalesOrder(input: AutoPopulateInput, result: AutoPopulateResult) {
    const { companyId, hints } = input;
    const { customerId, customerName, productIds } = hints;

    // 1. Auto-fill from customer master
    if (customerId || customerName) {
      const customer = await this.findCustomer(companyId, customerId, customerName);
      if (customer) {
        this.set(result, 'customerId', customer.id, 'Customer master', 1.0);
        this.set(result, 'customerName', customer.name, 'Customer master', 1.0);
        this.set(result, 'paymentTerms', customer.paymentTerms, 'Customer master', 0.95);
        this.set(result, 'pod', customer.pod, 'Customer master', 0.9);
        this.set(result, 'deliveryAddress', customer.address || customer.location, 'Customer master', 0.85);
        this.set(result, 'currency', 'USD', 'Default', 0.8);

        // Pick up POA and pickup location from customer
        if (customer.poa) this.set(result, 'poa', customer.poa, 'Customer master', 0.9);
        if (customer.pickupLocation) this.set(result, 'pickupLocation', customer.pickupLocation, 'Customer master', 0.85);
      }
    }

    // 2. Auto-fill from last SO to this customer
    if (customerId || customerName) {
      const lastSO = await this.findLastOrder(companyId, 'sales_orders', customerId, customerName);
      if (lastSO) {
        if (!result.fields.paymentTerms) this.set(result, 'paymentTerms', lastSO.paymentTerms, 'Last order', 0.85);
        if (!result.fields.incoterm) this.set(result, 'incoterm', lastSO.incoterm, 'Last order', 0.8);
        if (!result.fields.currency) this.set(result, 'currency', lastSO.currency, 'Last order', 0.85);
        if (!result.fields.saleType) this.set(result, 'saleType', lastSO.saleType, 'Last order', 0.75);
        if (!result.fields.deliveryMethod) this.set(result, 'deliveryMethod', lastSO.deliveryMethod, 'Last order', 0.75);
        if (!result.fields.bankId) this.set(result, 'bankId', lastSO.bankId, 'Last order', 0.7);
      }
    }

    // 3. Auto-fill order metadata
    this.set(result, 'orderNumber', `SO-${Date.now().toString(36).toUpperCase()}`, 'Auto-generated', 1.0);
    this.set(result, 'orderDate', new Date().toISOString().split('T')[0], 'Today', 1.0);
    this.set(result, 'status', 'PENDING', 'Default', 1.0);
    this.set(result, 'orderType', 'SPOT', 'Default', 0.7);

    // 4. Auto-fill product prices from last SO or product master
    if (productIds?.length) {
      const items = await this.getProductPrices(companyId, productIds, customerId);
      if (items.length) this.set(result, 'suggestedItems', items, 'Product catalog + history', 0.8);
    }
  }

  // ─── Purchase Order ──────────────────────────────────────────────────

  private async populatePurchaseOrder(input: AutoPopulateInput, result: AutoPopulateResult) {
    const { companyId, hints } = input;
    const { supplierId, supplierName, productIds } = hints;

    // 1. Auto-fill from supplier master
    if (supplierId || supplierName) {
      const supplier = await this.findSupplier(companyId, supplierId, supplierName);
      if (supplier) {
        this.set(result, 'supplierId', supplier.id, 'Supplier master', 1.0);
        this.set(result, 'supplierName', supplier.name, 'Supplier master', 1.0);
        this.set(result, 'paymentTerms', supplier.paymentTerms, 'Supplier master', 0.95);
        this.set(result, 'currency', 'USD', 'Default', 0.8);
      }
    }

    // 2. Auto-fill from last PO
    if (supplierId || supplierName) {
      const lastPO = await this.findLastPO(companyId, supplierId, supplierName);
      if (lastPO) {
        if (!result.fields.paymentTerms) this.set(result, 'paymentTerms', lastPO.paymentTerms, 'Last PO', 0.85);
        if (!result.fields.currency) this.set(result, 'currency', lastPO.currency, 'Last PO', 0.85);
      }
    }

    this.set(result, 'orderDate', new Date().toISOString().split('T')[0], 'Today', 1.0);
    this.set(result, 'status', 'Draft', 'Default', 1.0);

    // 3. Product prices from supplier quotes
    if (productIds?.length && (supplierId || supplierName)) {
      const items = await this.getSupplierQuotePrices(companyId, supplierId, supplierName, productIds);
      if (items.length) this.set(result, 'suggestedItems', items, 'Supplier quotes', 0.85);
    }
  }

  // ─── Invoice ─────────────────────────────────────────────────────────

  private async populateInvoice(input: AutoPopulateInput, result: AutoPopulateResult) {
    const { companyId, hints } = input;
    const { salesOrderId, packingListId, customerId } = hints;

    // 1. Auto-fill from linked Sales Order
    if (salesOrderId) {
      const { data: so } = await this.client
        .from('sales_orders')
        .select('*')
        .eq('id', salesOrderId)
        .single();

      if (so) {
        this.set(result, 'soldTo', so.customerName, 'Sales Order', 1.0);
        this.set(result, 'paymentTerms', so.paymentTerms, 'Sales Order', 0.95);
        this.set(result, 'currency', so.currency, 'Sales Order', 1.0);
        this.set(result, 'incoterms', so.incoterm, 'Sales Order', 0.95);
        this.set(result, 'customerPo', so.orderNumber, 'Sales Order', 1.0);
        this.set(result, 'soNumber', so.orderNumber, 'Sales Order', 1.0);
        this.set(result, 'totalAmount', so.totalAmount, 'Sales Order', 0.9);
        this.set(result, 'pod', so.pod, 'Sales Order', 0.9);
        this.set(result, 'poa', so.poa, 'Sales Order', 0.9);

        // Set items from SO
        if (so.items) {
          this.set(result, 'items', typeof so.items === 'string' ? so.items : JSON.stringify(so.items), 'Sales Order', 0.9);
        }
      }
    }

    // 2. Auto-fill from Packing List
    if (packingListId) {
      const { data: pl } = await this.client
        .from('packing_lists')
        .select('*')
        .eq('id', packingListId)
        .single();

      if (pl) {
        this.set(result, 'shipTo', pl.consignee || pl.destination, 'Packing List', 0.95);
        this.set(result, 'grossWeight', pl.grossWeight, 'Packing List', 1.0);
        this.set(result, 'netWeight', pl.netWeight, 'Packing List', 1.0);
        this.set(result, 'plNumber', pl.plNumber, 'Packing List', 1.0);
        this.set(result, 'carrier', pl.carrier, 'Packing List', 0.9);
        if (pl.containers) this.set(result, 'containers', pl.containers, 'Packing List', 1.0);
        if (pl.items && !result.fields.items) {
          this.set(result, 'items', pl.items, 'Packing List', 0.95);
        }
      }
    }

    // 3. Auto-fill company bank details
    const { data: banks } = await this.client
      .from('banks')
      .select('*')
      .eq('company_id', companyId)
      .limit(1);

    if (banks?.length) {
      const bank = banks[0];
      this.set(result, 'bankName', bank.name, 'Company bank', 0.95);
      this.set(result, 'swiftCode', bank.swift_code, 'Company bank', 0.95);
      this.set(result, 'routingNumber', bank.routing, 'Company bank', 0.95);
      this.set(result, 'accountNumber', bank.account_number, 'Company bank', 0.95);
    }

    // 4. Company shipper info
    const { data: company } = await this.client
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    if (company) {
      this.set(result, 'shipperName', company.name, 'Company', 1.0);
      const addr = [company.address, company.city, company.state, company.zip, company.country].filter(Boolean).join(', ');
      this.set(result, 'shipperAddress', addr, 'Company', 0.95);
    }

    this.set(result, 'invoiceDate', new Date().toISOString().split('T')[0], 'Today', 1.0);
  }

  // ─── Booking ─────────────────────────────────────────────────────────

  private async populateBooking(input: AutoPopulateInput, result: AutoPopulateResult) {
    const { companyId, hints } = input;
    const { salesOrderId } = hints;

    if (salesOrderId) {
      const { data: so } = await this.client
        .from('sales_orders')
        .select('*')
        .eq('id', salesOrderId)
        .single();

      if (so) {
        this.set(result, 'customer', so.customerName, 'Sales Order', 1.0);
        this.set(result, 'pol', so.poa, 'Sales Order', 0.9);
        this.set(result, 'pod', so.pod, 'Sales Order', 0.9);
        this.set(result, 'salesOrderId', so.id, 'Sales Order', 1.0);
        this.set(result, 'status', 'REQUESTED', 'Default', 1.0);
      }
    }

    this.set(result, 'bookingNumber', `BK-${Date.now().toString(36).toUpperCase()}`, 'Auto-generated', 1.0);
  }

  // ─── Shipment ────────────────────────────────────────────────────────

  private async populateShipment(input: AutoPopulateInput, result: AutoPopulateResult) {
    const { companyId, hints } = input;
    const { bookingId } = hints;

    if (bookingId) {
      const { data: booking } = await this.client
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single();

      if (booking) {
        this.set(result, 'containerNumber', booking.containerNumber, 'Booking', 0.9);
        this.set(result, 'blNumber', booking.blNumber, 'Booking', 0.9);
        this.set(result, 'origin', booking.pol, 'Booking', 1.0);
        this.set(result, 'destination', booking.pod, 'Booking', 1.0);
        this.set(result, 'carrier', booking.carrier, 'Booking', 0.9);
        this.set(result, 'etd', booking.etd, 'Booking', 0.95);
        this.set(result, 'eta', booking.eta, 'Booking', 0.95);
        this.set(result, 'status', 'Booking', 'Default', 1.0);
      }
    }
  }

  // ─── Freight Quote ───────────────────────────────────────────────────

  private async populateFreightQuote(input: AutoPopulateInput, result: AutoPopulateResult) {
    const { companyId, hints } = input;
    const { salesOrderId, origin, destination } = hints;

    if (salesOrderId) {
      const { data: so } = await this.client
        .from('sales_orders')
        .select('poa, pod, items, totalAmount')
        .eq('id', salesOrderId)
        .single();

      if (so) {
        this.set(result, 'originPort', so.poa, 'Sales Order', 0.9);
        this.set(result, 'destinationPort', so.pod, 'Sales Order', 0.9);
      }
    }

    if (origin) this.set(result, 'originPort', origin, 'User input', 1.0);
    if (destination) this.set(result, 'destinationPort', destination, 'User input', 1.0);

    this.set(result, 'currency', 'USD', 'Default', 0.8);
    this.set(result, 'status', 'PENDING', 'Default', 1.0);
    this.set(result, 'freightType', 'PORT_PORT', 'Default', 0.7);

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);
    this.set(result, 'validUntil', validUntil.toISOString().split('T')[0], 'Default 30 days', 0.8);
  }

  // ─── Packing List ────────────────────────────────────────────────────

  private async populatePackingList(input: AutoPopulateInput, result: AutoPopulateResult) {
    const { companyId, hints } = input;
    const { salesOrderId, bookingId } = hints;

    if (salesOrderId) {
      const { data: so } = await this.client
        .from('sales_orders')
        .select('*')
        .eq('id', salesOrderId)
        .single();

      if (so) {
        this.set(result, 'soNumber', so.orderNumber, 'Sales Order', 1.0);
        this.set(result, 'consignee', so.customerName, 'Sales Order', 0.95);
        this.set(result, 'destination', so.pod, 'Sales Order', 0.9);

        if (so.items) {
          const items = typeof so.items === 'string' ? JSON.parse(so.items) : so.items;
          this.set(result, 'items', JSON.stringify(items), 'Sales Order', 0.9);
          this.set(result, 'productDescription', items.map((i: any) => i.productName).join(', '), 'Sales Order', 0.9);
        }
      }
    }

    if (bookingId) {
      const { data: booking } = await this.client
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single();

      if (booking) {
        this.set(result, 'containerNumber', booking.containerNumber, 'Booking', 0.9);
        this.set(result, 'vesselVoyage', booking.vesselVoyage, 'Booking', 0.95);
        this.set(result, 'carrier', booking.carrier, 'Booking', 0.9);
        this.set(result, 'shippingPoint', booking.pol, 'Booking', 0.9);
      }
    }

    // Company shipper info
    const { data: company } = await this.client
      .from('companies')
      .select('name, address, city, state, country')
      .eq('id', companyId)
      .single();

    if (company) {
      this.set(result, 'shipper', company.name, 'Company', 1.0);
    }

    this.set(result, 'date', new Date().toISOString().split('T')[0], 'Today', 1.0);
    this.set(result, 'status', 'AVAILABLE', 'Default', 1.0);
  }

  // ─── Cost Calculation ────────────────────────────────────────────────

  private async populateCostCalculation(input: AutoPopulateInput, result: AutoPopulateResult) {
    const { companyId, hints } = input;
    const { productName, supplierId, customerId } = hints;

    // Get product price
    if (productName) {
      const { data: product } = await this.client
        .from('products')
        .select('*')
        .eq('companyId', companyId)
        .ilike('name', `%${productName}%`)
        .limit(1)
        .single();

      if (product) {
        this.set(result, 'productName', product.name, 'Product master', 1.0);
        this.set(result, 'hsCode', product.hsCode, 'Product master', 0.95);
        this.set(result, 'fobPrice', product.price, 'Product master', 0.8);
      }
    }

    this.set(result, 'date', new Date().toISOString().split('T')[0], 'Today', 1.0);
    this.set(result, 'marginPercent', 15, 'Default 15%', 0.6);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private set(result: AutoPopulateResult, field: string, value: any, source: string, confidence: number) {
    if (value !== undefined && value !== null && value !== '') {
      result.fields[field] = value;
      result.source[field] = source;
      result.confidence[field] = confidence;
    }
  }

  private async findCustomer(companyId: string, customerId?: string, customerName?: string) {
    if (customerId) {
      const { data } = await this.client
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .single();
      return data;
    }
    if (customerName) {
      const { data } = await this.client
        .from('customers')
        .select('*')
        .eq('companyId', companyId)
        .ilike('name', `%${customerName}%`)
        .limit(1)
        .single();
      return data;
    }
    return null;
  }

  private async findSupplier(companyId: string, supplierId?: string, supplierName?: string) {
    if (supplierId) {
      const { data } = await this.client
        .from('suppliers')
        .select('*')
        .eq('id', supplierId)
        .single();
      return data;
    }
    if (supplierName) {
      const { data } = await this.client
        .from('suppliers')
        .select('*')
        .eq('companyId', companyId)
        .ilike('name', `%${supplierName}%`)
        .limit(1)
        .single();
      return data;
    }
    return null;
  }

  private async findLastOrder(companyId: string, table: string, entityId?: string, entityName?: string) {
    let query = this.client
      .from(table)
      .select('*')
      .eq('companyId', companyId)
      .order('createdAt', { ascending: false })
      .limit(1);

    if (entityId) query = query.eq('customerId', entityId);
    else if (entityName) query = query.ilike('customerName', `%${entityName}%`);

    const { data } = await query;
    return data?.[0] || null;
  }

  private async findLastPO(companyId: string, supplierId?: string, supplierName?: string) {
    let query = this.client
      .from('purchase_orders')
      .select('*')
      .eq('companyId', companyId)
      .order('orderDate', { ascending: false })
      .limit(1);

    if (supplierId) query = query.eq('supplierId', supplierId);
    else if (supplierName) query = query.ilike('supplierName', `%${supplierName}%`);

    const { data } = await query;
    return data?.[0] || null;
  }

  private async getProductPrices(companyId: string, productIds: string[], customerId?: string) {
    const items: any[] = [];

    for (const pid of productIds) {
      const { data: product } = await this.client
        .from('products')
        .select('*')
        .eq('id', pid)
        .single();

      if (product) {
        // Try to find last price for this customer + product
        let lastPrice = product.price;

        if (customerId) {
          const { data: lastSO } = await this.client
            .from('sales_orders')
            .select('items')
            .eq('companyId', companyId)
            .eq('customerId', customerId)
            .order('createdAt', { ascending: false })
            .limit(5);

          if (lastSO?.length) {
            for (const so of lastSO) {
              const soItems = typeof so.items === 'string' ? JSON.parse(so.items) : (so.items || []);
              const match = soItems.find((i: any) =>
                i.productId === pid || i.productName?.toLowerCase().includes(product.name.toLowerCase())
              );
              if (match?.unitPrice) {
                lastPrice = match.unitPrice;
                break;
              }
            }
          }
        }

        items.push({
          productId: product.id,
          productName: product.name,
          hsCode: product.hsCode || '',
          customerDescription: product.description || product.name,
          quantity: 0, // User fills this
          unitPrice: lastPrice || 0,
          total: 0,
          source: lastPrice !== product.price ? 'Last order price' : 'Product catalog',
        });
      }
    }

    return items;
  }

  private async getSupplierQuotePrices(companyId: string, supplierId?: string, supplierName?: string, productIds?: string[]) {
    const items: any[] = [];
    if (!productIds?.length) return items;

    // Find latest supplier quote
    let query = this.client
      .from('supplier_quotes')
      .select('*')
      .eq('companyId', companyId)
      .order('validUntil', { ascending: false })
      .limit(5);

    if (supplierId) query = query.eq('supplierId', supplierId);
    else if (supplierName) query = query.ilike('supplierName', `%${supplierName}%`);

    const { data: quotes } = await query;

    for (const pid of productIds) {
      const { data: product } = await this.client
        .from('products')
        .select('*')
        .eq('id', pid)
        .single();

      if (product) {
        let bestPrice = product.price;
        let priceSource = 'Product catalog';

        // Check supplier quotes for better price
        if (quotes?.length) {
          for (const q of quotes) {
            const qItems = typeof q.items === 'string' ? JSON.parse(q.items) : (q.items || []);
            const match = qItems.find((i: any) =>
              i.productName?.toLowerCase().includes(product.name.toLowerCase())
            );
            if (match?.unitPrice) {
              bestPrice = match.unitPrice;
              priceSource = `Quote ${q.quoteNumber || 'latest'}`;
              break;
            }
          }
        }

        items.push({
          productName: product.name,
          quantity: 0,
          unitPrice: bestPrice,
          total: 0,
          source: priceSource,
        });
      }
    }

    return items;
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const autoPopulateService = new AutoPopulateService();

if (typeof window !== 'undefined') {
  (window as any).autoPopulateService = autoPopulateService;
}
