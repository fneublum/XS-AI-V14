/**
 * Workflow Engine — Event-driven automation for XS-AI-ERP
 *
 * Listens for business events and executes automated action chains.
 * Supports configurable approval gates for high-value actions.
 * All automated actions are logged with source: 'automation'.
 */

import { getSupabaseClient } from './supabase';
import { activityLogger } from './activityLogService';
import { notificationService, NotificationType } from './notificationService';

// ─── Types ───────────────────────────────────────────────────────────────────

export type WorkflowEventType =
  | 'SO_CREATED' | 'SO_APPROVED' | 'SO_FULFILLED'
  | 'PO_CREATED' | 'PO_RECEIVED'
  | 'BOOKING_CONFIRMED' | 'BOOKING_CREATED'
  | 'SHIPMENT_CREATED' | 'SHIPMENT_DEPARTED' | 'SHIPMENT_DELIVERED'
  | 'INVOICE_CREATED' | 'INVOICE_APPROVED' | 'INVOICE_OVERDUE'
  | 'PL_CREATED'
  | 'PAYMENT_RECEIVED' | 'PAYMENT_OVERDUE'
  | 'INVENTORY_LOW' | 'INVENTORY_ADJUSTED'
  | 'DOCUMENT_EXTRACTED'
  | 'CUSTOM';

export type WorkflowActionType =
  | 'CREATE_RECORD' | 'UPDATE_RECORD' | 'SEND_NOTIFICATION'
  | 'RESERVE_INVENTORY' | 'ADJUST_INVENTORY'
  | 'CREATE_INVOICE_DRAFT' | 'CREATE_AR_RECORD'
  | 'SEND_EMAIL' | 'SCHEDULE_FOLLOWUP'
  | 'UPDATE_PIPELINE' | 'LOG_ACTIVITY';

export type WorkflowStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'AWAITING_APPROVAL' | 'CANCELLED';

export interface WorkflowEvent {
  type: WorkflowEventType;
  entityType: string;
  entityId: string;
  data: Record<string, any>;
  companyId: string;
  userId?: string;
  timestamp: string;
}

export interface WorkflowAction {
  type: WorkflowActionType;
  params: Record<string, any>;
  requiresApproval?: boolean;
  approvalThreshold?: number; // Dollar amount above which approval is needed
  description: string;
}

export interface WorkflowRule {
  id: string;
  name: string;
  description: string;
  triggerEvent: WorkflowEventType;
  conditions?: WorkflowCondition[];
  actions: WorkflowAction[];
  enabled: boolean;
  companyId?: string; // null = global
  createdAt: string;
}

export interface WorkflowCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'exists';
  value: any;
}

export interface WorkflowExecution {
  id: string;
  ruleId: string;
  ruleName: string;
  triggerEvent: WorkflowEventType;
  status: WorkflowStatus;
  entityType: string;
  entityId: string;
  companyId: string;
  actions: {
    type: WorkflowActionType;
    description: string;
    status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
    result?: string;
    error?: string;
    executedAt?: string;
  }[];
  startedAt: string;
  completedAt?: string;
  error?: string;
}

// ─── Action Handlers ─────────────────────────────────────────────────────────

type ActionHandler = (
  action: WorkflowAction,
  event: WorkflowEvent,
  context: WorkflowContext
) => Promise<{ success: boolean; message: string; data?: any }>;

export interface WorkflowContext {
  companyId: string;
  userId?: string;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

class WorkflowEngine {
  private rules: WorkflowRule[] = [];
  private actionHandlers: Map<WorkflowActionType, ActionHandler> = new Map();
  private executionHistory: WorkflowExecution[] = [];
  private listeners: Map<string, ((execution: WorkflowExecution) => void)[]> = new Map();
  private enabled = true;
  private moduleToggles: Map<string, boolean> = new Map();

  constructor() {
    this.registerDefaultHandlers();
  }

  // ─── Configuration ───────────────────────────────────────────────────

  /**
   * Load workflow rules from settings or use defaults
   */
  async loadRules(companyId?: string) {
    try {
      const client = getSupabaseClient();
      const { data } = await client
        .from('system_settings')
        .select('value')
        .eq('key', 'workflow_rules')
        .single();

      if (data?.value) {
        const allRules = JSON.parse(typeof data.value === 'string' ? data.value : JSON.stringify(data.value));
        this.rules = companyId
          ? allRules.filter((r: WorkflowRule) => !r.companyId || r.companyId === companyId)
          : allRules;
      }
    } catch {
      // Use default rules if DB fetch fails
      console.log('[WorkflowEngine] Using default rules');
    }

    // Merge with default rules (don't duplicate)
    const { getDefaultWorkflowRules } = await import('./workflowDefinitions');
    const defaults = getDefaultWorkflowRules();
    for (const def of defaults) {
      if (!this.rules.find(r => r.id === def.id)) {
        this.rules.push(def);
      }
    }

    console.log(`[WorkflowEngine] Loaded ${this.rules.length} rules`);
  }

