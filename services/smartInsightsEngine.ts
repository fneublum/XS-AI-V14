/**
 * SmartInsightsEngine — Proactive intelligence layer for XS-AI-ERP
 *
 * Analyzes real-time Supabase data to produce actionable insights:
 *  • Expiring quotes / proformas
 *  • Idle customers (no orders in 30+ days)
 *  • Arriving shipments (ETA within 3 days)
 *  • Overdue invoices
 *  • Low-stock alerts
 *  • Pipeline velocity metrics
 *  • Daily briefing data
 */

import { getSupabaseClient } from './supabase';

// ── Types ──────────────────────────────────────────────────────────────

export type InsightSeverity = 'critical' | 'warning' | 'info' | 'success';
export type InsightCategory = 'sales' | 'logistics' | 'finance' | 'inventory' | 'crm' | 'pipeline';

export interface Insight {
  id: string;
  title: string;
  description: string;
  severity: InsightSeverity;
  category: InsightCategory;
  actionLabel?: string;
  actionCommand?: string;  // command the AI agent can execute
  entityType?: string;
  entityId?: string;
  value?: number;
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface DailyBriefingData {
  greeting: string;
  date: string;
  highlights: Insight[];
  metrics: BriefingMetric[];
  pendingActions: Insight[];
  overnightChanges: OvernightChange[];
}

export interface BriefingMetric {
  label: string;
  value: string | number;
  change?: number;       // % change
  trend?: 'up' | 'down' | 'flat';
  icon?: string;
}

export interface OvernightChange {
  type: string;
  description: string;
  timestamp: string;
}

export interface WorkflowStep {
  id: string;
  label: string;
  description: string;
  actionCommand: string;
  status: 'pending' | 'active' | 'completed' | 'skipped';
  requiredFields?: string[];
  entityType?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  steps: WorkflowStep[];
  estimatedTime: string;
}

// ── Workflow Templates ─────────────────────────────────────────────────

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'wf_onboard_customer',
    name: 'Onboard New Customer',
    description: 'Create customer → First quote → Proforma → Sales order',
    icon: '👤',
    estimatedTime: '~5 min',
    steps: [
      { id: 's1', label: 'Create Customer', description: 'Add customer details', actionCommand: 'add customer', status: 'pending', entityType: 'customer', requiredFields: ['customerName', 'country'] },
      { id: 's2', label: 'Create Quote', description: 'Draft initial estimate', actionCommand: 'create estimate', status: 'pending', entityType: 'estimate', requiredFields: ['customerName'] },
      { id: 's3', label: 'Create Proforma', description: 'Generate proforma invoice', actionCommand: 'create proforma', status: 'pending', entityType: 'proforma', requiredFields: ['customerName'] },
      { id: 's4', label: 'Create Sales Order', description: 'Finalize sales order', actionCommand: 'create sales order', status: 'pending', entityType: 'salesOrder', requiredFields: ['customerName'] },
    ],
  },
  {
    id: 'wf_full_shipment',
    name: 'Full Shipment Cycle',
    description: 'Sales order → Booking → B/L → Packing list → Invoice',
    icon: '🚢',
    estimatedTime: '~8 min',
    steps: [
      { id: 's1', label: 'Sales Order', description: 'Create or select SO', actionCommand: 'create sales order', status: 'pending', entityType: 'salesOrder' },
      { id: 's2', label: 'Create Booking', description: 'Book with carrier', actionCommand: 'create booking', status: 'pending', entityType: 'booking', requiredFields: ['vesselVoyage', 'pol', 'pod'] },
      { id: 's3', label: 'Bill of Lading', description: 'Generate B/L', actionCommand: 'create bl', status: 'pending', entityType: 'billOfLading' },
      { id: 's4', label: 'Packing List', description: 'Create packing list', actionCommand: 'create packing list', status: 'pending', entityType: 'packingList' },
      { id: 's5', label: 'Invoice', description: 'Generate commercial invoice', actionCommand: 'create invoice', status: 'pending', entityType: 'invoice' },
    ],
  },
  {
    id: 'wf_procurement',
    name: 'Procurement Flow',
    description: 'Supplier quote → Purchase order → Receive goods → Pay invoice',
    icon: '📦',
    estimatedTime: '~6 min',
    steps: [
      { id: 's1', label: 'Get Quotes', description: 'Request supplier quotes', actionCommand: 'create supplier quote', status: 'pending', entityType: 'supplierQuote' },
      { id: 's2', label: 'Purchase Order', description: 'Issue PO to supplier', actionCommand: 'create purchase order', status: 'pending', entityType: 'purchaseOrder', requiredFields: ['supplierName'] },
      { id: 's3', label: 'Receive Goods', description: 'Mark goods received', actionCommand: 'update inventory', status: 'pending', entityType: 'inventory' },
      { id: 's4', label: 'Record Payment', description: 'Log supplier payment', actionCommand: 'record payment', status: 'pending', entityType: 'payment' },
    ],
  },
  {
    id: 'wf_freight_booking',
    name: 'Freight Booking',
    description: 'Compare freight → Book → Track → Deliver',
    icon: '✈️',
    estimatedTime: '~4 min',
    steps: [
      { id: 's1', label: 'Compare Freight', description: 'Get freight quotes from agents', actionCommand: 'compare freight', status: 'pending', entityType: 'freightQuote' },
      { id: 's2', label: 'Book Shipment', description: 'Confirm booking with best rate', actionCommand: 'create booking', status: 'pending', entityType: 'booking' },
      { id: 's3', label: 'Track Container', description: 'Monitor shipment progress', actionCommand: 'track shipment', status: 'pending', entityType: 'shipment' },
      { id: 's4', label: 'Confirm Delivery', description: 'Mark as delivered', actionCommand: 'confirm delivery', status: 'pending', entityType: 'delivery' },
    ],
  },
];

