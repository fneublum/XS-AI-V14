/**
 * Workflow Definitions — Default automation rules for XS-AI-ERP
 *
 * These rules define the standard business process automations.
 * Users can customize/disable via Settings > Workflows.
 */

import type { WorkflowRule } from './workflowEngine';

export function getDefaultWorkflowRules(): WorkflowRule[] {
  return [
    // ─── Sales Order Workflows ────────────────────────────────────────

    {
      id: 'wf_so_approved',
      name: 'SO Approved → Notify & Reserve',
      description: 'When a Sales Order is approved, check inventory and notify logistics team',
      triggerEvent: 'SO_APPROVED',
      conditions: [],
      actions: [
        {
          type: 'RESERVE_INVENTORY',
          params: {},
          description: 'Check and reserve inventory for order items',
        },
        {
          type: 'SEND_NOTIFICATION',
          params: {
            title: 'Sales Order Approved: {{orderNumber}}',
            message: '{{customerName}} — ${{totalAmount}} {{currency}}. Ready for booking.',
            category: 'logistics',
            type: 'action',
          },
          description: 'Notify logistics team about approved order',
        },
        {
          type: 'UPDATE_PIPELINE',
          params: { stage: 'Order', status: 'Approved' },
          description: 'Update shipment pipeline',
        },
        {
          type: 'LOG_ACTIVITY',
          params: { action: 'SO_APPROVED_AUTOMATION' },
          description: 'Log approval automation',
        },
      ],
      enabled: true,
      createdAt: new Date().toISOString(),
    },

    {
      id: 'wf_so_created',
      name: 'SO Created → Acknowledge',
      description: 'When a Sales Order is created, send acknowledgment notification',
      triggerEvent: 'SO_CREATED',
      conditions: [],
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          params: {
            title: 'New Sales Order: {{orderNumber}}',
            message: 'Created for {{customerName}} — {{items.length}} items, ${{totalAmount}} {{currency}}',
            category: 'sales',
            type: 'info',
          },
          description: 'Acknowledge new sales order',
        },
        {
          type: 'LOG_ACTIVITY',
          params: { action: 'SO_CREATED_AUTOMATION' },
          description: 'Log SO creation',
        },
      ],
      enabled: true,
      createdAt: new Date().toISOString(),
    },

    // ─── Purchase Order Workflows ─────────────────────────────────────

    {
      id: 'wf_po_received',
      name: 'PO Received → Adjust Inventory',
      description: 'When a PO is marked as received, increase inventory quantities',
      triggerEvent: 'PO_RECEIVED',
      conditions: [],
      actions: [
        {
          type: 'ADJUST_INVENTORY',
          params: { adjustmentType: 'INCREASE' },
          description: 'Increase inventory for received items',
        },
        {
          type: 'SEND_NOTIFICATION',
          params: {
            title: 'PO Received: {{supplierName}}',
            message: 'Goods from {{supplierName}} received. Inventory updated.',
            category: 'inventory',
            type: 'success',
          },
          description: 'Notify about inventory update',
        },
        {
          type: 'UPDATE_RECORD',
          params: {
            table: 'purchase_orders',
            updates: { status: 'Completed' },
          },
          description: 'Mark PO as completed',
        },
      ],
      enabled: true,
      createdAt: new Date().toISOString(),
    },

    // ─── Booking Workflows ────────────────────────────────────────────

    {
      id: 'wf_booking_confirmed',
      name: 'Booking Confirmed → Create Shipment',
      description: 'When a booking is confirmed, notify and update pipeline',
      triggerEvent: 'BOOKING_CONFIRMED',
      conditions: [],
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          params: {
            title: 'Booking Confirmed: {{bookingNumber}}',
            message: 'Vessel: {{vesselVoyage}}, ETD: {{etd}}, ETA: {{eta}}. POL: {{pol}} → POD: {{pod}}',
            category: 'logistics',
            type: 'success',
          },
          description: 'Notify about confirmed booking',
        },
        {
          type: 'UPDATE_PIPELINE',
          params: { stage: 'Booking', status: 'Confirmed' },
          description: 'Update shipment pipeline with booking',
        },
      ],
      enabled: true,
      createdAt: new Date().toISOString(),
    },

    // ─── Shipment Workflows ───────────────────────────────────────────

    {
      id: 'wf_shipment_departed',
      name: 'Shipment Departed → Notify',
      description: 'When a shipment departs, notify sales and customer teams',
      triggerEvent: 'SHIPMENT_DEPARTED',
      conditions: [],
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          params: {
            title: 'Shipment Departed: {{containerNumber}}',
            message: 'Container {{containerNumber}} departed from {{origin}}. ETA to {{destination}}: {{eta}}',
            category: 'logistics',
            type: 'info',
          },
          description: 'Notify about shipment departure',
        },
      ],
      enabled: true,
      createdAt: new Date().toISOString(),
    },

    {
      id: 'wf_shipment_delivered',
      name: 'Shipment Delivered → Close Pipeline',
      description: 'When a shipment is delivered, update pipeline and notify',
      triggerEvent: 'SHIPMENT_DELIVERED',
      conditions: [],
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          params: {
            title: 'Shipment Delivered: {{containerNumber}}',
            message: 'Container {{containerNumber}} delivered at {{destination}}',
            category: 'logistics',
            type: 'success',
          },
          description: 'Notify about delivery',
        },
        {
          type: 'UPDATE_PIPELINE',
          params: { stage: 'Delivery', status: 'Complete' },
          description: 'Close pipeline entry',
        },
        {
          type: 'SCHEDULE_FOLLOWUP',
          params: { daysFromNow: 7, followUpType: 'Customer satisfaction check' },
          description: 'Schedule post-delivery follow-up',
        },
      ],
      enabled: true,
      createdAt: new Date().toISOString(),
    },

    // ─── Invoice Workflows ────────────────────────────────────────────

    {
      id: 'wf_invoice_created',
      name: 'Invoice Created → AR & Notify',
      description: 'When an invoice is created, create AR record and notify finance',
      triggerEvent: 'INVOICE_CREATED',
      conditions: [],
      actions: [
        {
          type: 'CREATE_AR_RECORD',
          params: {},
          description: 'Create accounts receivable entry',
        },
        {
          type: 'SEND_NOTIFICATION',
          params: {
            title: 'Invoice Created: {{invoiceNumber}}',
            message: 'Invoice for {{soldTo}} — ${{totalAmount}} {{currency}}',
            category: 'finance',
            type: 'success',
          },
          description: 'Notify about new invoice',
        },
        {
          type: 'SCHEDULE_FOLLOWUP',
          params: { daysFromNow: 30, followUpType: 'Payment follow-up' },
          description: 'Schedule payment follow-up',
        },
      ],
      enabled: true,
      createdAt: new Date().toISOString(),
    },

    // ─── Packing List Workflows ───────────────────────────────────────

    {
      id: 'wf_pl_created',
      name: 'Packing List Created → Invoice Draft',
      description: 'When a packing list is created, suggest invoice creation',
      triggerEvent: 'PL_CREATED',
      conditions: [],
      actions: [
        {
          type: 'CREATE_INVOICE_DRAFT',
          params: {},
          description: 'Create invoice draft from packing list',
        },
        {
          type: 'SEND_NOTIFICATION',
          params: {
            title: 'Packing List Ready: {{plNumber}}',
            message: 'PL for {{customerName}} is ready. Invoice draft available.',
            category: 'logistics',
            type: 'action',
          },
          description: 'Notify about PL completion',
        },
      ],
      enabled: true,
      createdAt: new Date().toISOString(),
    },

    // ─── Document Extraction Workflows ────────────────────────────────

    {
      id: 'wf_document_extracted',
      name: 'Document Extracted → Notify',
      description: 'When a document is extracted via OCR, notify the user',
      triggerEvent: 'DOCUMENT_EXTRACTED',
      conditions: [],
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          params: {
            title: 'Document Processed: {{documentType}}',
            message: '{{documentType}} extracted with {{confidence}}% confidence. {{fieldsExtracted}} fields captured.',
            category: 'ai',
            type: 'success',
          },
          description: 'Notify about document extraction',
        },
      ],
      enabled: true,
      createdAt: new Date().toISOString(),
    },

    // ─── Payment Workflows ────────────────────────────────────────────

    {
      id: 'wf_payment_overdue',
      name: 'Payment Overdue → Alert',
      description: 'When a payment becomes overdue, alert finance and sales',
      triggerEvent: 'PAYMENT_OVERDUE',
      conditions: [],
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          params: {
            title: 'Payment Overdue: {{invoiceNumber}}',
            message: '{{customerName}} — ${{amount}} is {{daysOverdue}} days overdue',
            category: 'finance',
            type: 'error',
          },
          description: 'Alert about overdue payment',
        },
        {
          type: 'SCHEDULE_FOLLOWUP',
          params: { daysFromNow: 3, followUpType: 'Payment reminder' },
          description: 'Schedule payment reminder',
        },
      ],
      enabled: true,
      createdAt: new Date().toISOString(),
    },
    // ── Email PO Auto-Processing ──────────────────────────────────────────
    {
      id: 'wf_email_po_processed',
      name: 'Email PO → Auto-Process Notification',
      description: 'When a Sales Order is auto-created from an email PO, notify the team',
      triggerEvent: 'SO_CREATED',
      conditions: [
        { field: 'createdBy', operator: 'eq', value: 'AI Email Agent' },
      ],
      actions: [
        {
          type: 'SEND_NOTIFICATION',
          params: {
            title: 'PO Auto-Processed → {{orderNumber}}',
            message: 'Customer: {{customerName}} — ${{totalAmount}} {{currency}}. Created from email PO by AI Agent.',
            category: 'sales',
            type: 'success',
          },
          description: 'Notify about auto-processed PO from email',
        },
        {
          type: 'LOG_ACTIVITY',
          params: { action: 'EMAIL_PO_AUTO_PROCESSED', details: 'SO {{orderNumber}} created from inbound PO email' },
          description: 'Log PO auto-processing to activity log',
        },
      ],
      enabled: true,
      createdAt: new Date().toISOString(),
    },
  ];
}
