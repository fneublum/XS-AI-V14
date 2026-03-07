/**
 * Document Pipeline Service — Batch processing, confidence scoring,
 * duplicate detection, and document chain linking for XS-AI-ERP
 */

import { getSupabaseClient } from './supabase';
import { analyzeDocument } from './geminiService';
import { notificationService } from './notificationService';
import { workflowEngine } from './workflowEngine';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DocType = 'BILL OF LADING' | 'BOOKING' | 'ESTIMATE' | 'PROFORMA INVOICE' | 'PURCHASE ORDER' | 'INVOICE' | 'PACKING LIST' | 'OTHER' | 'UNKNOWN';

export interface BatchFile {
  id: string;
  file: File;
  previewUrl: string;
  base64Data: string;
  status: 'queued' | 'identifying' | 'extracting' | 'saving' | 'completed' | 'failed' | 'duplicate' | 'review';
  docType?: DocType;
  extractedData?: any;
  confidence: number;
  error?: string;
  savedTo?: string;
  duplicateOf?: string;
  chainLinks?: string[];
}

export interface PipelineStats {
  total: number;
  completed: number;
  failed: number;
  duplicates: number;
  needsReview: number;
  processing: number;
}

export type PipelineListener = (files: BatchFile[], stats: PipelineStats) => void;

// ─── Confidence Thresholds ───────────────────────────────────────────────────

const CONFIDENCE_AUTO_SAVE = 0.85;   // Auto-save above this
const CONFIDENCE_REVIEW = 0.50;      // Queue for review between this and auto-save

// ─── Identification Prompt ───────────────────────────────────────────────────

const IDENTIFICATION_PROMPT = `Analyze the uploaded document image and classify it into exactly one of these categories:
- BILL OF LADING
- BOOKING
- ESTIMATE
- PROFORMA INVOICE
- PURCHASE ORDER
- INVOICE
- PACKING LIST
- OTHER

Classification Rules:
1. If the document title contains "Straight Bill of Lading" or "Short Form Straight Bill of Lading", classify it strictly as "PACKING LIST".
2. If the document is a standard "Bill of Lading" (negotiable, ocean, or multimodal) WITHOUT the word "Straight", classify it as "BILL OF LADING".
3. A distinct "Packing List" document is also classified as "PACKING LIST".

Return ONLY the category name. Do not add any explanation or punctuation.`;

// ─── Extraction Prompts (with confidence request) ────────────────────────────

