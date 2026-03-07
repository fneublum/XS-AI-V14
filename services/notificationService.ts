/**
 * Notification Service — Proactive alerts & notification center for XS-AI-ERP
 *
 * Manages in-app notifications with categories, priority, read state,
 * and scheduled notifications for follow-ups.
 */

import { getSupabaseClient } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'action' | 'workflow';

export type NotificationCategory =
  | 'sales' | 'procurement' | 'logistics' | 'finance'
  | 'inventory' | 'system' | 'ai' | 'general';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  category: NotificationCategory;
  companyId: string;
  read: boolean;
  dismissed: boolean;
  actionUrl?: string;        // Navigate to this URL when clicked
  scheduledFor?: string;     // ISO date — don't show until this time
  expiresAt?: string;        // ISO date — auto-dismiss after this
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface NotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  category: NotificationCategory;
  companyId: string;
  actionUrl?: string;
  scheduledFor?: string;
  expiresAt?: string;
  metadata?: Record<string, any>;
}

type NotificationListener = (notifications: Notification[]) => void;

// ─── Alert Rules ─────────────────────────────────────────────────────────────

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  category: NotificationCategory;
  enabled: boolean;
  checkFn: (companyId: string) => Promise<Notification[]>;
  intervalMinutes: number;
  lastChecked?: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

class NotificationService {
  private notifications: Notification[] = [];
  private listeners: NotificationListener[] = [];
  private alertRules: AlertRule[] = [];
  private alertTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private maxNotifications = 200;

  constructor() {
    this.registerDefaultAlertRules();
  }

  // ─── Core API ──────────────────────────────────────────────────────────

  /**
   * Add a new notification
   */
  add(input: NotificationInput): Notification {
    const notification: Notification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      ...input,
      read: false,
      dismissed: false,
      createdAt: new Date().toISOString(),
    };

    this.notifications.unshift(notification);

    // Trim old notifications
    if (this.notifications.length > this.maxNotifications) {
      this.notifications = this.notifications.slice(0, this.maxNotifications);
    }

    this.emit();
    this.persist(notification);