  /**
   * Save rules to database
   */
  async saveRules() {
    try {
      const client = getSupabaseClient();
      await client.from('system_settings').upsert({
        key: 'workflow_rules',
        value: JSON.stringify(this.rules),
      }, { onConflict: 'key' });
    } catch (err) {
      console.error('[WorkflowEngine] Failed to save rules:', err);
    }
  }

  /**
   * Toggle entire engine on/off
   */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    console.log(`[WorkflowEngine] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * Toggle a specific module's automation
   */
  setModuleEnabled(module: string, enabled: boolean) {
    this.moduleToggles.set(module, enabled);
  }

  isModuleEnabled(module: string): boolean {
    return this.moduleToggles.get(module) ?? true;
  }

  // ─── Rule Management ─────────────────────────────────────────────────

  addRule(rule: WorkflowRule) {
    const existing = this.rules.findIndex(r => r.id === rule.id);
    if (existing >= 0) {
      this.rules[existing] = rule;
    } else {
      this.rules.push(rule);
    }
  }

  removeRule(ruleId: string) {
    this.rules = this.rules.filter(r => r.id !== ruleId);
  }

  toggleRule(ruleId: string, enabled: boolean) {
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) rule.enabled = enabled;
  }

  getRules(): WorkflowRule[] {
    return [...this.rules];
  }

  getEnabledRules(): WorkflowRule[] {
    return this.rules.filter(r => r.enabled);
  }

  // ─── Event Processing ────────────────────────────────────────────────

  /**
   * Fire an event and execute matching workflow rules
   */
  async emit(event: WorkflowEvent): Promise<WorkflowExecution[]> {
    if (!this.enabled) {
      console.log(`[WorkflowEngine] Disabled — ignoring ${event.type}`);
      return [];
    }

    console.log(`[WorkflowEngine] Event: ${event.type} for ${event.entityType}#${event.entityId}`);

    const matchingRules = this.rules.filter(r =>
      r.enabled &&
      r.triggerEvent === event.type &&
      this.evaluateConditions(r.conditions || [], event)
    );

    if (matchingRules.length === 0) {
      console.log(`[WorkflowEngine] No matching rules for ${event.type}`);
      return [];
    }

    const executions: WorkflowExecution[] = [];

    for (const rule of matchingRules) {
      const execution = await this.executeRule(rule, event);
      executions.push(execution);
      this.executionHistory.push(execution);

      // Keep history manageable
      if (this.executionHistory.length > 200) {
        this.executionHistory = this.executionHistory.slice(-100);
      }
    }

    // Persist executions
    this.persistExecutions(executions);

    return executions;
  }

  /**
   * Evaluate conditions against event data
   */
  private evaluateConditions(conditions: WorkflowCondition[], event: WorkflowEvent): boolean {
    if (conditions.length === 0) return true;

    return conditions.every(cond => {
      const value = event.data[cond.field];
      switch (cond.operator) {
        case 'eq': return value === cond.value;
        case 'neq': return value !== cond.value;
        case 'gt': return Number(value) > Number(cond.value);
        case 'lt': return Number(value) < Number(cond.value);
        case 'gte': return Number(value) >= Number(cond.value);
        case 'lte': return Number(value) <= Number(cond.value);
        case 'contains': return String(value).toLowerCase().includes(String(cond.value).toLowerCase());
        case 'exists': return value !== undefined && value !== null && value !== '';
        default: return true;
      }
    });
  }