const EXTRACTION_PROMPTS: Record<string, string> = {
  'BILL OF LADING': `Extract the following fields specifically for a BILL OF LADING document.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    Also include a field "EXTRACTION_CONFIDENCE" with a number from 0.0 to 1.0 indicating how confident you are in the overall extraction accuracy.

    KEYS: DOC_NUMBER (B/L Number), SHIPPER, CONSIGNEE, NOTIFY, NUMBER_OF_ORIGINALS, PRODUCT_DESCRIPTION, MARKS_NUMBERS, CONTAINER, SEAL, PACKAGES, GROSS_WEIGHT, MEASUREMENT, VESSEL_VOYAGE, PORT_LOADING, PORT_DISCHARGE, PLACE_OF_ISSUE, PLACE_OF_RECEIPT, PLACE_OF_DELIVERY, SHIPPED_DATE, FREIGHT_PAYABLE, TERMS, EXTRACTION_CONFIDENCE.`,

  'BOOKING': `Extract the following fields specifically for a SHIPPING BOOKING CONFIRMATION document.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    Also include a field "EXTRACTION_CONFIDENCE" with a number from 0.0 to 1.0 indicating how confident you are in the overall extraction accuracy.

    KEYS: DOC_NUMBER, CUSTOMER, CARGO_AGENT, VESSEL_VOYAGE, POL, POD, EQUIPMENT, ETD, ETA, CARGO_CUT_OFF, VGM_CUT_OFF, DRAFT_CUT_OFF, FREE_TIME, TERMINAL, EXTRACTION_CONFIDENCE.`,

  'ESTIMATE': `Extract the following fields specifically for a PROFORMA INVOICE or ESTIMATE.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    Also include a field "EXTRACTION_CONFIDENCE" with a number from 0.0 to 1.0 indicating how confident you are in the overall extraction accuracy.

    KEYS: DOC_NUMBER, DATE, SELLER_NAME, BUYER_NAME, SHIP_TO, PAY_TO, PAYMENT_TERMS, INCOTERM, ITEMS, SUBTOTAL, TAX, TOTAL_AMOUNT, CURRENCY, ACCEPTED_BY, ACCEPTED_DATE, EXTRACTION_CONFIDENCE.`,

  'PROFORMA INVOICE': `Extract the following fields specifically for a PROFORMA INVOICE or ESTIMATE.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    Also include a field "EXTRACTION_CONFIDENCE" with a number from 0.0 to 1.0 indicating how confident you are in the overall extraction accuracy.

    KEYS: DOC_NUMBER, DATE, SELLER_NAME, BUYER_NAME, SHIP_TO, PAY_TO, PAYMENT_TERMS, INCOTERM, ITEMS, SUBTOTAL, TAX, TOTAL_AMOUNT, CURRENCY, ACCEPTED_BY, ACCEPTED_DATE, EXTRACTION_CONFIDENCE.`,

  'PURCHASE ORDER': `Extract the following fields specifically for a PURCHASE ORDER.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    Also include a field "EXTRACTION_CONFIDENCE" with a number from 0.0 to 1.0 indicating how confident you are in the overall extraction accuracy.

    KEYS: DOC_NUMBER, DATE, BUYER_NAME, SELLER_NAME, VENDOR_REF, FOLDER_NUMBER, PRODUCT_DESCRIPTION, QUANTITY, UNIT_OF_MEASURE, UNIT_PRICE, LINE_TOTAL, TOTAL_AMOUNT, CURRENCY, INCOTERM, PAYMENT_TERMS, PORT_DISCHARGE, PACKING_INSTRUCTIONS, SHIPMENT_INSTRUCTIONS, MARKINGS, INSPECTION, ITEMS, EXTRACTION_CONFIDENCE.`,

  'INVOICE': `Extract the following fields specifically for a COMMERCIAL INVOICE from a Supplier.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    Also include a field "EXTRACTION_CONFIDENCE" with a number from 0.0 to 1.0 indicating how confident you are in the overall extraction accuracy.

    KEYS: INVOICE_NUMBER, INVOICE_DATE, SELLER_NAME, SELLER_ADDRESS, BUYER_NAME_ADDRESS, SHIP_TO_ADDRESS, PAYMENT_TERMS, INCOTERMS, DATE_SHIPPED, PO_NUMBER, CARRIER, TRANSPORT_ID, FREIGHT_TERMS, ITEMS, WEIGHT_GROSS, WEIGHT_NET, WEIGHT_TARE, TOTAL_QUANTITY, SUBTOTAL, TOTAL_AMOUNT, CURRENCY, REMIT_TO_NAME, BANK_NAME, SWIFT_CODE, ROUTING_NUMBER, ACCOUNT_NUMBER, EXTRACTION_CONFIDENCE.`,

  'PACKING LIST': `Extract the following fields specifically for a PACKING LIST / STRAIGHT BILL OF LADING.
    Return a valid JSON object with the exact keys listed below. If a field is not found, return null.
    Also include a field "EXTRACTION_CONFIDENCE" with a number from 0.0 to 1.0 indicating how confident you are in the overall extraction accuracy.

    KEYS: BL_NUMBER, PL_NUMBER, SHIPPER, CONSIGNEE, SHIPPING_POINT, DESTINATION, DATE, CARRIER, CONTAINER_NUMBER, SEAL_NUMBER, VESSEL_VOYAGE, PRODUCT_DESCRIPTION, UNIT_COUNT, UNIT_NUMBERS, GROSS_WEIGHT, NET_WEIGHT, FREIGHT_TERMS, PO_NUMBER, NOTES, SCH_SHIP_DATE, EXTRACTION_CONFIDENCE.`
};