// ── Context-Aware Quick Actions ────────────────────────────────────────

export interface QuickAction {
  label: string;
  command: string;
  icon: string;
  description: string;
  category: InsightCategory;
}

export const CONTEXT_QUICK_ACTIONS: Record<string, QuickAction[]> = {
  DASHBOARD: [
    { label: 'Daily Briefing', command: 'show my daily briefing', icon: '☀️', description: 'Get your morning intel', category: 'pipeline' },
    { label: 'Overdue Payments', command: 'show overdue invoices', icon: '💰', description: 'Check unpaid invoices', category: 'finance' },
    { label: 'Active Shipments', command: 'show active shipments', icon: '🚢', description: 'Track in-transit cargo', category: 'logistics' },
    { label: 'Pipeline Health', command: 'analyze sales pipeline', icon: '📊', description: 'Sales pipeline overview', category: 'sales' },
  ],
  SELL: [
    { label: 'New Sales Order', command: 'create sales order', icon: '📝', description: 'Start a new SO', category: 'sales' },
    { label: 'Expiring Quotes', command: 'show expiring quotes', icon: '⏰', description: 'Quotes expiring soon', category: 'sales' },
    { label: 'Top Customers', command: 'show top customers by revenue', icon: '🏆', description: 'Revenue leaders', category: 'crm' },
    { label: 'Idle Customers', command: 'show idle customers', icon: '😴', description: 'No orders in 30+ days', category: 'crm' },
  ],
  BUY: [
    { label: 'New PO', command: 'create purchase order', icon: '🛒', description: 'Create purchase order', category: 'inventory' },
    { label: 'Compare Suppliers', command: 'compare supplier prices', icon: '⚖️', description: 'Best pricing analysis', category: 'inventory' },
    { label: 'Low Stock', command: 'show low stock items', icon: '📉', description: 'Items below reorder point', category: 'inventory' },
    { label: 'Pending POs', command: 'show pending purchase orders', icon: '📋', description: 'POs awaiting delivery', category: 'inventory' },
  ],
  LOGISTICS: [
    { label: 'New Booking', command: 'create booking', icon: '📅', description: 'Book a shipment', category: 'logistics' },
    { label: 'Arriving Soon', command: 'show shipments arriving this week', icon: '🛬', description: 'ETA within 7 days', category: 'logistics' },
    { label: 'Create B/L', command: 'create bill of lading', icon: '📄', description: 'New bill of lading', category: 'logistics' },
    { label: 'Freight Rates', command: 'compare freight rates', icon: '💵', description: 'Best available rates', category: 'logistics' },
  ],
  FINANCE: [
    { label: 'Create Invoice', command: 'create invoice', icon: '🧾', description: 'New commercial invoice', category: 'finance' },
    { label: 'AR Aging', command: 'show accounts receivable aging', icon: '📊', description: 'Receivables by age', category: 'finance' },
    { label: 'Overdue', command: 'show overdue payments', icon: '🔴', description: 'Past-due invoices', category: 'finance' },
    { label: 'Revenue Today', command: 'show today revenue', icon: '💹', description: 'Today\'s numbers', category: 'finance' },
  ],
  DATA: [
    { label: 'Add Customer', command: 'add customer', icon: '👤', description: 'New customer record', category: 'crm' },
    { label: 'Add Product', command: 'add product', icon: '📦', description: 'New product entry', category: 'inventory' },
    { label: 'Add Supplier', command: 'add supplier', icon: '🏭', description: 'New supplier record', category: 'inventory' },
    { label: 'Scan Document', command: '/scan', icon: '📷', description: 'OCR a document', category: 'pipeline' },
  ],
  SETTINGS: [
    { label: 'Add User', command: 'add user', icon: '👥', description: 'Create new user', category: 'pipeline' },
    { label: 'Manage Workflows', command: 'show workflows', icon: '⚡', description: 'Automation rules', category: 'pipeline' },
  ],
  AI_UPLOAD: [
    { label: 'Batch Scan', command: 'start batch scan', icon: '📑', description: 'Scan multiple docs', category: 'pipeline' },
    { label: 'Review Queue', command: 'show pending reviews', icon: '👁️', description: 'Docs awaiting review', category: 'pipeline' },
  ],
  CUSTOMER_PORTAL: [
    { label: 'My Orders', command: 'show my orders', icon: '📋', description: 'Your order history', category: 'sales' },
    { label: 'Track Shipment', command: 'track my shipment', icon: '📍', description: 'Where is my cargo?', category: 'logistics' },
  ],
};