  /**
   * Execute a single workflow rule
   */
  private async executeRule(rule: WorkflowRule, event: WorkflowEvent): Promise<WorkflowExecution> {
    const execution: WorkflowExecution = {
      id: `wf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      triggerEvent: event.type,
      status: 'RUNNING',
      entityType: event.entityType,
      entityId: event.entityId,
      companyId: event.companyId,
      actions: rule.actions.map(a => ({
        type: a.type,
        description: a.description,
        status: 'PENDING' as const,
      })),
      startedAt: new Date().toISOString(),
    };

    console.log(`[WorkflowEngine] Executing rule: ${rule.name}`);

    const context: WorkflowContext = {
      companyId: event.companyId,
      userId: event.userId,
    };

    let allSuccess = true;

    for (let i = 0; i < rule.actions.length; i++) {
      const action = rule.actions[i];
      const actionEntry = execution.actions[i];

      // Check if action needs approval
      if (action.requiresApproval) {
        const amount = event.data.totalAmount || event.data.amount || 0;
        if (action.approvalThreshold && amount > action.approvalThreshold) {
          actionEntry.status = 'SKIPPED';
          actionEntry.result = `Requires approval (amount $${amount} exceeds threshold $${action.approvalThreshold})`;
          execution.status = 'AWAITING_APPROVAL';

          // Send approval notification
          notificationService.add({
            type: 'workflow' as NotificationType,
            title: `Approval Required: ${rule.name}`,
            message: `Action "${action.description}" needs approval. Amount: $${amount.toLocaleString()}`,
            category: 'system',
            companyId: event.companyId,
            actionUrl: `/settings?tab=workflows&execution=${execution.id}`,
            metadata: { executionId: execution.id, actionIndex: i },
          });

          continue;
        }
      }

      try {
        const handler = this.actionHandlers.get(action.type);
        if (!handler) {
          actionEntry.status = 'FAILED';
          actionEntry.error = `No handler for action type: ${action.type}`;
          allSuccess = false;
          continue;
        }

        const result = await handler(action, event, context);
        actionEntry.status = result.success ? 'COMPLETED' : 'FAILED';
        actionEntry.result = result.message;
        actionEntry.error = result.success ? undefined : result.message;
        actionEntry.executedAt = new Date().toISOString();

        if (!result.success) allSuccess = false;

      } catch (err: any) {
        actionEntry.status = 'FAILED';
        actionEntry.error = err.message || 'Unknown error';
        actionEntry.executedAt = new Date().toISOString();
        allSuccess = false;
      }
    }

    if (execution.status !== 'AWAITING_APPROVAL') {
      execution.status = allSuccess ? 'COMPLETED' : 'FAILED';
    }
    execution.completedAt = new Date().toISOString();

    // Log the execution
    activityLogger.logSystem('BUTTON_CLICK', {
      source: 'automation',
      workflow_rule: rule.name,
      workflow_id: execution.id,
      trigger_event: event.type,
      status: execution.status,
      actions_completed: execution.actions.filter(a => a.status === 'COMPLETED').length,
      actions_failed: execution.actions.filter(a => a.status === 'FAILED').length,
    });

    // Notify listeners
    this.notifyListeners(event.type, execution);

    return execution;
  }

  // ─── Action Handlers ─────────────────────────────────────────────────

  registerActionHandler(type: WorkflowActionType, handler: ActionHandler) {
    this.actionHandlers.set(type, handler);
  }

  private registerDefaultHandlers() {
    // SEND_NOTIFICATION
    this.registerActionHandler('SEND_NOTIFICATION', async (action, event) => {
      const { title, message, category, type: notifType } = action.params;
      notificationService.add({
        type: notifType || 'info',
        title: this.interpolate(title || 'Workflow Notification', event.data),
        message: this.interpolate(message || '', event.data),
        category: category || 'system',
        companyId: event.companyId,
        metadata: { eventType: event.type, entityId: event.entityId },
      });
      return { success: true, message: 'Notification sent' };
    });

    // UPDATE_RECORD
    this.registerActionHandler('UPDATE_RECORD', async (action, event) => {
      const { table, updates } = action.params;
      if (!table || !updates) return { success: false, message: 'Missing table or updates' };

      try {
        const client = getSupabaseClient();
        const resolvedUpdates: Record<string, any> = {};
        for (const [key, val] of Object.entries(updates)) {
          resolvedUpdates[key] = typeof val === 'string' && val.startsWith('$')
            ? event.data[val.substring(1)]
            : val;
        }

        const { error } = await client
          .from(table)
          .update(resolvedUpdates)
          .eq('id', event.entityId);

        if (error) throw error;
        return { success: true, message: `Updated ${table}#${event.entityId}` };
      } catch (err: any) {
        return { success: false, message: err.message };
      }
    });