// ─── Service ─────────────────────────────────────────────────────────────────

class DocumentPipelineService {
  private listeners: PipelineListener[] = [];
  private batchFiles: BatchFile[] = [];
  private isProcessing = false;
  private processedHashes: Map<string, string> = new Map(); // hash → docId
  private concurrency = 3; // Process 3 files simultaneously

  constructor() {
    this.loadHashCache();
  }

  // ─── Core Batch API ──────────────────────────────────────────────────

  /**
   * Add files to the batch queue and start processing
   */
  async addFiles(files: File[]): Promise<string[]> {
    const ids: string[] = [];

    for (const file of files) {
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
      if (!validTypes.includes(file.type)) continue;
      if (file.size > 10 * 1024 * 1024) continue;

      const id = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const { base64Data, previewUrl } = await this.fileToBase64(file);

      // Check for duplicate via hash
      const hash = await this.computeHash(base64Data);
      const existingDoc = this.processedHashes.get(hash);

      const batchFile: BatchFile = {
        id,
        file,
        previewUrl,
        base64Data,
        status: existingDoc ? 'duplicate' : 'queued',
        confidence: 0,
        duplicateOf: existingDoc,
      };

      this.batchFiles.push(batchFile);
      ids.push(id);
    }

    this.emit();

    // Start processing if not already running
    if (!this.isProcessing) {
      this.processQueue();
    }

    return ids;
  }

  /**
   * Get current batch files
   */
  getFiles(): BatchFile[] {
    return [...this.batchFiles];
  }

  /**
   * Get pipeline statistics
   */
  getStats(): PipelineStats {
    return {
      total: this.batchFiles.length,
      completed: this.batchFiles.filter(f => f.status === 'completed').length,
      failed: this.batchFiles.filter(f => f.status === 'failed').length,
      duplicates: this.batchFiles.filter(f => f.status === 'duplicate').length,
      needsReview: this.batchFiles.filter(f => f.status === 'review').length,
      processing: this.batchFiles.filter(f => ['identifying', 'extracting', 'saving'].includes(f.status)).length,
    };
  }

  /**
   * Remove a file from the batch
   */
  removeFile(id: string) {
    this.batchFiles = this.batchFiles.filter(f => f.id !== id);
    this.emit();
  }

  /**
   * Clear all completed/failed files
   */
  clearCompleted() {
    this.batchFiles = this.batchFiles.filter(f => !['completed', 'failed', 'duplicate'].includes(f.status));
    this.emit();
  }

  /**
   * Clear all files
   */
  clearAll() {
    this.batchFiles = [];
    this.isProcessing = false;
    this.emit();
  }

  /**
   * Retry a failed file
   */
  retryFile(id: string) {
    const file = this.batchFiles.find(f => f.id === id);
    if (file) {
      file.status = 'queued';
      file.error = undefined;
      file.confidence = 0;
      this.emit();
      if (!this.isProcessing) this.processQueue();
    }
  }

  /**
   * Approve a file that needs review (force save)
   */
  async approveFile(id: string, companyId: string, saveFn: (type: string, data: any, previewUrl: string) => Promise<void>) {
    const file = this.batchFiles.find(f => f.id === id);
    if (!file || !file.extractedData || !file.docType) return;

    file.status = 'saving';
    this.emit();

    try {
      await saveFn(file.docType, file.extractedData, file.previewUrl);
      file.status = 'completed';
      file.savedTo = file.docType;

      // Store hash to prevent future duplicates
      const hash = await this.computeHash(file.base64Data);
      this.processedHashes.set(hash, file.id);
      this.saveHashCache();

      // Find chain links
      file.chainLinks = await this.findChainLinks(file.docType, file.extractedData, companyId);
    } catch (err: any) {
      file.status = 'failed';
      file.error = err.message || 'Save failed';
    }
    this.emit();
  }

  // ─── Processing Queue ──────────────────────────────────────────────

