/**
 * Email Agent Service
 *
 * Autonomous email analysis engine that:
 * 1. Scans all inbox emails and reasons AI replies using thread + ERP context
 * 2. Tracks outbound emails and generates follow-ups when no reply is received
 *
 * All drafts are queued for human approval before sending.
 */

import { ProcessorKey } from './smailAuth';
import { getEmails, getConversationThread, getSentEmails, sendReply, getEmailAttachments } from './smailGraph';
import { reasonEmailReply, reasonFollowUp, analyzeDocument, extractPOFromEmail, ExtractedPOData } from './geminiService';
import { getSupabaseClient } from './supabase';
import { notificationService } from './notificationService';
import { workflowEngine } from './workflowEngine';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExtractedDoc {
    fileName: string;
    docType: string;
    data: Record<string, any>;
    confidence: number;
    saved: boolean;
}

export interface EmailAgentItem {
    id: string;
    messageId: string;
    conversationId: string;
    senderEmail: string;
    senderName: string;
    recipientEmail?: string;
    subject: string;
    receivedAt: string;
    draftReply: string;
    reasoning: string;
    priority: 'high' | 'medium' | 'low';
    category: string;
    status: 'queued' | 'pending' | 'approved' | 'sent' | 'dismissed' | 'sending' | 'error';
    type: 'inbound' | 'followup' | 'document' | 'purchase_order';
    daysSinceSent?: number;
    threadPreview: string;
    createdAt: string;
    error?: string;
    documents?: ExtractedDoc[];
    poResult?: POProcessingResult;
}

export interface POProcessingResult {
    extractedPO: ExtractedPOData;
    customerId?: string;
    customerCreated: boolean;
    productIds: string[];
    productsCreated: string[];
    salesOrderId?: string;
    salesOrderNumber?: string;
    bookingId?: string;
    bookingNumber?: string;
    actionsLog: string[];
    status: 'processing' | 'completed' | 'failed';
    error?: string;
}

export interface AgentStats {
    pending: number;
    sent: number;
    dismissed: number;
    followups: number;
    documents: number;
    purchaseOrders: number;
    processing: boolean;
}

// Save callbacks for extracted documents
export type SaveCallbacks = {
    onSaveBL?: (data: any) => any;
    onSaveBooking?: (data: any) => any;
    onSaveEstimate?: (data: any) => any;
    onSaveProforma?: (data: any) => any;
    onSavePO?: (data: any) => any;
    onSaveInvoice?: (data: any) => any;
    onSaveSupplierInvoice?: (data: any) => any;
    onSavePackingList?: (data: any) => any;
};

type Listener = (items: EmailAgentItem[], stats: AgentStats) => void;

// ─── Storage Keys ────────────────────────────────────────────────────────────

const STORAGE_KEY = 'xs_email_agent_queue';
const PROCESSED_KEY = 'xs_email_agent_processed';
const TRACKED_SENT_KEY = 'xs_email_agent_tracked_sent';
const FOLLOWUP_DAYS = 3; // days before first follow-up

// ─── Service ─────────────────────────────────────────────────────────────────

class EmailAgentService {
    private items: EmailAgentItem[] = [];
    private processedIds: Set<string> = new Set();
    private trackedSentIds: Set<string> = new Set();
    private listeners: Listener[] = [];
    private isProcessing = false;
    private saveCallbacks: SaveCallbacks = {};

    constructor() {
        this.loadFromStorage();
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    private loadFromStorage() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) this.items = JSON.parse(saved);

            const processed = localStorage.getItem(PROCESSED_KEY);
            if (processed) this.processedIds = new Set(JSON.parse(processed));

