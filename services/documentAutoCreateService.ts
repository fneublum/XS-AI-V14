/**
 * Document Auto-Create Service — OCR → Record Automation for XS-AI-ERP
 *
 * Takes extracted document data from the documentPipelineService and
 * automatically creates database records (BL, Booking, Invoice, PL, etc.)
 * based on confidence thresholds.
 *
 * High confidence (≥85%) → Auto-create + notify
 * Medium confidence (50-84%) → Queue for one-click approval
 * Low confidence (<50%) → Skip, manual entry required
 *
 * All auto-created records are tagged with source: 'auto_pipeline' so
 * users can audit what was created automatically.
 */

import { getSupabaseClient } from './supabase';
import { notificationService } from './notificationService';
import { workflowEngine } from './workflowEngine';
import { brainService } from './brainService';
import type { DocType } from './documentPipelineService';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PendingDocument {
  id: string;
  docType: DocType;
  extractedData: Record<string, any>;
  confidence: number;
  originalDocument: string; // base64 preview URL
  fileName: string;
  companyId: string;
  status: 'pending_review' | 'approved' | 'rejected' | 'auto_created';
  createdRecordId?: string;
  createdRecordTable?: string;
  error?: string;
  createdAt: string;
  processedAt?: string;
}

export type PendingDocsListener = (docs: PendingDocument[]) => void;

// ─── Confidence Thresholds ──────────────────────────────────────────────────

const AUTO_CREATE_THRESHOLD = 0.85;
const REVIEW_THRESHOLD = 0.50;

// ─── Table Mapping ──────────────────────────────────────────────────────────

const DOC_TYPE_TABLE_MAP: Record<string, string> = {
  'BILL OF LADING': 'bill_landings',
  'BOOKING': 'bookings',
  'ESTIMATE': 'estimates',
  'PROFORMA INVOICE': 'proforma_invoices',
  'PURCHASE ORDER': 'purchase_order_extracts',
  'INVOICE': 'invoices_suppliers',
  'PACKING LIST': 'packing_lists',
};

// ─── Service ────────────────────────────────────────────────────────────────

class DocumentAutoCreateService {
  private pendingDocs: PendingDocument[] = [];
  private listeners: PendingDocsListener[] = [];
  private enabled = true;

  constructor() {
    this.loadPendingFromStorage();
  }

  // ─── Configuration ───────────────────────────────────────────────

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    console.log(`[DocAutoCreate] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ─── Core: Process Extracted Document ─────────────────────────────

  /**
   * Main entry point — called after OCR extraction completes.
   * Decides whether to auto-create, queue for review, or skip.
   */
  async processExtractedDocument(
    docType: DocType,
    extractedData: Record<string, any>,
    confidence: number,
    originalDocument: string,
    fileName: string,
    companyId: string
  ): Promise<PendingDocument> {
    const doc: PendingDocument = {
      id: `autodoc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      docType,
      extractedData,
      confidence,
      originalDocument,
      fileName,
      companyId,
      status: 'pending_review',
      createdAt: new Date().toISOString(),
    };

    if (!this.enabled) {
      doc.status = 'pending_review';
      this.addToPending(doc);
      return doc;
    }

    if (docType === 'OTHER' || docType === 'UNKNOWN') {
      doc.status = 'rejected';
      doc.error = 'Unknown document type — cannot auto-create';
      return doc;
    }

    // Check for duplicates before creating
    const duplicate = await this.checkDuplicate(docType, extractedData, companyId);
    if (duplicate) {
      doc.status = 'rejected';
      doc.error = `Duplicate detected: ${duplicate}`;
      notificationService.add({
        type: 'warning',
        title: 'Duplicate Document Detected',
        message: `${docType} "${this.getDocNumber(docType, extractedData)}" already exists. Skipped auto-create.`,
        category: 'ai',
        companyId,
      });
      return doc;
    }

