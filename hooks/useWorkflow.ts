/**
 * useWorkflow — React hook for workflow engine integration
 *
 * Provides easy-to-use methods for emitting workflow events
 * from any page component.
 */

import { useCallback, useEffect, useRef } from 'react';
import { workflowEngine, WorkflowEventType, WorkflowExecution } from '../services/workflowEngine';

interface UseWorkflowOptions {
  companyId: string;
  userId?: string;
  /** Auto-load rules on mount */
  autoLoad?: boolean;
}

export function useWorkflow({ companyId, userId, autoLoad = true }: UseWorkflowOptions) {
  const initialized = useRef(false);

  useEffect(() => {
    if (autoLoad && !initialized.current && companyId) {
      initialized.current = true;
      workflowEngine.loadRules(companyId);
    }
  }, [companyId, autoLoad]);

  /**
   * Emit a workflow event and return executions
   */
  const emitEvent = useCallback(async (
    type: WorkflowEventType,
    entityType: string,
    entityId: string,
    data: Record<string, any>
  ): Promise<WorkflowExecution[]> => {
    return workflowEngine.emit({
      type,
      entityType,
      entityId,
      data,
      companyId,
      userId,
      timestamp: new Date().toISOString(),
    });
  }, [companyId, userId]);

  // ─── Convenience Methods ──────────────────────────────────────────

  const onSalesOrderCreated = useCallback((orderId: string, orderData: Record<string, any>) => {
    return emitEvent('SO_CREATED', 'sales_order', orderId, orderData);
  }, [emitEvent]);

  const onSalesOrderApproved = useCallback((orderId: string, orderData: Record<string, any>) => {
    return emitEvent('SO_APPROVED', 'sales_order', orderId, orderData);
  }, [emitEvent]);

  const onPurchaseOrderCreated = useCallback((poId: string, poData: Record<string, any>) => {
    return emitEvent('PO_CREATED', 'purchase_order', poId, poData);
  }, [emitEvent]);

  const onPurchaseOrderReceived = useCallback((poId: string, poData: Record<string, any>) => {
    return emitEvent('PO_RECEIVED', 'purchase_order', poId, poData);
  }, [emitEvent]);

  const onBookingConfirmed = useCallback((bookingId: string, bookingData: Record<string, any>) => {
    return emitEvent('BOOKING_CONFIRMED', 'booking', bookingId, bookingData);
  }, [emitEvent]);

  const onShipmentDeparted = useCallback((shipmentId: string, shipmentData: Record<string, any>) => {
    return emitEvent('SHIPMENT_DEPARTED', 'shipment', shipmentId, shipmentData);
  }, [emitEvent]);

  const onShipmentDelivered = useCallback((shipmentId: string, shipmentData: Record<string, any>) => {
    return emitEvent('SHIPMENT_DELIVERED', 'shipment', shipmentId, shipmentData);
  }, [emitEvent]);

  const onInvoiceCreated = useCallback((invoiceId: string, invoiceData: Record<string, any>) => {
    return emitEvent('INVOICE_CREATED', 'invoice', invoiceId, invoiceData);
  }, [emitEvent]);

  const onPackingListCreated = useCallback((plId: string, plData: Record<string, any>) => {
    return emitEvent('PL_CREATED', 'packing_list', plId, plData);
  }, [emitEvent]);

  const onDocumentExtracted = useCallback((docId: string, docData: Record<string, any>) => {
    return emitEvent('DOCUMENT_EXTRACTED', 'document', docId, docData);
  }, [emitEvent]);

  return {
    emitEvent,
    // Convenience methods
    onSalesOrderCreated,
    onSalesOrderApproved,
    onPurchaseOrderCreated,
    onPurchaseOrderReceived,
    onBookingConfirmed,
    onShipmentDeparted,
    onShipmentDelivered,
    onInvoiceCreated,
    onPackingListCreated,
    onDocumentExtracted,
    // Direct access
    engine: workflowEngine,
  };
}