// ── Smart Insights Engine ──────────────────────────────────────────────

class SmartInsightsEngine {
  private cache: Map<string, { data: any; expiry: number }> = new Map();
  private CACHE_TTL = 5 * 60 * 1000; // 5 min

  // ── Main: generate all insights for a company ───────────────────────

  async generateInsights(companyId: string): Promise<Insight[]> {
    const cacheKey = `insights_${companyId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) return cached.data;

    const insights: Insight[] = [];

    try {
      const [
        expiringQuotes,
        idleCustomers,
        arrivingShipments,
        overdueInvoices,
        recentOrders,
        pendingBookings,
      ] = await Promise.allSettled([
        this.getExpiringQuotes(companyId),
        this.getIdleCustomers(companyId),
        this.getArrivingShipments(companyId),
        this.getOverdueInvoices(companyId),
        this.getRecentOrders(companyId),
        this.getPendingBookings(companyId),
      ]);

      if (expiringQuotes.status === 'fulfilled') insights.push(...expiringQuotes.value);
      if (idleCustomers.status === 'fulfilled') insights.push(...idleCustomers.value);
      if (arrivingShipments.status === 'fulfilled') insights.push(...arrivingShipments.value);
      if (overdueInvoices.status === 'fulfilled') insights.push(...overdueInvoices.value);
      if (recentOrders.status === 'fulfilled') insights.push(...recentOrders.value);
      if (pendingBookings.status === 'fulfilled') insights.push(...pendingBookings.value);
    } catch (err) {
      console.warn('[SmartInsights] Error generating insights:', err);
    }

    // Sort: critical first, then warning, info, success
    const severityOrder: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2, success: 3 };
    insights.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    this.cache.set(cacheKey, { data: insights, expiry: Date.now() + this.CACHE_TTL });
    return insights;
  }

  // ── Daily Briefing ──────────────────────────────────────────────────

  async generateDailyBriefing(companyId: string, userName: string): Promise<DailyBriefingData> {
    const insights = await this.generateInsights(companyId);
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    const criticalAndWarning = insights.filter(i => i.severity === 'critical' || i.severity === 'warning');
    const actionable = insights.filter(i => i.actionCommand);

    return {
      greeting: `${greeting}, ${userName}`,
      date: now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      highlights: insights.slice(0, 5),
      metrics: this.generateMetrics(insights),
      pendingActions: actionable.slice(0, 4),
      overnightChanges: this.generateOvernightChanges(),
    };
  }

  // ── Smart Suggestion Chips ──────────────────────────────────────────

  async getSmartSuggestions(companyId: string, limit = 4): Promise<Insight[]> {
    const insights = await this.generateInsights(companyId);
    return insights.filter(i => i.actionCommand).slice(0, limit);
  }

  // ── Private: Query Methods ──────────────────────────────────────────

  private async getExpiringQuotes(companyId: string): Promise<Insight[]> {
    const supabase = getSupabaseClient();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    let query = supabase
      .from('estimates')
      .select('id, estimateNumber, buyer, date, totalAmount, currency');
    if (companyId !== 'ALL') {
      query = query.eq('companyId', companyId);
    }
    const { data } = await query
      .lte('date', threeDaysFromNow.toISOString().split('T')[0])
      .gte('date', new Date().toISOString().split('T')[0])
      .limit(5);

    if (!data?.length) return [];

    return data.map(q => ({
      id: `insight_expquote_${q.id}`,
      title: `Quote ${q.estimateNumber || 'N/A'} expiring soon`,
      description: `${q.buyer || 'Customer'} — $${q.totalAmount || 0} ${q.currency || 'USD'}. Expires ${q.date}.`,
      severity: 'warning' as InsightSeverity,
      category: 'sales' as InsightCategory,
      actionLabel: 'Follow up',
      actionCommand: `follow up on quote ${q.estimateNumber}`,
      entityType: 'estimate',
      entityId: q.id,
      value: q.totalAmount,
      createdAt: new Date().toISOString(),
    }));
  }

  private async getIdleCustomers(companyId: string): Promise<Insight[]> {
    const supabase = getSupabaseClient();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get customers with no recent sales orders
    let customersQuery = supabase
      .from('customers')
      .select('id, name, country');
    if (companyId !== 'ALL') {
      customersQuery = customersQuery.eq('companyId', companyId);
    }
    const { data: customers } = await customersQuery.limit(50);

    if (!customers?.length) return [];

    let ordersQuery = supabase
      .from('sales_orders')
      .select('customerName')
      .gte('createdAt', thirtyDaysAgo.toISOString());
    if (companyId !== 'ALL') {
      ordersQuery = ordersQuery.eq('companyId', companyId);
    }
    const { data: recentOrders } = await ordersQuery;

    const activeCustomerNames = new Set((recentOrders || []).map(o => (o as any).customerName?.toLowerCase()));
    const idle = customers.filter(c => !activeCustomerNames.has(c.name?.toLowerCase()));

    if (idle.length === 0) return [];

    return [{
      id: 'insight_idle_customers',
      title: `${idle.length} customer${idle.length > 1 ? 's' : ''} idle for 30+ days`,
      description: idle.slice(0, 3).map(c => c.name).join(', ') + (idle.length > 3 ? ` +${idle.length - 3} more` : ''),
      severity: 'info',
      category: 'crm',
      actionLabel: 'View idle customers',
      actionCommand: 'show idle customers',
      value: idle.length,
      createdAt: new Date().toISOString(),
    }];
  }

  private async getArrivingShipments(companyId: string): Promise<Insight[]> {
    const supabase = getSupabaseClient();
    const threeDays = new Date();
    threeDays.setDate(threeDays.getDate() + 3);

    let query = supabase
      .from('bookings')
      .select('id, bookingNumber, vesselVoyage, eta, pod');
    if (companyId !== 'ALL') {
      query = query.eq('companyId', companyId);
    }
    const { data } = await query
      .lte('eta', threeDays.toISOString().split('T')[0])
      .gte('eta', new Date().toISOString().split('T')[0])
      .limit(5);

    if (!data?.length) return [];

    return data.map(s => ({
      id: `insight_arriving_${s.id}`,
      title: `Shipment ${(s as any).bookingNumber || ''} arriving soon`,
      description: `${(s as any).vesselVoyage || 'Vessel'} → ${(s as any).pod || 'Port'}. ETA: ${(s as any).eta}`,
      severity: 'info' as InsightSeverity,
      category: 'logistics' as InsightCategory,
      actionLabel: 'Track',
      actionCommand: `track booking ${(s as any).bookingNumber}`,
      entityType: 'booking',
      entityId: s.id,
      createdAt: new Date().toISOString(),
    }));
  }

  private async getOverdueInvoices(companyId: string): Promise<Insight[]> {
    const supabase = getSupabaseClient();
    // No dueDate column exists — estimate overdue as invoices older than 45 days
    const overdueThreshold = new Date();
    overdueThreshold.setDate(overdueThreshold.getDate() - 45);

    let query = supabase
      .from('invoices')
      .select('id, invoiceNumber, soldTo, totalAmount, currency, invoiceDate');
    if (companyId !== 'ALL') {
      query = query.eq('companyId', companyId);
    }
    const { data } = await query
      .lt('invoiceDate', overdueThreshold.toISOString().split('T')[0])
      .limit(5);

    if (!data?.length) return [];

    const total = data.reduce((sum, inv) => sum + ((inv as any).totalAmount || 0), 0);

    return [{
      id: 'insight_overdue_invoices',
      title: `${data.length} overdue invoice${data.length > 1 ? 's' : ''} — $${total.toLocaleString()}`,
      description: data.slice(0, 3).map(i => `${(i as any).invoiceNumber}: ${(i as any).soldTo}`).join(', '),
      severity: 'critical',
      category: 'finance',
      actionLabel: 'View overdue',
      actionCommand: 'show overdue invoices',
      value: total,
      createdAt: new Date().toISOString(),
    }];
  }

  private async getRecentOrders(companyId: string): Promise<Insight[]> {
    const supabase = getSupabaseClient();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    let query = supabase
      .from('sales_orders')
      .select('id, orderNumber, customerName, totalAmount, currency, status');
    if (companyId !== 'ALL') {
      query = query.eq('companyId', companyId);
    }
    const { data } = await query
      .gte('createdAt', yesterday.toISOString())
      .limit(5);

    if (!data?.length) return [];

    const total = data.reduce((sum, o) => sum + ((o as any).totalAmount || 0), 0);

    return [{
      id: 'insight_recent_orders',
      title: `${data.length} new order${data.length > 1 ? 's' : ''} — $${total.toLocaleString()}`,
      description: data.map(o => (o as any).orderNumber || (o as any).customerName).join(', '),
      severity: 'success',
      category: 'sales',
      actionLabel: 'View orders',
      actionCommand: 'show recent sales orders',
      value: total,
      createdAt: new Date().toISOString(),
    }];
  }

  private async getPendingBookings(companyId: string): Promise<Insight[]> {
    const supabase = getSupabaseClient();

    let query = supabase
      .from('bookings')
      .select('id, bookingNumber, vesselVoyage, status');
    if (companyId !== 'ALL') {
      query = query.eq('companyId', companyId);
    }
    const { data } = await query
      .eq('status', 'Pending')
      .limit(5);

    if (!data?.length) return [];

    return [{
      id: 'insight_pending_bookings',
      title: `${data.length} booking${data.length > 1 ? 's' : ''} pending confirmation`,
      description: data.map(b => (b as any).bookingNumber || (b as any).vesselVoyage).join(', '),
      severity: 'warning',
      category: 'logistics',
      actionLabel: 'Review bookings',
      actionCommand: 'show pending bookings',
      value: data.length,
      createdAt: new Date().toISOString(),
    }];
  }

  // ── Mock Insights (fallback) ────────────────────────────────────────

  private getMockInsights(): Insight[] {
    return [];
  }

  // ── Metrics ─────────────────────────────────────────────────────────

  private generateMetrics(insights: Insight[]): BriefingMetric[] {
    const financeInsights = insights.filter(i => i.category === 'finance');
    const salesInsights = insights.filter(i => i.category === 'sales');
    const logisticsInsights = insights.filter(i => i.category === 'logistics');

    const openOrdersTotal = salesInsights.reduce((sum, i) => sum + (i.value || 0), 0);
    const overdueTotal = financeInsights.find(i => i.id.includes('overdue'))?.value || 0;

    return [
      {
        label: 'Open Orders',
        value: openOrdersTotal > 0 ? `$${openOrdersTotal.toLocaleString()}` : '$0',
        icon: '📈',
      },
      {
        label: 'Overdue AR',
        value: overdueTotal > 0 ? `$${overdueTotal.toLocaleString()}` : '$0',
        icon: '💰',
      },
      {
        label: 'Active Shipments',
        value: logisticsInsights.length,
        trend: 'flat',
        icon: '🚢',
      },
      {
        label: 'Insights',
        value: insights.length,
        icon: '🎯',
      },
    ];
  }

  // ── Overnight Changes ───────────────────────────────────────────────

  private generateOvernightChanges(): OvernightChange[] {
    // Only show real overnight changes (none available without event tracking)
    return [];
  }

  // ── Cache management ────────────────────────────────────────────────

  clearCache(): void {
    this.cache.clear();
  }
}

// Singleton
export const smartInsightsEngine = new SmartInsightsEngine();