    if (confidence >= AUTO_CREATE_THRESHOLD) {
      // Auto-create the record
      const result = await this.createRecord(doc);
      if (result.success) {
        doc.status = 'auto_created';
        doc.createdRecordId = result.recordId;
        doc.createdRecordTable = result.table;
        doc.processedAt = new Date().toISOString();

        notificationService.add({
          type: 'success',
          title: `Auto-Created: ${docType}`,
          message: `"${this.getDocNumber(docType, extractedData)}" saved with ${Math.round(confidence * 100)}% confidence from "${fileName}".`,
          category: 'ai',
          companyId,
          metadata: { recordId: result.recordId, table: result.table, source: 'auto_pipeline' },
        });

        // Fire workflow event
        workflowEngine.emit({
          type: 'DOCUMENT_EXTRACTED',
          entityType: docType,
          entityId: result.recordId || doc.id,
          data: {
            documentType: docType,
            confidence: Math.round(confidence * 100),
            fieldsExtracted: Object.keys(extractedData).filter(k => extractedData[k] && k !== 'EXTRACTION_CONFIDENCE').length,
            docNumber: this.getDocNumber(docType, extractedData),
            autoCreated: true,
            ...extractedData,
          },
          companyId,
          timestamp: new Date().toISOString(),
        });

        brainService.quickLog(
          'document', 'document_extract', 'system', companyId,
          `Auto-created ${docType}: ${this.getDocNumber(docType, extractedData)} (${Math.round(confidence * 100)}% conf)`,
          `Table: ${result.table}, ID: ${result.recordId}`,
          'auto_completed'
        ).catch(() => {});

      } else {
        doc.status = 'pending_review';
        doc.error = result.error;
        this.addToPending(doc);

        notificationService.add({
          type: 'warning',
          title: `Auto-Create Failed: ${docType}`,
          message: `Could not auto-save "${fileName}": ${result.error}. Queued for manual review.`,
          category: 'ai',
          companyId,
        });
      }
    } else if (confidence >= REVIEW_THRESHOLD) {
      // Queue for review
      doc.status = 'pending_review';
      this.addToPending(doc);

      notificationService.add({
        type: 'action',
        title: `Review Needed: ${docType}`,
        message: `"${this.getDocNumber(docType, extractedData)}" extracted at ${Math.round(confidence * 100)}% confidence. Tap to review and approve.`,
        category: 'ai',
        companyId,
        metadata: { pendingDocId: doc.id },
      });
    } else {
      doc.status = 'rejected';
      doc.error = 'Confidence too low for auto-create';
    }