  private async processQueue() {
    this.isProcessing = true;

    while (true) {
      const queued = this.batchFiles.filter(f => f.status === 'queued');
      if (queued.length === 0) break;

      // Process in batches of `concurrency`
      const batch = queued.slice(0, this.concurrency);
      await Promise.all(batch.map(f => this.processFile(f)));
    }

    this.isProcessing = false;
    this.emit();

    // Notify completion
    const stats = this.getStats();
    if (stats.total > 1) {
      notificationService.add({
        type: stats.failed > 0 ? 'warning' : 'success',
        title: 'Batch Processing Complete',
        message: `${stats.completed} saved, ${stats.needsReview} need review, ${stats.duplicates} duplicates, ${stats.failed} failed (${stats.total} total)`,
        category: 'ai',
        companyId: 'ALL',
      });
    }
  }

  private async processFile(file: BatchFile) {
    try {
      // Step 1: Identify document type
      file.status = 'identifying';
      this.emit();

      const typeResult = await analyzeDocument(file.base64Data, file.file.type, IDENTIFICATION_PROMPT);
      const docType = String(typeResult).replace(/[\*\"]/g, '').trim().toUpperCase() as DocType;
      file.docType = docType;

      if (docType === 'OTHER' || docType === 'UNKNOWN') {
        file.status = 'review';
        file.confidence = 0;
        file.error = 'Could not identify document type';
        this.emit();
        return;
      }

      // Step 2: Extract data
      file.status = 'extracting';
      this.emit();

      const prompt = EXTRACTION_PROMPTS[docType];
      if (!prompt) {
        file.status = 'review';
        file.error = `No extraction prompt for type: ${docType}`;
        this.emit();
        return;
      }

      const rawResult = await analyzeDocument(file.base64Data, file.file.type, prompt);
      const resultStr = String(rawResult ?? '');

      // Parse JSON
      let cleanText = resultStr;
      if (cleanText.startsWith('"') && cleanText.includes('\\"')) {
        cleanText = cleanText.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '').replace(/\\\\/g, '\\').trim();
      }
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        file.status = 'failed';
        file.error = 'Could not parse extraction result';
        this.emit();
        return;
      }

      const extractedData = JSON.parse(jsonMatch[0]);
      file.extractedData = extractedData;

      // Step 3: Calculate confidence
      const aiConfidence = Number(extractedData.EXTRACTION_CONFIDENCE || 0);
      const fieldConfidence = this.calculateFieldConfidence(docType, extractedData);
      file.confidence = Math.max(aiConfidence, fieldConfidence);

      // Step 4: Decide auto-save vs review
      if (file.confidence >= CONFIDENCE_AUTO_SAVE) {
        file.status = 'completed';
        file.savedTo = docType;

        // Store hash
        const hash = await this.computeHash(file.base64Data);
        this.processedHashes.set(hash, file.id);
        this.saveHashCache();
      } else if (file.confidence >= CONFIDENCE_REVIEW) {
        file.status = 'review';
      } else {
        file.status = 'review';
        file.error = 'Low confidence extraction — manual review required';
      }

      this.emit();
    } catch (err: any) {
      file.status = 'failed';
      file.error = err.message || 'Processing failed';
      this.emit();
    }
  }

  // ─── Confidence Calculation ────────────────────────────────────────

  private calculateFieldConfidence(docType: DocType, data: any): number {
    const requiredFields: Record<string, string[]> = {
      'BILL OF LADING': ['DOC_NUMBER', 'SHIPPER', 'CONSIGNEE', 'VESSEL_VOYAGE', 'PORT_LOADING', 'PORT_DISCHARGE'],
      'BOOKING': ['DOC_NUMBER', 'VESSEL_VOYAGE', 'POL', 'POD', 'ETD'],
      'ESTIMATE': ['DOC_NUMBER', 'SELLER_NAME', 'TOTAL_AMOUNT'],
      'PROFORMA INVOICE': ['DOC_NUMBER', 'SELLER_NAME', 'TOTAL_AMOUNT'],
      'PURCHASE ORDER': ['DOC_NUMBER', 'SELLER_NAME', 'TOTAL_AMOUNT'],
      'INVOICE': ['INVOICE_NUMBER', 'SELLER_NAME', 'TOTAL_AMOUNT'],
      'PACKING LIST': ['SHIPPER', 'CONSIGNEE', 'CONTAINER_NUMBER'],
    };

    const fields = requiredFields[docType] || [];
    if (fields.length === 0) return 0.5;

    let filled = 0;
    for (const field of fields) {
      const val = data[field];
      if (val !== null && val !== undefined && val !== '' && val !== 'null' && val !== 'N/A') {
        filled++;
      }
    }

    return filled / fields.length;
  }