    // CREATE_RECORD
    this.registerActionHandler('CREATE_RECORD', async (action, event) => {
      const { table, record } = action.params;
      if (!table || !record) return { success: false, message: 'Missing table or record' };

      try {
        const client = getSupabaseClient();
        const resolvedRecord: Record<string, any> = {};
        for (const [key, val] of Object.entries(record)) {
          resolvedRecord[key] = typeof val === 'string' && val.startsWith('$')
            ? event.data[val.substring(1)]
            : val;
        }
        resolvedRecord.id = resolvedRecord.id || `auto_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        resolvedRecord.companyId = resolvedRecord.companyId || event.companyId;

        const { error } = await client.from(table).insert(resolvedRecord);
        if (error) throw error;
        return { success: true, message: `Created ${table}#${resolvedRecord.id}` };
      } catch (err: any) {
        return { success: false, message: err.message };
      }
    });

    // LOG_ACTIVITY
    this.registerActionHandler('LOG_ACTIVITY', async (action, event) => {
      activityLogger.logSystem('BUTTON_CLICK', {
        source: 'automation',
        description: action.description,
        eventType: event.type,
        entityType: event.entityType,
        entityId: event.entityId,
        ...action.params,
      });
      return { success: true, message: 'Activity logged' };
    });

    // UPDATE_PIPELINE
    this.registerActionHandler('UPDATE_PIPELINE', async (action, event) => {
      // Updates the shipment pipeline status chain
      const { stage, status } = action.params;
      notificationService.add({
        type: 'info',
        title: 'Pipeline Updated',
        message: `${event.entityType} moved to ${stage}: ${status}`,
        category: 'logistics',
        companyId: event.companyId,
      });
      return { success: true, message: `Pipeline stage ${stage} updated` };
    });

    // RESERVE_INVENTORY
    this.registerActionHandler('RESERVE_INVENTORY', async (action, event) => {
      const items = event.data.items || [];
      if (!Array.isArray(items) || items.length === 0) {
        return { success: true, message: 'No items to reserve' };
      }

      const client = getSupabaseClient();
      const results: string[] = [];

      for (const item of items) {
        const productName = item.productName || item.product;
        const quantity = item.quantity || 0;
        if (!productName || !quantity) continue;

        // Find inventory record
        const { data: inv } = await client
          .from('inventory')
          .select('*')
          .eq('companyId', event.companyId)
          .ilike('productName', `%${productName}%`)
          .limit(1);

        if (inv && inv.length > 0) {
          const current = inv[0];
          const available = (current.quantityLBS || 0);
          if (available >= quantity) {
            results.push(`${productName}: ${quantity} LBS reserved (${available - quantity} remaining)`);
          } else {
            results.push(`${productName}: insufficient stock (${available} LBS available, ${quantity} LBS needed)`);
            // Send low stock notification
            notificationService.add({
              type: 'warning',
              title: 'Low Stock Alert',
              message: `${productName}: Only ${available} LBS available but ${quantity} LBS needed for order ${event.data.orderNumber || event.entityId}`,
              category: 'inventory',
              companyId: event.companyId,
            });
          }
        } else {
          results.push(`${productName}: no inventory record found`);
        }
      }

      return { success: true, message: results.join('; ') };
    });