    console.log(`[NotificationService] ${input.type}: ${input.title}`);
    return notification;
  }

  /**
   * Get visible (not dismissed, not scheduled-future) notifications
   */
  getVisible(companyId?: string): Notification[] {
    const now = new Date().toISOString();
    return this.notifications.filter(n => {
      if (n.dismissed) return false;
      if (n.scheduledFor && n.scheduledFor > now) return false;
      if (n.expiresAt && n.expiresAt < now) return false;
      if (companyId && n.companyId !== companyId && n.companyId !== 'ALL') return false;
      return true;
    });
  }

  /**
   * Get unread count
   */
  getUnreadCount(companyId?: string): number {
    return this.getVisible(companyId).filter(n => !n.read).length;
  }

  /**
   * Mark a notification as read
   */
  markRead(id: string) {
    const n = this.notifications.find(n => n.id === id);
    if (n) {
      n.read = true;
      this.emit();
    }
  }

  /**
   * Mark all as read
   */
  markAllRead(companyId?: string) {
    this.notifications.forEach(n => {
      if (!companyId || n.companyId === companyId || n.companyId === 'ALL') {
        n.read = true;
      }
    });
    this.emit();
  }

  /**
   * Dismiss a notification
   */
  dismiss(id: string) {
    const n = this.notifications.find(n => n.id === id);
    if (n) {
      n.dismissed = true;
      this.emit();
    }
  }

  /**
   * Dismiss all
   */
  dismissAll(companyId?: string) {
    this.notifications.forEach(n => {
      if (!companyId || n.companyId === companyId || n.companyId === 'ALL') {
        n.dismissed = true;
      }
    });
    this.emit();
  }

  // ─── Listeners ───────────────────────────────────────────────────────

  subscribe(listener: NotificationListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit() {
    const visible = this.getVisible();
    this.listeners.forEach(l => {
      try { l(visible); } catch { }
    });
  }

  // ─── Alert Rules ─────────────────────────────────────────────────────

  registerAlertRule(rule: AlertRule) {
    const existing = this.alertRules.findIndex(r => r.id === rule.id);
    if (existing >= 0) {
      this.alertRules[existing] = rule;
    } else {
      this.alertRules.push(rule);
    }
  }

  /**
   * Start checking alert rules periodically
   */
  startAlertChecks(companyId: string) {
    this.stopAlertChecks();

    for (const rule of this.alertRules) {
      if (!rule.enabled) continue;

      // Run immediately
      this.runAlertCheck(rule, companyId);

      // Then on interval
      const timer = setInterval(() => {
        this.runAlertCheck(rule, companyId);
      }, rule.intervalMinutes * 60 * 1000);

      this.alertTimers.set(rule.id, timer);
    }

    console.log(`[NotificationService] Started ${this.alertTimers.size} alert checks`);
  }

  stopAlertChecks() {
    for (const timer of this.alertTimers.values()) {
      clearInterval(timer);
    }
    this.alertTimers.clear();
  }

  private async runAlertCheck(rule: AlertRule, companyId: string) {
    try {
      const alerts = await rule.checkFn(companyId);
      for (const alert of alerts) {
        // Avoid duplicate notifications
        const isDuplicate = this.notifications.some(n =>
          n.title === alert.title &&
          n.category === alert.category &&
          !n.dismissed &&
          (Date.now() - new Date(n.createdAt).getTime()) < rule.intervalMinutes * 60 * 1000
        );
        if (!isDuplicate) {
          this.notifications.unshift(alert);
        }
      }
      if (alerts.length > 0) this.emit();
      rule.lastChecked = new Date().toISOString();
    } catch (err) {
      console.error(`[NotificationService] Alert check failed for ${rule.id}:`, err);
    }
  }

  // ─── Default Alert Rules ─────────────────────────────────────────────

  private registerDefaultAlertRules() {
    // 1. Overdue Invoices Check
    this.registerAlertRule({
      id: 'overdue_invoices',
      name: 'Overdue Invoices',
      description: 'Check for invoices past their due date',
      category: 'finance',
      enabled: true,
      intervalMinutes: 60, // Every hour
      checkFn: async (companyId) => {
        const client = getSupabaseClient();
        const today = new Date();

        const { data: invoices } = await client
          .from('invoices')
          .select('id, invoiceNumber, soldTo, totalAmount, invoiceDate, paymentTerms, date')
          .eq('companyId', companyId)
          .limit(50);

        if (!invoices?.length) return [];

        const overdue = invoices.filter(inv => {
          const invDate = inv.invoiceDate || inv.date;
          if (!invDate) return false;
          try {
            const base = new Date(invDate);
            const days = inv.paymentTerms ? parseInt((inv.paymentTerms.match(/\d+/) || ['0'])[0], 10) : 0;
            const due = new Date(base.getTime() + days * 86400000);
            return due < today;
          } catch { return false; }
        });

        return overdue.slice(0, 10).map(inv => {
          const invDate = inv.invoiceDate || inv.date;
          const days = inv.paymentTerms ? parseInt((inv.paymentTerms.match(/\d+/) || ['0'])[0], 10) : 0;
          const due = new Date(new Date(invDate).getTime() + days * 86400000);
          return {
            id: `notif_overdue_${inv.id}_${Date.now()}`,
            type: 'warning' as NotificationType,
            title: 'Overdue Invoice',
            message: `Invoice ${inv.invoiceNumber || inv.id.substring(0, 8)} for ${inv.soldTo || 'customer'} ($${(inv.totalAmount || 0).toLocaleString()}) is past due date ${due.toISOString().split('T')[0]}`,
            category: 'finance' as NotificationCategory,
            companyId,
            read: false,
            dismissed: false,
            actionUrl: '/finance/receivables',
            metadata: { invoiceId: inv.id },
            createdAt: new Date().toISOString(),
          };
        });
      },
    });

    // 2. Stalled Pipeline Deals
    this.registerAlertRule({
      id: 'stalled_pipeline',
      name: 'Stalled Pipeline Deals',
      description: 'Opportunities that haven\'t progressed in 14+ days',
      category: 'sales',
      enabled: true,
      intervalMinutes: 360, // Every 6 hours
      checkFn: async (companyId) => {
        const client = getSupabaseClient();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 14);

        const { data: opportunities } = await client
          .from('opportunities')
          .select('id, customerName, productName, value, stage, expectedCloseDate')
          .eq('companyId', companyId)
          .not('stage', 'in', '("Closed Won","Closed Lost")')
          .lt('expectedCloseDate', cutoff.toISOString().split('T')[0])
          .limit(5);

        if (!opportunities?.length) return [];

        return opportunities.map(opp => ({
          id: `notif_stalled_${opp.id}_${Date.now()}`,
          type: 'info' as NotificationType,
          title: 'Stalled Deal',
          message: `${opp.customerName}: "${opp.productName}" ($${(opp.value || 0).toLocaleString()}) has been at "${opp.stage}" past expected close date`,
          category: 'sales' as NotificationCategory,
          companyId,
          read: false,
          dismissed: false,
          metadata: { opportunityId: opp.id },
          createdAt: new Date().toISOString(),
        }));
      },
    });

    // 3. PO Not Confirmed Check
    this.registerAlertRule({
      id: 'po_not_confirmed',
      name: 'PO Not Confirmed',
      description: 'Purchase orders sent 5+ days ago without confirmation',
      category: 'procurement',
      enabled: true,
      intervalMinutes: 360,
      checkFn: async (companyId) => {
        const client = getSupabaseClient();
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 5);

        const { data: pos } = await client
          .from('purchase_orders')
          .select('id, supplierName, totalAmount, orderDate, status')
          .eq('companyId', companyId)
          .eq('status', 'Sent')
          .lt('orderDate', cutoff.toISOString().split('T')[0])
          .limit(5);

        if (!pos?.length) return [];

        return pos.map(po => ({
          id: `notif_po_${po.id}_${Date.now()}`,
          type: 'warning' as NotificationType,
          title: 'PO Awaiting Confirmation',
          message: `PO to ${po.supplierName} ($${(po.totalAmount || 0).toLocaleString()}) sent on ${po.orderDate} — no confirmation yet`,
          category: 'procurement' as NotificationCategory,
          companyId,
          read: false,
          dismissed: false,
          metadata: { poId: po.id },
          createdAt: new Date().toISOString(),
        }));
      },
    });

    // 4. Shipment Missing Documents
    this.registerAlertRule({
      id: 'shipment_missing_docs',
      name: 'Shipments Missing Documents',
      description: 'Active shipments without a B/L or invoice',
      category: 'logistics',
      enabled: true,
      intervalMinutes: 240,
      checkFn: async (companyId) => {
        const client = getSupabaseClient();

        const { data: shipments } = await client
          .from('shipments')
          .select('id, containerNumber, blNumber, origin, destination, status')
          .eq('companyId', companyId)
          .in('status', ['Booking', 'In Transit'])
          .is('blNumber', null)
          .limit(5);

        if (!shipments?.length) return [];

        return shipments.map(s => ({
          id: `notif_shipdoc_${s.id}_${Date.now()}`,
          type: 'warning' as NotificationType,
          title: 'Shipment Missing B/L',
          message: `Container ${s.containerNumber || 'TBD'} (${s.origin} → ${s.destination}) is "${s.status}" but has no B/L number`,
          category: 'logistics' as NotificationCategory,
          companyId,
          read: false,
          dismissed: false,
          metadata: { shipmentId: s.id },
          createdAt: new Date().toISOString(),
        }));
      },
    });
  }

  // ─── Persistence ─────────────────────────────────────────────────────

  private async persist(notification: Notification) {
    try {
      // Store recent notifications in localStorage for instant display
      const stored = JSON.parse(localStorage.getItem('xs_notifications') || '[]');
      stored.unshift(notification);
      if (stored.length > 50) stored.length = 50;
      localStorage.setItem('xs_notifications', JSON.stringify(stored));
    } catch { }
  }

  /**
   * Load notifications from localStorage
   */
  loadFromStorage() {
    try {
      const stored = JSON.parse(localStorage.getItem('xs_notifications') || '[]');
      this.notifications = stored.map((n: any) => ({ ...n, read: n.read || false, dismissed: n.dismissed || false }));
      this.emit();
    } catch { }
  }

  /**
   * Clear all stored notifications
   */
  clearStorage() {
    localStorage.removeItem('xs_notifications');
    this.notifications = [];
    this.emit();
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const notificationService = new NotificationService();

if (typeof window !== 'undefined') {
  (window as any).notificationService = notificationService;
}