  // ─── Document Chain Linking ────────────────────────────────────────

  /**
   * Find related documents by matching reference numbers, containers, vessels, etc.
   */
  async findChainLinks(docType: DocType, data: any, companyId: string): Promise<string[]> {
    const client = getSupabaseClient();
    if (!client) return [];

    const links: string[] = [];

    try {
      // Extract key identifiers for cross-referencing
      const blNumber = data.DOC_NUMBER || data.BL_NUMBER || data.TRANSPORT_ID || '';
      const poNumber = data.PO_NUMBER || data.DOC_NUMBER || '';
      const containerNumber = data.CONTAINER || data.CONTAINER_NUMBER || '';
      const vesselVoyage = data.VESSEL_VOYAGE || '';
      const invoiceNumber = data.INVOICE_NUMBER || '';

      // Link B/L ↔ Booking (by vessel/voyage)
      if (vesselVoyage && (docType === 'BILL OF LADING' || docType === 'BOOKING')) {
        const { data: bookings } = await client
          .from('bookings')
          .select('id, bookingNumber')
          .eq('companyId', companyId)
          .ilike('vesselVoyage', `%${vesselVoyage.split('/')[0].trim()}%`)
          .limit(3);
        if (bookings?.length) {
          links.push(...bookings.map(b => `Booking: ${b.bookingNumber} (${b.id})`));
        }
      }

      // Link Invoice ↔ PO (by PO number reference)
      if (poNumber && (docType === 'INVOICE' || docType === 'PURCHASE ORDER')) {
        const { data: pos } = await client
          .from('purchase_orders')
          .select('id, poNumber')
          .eq('companyId', companyId)
          .ilike('poNumber', `%${poNumber}%`)
          .limit(3);
        if (pos?.length) {
          links.push(...pos.map(p => `PO: ${p.poNumber} (${p.id})`));
        }
      }

      // Link B/L ↔ Shipment (by container number)
      if (containerNumber && (docType === 'BILL OF LADING' || docType === 'PACKING LIST')) {
        const { data: shipments } = await client
          .from('shipments')
          .select('id, containerNumber, blNumber')
          .eq('companyId', companyId)
          .ilike('containerNumber', `%${containerNumber}%`)
          .limit(3);
        if (shipments?.length) {
          links.push(...shipments.map(s => `Shipment: ${s.containerNumber} (${s.id})`));

          // Auto-update shipment B/L number if missing
          if (blNumber && docType === 'BILL OF LADING') {
            for (const s of shipments) {
              if (!s.blNumber) {
                await client.from('shipments').update({ blNumber }).eq('id', s.id);
                links.push(`[Auto-linked B/L to Shipment ${s.id}]`);
              }
            }
          }
        }
      }

      // Link Invoice ↔ B/L (by transport reference)
      if (blNumber && docType === 'INVOICE') {
        const { data: bls } = await client
          .from('bills_of_lading')
          .select('id, blNumber')
          .eq('companyId', companyId)
          .ilike('blNumber', `%${blNumber}%`)
          .limit(3);
        if (bls?.length) {
          links.push(...bls.map(b => `B/L: ${b.blNumber} (${b.id})`));
        }
      }

      // Link Packing List ↔ B/L
      if (blNumber && docType === 'PACKING LIST') {
        const { data: bls } = await client
          .from('bills_of_lading')
          .select('id, blNumber')
          .eq('companyId', companyId)
          .ilike('blNumber', `%${blNumber}%`)
          .limit(3);
        if (bls?.length) {
          links.push(...bls.map(b => `B/L: ${b.blNumber} (${b.id})`));
        }
      }

      // Link Supplier Invoice ↔ existing supplier invoices (by invoice number)
      if (invoiceNumber && docType === 'INVOICE') {
        const { data: existingInvs } = await client
          .from('supplier_invoices')
          .select('id, invoiceNumber')
          .eq('companyId', companyId)
          .ilike('invoiceNumber', `%${invoiceNumber}%`)
          .limit(3);
        if (existingInvs?.length) {
          links.push(...existingInvs.map(i => `Existing Invoice: ${i.invoiceNumber} (${i.id})`));
        }
      }
    } catch (err) {
      console.error('[DocumentPipeline] Chain linking error:', err);
    }

    return links;
  }