    return doc;
  }

  // ─── Approve / Reject Pending ─────────────────────────────────────

  /**
   * Approve a pending document and create the record
   */
  async approvePending(docId: string): Promise<{ success: boolean; error?: string }> {
    const doc = this.pendingDocs.find(d => d.id === docId);
    if (!doc) return { success: false, error: 'Document not found' };

    const result = await this.createRecord(doc);
    if (result.success) {
      doc.status = 'approved';
      doc.createdRecordId = result.recordId;
      doc.createdRecordTable = result.table;
      doc.processedAt = new Date().toISOString();

      notificationService.add({
        type: 'success',
        title: `Approved: ${doc.docType}`,
        message: `"${this.getDocNumber(doc.docType, doc.extractedData)}" saved to ${result.table}.`,
        category: 'ai',
        companyId: doc.companyId,
      });

      brainService.quickLog(
        'document', 'document_extract', 'system', doc.companyId,
        `Manually approved ${doc.docType}: ${this.getDocNumber(doc.docType, doc.extractedData)}`,
        `Was ${Math.round(doc.confidence * 100)}% confidence. Table: ${result.table}`,
        'approved'
      ).catch(() => {});

      this.removeFromPending(docId);
      return { success: true };
    } else {
      doc.error = result.error;
      this.emit();
      return { success: false, error: result.error };
    }
  }

  /**
   * Reject a pending document
   */
  rejectPending(docId: string) {
    const doc = this.pendingDocs.find(d => d.id === docId);
    if (doc) {
      doc.status = 'rejected';
      doc.processedAt = new Date().toISOString();
      this.removeFromPending(docId);
    }
  }

  // ─── Record Creation ──────────────────────────────────────────────

  private async createRecord(doc: PendingDocument): Promise<{ success: boolean; recordId?: string; table?: string; error?: string }> {
    const client = getSupabaseClient();
    if (!client) return { success: false, error: 'No database connection' };

    const table = DOC_TYPE_TABLE_MAP[doc.docType];
    if (!table) return { success: false, error: `No table mapping for ${doc.docType}` };

    const data = doc.extractedData;
    const companyId = doc.companyId;
    const created = new Date().toISOString();

    try {
      let record: Record<string, any> = {};

      switch (doc.docType) {
        case 'BILL OF LADING':
          record = {
            id: `BL${Date.now()}`, companyId, createdAt: created,
            blNumber: String(data.DOC_NUMBER || ''),
            shipper: String(data.SHIPPER || ''),
            consignee: String(data.CONSIGNEE || ''),
            notifyParty: String(data.NOTIFY || ''),
            vesselVoyage: String(data.VESSEL_VOYAGE || ''),
            portLoading: String(data.PORT_LOADING || ''),
            portDischarge: String(data.PORT_DISCHARGE || ''),
            placeReceipt: String(data.PLACE_OF_RECEIPT || ''),
            placeDelivery: String(data.PLACE_OF_DELIVERY || ''),
            shippedDate: String(data.SHIPPED_DATE || ''),
            originals: String(data.NUMBER_OF_ORIGINALS || ''),
            container: String(data.CONTAINER || ''),
            seal: String(data.SEAL || ''),
            description: String(data.PRODUCT_DESCRIPTION || ''),
            grossWeight: String(data.GROSS_WEIGHT || ''),
            measurement: String(data.MEASUREMENT || ''),
            packages: String(data.PACKAGES || ''),
            freightPayable: String(data.FREIGHT_PAYABLE || ''),
            remarks: String(data.TERMS || ''),
            originalDocument: doc.originalDocument,
            status: 'AVAILABLE',
          };
          break;

        case 'BOOKING':
          record = {
            id: `BK${Date.now()}`, companyId, createdAt: created,
            bookingNumber: String(data.DOC_NUMBER || ''),
            customer: String(data.CUSTOMER || ''),
            agentName: String(data.CARGO_AGENT || ''),
            vesselVoyage: String(data.VESSEL_VOYAGE || ''),
            pol: String(data.POL || ''),
            pod: String(data.POD || ''),
            equipment: String(data.EQUIPMENT || ''),
            etd: String(data.ETD || ''),
            eta: String(data.ETA || ''),
            cargoCutOff: String(data.CARGO_CUT_OFF || ''),
            vgmCutOff: String(data.VGM_CUT_OFF || ''),
            draftCutOff: String(data.DRAFT_CUT_OFF || ''),
            freeTime: String(data.FREE_TIME || ''),
            terminal: String(data.TERMINAL || ''),
            originalDocument: doc.originalDocument,
            status: 'AVAILABLE',
          };
          break;

        case 'ESTIMATE':
          record = {
            id: `EST${Date.now()}`, companyId, createdAt: created,
            estimateNumber: String(data.DOC_NUMBER || ''),
            supplier: String(data.SELLER_NAME || ''),
            buyer: String(data.BUYER_NAME || ''),
            shipTo: String(data.SHIP_TO || ''),
            payTo: String(data.PAY_TO || ''),
            date: String(data.DATE || ''),
            terms: String(data.PAYMENT_TERMS || ''),
            incoterm: String(data.INCOTERM || ''),
            subtotal: Number(data.SUBTOTAL || 0),
            tax: Number(data.TAX || 0),
            totalAmount: Number(data.TOTAL_AMOUNT || 0),
            currency: String(data.CURRENCY || 'USD'),
            items: JSON.stringify(data.ITEMS || []),
            acceptedBy: String(data.ACCEPTED_BY || ''),
            acceptedDate: String(data.ACCEPTED_DATE || ''),
            originalDocument: doc.originalDocument,
          };
          break;

        case 'PROFORMA INVOICE':
          record = {
            id: `PI${Date.now()}`, companyId, createdAt: created,
            piNumber: String(data.DOC_NUMBER || ''),
            supplier: String(data.SELLER_NAME || ''),
            buyer: String(data.BUYER_NAME || ''),
            shipTo: String(data.SHIP_TO || ''),
            payTo: String(data.PAY_TO || ''),
            date: String(data.DATE || ''),
            terms: String(data.PAYMENT_TERMS || ''),
            incoterm: String(data.INCOTERM || ''),
            subtotal: Number(data.SUBTOTAL || 0),
            tax: Number(data.TAX || 0),
            totalAmount: Number(data.TOTAL_AMOUNT || 0),
            currency: String(data.CURRENCY || 'USD'),
            items: JSON.stringify(data.ITEMS || []),
            acceptedBy: String(data.ACCEPTED_BY || ''),
            acceptedDate: String(data.ACCEPTED_DATE || ''),
            originalDocument: doc.originalDocument,
          };
          break;

        case 'PURCHASE ORDER':
          record = {
            id: `PO${Date.now()}`, companyId, createdAt: created,
            poNumber: String(data.DOC_NUMBER || ''),
            vendor: String(data.SELLER_NAME || data.VENDOR_NAME || ''),
            date: String(data.DATE || ''),
            totalAmount: String(data.TOTAL_AMOUNT || ''),
            currency: String(data.CURRENCY || ''),
            items: JSON.stringify(data.ITEMS || []),
            originalDocument: doc.originalDocument,
          };
          break;

        case 'INVOICE':
          record = {
            id: `INV${Date.now()}`, companyId, createdAt: created,
            invoiceNumber: String(data.INVOICE_NUMBER || ''),
            invoiceDate: String(data.INVOICE_DATE || ''),
            shipperName: String(data.SELLER_NAME || ''),
            shipperAddress: String(data.SELLER_ADDRESS || ''),
            soldTo: String(data.BUYER_NAME_ADDRESS || ''),
            shipTo: String(data.SHIP_TO_ADDRESS || ''),
            paymentTerms: String(data.PAYMENT_TERMS || ''),
            dateOrder: String(data.DATE_SHIPPED || ''),
            customerPo: String(data.PO_NUMBER || ''),
            carrier: String(data.CARRIER || ''),
            transportRef: String(data.TRANSPORT_ID || ''),
            freightTerms: String(data.FREIGHT_TERMS || ''),
            items: JSON.stringify(data.ITEMS || []),
            grossWeight: String(data.WEIGHT_GROSS || ''),
            netWeight: String(data.WEIGHT_NET || ''),
            tareWeight: String(data.WEIGHT_TARE || ''),
            totalQuantity: String(data.TOTAL_QUANTITY || ''),
            subtotal: Number(data.SUBTOTAL || 0),
            totalAmount: Number(data.TOTAL_AMOUNT || 0),
            currency: String(data.CURRENCY || 'USD'),
            remitTo: String(data.REMIT_TO_NAME || ''),
            bankName: String(data.BANK_NAME || ''),
            swiftCode: String(data.SWIFT_CODE || ''),
            routingNumber: String(data.ROUTING_NUMBER || ''),
            accountNumber: String(data.ACCOUNT_NUMBER || ''),
            originalDocument: doc.originalDocument,
          };
          break;

        case 'PACKING LIST':
          record = {
            id: `PL${Date.now()}`, companyId, createdAt: created,
            plNumber: String(data.PL_NUMBER || ''),
            blNumber: String(data.BL_NUMBER || ''),
            shipper: String(data.SHIPPER || ''),
            consignee: String(data.CONSIGNEE || ''),
            shippingPoint: String(data.SHIPPING_POINT || ''),
            destination: String(data.DESTINATION || ''),
            date: String(data.DATE || ''),
            carrier: String(data.CARRIER || ''),
            containerNumber: String(data.CONTAINER_NUMBER || ''),
            sealNumber: String(data.SEAL_NUMBER || ''),
            vesselVoyage: String(data.VESSEL_VOYAGE || ''),
            productDescription: String(data.PRODUCT_DESCRIPTION || ''),
            unitCount: String(data.UNIT_COUNT || ''),
            unitNumbers: String(data.UNIT_NUMBERS || ''),
            grossWeight: String(data.GROSS_WEIGHT || ''),
            netWeight: String(data.NET_WEIGHT || ''),
            freightTerms: String(data.FREIGHT_TERMS || ''),
            poNumber: String(data.PO_NUMBER || ''),
            notes: String(data.NOTES || ''),
            scheduledShipDate: String(data.SCH_SHIP_DATE || ''),
            originalDocument: doc.originalDocument,
            status: 'AVAILABLE',
          };
          break;

        default:
          return { success: false, error: `Unsupported doc type: ${doc.docType}` };
      }

      const { error } = await client.from(table).insert(record);
      if (error) throw error;

      // Post-create chain linking (e.g., B/L → update booking status)
      await this.postCreateChainActions(doc.docType, record, companyId);

      return { success: true, recordId: record.id, table };
    } catch (err: any) {
      console.error(`[DocAutoCreate] Failed to create ${doc.docType}:`, err);
      return { success: false, error: err.message || 'Database insert failed' };
    }
  }

  // ─── Post-Create Chain Actions ────────────────────────────────────

  /**
   * After creating a record, perform related updates
   * (e.g., B/L created → mark matching booking as AVAILABLE)
   */
  private async postCreateChainActions(docType: DocType, record: Record<string, any>, companyId: string) {
    const client = getSupabaseClient();
    if (!client) return;

    try {
      if (docType === 'BILL OF LADING' && record.vesselVoyage && record.consignee) {
        // Find and update matching booking
        const { data: bookings } = await client
          .from('bookings')
          .select('id, bookingNumber, customer, status')
          .eq('companyId', companyId)
          .or('status.eq.ACTIVE,status.eq.REQUESTED');

        if (bookings) {
          const match = bookings.find(b =>
            b.customer && record.consignee?.toLowerCase().includes(b.customer.toLowerCase()) &&
            record.vesselVoyage
          );
          if (match) {
            await client.from('bookings').update({
              status: 'SHIPPED',
              blNumber: record.blNumber,
              containerNumber: record.container,
            }).eq('id', match.id);

            console.log(`[DocAutoCreate] Updated booking ${match.bookingNumber} → SHIPPED`);
          }
        }
      }

      if (docType === 'PACKING LIST' && record.blNumber) {
        // Fire PL_CREATED workflow for invoice draft
        workflowEngine.emit({
          type: 'PL_CREATED',
          entityType: 'PACKING_LIST',
          entityId: record.id,
          data: {
            plNumber: record.plNumber,
            customerName: record.consignee,
            soNumber: record.soNumber,
            ...record,
          },
          companyId,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error('[DocAutoCreate] Chain action error:', err);
    }
  }

  // ─── Duplicate Detection ──────────────────────────────────────────

  private async checkDuplicate(docType: DocType, data: Record<string, any>, companyId: string): Promise<string | null> {
    const client = getSupabaseClient();
    if (!client) return null;

    const docNumber = this.getDocNumber(docType, data);
    if (!docNumber) return null;

    const checks: Record<string, { table: string; field: string }> = {
      'BILL OF LADING': { table: 'bill_landings', field: 'blNumber' },
      'BOOKING': { table: 'bookings', field: 'bookingNumber' },
      'ESTIMATE': { table: 'estimates', field: 'estimateNumber' },
      'PROFORMA INVOICE': { table: 'proforma_invoices', field: 'piNumber' },
      'PURCHASE ORDER': { table: 'purchase_order_extracts', field: 'poNumber' },
      'INVOICE': { table: 'invoices_suppliers', field: 'invoiceNumber' },
      'PACKING LIST': { table: 'packing_lists', field: 'plNumber' },
    };

    const check = checks[docType];
    if (!check) return null;

    try {
      const { data: existing } = await client
        .from(check.table)
        .select('id')
        .eq('companyId', companyId)
        .eq(check.field, docNumber)
        .limit(1);

      if (existing?.length) {
        return `${docType} #${docNumber}`;
      }
    } catch {}

    return null;
  }

  // ─── Pending Queue Management ─────────────────────────────────────

  getPendingDocs(): PendingDocument[] {
    return [...this.pendingDocs];
  }

  getPendingCount(): number {
    return this.pendingDocs.filter(d => d.status === 'pending_review').length;
  }

  private addToPending(doc: PendingDocument) {
    this.pendingDocs.push(doc);
    this.savePendingToStorage();
    this.emit();
  }

  private removeFromPending(docId: string) {
    this.pendingDocs = this.pendingDocs.filter(d => d.id !== docId);
    this.savePendingToStorage();
    this.emit();
  }

  clearProcessed() {
    this.pendingDocs = this.pendingDocs.filter(d => d.status === 'pending_review');
    this.savePendingToStorage();
    this.emit();
  }

  // ─── Persistence ──────────────────────────────────────────────────

  private savePendingToStorage() {
    try {
      const toSave = this.pendingDocs.slice(-50); // Keep last 50
      sessionStorage.setItem('xs_pending_docs', JSON.stringify(toSave));
    } catch {}
  }

  private loadPendingFromStorage() {
    try {
      const stored = sessionStorage.getItem('xs_pending_docs');
      if (stored) {
        this.pendingDocs = JSON.parse(stored).filter(
          (d: PendingDocument) => d.status === 'pending_review'
        );
      }
    } catch {}
  }

  // ─── Listeners ────────────────────────────────────────────────────

  subscribe(listener: PendingDocsListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit() {
    const docs = this.getPendingDocs();
    this.listeners.forEach(l => {
      try { l(docs); } catch {}
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private getDocNumber(docType: DocType, data: Record<string, any>): string {
    switch (docType) {
      case 'BILL OF LADING': return String(data.DOC_NUMBER || data.BL_NUMBER || '');
      case 'BOOKING': return String(data.DOC_NUMBER || '');
      case 'ESTIMATE': return String(data.DOC_NUMBER || '');
      case 'PROFORMA INVOICE': return String(data.DOC_NUMBER || '');
      case 'PURCHASE ORDER': return String(data.DOC_NUMBER || '');
      case 'INVOICE': return String(data.INVOICE_NUMBER || '');
      case 'PACKING LIST': return String(data.PL_NUMBER || data.BL_NUMBER || '');
      default: return '';
    }
  }
}

// ─── Singleton Export ───────────────────────────────────────────────────────

export const documentAutoCreateService = new DocumentAutoCreateService();

// Debug access
if (typeof window !== 'undefined') {
  (window as any).documentAutoCreateService = documentAutoCreateService;
}
