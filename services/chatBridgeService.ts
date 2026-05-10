/**
 * Chat Bridge Service
 * Routes Email Agent events to the AI Copilot Sidebar chat.
 * Singleton event emitter: emailAgentService pushes messages → AiCopilotSidebar subscribes.
 */

export type ChatBridgeMessageType =
    | 'email_draft'       // AI Reply Drafted — needs approve/dismiss
    | 'email_followup'    // Follow-up Needed — needs approve/dismiss
    | 'email_sent'        // Email Sent — confirmation
    | 'email_po'          // PO Auto-Processed — informational
    | 'email_doc'         // Documents Extracted — informational
    | 'email_doc_saved';  // Document Saved — confirmation

export interface EmailActionPayload {
    itemId: string;
    senderEmail: string;
    senderName: string;
    subject: string;
    draftReply: string;
    reasoning: string;
    priority: 'high' | 'medium' | 'low';
    category: string;
    type: 'inbound' | 'followup' | 'document' | 'purchase_order';
    daysSinceSent?: number;
    documents?: Array<{ fileName: string; docType: string; saved: boolean }>;
    poSummary?: string;
}

export interface ChatBridgeMessage {
    id: string;
    timestamp: string;
    messageType: ChatBridgeMessageType;
    title: string;
    summary: string;
    payload?: EmailActionPayload;
    actionTaken?: 'approved' | 'dismissed' | null;
}

type ChatBridgeListener = (message: ChatBridgeMessage) => void;

class ChatBridgeService {
    private listeners: ChatBridgeListener[] = [];
    private sidebarOpener: (() => void) | null = null;

    /** Called by App.tsx to register the sidebar open function */
    registerSidebarOpener(fn: () => void) {
        this.sidebarOpener = fn;
    }

    unregisterSidebarOpener() {
        this.sidebarOpener = null;
    }

    /** Called by emailAgentService to push a message to the chat */
    push(message: ChatBridgeMessage) {
        // Auto-open sidebar so user sees the message
        if (this.sidebarOpener) {
            this.sidebarOpener();
        }
        // Broadcast to all subscribers (AiCopilotSidebar)
        this.listeners.forEach(listener => {
            try { listener(message); } catch {}
        });
    }

    /** Called by AiCopilotSidebar on mount */
    subscribe(listener: ChatBridgeListener): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }
}

export const chatBridgeService = new ChatBridgeService();