  // ─── Duplicate Detection ───────────────────────────────────────────

  private async computeHash(base64Data: string): Promise<string> {
    // Use first 10KB + last 10KB + length as a fingerprint
    const sample = base64Data.substring(0, 10240) + base64Data.substring(Math.max(0, base64Data.length - 10240)) + base64Data.length;

    // Simple hash function (FNV-1a inspired)
    let hash = 2166136261;
    for (let i = 0; i < sample.length; i++) {
      hash ^= sample.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return `doc_${hash.toString(36)}`;
  }

  /**
   * Check if a document with similar content already exists in the database
   */
  async checkDuplicateInDB(docType: DocType, data: any, companyId: string): Promise<string | null> {
    const client = getSupabaseClient();
    if (!client) return null;

    try {
      const docNumber = data.DOC_NUMBER || data.INVOICE_NUMBER || data.BL_NUMBER || data.PL_NUMBER || '';
      if (!docNumber) return null;

      const tableMap: Record<string, { table: string; field: string }> = {
        'BILL OF LADING': { table: 'bills_of_lading', field: 'blNumber' },
        'BOOKING': { table: 'bookings', field: 'bookingNumber' },
        'INVOICE': { table: 'supplier_invoices', field: 'invoiceNumber' },
        'PACKING LIST': { table: 'packing_lists', field: 'plNumber' },
        'PURCHASE ORDER': { table: 'purchase_orders', field: 'poNumber' },
      };

      const mapping = tableMap[docType];
      if (!mapping) return null;

      const { data: existing } = await client
        .from(mapping.table)
        .select('id')
        .eq('companyId', companyId)
        .eq(mapping.field, docNumber)
        .limit(1);

      if (existing?.length) {
        return `${docType} ${docNumber} already exists (${existing[0].id})`;
      }
    } catch { }

    return null;
  }

  // ─── Hash Cache Persistence ────────────────────────────────────────

  private loadHashCache() {
    try {
      const stored = JSON.parse(localStorage.getItem('xs_doc_hashes') || '{}');
      this.processedHashes = new Map(Object.entries(stored));
    } catch { }
  }

  private saveHashCache() {
    try {
      const obj: Record<string, string> = {};
      // Keep only last 500 hashes
      const entries = [...this.processedHashes.entries()].slice(-500);
      for (const [k, v] of entries) {
        obj[k] = v;
      }
      localStorage.setItem('xs_doc_hashes', JSON.stringify(obj));
    } catch { }
  }

  // ─── Listeners ─────────────────────────────────────────────────────

  subscribe(listener: PipelineListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emit() {
    const files = this.getFiles();
    const stats = this.getStats();
    this.listeners.forEach(l => {
      try { l(files, stats); } catch { }
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private fileToBase64(file: File): Promise<{ base64Data: string; previewUrl: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        if (result) {
          const parts = result.split(',');
          resolve({ base64Data: parts[1] || '', previewUrl: result });
        } else {
          reject(new Error('Failed to read file'));
        }
      };
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsDataURL(file);
    });
  }
}

// ─── Singleton Export ────────────────────────────────────────────────────────

export const documentPipelineService = new DocumentPipelineService();