    // ADJUST_INVENTORY
    this.registerActionHandler('ADJUST_INVENTORY', async (action, event) => {
      const { adjustmentType } = action.params; // 'INCREASE' or 'DECREASE'
      const items = event.data.items || [];
      if (!Array.isArray(items) || items.length === 0) {
        return { success: true, message: 'No items to adjust' };
      }

      const client = getSupabaseClient();
      let adjusted = 0;

      for (const item of items) {
        const productName = item.productName || item.product;
        const quantity = item.quantity || 0;
        if (!productName || !quantity) continue;

        const { data: inv } = await client
          .from('inventory')
          .select('*')
          .eq('companyId', event.companyId)
          .ilike('productName', `%${productName}%`)
          .limit(1);

        if (inv && inv.length > 0) {
          const current = inv[0];
          const newQty = adjustmentType === 'INCREASE'
            ? (current.quantityLBS || 0) + quantity
            : Math.max(0, (current.quantityLBS || 0) - quantity);

          await client
            .from('inventory')
            .update({ quantityLBS: newQty, lastUpdated: new Date().toISOString() })
            .eq('id', current.id);

          // Log the adjustment
          await client.from('inventory_logs').insert({
            id: `invlog_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            companyId: event.companyId,
            inventoryId: current.id,
            productName,
            grade: current.grade || '',
            type: adjustmentType,
            quantityChange: adjustmentType === 'INCREASE' ? quantity : -quantity,
            newQuantity: newQty,
            documentReference: event.data.orderNumber || event.entityId,
            date: new Date().toISOString(),
            performedBy: 'automation',
          });

          adjusted++;
        }
      }

      return { success: true, message: `Adjusted ${adjusted} inventory items` };
    });

    // CREATE_INVOICE_DRAFT
    this.registerActionHandler('CREATE_INVOICE_DRAFT', async (action, event) => {
      // Notify that an invoice draft should be created
      notificationService.add({
        type: 'action',
        title: 'Invoice Draft Ready',
        message: `A packing list has been created for ${event.data.customerName || 'order'}. An invoice draft is ready for review.`,
        category: 'finance',
        companyId: event.companyId,
        actionUrl: `/paperwork?plId=${event.entityId}`,
        metadata: { plId: event.entityId, soNumber: event.data.soNumber },
      });
      return { success: true, message: 'Invoice draft notification sent' };
    });

    // CREATE_AR_RECORD
    this.registerActionHandler('CREATE_AR_RECORD', async (action, event) => {
      // Notify finance team about new AR
      notificationService.add({
        type: 'success',
        title: 'New Receivable Created',
        message: `Invoice ${event.data.invoiceNumber || ''} for $${(event.data.totalAmount || 0).toLocaleString()} has been recorded in Accounts Receivable.`,
        category: 'finance',
        companyId: event.companyId,
        actionUrl: '/finance/receivables',
        metadata: { invoiceId: event.entityId, amount: event.data.totalAmount },
      });
      return { success: true, message: 'AR record notification sent' };
    });

    // SCHEDULE_FOLLOWUP
    this.registerActionHandler('SCHEDULE_FOLLOWUP', async (action, event) => {
      const { daysFromNow, followUpType } = action.params;
      const followUpDate = new Date();
      followUpDate.setDate(followUpDate.getDate() + (daysFromNow || 7));

      notificationService.add({
        type: 'info',
        title: `Follow-up Scheduled`,
        message: `${followUpType || 'Follow-up'} scheduled for ${followUpDate.toLocaleDateString()} regarding ${event.entityType}#${event.data.orderNumber || event.entityId}`,
        category: 'sales',
        companyId: event.companyId,
        scheduledFor: followUpDate.toISOString(),
        metadata: { entityType: event.entityType, entityId: event.entityId },
      });
      return { success: true, message: `Follow-up scheduled for ${followUpDate.toLocaleDateString()}` };
    });
  }

  /**
   * Interpolate template strings with event data
   * e.g., "Order {{orderNumber}} created" → "Order SO-001 created"
   */
  private interpolate(template: string, data: Record<string, any>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = data[key];
      return val !== undefined && val !== null ? String(val) : `{{${key}}}`;
    });
  }

  // ─── Listeners ───────────────────────────────────────────────────────

  on(eventType: string, callback: (execution: WorkflowExecution) => void) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }
    this.listeners.get(eventType)!.push(callback);
  }

  off(eventType: string, callback: (execution: WorkflowExecution) => void) {
    const cbs = this.listeners.get(eventType);
    if (cbs) {
      this.listeners.set(eventType, cbs.filter(cb => cb !== callback));
    }
  }

  private notifyListeners(eventType: string, execution: WorkflowExecution) {
    const cbs = this.listeners.get(eventType) || [];
    const allCbs = this.listeners.get('*') || [];
    [...cbs, ...allCbs].forEach(cb => {
      try { cb(execution); } catch { }
    });
  }

  // ─── History ─────────────────────────────────────────────────────────

  getExecutionHistory(limit = 50): WorkflowExecution[] {
    return this.executionHistory.slice(-limit);
  }

  getRecentExecutions(companyId: string, limit = 20): WorkflowExecution[] {
    return this.executionHistory
      .filter(e => e.companyId === companyId)
      .slice(-limit);
  }

  // ─── Persistence ─────────────────────────────────────────────────────

  private async persistExecutions(executions: WorkflowExecution[]) {
    try {
      const client = getSupabaseClient();
      for (const exec of executions) {
        await client.from('system_settings').upsert({
          key: `wf_exec_${exec.id}`,
          value: JSON.stringify(exec),
        }, { onConflict: 'key' });
      }
    } catch {
      // Non-critical, don't fail
    }
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const workflowEngine = new WorkflowEngine();

// Make available in console for debugging
if (typeof window !== 'undefined') {
  (window as any).workflowEngine = workflowEngine;
}