            const tracked = localStorage.getItem(TRACKED_SENT_KEY);
            if (tracked) this.trackedSentIds = new Set(JSON.parse(tracked));
        } catch { /* ignore corrupt storage */ }
    }

    private saveToStorage() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
            localStorage.setItem(PROCESSED_KEY, JSON.stringify([...this.processedIds]));
            localStorage.setItem(TRACKED_SENT_KEY, JSON.stringify([...this.trackedSentIds]));
            // Keep only last 200 processed IDs
            if (this.processedIds.size > 200) {
                const arr = [...this.processedIds];
                this.processedIds = new Set(arr.slice(-200));
            }
        } catch { /* storage full */ }
    }

    // ── Event System ─────────────────────────────────────────────────────────

    subscribe(listener: Listener): () => void {
        this.listeners.push(listener);
        listener(this.items, this.getStats());
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notify() {
        const stats = this.getStats();
        this.listeners.forEach(l => l([...this.items], stats));
    }

    getStats(): AgentStats {
        return {
            pending: this.items.filter(i => (i.status === 'pending' || i.status === 'queued') && i.type !== 'document' && i.type !== 'purchase_order').length,
            sent: this.items.filter(i => i.status === 'sent').length,
            dismissed: this.items.filter(i => i.status === 'dismissed').length,
            followups: this.items.filter(i => i.type === 'followup' && i.status === 'pending').length,
            documents: this.items.filter(i => i.type === 'document').length,
            purchaseOrders: this.items.filter(i => i.type === 'purchase_order').length,
            processing: this.isProcessing,
        };
    }

    getItems(): EmailAgentItem[] {
        return [...this.items];
    }

    // ── ERP Context Builder ──────────────────────────────────────────────────

    private async buildERPContext(senderEmail: string): Promise<string> {
        const supabase = getSupabaseClient();
        const parts: string[] = [];

        try {
            // Find matching customer
            const { data: customers } = await supabase
                .from('customers')
                .select('id, name, email, contactPerson, paymentTerms, creditLimit, status, city, state, country')
                .or(`email.ilike.%${senderEmail}%,contactPerson.ilike.%${senderEmail.split('@')[0]}%`)
                .limit(3);

            if (customers?.length) {
                parts.push(`MATCHING CUSTOMERS:\n${JSON.stringify(customers, null, 1)}`);

                // Get recent sales orders for this customer
                const customerIds = customers.map(c => c.id);
                const { data: orders } = await supabase
                    .from('sales_orders')
                    .select('id, orderNumber, status, totalAmount, currency, orderDate, deliveryDate, items, paymentTerms, incoterm')
                    .in('customerId', customerIds)
                    .order('orderDate', { ascending: false })
                    .limit(5);

                if (orders?.length) parts.push(`RECENT SALES ORDERS:\n${JSON.stringify(orders, null, 1)}`);

                // Get recent invoices (matched by customer name via soldTo)
                const customerNames = customers.map(c => c.name).filter(Boolean);
                if (customerNames.length > 0) {
                    const orFilter = customerNames.map(n => `soldTo.ilike.%${n}%`).join(',');
                    const { data: invoices } = await supabase
                        .from('invoices')
                        .select('id, invoiceNumber, invoiceDate, totalAmount, currency, paymentTerms, soldTo')
                        .or(orFilter)
                        .order('invoiceDate', { ascending: false })
                        .limit(5);

                    if (invoices?.length) parts.push(`RECENT INVOICES:\n${JSON.stringify(invoices, null, 1)}`);
                }
            }

            // Find matching supplier
            const { data: suppliers } = await supabase
                .from('suppliers')
                .select('id, name, email, contactPerson, paymentTerms, country, categories, rating')
                .or(`email.ilike.%${senderEmail}%,contactPerson.ilike.%${senderEmail.split('@')[0]}%`)
                .limit(3);

            if (suppliers?.length) {
                parts.push(`MATCHING SUPPLIERS:\n${JSON.stringify(suppliers, null, 1)}`);

                const supplierIds = suppliers.map(s => s.id);
                const { data: pos } = await supabase
                    .from('purchase_orders')
                    .select('id, status, orderDate, totalAmount, currency, items, expectedDeliveryDate')
                    .in('supplierId', supplierIds)
                    .order('orderDate', { ascending: false })
                    .limit(5);

                if (pos?.length) parts.push(`RECENT PURCHASE ORDERS:\n${JSON.stringify(pos, null, 1)}`);
            }

            // Get active shipments (may match by reference in email body)
            const { data: shipments } = await supabase
                .from('shipments')
                .select('id, containerNumber, blNumber, origin, destination, status, etd, eta, carrier')
                .in('status', ['ACTIVE', 'IN_TRANSIT', 'LOADING', 'BOOKED'])
                .order('etd', { ascending: false })
                .limit(10);

            if (shipments?.length) parts.push(`ACTIVE SHIPMENTS:\n${JSON.stringify(shipments, null, 1)}`);

            // Get recent bookings
            const { data: bookings } = await supabase
                .from('bookings')
                .select('id, bookingNumber, customer, vesselVoyage, pol, pod, etd, eta, equipment, status')
                .order('createdAt', { ascending: false })
                .limit(5);

            if (bookings?.length) parts.push(`RECENT BOOKINGS:\n${JSON.stringify(bookings, null, 1)}`);

        } catch (err) {
            console.error('ERP context build error:', err);
        }

        return parts.length > 0 ? parts.join('\n\n') : 'No matching ERP records found for this sender.';
    }

    // ── Strip HTML ───────────────────────────────────────────────────────────

    private stripHtml(html: string): string {
        const doc = new DOMParser().parseFromString(html || '', 'text/html');
        return doc.body.textContent?.trim() || '';
    }

    // ── Timeout helper ──────────────────────────────────────────────────────

    private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
        return Promise.race([
            promise,
            new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`[EmailAgent] Timeout after ${ms / 1000}s: ${label}`)), ms))
        ]);
    }

    // ── Scan Inbox ───────────────────────────────────────────────────────────

    async scanInbox(processorKey: ProcessorKey, userEmail: string, companyId?: string): Promise<number> {
        if (this.isProcessing) return 0;
        this.isProcessing = true;
        this.notify();

        let newCount = 0;

        try {
            // ══════════════════════════════════════════════════════════════════════
            // PHASE 1: Fetch all emails and show them immediately as "queued"
            // ══════════════════════════════════════════════════════════════════════
            const result = await getEmails(processorKey, 15, 'DESC', 'inbox');
            const emails = result?.value || [];
            console.log(`[EmailAgent] Phase 1: Fetched ${emails.length} emails from inbox`);
            if (result?.error) console.error(`[EmailAgent] Graph API error:`, result.error);

            // Filter out already processed
            const newEmails = emails.filter((e: any) => !this.processedIds.has(e.id));
            console.log(`[EmailAgent] ${newEmails.length} new emails to process (${this.processedIds.size} already processed)`);

            // Also filter out emails from ourselves
            const incomingEmails = newEmails.filter((e: any) => {
                const sender = e.from?.emailAddress?.address || '';
                if (sender.toLowerCase() === userEmail.toLowerCase()) {
                    this.processedIds.add(e.id);
                    return false;
                }
                return true;
            });
            console.log(`[EmailAgent] ${incomingEmails.length} incoming emails (excluded self)`);

            if (incomingEmails.length === 0) {
                this.isProcessing = false;
                this.notify();
                return 0;
            }

            // Create queued items for ALL emails immediately
            const queuedItems: EmailAgentItem[] = incomingEmails.map((email: any) => ({
                id: `inbound_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                messageId: email.id,
                conversationId: email.conversationId || '',
                senderEmail: email.from?.emailAddress?.address || '',
                senderName: email.from?.emailAddress?.name || email.from?.emailAddress?.address || '',
                subject: email.subject || '(no subject)',
                receivedAt: email.receivedDateTime || new Date().toISOString(),
                draftReply: '',
                reasoning: '',
                priority: 'medium' as const,
                category: 'general',
                status: 'queued' as const,
                type: 'inbound' as const,
                threadPreview: email.bodyPreview || '',
                createdAt: new Date().toISOString(),
            }));

            // Add all queued items to the list and notify UI immediately
            this.items.unshift(...queuedItems);
            this.saveToStorage();
            this.notify();
            console.log(`[EmailAgent] Phase 1 complete: ${queuedItems.length} emails queued and visible in UI`);

            // ══════════════════════════════════════════════════════════════════════
            // PHASE 2: Process each queued email with AI (sequential)
            // ══════════════════════════════════════════════════════════════════════
            for (let idx = 0; idx < queuedItems.length; idx++) {
                const queuedItem = queuedItems[idx];
                const email = incomingEmails[idx];

                try {
                    const { senderEmail, senderName, subject } = queuedItem;
                    console.log(`[EmailAgent] Phase 2: Analyzing ${idx + 1}/${queuedItems.length}: "${subject}" from ${senderName}`);

                    // Get conversation thread
                    const convId = email.conversationId;
                    let thread: { from: string; to: string; subject: string; body: string; date: string }[] = [];

                    if (convId) {
                        const threadResult = await getConversationThread(processorKey, convId, 10);
                        const threadMessages = threadResult?.value || [];
                        thread = threadMessages.map((m: any) => ({
                            from: m.from?.emailAddress?.address || '',
                            to: (m.toRecipients || []).map((r: any) => r.emailAddress?.address).join(', '),
                            subject: m.subject || '',
                            body: this.stripHtml(m.body?.content || ''),
                            date: m.receivedDateTime || m.sentDateTime || '',
                        }));
                    }

                    if (thread.length === 0) {
                        thread = [{
                            from: senderEmail,
                            to: userEmail,
                            subject,
                            body: this.stripHtml(email.body?.content || email.bodyPreview || ''),
                            date: email.receivedDateTime || '',
                        }];
                    }

                    // Build ERP context for this sender (10s timeout)
                    const erpContext = await this.withTimeout(
                        this.buildERPContext(senderEmail), 10000, 'buildERPContext'
                    ).catch(() => 'ERP context unavailable');

                    // Ask AI to reason a reply (45s timeout)
                    const analysis = await this.withTimeout(
                        reasonEmailReply(thread, erpContext, userEmail), 45000, 'reasonEmailReply'
                    );

                    this.processedIds.add(email.id);

                    // Extract documents from attachments
                    let extractedDocs: ExtractedDoc[] = [];
                    try {
                        const attResult = await getEmailAttachments(processorKey, email.id);
                        const attachments = (attResult?.value || []).filter(
                            (a: any) => !a.isInline && a.contentBytes && a.size > 1000
                        );

                        for (const att of attachments) {
                            const name = att.name || 'unknown';
                            const mime = att.contentType || 'application/octet-stream';
                            const isPdf = mime.includes('pdf') || name.toLowerCase().endsWith('.pdf');
                            const isImage = mime.startsWith('image/');

                            if (!isPdf && !isImage) continue;

                            try {
                                const classifyPrompt = `Classify this document into ONE of these types: BILL_OF_LADING, BOOKING, ESTIMATE, PROFORMA_INVOICE, PURCHASE_ORDER, INVOICE, SUPPLIER_INVOICE, PACKING_LIST, OTHER.
Then extract ALL key fields as JSON. Include a field "EXTRACTION_CONFIDENCE" (0.0 to 1.0).
Return ONLY valid JSON: {"docType":"...", "confidence":0.95, "data":{...extracted fields...}}`;

                                const docResult = await this.withTimeout(
                                    analyzeDocument(att.contentBytes, mime, classifyPrompt), 30000, `analyzeDocument(${name})`
                                );
                                const clean = docResult.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                                const parsed = JSON.parse(clean);

                                extractedDocs.push({
                                    fileName: name,
                                    docType: parsed.docType || 'OTHER',
                                    data: parsed.data || parsed,
                                    confidence: parsed.confidence || parsed.data?.EXTRACTION_CONFIDENCE || 0.5,
                                    saved: false,
                                });
                            } catch {
                                // Skip unparseable attachments
                            }
                        }
                    } catch {
                        // Attachment fetch failed — not critical
                    }

                    // Detect Purchase Order emails
                    const isPOEmail = analysis.category === 'order' ||
                        extractedDocs.some(d => d.docType === 'PURCHASE_ORDER');

                    // Update the queued item in-place with AI results
                    const itemIndex = this.items.findIndex(i => i.id === queuedItem.id);
                    if (itemIndex === -1) continue; // item was removed while processing

                    if (isPOEmail && companyId) {
                        // Transform into PO item
                        this.items[itemIndex] = {
                            ...this.items[itemIndex],
                            draftReply: analysis.draftReply || 'Processing purchase order...',
                            reasoning: analysis.reasoning || 'Purchase order detected — processing automatically',
                            priority: 'high',
                            category: 'purchase_order',
                            status: 'pending',
                            type: 'purchase_order',
                            threadPreview: thread.slice(-1)[0]?.body?.substring(0, 200) || '',
                            documents: extractedDocs.length > 0 ? extractedDocs : undefined,
                        };
                        newCount++;
                        this.saveToStorage();
                        this.notify();

                        // Collect attachment texts for PO extraction
                        const attachmentTexts: string[] = extractedDocs
                            .filter(d => d.data)
                            .map(d => JSON.stringify(d.data));

                        // Process PO asynchronously
                        this.processPurchaseOrder(this.items[itemIndex], thread, erpContext, companyId, attachmentTexts)
                            .catch(err => console.error('PO processing failed:', err));
                    } else if (analysis.shouldReply && analysis.draftReply) {
                        // Update with AI reply
                        this.items[itemIndex] = {
                            ...this.items[itemIndex],
                            draftReply: analysis.draftReply,
                            reasoning: analysis.reasoning,
                            priority: analysis.priority,
                            category: analysis.category,
                            status: 'pending',
                            type: 'inbound',
                            threadPreview: thread.slice(-1)[0]?.body?.substring(0, 200) || '',
                            documents: extractedDocs.length > 0 ? extractedDocs : undefined,
                        };
                        newCount++;

                        notificationService.add({
                            type: 'info',
                            title: 'AI Reply Drafted',
                            message: `Reply drafted for "${subject}" from ${senderName}${extractedDocs.length ? ` + ${extractedDocs.length} doc(s) extracted` : ''}`,
                            category: 'ai',
                            companyId: 'ALL',
                        });
                    } else if (extractedDocs.length > 0) {
                        // No reply needed but has documents
                        this.items[itemIndex] = {
                            ...this.items[itemIndex],
                            draftReply: '',
                            reasoning: `${extractedDocs.length} document(s) extracted: ${extractedDocs.map(d => d.docType).join(', ')}`,
                            priority: 'medium',
                            category: 'documentation',
                            status: 'pending',
                            type: 'document',
                            threadPreview: '',
                            documents: extractedDocs,
                        };
                        newCount++;

                        notificationService.add({
                            type: 'success',
                            title: 'Documents Extracted',
                            message: `${extractedDocs.length} doc(s) from "${subject}": ${extractedDocs.map(d => d.docType).join(', ')}`,
                            category: 'ai',
                            companyId: 'ALL',
                        });
                    } else {
                        // AI says no reply needed and no docs — mark as dismissed
                        this.items[itemIndex] = {
                            ...this.items[itemIndex],
                            reasoning: analysis.reasoning || 'No reply needed',
                            status: 'dismissed',
                            type: 'inbound',
                        };
                    }

                    // Save after each email so UI updates in real-time
                    this.saveToStorage();
                    this.notify();

                } catch (err) {
                    console.error(`[EmailAgent] Error processing email ${idx + 1}:`, err);
                    this.processedIds.add(email.id);
                    // Mark as error so it doesn't stay "queued" forever
                    const itemIndex = this.items.findIndex(i => i.id === queuedItem.id);
                    if (itemIndex !== -1) {
                        this.items[itemIndex] = {
                            ...this.items[itemIndex],
                            status: 'error',
                            reasoning: `Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                        };
                        this.saveToStorage();
                        this.notify();
                    }
                }
            }

            this.saveToStorage();
        } catch (err) {
            console.error('Inbox scan error:', err);
        } finally {
            this.isProcessing = false;
            this.notify();
        }

        return newCount;
    }

    // ── Scan Sent for Follow-ups ─────────────────────────────────────────────

    async scanSentForFollowups(processorKey: ProcessorKey, userEmail: string): Promise<number> {
        if (this.isProcessing) return 0;
        this.isProcessing = true;
        this.notify();

        let newFollowups = 0;

        try {
            const result = await getSentEmails(processorKey, 30);
            const sentEmails = result?.value || [];

            for (const sent of sentEmails) {
                const sentId = sent.id;
                if (this.trackedSentIds.has(sentId)) continue;

                const convId = sent.conversationId;
                if (!convId) {
                    this.trackedSentIds.add(sentId);
                    continue;
                }

                const recipientEmail = sent.toRecipients?.[0]?.emailAddress?.address || '';
                if (!recipientEmail) {
                    this.trackedSentIds.add(sentId);
                    continue;
                }

                // Get conversation thread to check if there's a reply after our message
                const threadResult = await getConversationThread(processorKey, convId, 20);
                const threadMessages = (threadResult?.value || []) as any[];

                // Find our sent message in the thread
                const sentDate = new Date(sent.sentDateTime || '');
                const sentTime = sentDate.getTime();

                // Check if there's any reply AFTER our sent message from the recipient
                const hasReply = threadMessages.some((m: any) => {
                    const msgTime = new Date(m.receivedDateTime || m.sentDateTime || '').getTime();
                    const msgFrom = m.from?.emailAddress?.address?.toLowerCase() || '';
                    return msgTime > sentTime && msgFrom !== userEmail.toLowerCase();
                });

                this.trackedSentIds.add(sentId);

                if (hasReply) continue; // Already got a reply, no follow-up needed

                // Check if enough days have passed
                const daysSince = Math.floor((Date.now() - sentTime) / (1000 * 60 * 60 * 24));
                if (daysSince < FOLLOWUP_DAYS) continue;

                // Already have a follow-up for this conversation?
                const existingFollowup = this.items.find(
                    i => i.type === 'followup' && i.conversationId === convId && i.status === 'pending'
                );
                if (existingFollowup) continue;

                // Build thread for AI
                const thread = threadMessages.map((m: any) => ({
                    from: m.from?.emailAddress?.address || '',
                    to: (m.toRecipients || []).map((r: any) => r.emailAddress?.address).join(', '),
                    subject: m.subject || '',
                    body: this.stripHtml(m.body?.content || ''),
                    date: m.receivedDateTime || m.sentDateTime || '',
                }));

                if (thread.length === 0) continue;

                // Build ERP context
                const erpContext = await this.buildERPContext(recipientEmail);

                // Ask AI to reason a follow-up
                const followup = await reasonFollowUp(thread, daysSince, erpContext);

                if (followup.draftFollowUp) {
                    const item: EmailAgentItem = {
                        id: `followup_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                        messageId: sentId,
                        conversationId: convId,
                        senderEmail: userEmail,
                        senderName: 'You',
                        recipientEmail,
                        subject: sent.subject || '(no subject)',
                        receivedAt: sent.sentDateTime || '',
                        draftReply: followup.draftFollowUp,
                        reasoning: followup.reasoning,
                        priority: daysSince > 7 ? 'high' : daysSince > 5 ? 'medium' : 'low',
                        category: 'followup',
                        status: 'pending',
                        type: 'followup',
                        daysSinceSent: daysSince,
                        threadPreview: thread.slice(-1)[0]?.body?.substring(0, 200) || '',
                        createdAt: new Date().toISOString(),
                    };

                    this.items.unshift(item);
                    newFollowups++;

                    notificationService.add({
                        type: 'warning',
                        title: 'Follow-up Needed',
                        message: `No reply in ${daysSince} days: "${sent.subject}" to ${recipientEmail}`,
                        category: 'ai',
                        companyId: 'ALL',
                    });
                }
            }

            this.saveToStorage();
        } catch (err) {
            console.error('Sent scan error:', err);
        } finally {
            this.isProcessing = false;
            this.notify();
        }

        return newFollowups;
    }

    // ── Full Scan (both inbox + sent) ────────────────────────────────────────

    async fullScan(processorKey: ProcessorKey, userEmail: string, companyId?: string): Promise<{ inbound: number; followups: number }> {
        const inbound = await this.scanInbox(processorKey, userEmail, companyId);
        const followups = await this.scanSentForFollowups(processorKey, userEmail);
        return { inbound, followups };
    }

    // ── Actions ──────────────────────────────────────────────────────────────

    async approveAndSend(itemId: string, processorKey: ProcessorKey, editedReply?: string): Promise<boolean> {
        const item = this.items.find(i => i.id === itemId);
        if (!item) return false;

        const reply = editedReply || item.draftReply;
        item.status = 'sending';
        this.notify();

        try {
            await sendReply(processorKey, item.messageId, reply);
            item.status = 'sent';
            this.saveToStorage();
            this.notify();

            notificationService.add({
                type: 'success',
                title: 'Email Sent',
                message: `Reply sent for "${item.subject}"`,
                category: 'ai',
                companyId: 'ALL',
            });

            return true;
        } catch (err) {
            item.status = 'error';
            item.error = (err as Error).message;
            this.saveToStorage();
            this.notify();
            return false;
        }
    }

    dismiss(itemId: string) {
        const item = this.items.find(i => i.id === itemId);
        if (item) {
            item.status = 'dismissed';
            this.saveToStorage();
            this.notify();
        }
    }

    updateDraft(itemId: string, newDraft: string) {
        const item = this.items.find(i => i.id === itemId);
        if (item) {
            item.draftReply = newDraft;
            this.saveToStorage();
            this.notify();
        }
    }

    clearCompleted() {
        this.items = this.items.filter(i => i.status === 'pending' || i.status === 'sending');
        this.processedIds.clear();
        this.trackedSentIds.clear();
        this.saveToStorage();
        this.notify();
        console.log('[EmailAgent] Cleared queue and reset processed cache — next scan will re-process all unread emails');
    }

    // ── PO Processing Methods ────────────────────────────────────────────────

    private fuzzyMatch(a: string, b: string): number {
        const na = a.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
        const nb = b.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
        if (na === nb) return 1.0;
        if (na.includes(nb) || nb.includes(na)) return 0.8;
        const tokensA = na.split(/\s+/).filter(Boolean);
        const tokensB = nb.split(/\s+/).filter(Boolean);
        const allTokens = new Set([...tokensA, ...tokensB]);
        const shared = tokensA.filter(t => tokensB.includes(t)).length;
        return allTokens.size > 0 ? shared / allTokens.size : 0;
    }

    private async findOrCreateCustomer(
        po: ExtractedPOData, companyId: string
    ): Promise<{ customerId: string; customerName: string; created: boolean }> {
        const supabase = getSupabaseClient();
        const email = po.customerEmail?.toLowerCase() || '';
        const name = po.customerCompany || po.customerName || '';

        // Try to find by email first
        if (email) {
            const { data } = await supabase
                .from('customers')
                .select('id, name')
                .ilike('email', `%${email}%`)
                .limit(1);
            if (data?.length) {
                return { customerId: data[0].id, customerName: data[0].name, created: false };
            }
        }

        // Try by name
        if (name) {
            const { data } = await supabase
                .from('customers')
                .select('id, name')
                .ilike('name', `%${name}%`)
                .limit(1);
            if (data?.length) {
                return { customerId: data[0].id, customerName: data[0].name, created: false };
            }
        }

        // Create new customer
        const newId = `C${Date.now()}`;
        const newCustomer = {
            id: newId,
            companyId,
            name: name || po.customerName || 'Unknown Customer',
            contactPerson: po.customerContactPerson || po.customerName || '',
            email: po.customerEmail || '',
            phone: po.customerPhone || '',
            city: po.customerCity || '',
            country: po.customerCountry || '',
            paymentTerms: po.paymentTerms || 'Net 30',
            status: 'Active',
            creditLimit: 0,
            totalVolumeLBS: 0,
            lastOrderDate: new Date().toISOString().split('T')[0],
        };

        const { error } = await supabase.from('customers').insert(newCustomer);
        if (error) throw new Error(`Customer insert failed: ${error.message}`);

        return { customerId: newId, customerName: newCustomer.name, created: true };
    }

    private async findOrCreateProducts(
        items: ExtractedPOData['items'], companyId: string
    ): Promise<{ productMap: Map<string, string>; created: string[] }> {
        const supabase = getSupabaseClient();
        const productMap = new Map<string, string>();
        const created: string[] = [];

        // Fetch all existing products for fuzzy matching
        const { data: existing } = await supabase
            .from('products')
            .select('id, name, sku, supplierProductName')
            .eq('companyId', companyId);

        const allProducts = existing || [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            let bestMatch = { id: '', score: 0 };

            for (const p of allProducts) {
                const nameScore = this.fuzzyMatch(item.productName, p.name || '');
                const skuScore = item.sku && p.sku ? (item.sku.toLowerCase() === p.sku.toLowerCase() ? 1.0 : 0) : 0;
                const altNameScore = p.supplierProductName ? this.fuzzyMatch(item.productName, p.supplierProductName) : 0;
                const maxScore = Math.max(nameScore, skuScore, altNameScore);
                if (maxScore > bestMatch.score) {
                    bestMatch = { id: p.id, score: maxScore };
                }
            }

            if (bestMatch.score >= 0.6) {
                productMap.set(item.productName, bestMatch.id);
            } else {
                // Create new product
                const newId = `P${Date.now()}_${i}`;
                const newProduct = {
                    id: newId,
                    companyId,
                    name: item.productName,
                    description: item.productDescription || '',
                    sku: item.sku || '',
                    hsCode: item.hsCode || '',
                    category: '',
                    grade: '',
                    supplier: '',
                    price: item.unitPrice || 0,
                    stockStatus: 'Available',
                    specs: {},
                };

                const { error } = await supabase.from('products').insert(newProduct);
                if (error) throw new Error(`Product insert failed: ${error.message}`);

                productMap.set(item.productName, newId);
                created.push(item.productName);

                // Add to local cache so next items can match against it
                allProducts.push({ id: newId, name: item.productName, sku: item.sku || '', supplierProductName: '' });
            }
        }

        return { productMap, created };
    }

    private async createSalesOrder(
        po: ExtractedPOData, customerId: string, customerName: string,
        productMap: Map<string, string>, companyId: string
    ): Promise<{ salesOrderId: string; orderNumber: string }> {
        const supabase = getSupabaseClient();
        const soId = `SO${Date.now()}`;
        const orderNumber = `SO-${Date.now().toString().slice(-6)}`;

        const soItems = po.items.map(item => ({
            productId: productMap.get(item.productName) || '',
            productName: item.productName,
            customerDescription: item.productDescription || item.productName,
            hsCode: item.hsCode || '',
            quantity: item.quantity || 0,
            unitPrice: item.unitPrice || 0,
            total: item.total || (item.quantity * item.unitPrice) || 0,
        }));

        const salesOrder = {
            id: soId,
            companyId,
            customerId,
            customerName,
            orderNumber,
            orderDate: new Date().toISOString().split('T')[0],
            orderType: 'SPOT',
            status: 'PENDING',
            items: soItems,
            totalAmount: po.totalAmount || soItems.reduce((s, i) => s + i.total, 0),
            currency: po.currency || 'USD',
            paymentTerms: po.paymentTerms || 'Net 30',
            incoterm: po.incoterm || '',
            notes: `Auto-created from PO ${po.poNumber || 'N/A'} received via email`,
            createdBy: 'AI Email Agent',
            createdAt: new Date().toISOString(),
            saleType: po.shippingRequired ? 'EXPORT' : 'LOCAL',
            deliveryMethod: '',
            deliveryAddress: po.customerAddress || '',
            deliveryDate: po.deliveryDate || '',
            pod: po.portOfDestination || '',
            poa: po.portOfLoading || '',
        };

        const { error } = await supabase.from('sales_orders').insert(salesOrder);
        if (error) throw new Error(`SO insert failed: ${error.message}`);

        // Fire workflow event
        try {
            await workflowEngine.emit({
                type: 'SO_CREATED',
                entityType: 'sales_orders',
                entityId: soId,
                data: { ...salesOrder, source: 'email_agent' },
                companyId,
                timestamp: new Date().toISOString(),
            });
        } catch { /* workflow emit is non-critical */ }

        return { salesOrderId: soId, orderNumber };
    }

    private async requestBookingIfNeeded(
        po: ExtractedPOData, salesOrderId: string, customerName: string, companyId: string
    ): Promise<{ bookingId?: string; bookingNumber?: string }> {
        if (!po.shippingRequired || (!po.portOfLoading && !po.portOfDestination)) {
            return {};
        }

        const supabase = getSupabaseClient();
        const bookingId = `BK${Date.now()}`;
        const bookingNumber = `BK-${Date.now().toString().slice(-6)}`;

        const booking = {
            id: bookingId,
            companyId,
            bookingNumber,
            customer: customerName,
            vesselVoyage: '',
            pol: po.portOfLoading || '',
            pod: po.portOfDestination || '',
            equipment: po.equipment || '',
            etd: '',
            eta: '',
            salesOrderId,
            status: 'REQUESTED',
            createdAt: new Date().toISOString(),
        };

        const { error } = await supabase.from('bookings').insert(booking);
        if (error) throw new Error(`Booking insert failed: ${error.message}`);

        // Fire workflow event
        try {
            await workflowEngine.emit({
                type: 'BOOKING_CREATED',
                entityType: 'bookings',
                entityId: bookingId,
                data: { ...booking, source: 'email_agent' },
                companyId,
                timestamp: new Date().toISOString(),
            });
        } catch { /* workflow emit is non-critical */ }

        return { bookingId, bookingNumber };
    }

    private async processPurchaseOrder(
        item: EmailAgentItem,
        thread: { from: string; to: string; subject: string; body: string; date: string }[],
        erpContext: string,
        companyId: string,
        attachmentTexts?: string[]
    ): Promise<void> {
        const log: string[] = [];
        const poResult: POProcessingResult = {
            extractedPO: {
                isPurchaseOrder: false, confidence: 0, customerName: '', customerEmail: '',
                items: [], totalAmount: 0, currency: 'USD', shippingRequired: false,
            },
            customerCreated: false,
            productIds: [],
            productsCreated: [],
            actionsLog: log,
            status: 'processing',
        };

        item.poResult = poResult;
        this.saveToStorage();
        this.notify();

        try {
            // Step 1: Extract PO data
            log.push('Extracting PO data from email...');
            this.notify();
            const po = await extractPOFromEmail(thread, erpContext, attachmentTexts);
            poResult.extractedPO = po;

            if (!po.isPurchaseOrder || po.confidence < 0.5) {
                log.push(`Not a PO (confidence: ${Math.round(po.confidence * 100)}%). Keeping as normal email.`);
                item.type = 'inbound';
                item.poResult = undefined;
                this.saveToStorage();
                this.notify();
                return;
            }

            log.push(`PO detected (${Math.round(po.confidence * 100)}% confidence) — ${po.items.length} item(s), $${po.totalAmount} ${po.currency}`);

            // Step 2: Find or create customer
            log.push(`Looking up customer: ${po.customerCompany || po.customerName} (${po.customerEmail})...`);
            this.notify();
            const { customerId, customerName, created: custCreated } = await this.findOrCreateCustomer(po, companyId);
            poResult.customerId = customerId;
            poResult.customerCreated = custCreated;
            log.push(custCreated
                ? `Created new customer: ${customerName} (${customerId})`
                : `Found existing customer: ${customerName} (${customerId})`
            );

            // Step 3: Find or create products
            log.push(`Matching ${po.items.length} product(s)...`);
            this.notify();
            const { productMap, created: prodsCreated } = await this.findOrCreateProducts(po.items, companyId);
            poResult.productIds = [...productMap.values()];
            poResult.productsCreated = prodsCreated;
            log.push(prodsCreated.length > 0
                ? `Products: ${productMap.size - prodsCreated.length} matched, ${prodsCreated.length} created (${prodsCreated.join(', ')})`
                : `All ${productMap.size} product(s) matched to existing records`
            );

            // Step 4: Create Sales Order
            log.push('Creating Sales Order...');
            this.notify();
            const { salesOrderId, orderNumber } = await this.createSalesOrder(po, customerId, customerName, productMap, companyId);
            poResult.salesOrderId = salesOrderId;
            poResult.salesOrderNumber = orderNumber;
            log.push(`Sales Order created: ${orderNumber} ($${po.totalAmount} ${po.currency})`);

            // Step 5: Request booking if needed
            if (po.shippingRequired) {
                log.push('Requesting shipping booking...');
                this.notify();
                const { bookingId, bookingNumber } = await this.requestBookingIfNeeded(po, salesOrderId, customerName, companyId);
                if (bookingId) {
                    poResult.bookingId = bookingId;
                    poResult.bookingNumber = bookingNumber;
                    log.push(`Booking requested: ${bookingNumber} (${po.portOfLoading || '?'} → ${po.portOfDestination || '?'})`);
                }
            }

            // Step 6: Generate confirmation reply
            const itemsSummary = po.items.map(i =>
                `- ${i.productName}: ${i.quantity} ${i.unit} @ $${i.unitPrice}/${i.unit} = $${i.total}`
            ).join('\n');

            const bookingLine = poResult.bookingNumber
                ? `\nA shipping booking (${poResult.bookingNumber}) has been requested for ${po.portOfLoading || ''} → ${po.portOfDestination || ''}. We will share booking details once confirmed.`
                : '';

            item.draftReply = `Dear ${po.customerContactPerson || po.customerName || 'Customer'},

Thank you for your Purchase Order${po.poNumber ? ` (${po.poNumber})` : ''}.

We have created Sales Order ${orderNumber} for your order:

${itemsSummary}

Total: $${po.totalAmount} ${po.currency}
Payment Terms: ${po.paymentTerms || 'Net 30'}
${po.incoterm ? `Incoterm: ${po.incoterm}` : ''}
${bookingLine}

We will keep you updated on the order progress.

Best regards`;

            poResult.status = 'completed';
            log.push('PO processing complete — confirmation reply drafted');

            notificationService.add({
                type: 'success',
                title: 'PO Auto-Processed',
                message: `${orderNumber}: ${po.items.length} item(s), $${po.totalAmount} ${po.currency} from ${customerName}`,
                category: 'sales',
                companyId,
            });

        } catch (err) {
            const errMsg = (err as Error).message;
            log.push(`ERROR: ${errMsg}`);
            poResult.status = 'failed';
            poResult.error = errMsg;
            console.error('PO processing error:', err);
        } finally {
            this.saveToStorage();
            this.notify();
        }
    }

    // ── Document Save Callbacks ──────────────────────────────────────────────

    setSaveCallbacks(callbacks: SaveCallbacks) {
        this.saveCallbacks = callbacks;
    }

    async saveDocument(itemId: string, docIndex: number): Promise<boolean> {
        const item = this.items.find(i => i.id === itemId);
        if (!item?.documents?.[docIndex]) return false;

        const doc = item.documents[docIndex];
        if (doc.saved) return true;

        const callbackMap: Record<string, keyof SaveCallbacks> = {
            'BILL_OF_LADING': 'onSaveBL',
            'BOOKING': 'onSaveBooking',
            'ESTIMATE': 'onSaveEstimate',
            'PROFORMA_INVOICE': 'onSaveProforma',
            'PURCHASE_ORDER': 'onSavePO',
            'INVOICE': 'onSaveInvoice',
            'SUPPLIER_INVOICE': 'onSaveSupplierInvoice',
            'PACKING_LIST': 'onSavePackingList',
        };

        const callbackKey = callbackMap[doc.docType];
        const callback = callbackKey ? this.saveCallbacks[callbackKey] : undefined;

        if (!callback) {
            console.warn(`No save callback for doc type: ${doc.docType}`);
            return false;
        }

        try {
            await callback(doc.data);
            doc.saved = true;
            this.saveToStorage();
            this.notify();

            notificationService.add({
                type: 'success',
                title: 'Document Saved',
                message: `${doc.docType.replace(/_/g, ' ')} from "${item.subject}" saved to database`,
                category: 'ai',
                companyId: 'ALL',
            });

            return true;
        } catch (err) {
            console.error('Save document error:', err);
            return false;
        }
    }

    async saveAllDocuments(itemId: string): Promise<number> {
        const item = this.items.find(i => i.id === itemId);
        if (!item?.documents) return 0;

        let saved = 0;
        for (let i = 0; i < item.documents.length; i++) {
            if (!item.documents[i].saved) {
                const ok = await this.saveDocument(itemId, i);
                if (ok) saved++;
            }
        }

        // Mark document item as sent (completed) if all docs saved
        if (item.type === 'document' && item.documents.every(d => d.saved)) {
            item.status = 'sent';
            this.saveToStorage();
            this.notify();
        }

        return saved;
    }
}

export const emailAgentService = new EmailAgentService();
