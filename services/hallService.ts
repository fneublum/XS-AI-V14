/**
 * HALL Service - Direct Brain API Integration
 *
 * Calls HALL's brain API directly for instant AI responses.
 *
 * HALL Brain API: https://gen-lang-client-0755290444.ue.r.appspot.com/api/brain/chat
 * HALL's WhatsApp: +19047882483
 *
 * IMPORTANT: HALL uses a SEPARATE Supabase instance for its messages table.
 * XS CRM Supabase = qfskvevighylzzmyiwre.supabase.co (no messages table)
 * HALL Supabase    = xkoknmidesfzqktndwgf.supabase.co (has messages + conversations tables)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabase';
import { activityLogger } from './activityLogService';

// HALL's endpoints
export const HALL_PHONE_NUMBER = '+19047882483';
const HALL_BRAIN_URL = 'https://gen-lang-client-0755290444.ue.r.appspot.com/api/brain/chat';
const BRAIN_API_TIMEOUT = 15000; // 15s timeout for Brain API calls
const BRAIN_API_MAX_RETRIES = 2;


// HALL's Supabase instance (where messages table lives)
const HALL_SUPABASE_URL = 'https://xkoknmidesfzqktndwgf.supabase.co';
const HALL_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhrb2tubWlkZXNmenFrdG5kd2dmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0MzI5MzUsImV4cCI6MjA4MjAwODkzNX0.s-1g2A1QYPpNDEv_cc8-JTtKfNZNyMZBwkMZBYxupj4';

let hallSupabaseClient: SupabaseClient | null = null;

function getHallSupabase(): SupabaseClient {
    if (!hallSupabaseClient) {
        hallSupabaseClient = createClient(HALL_SUPABASE_URL, HALL_SUPABASE_ANON_KEY);
    }
    return hallSupabaseClient;
}



export interface HallResponse {
    success: boolean;
    messageId?: string;
    reply?: string;
    error?: string;
    provider?: 'brain';
}

export interface HallStatus {
    connected: boolean;
    provider?: string;
    phoneNumber?: string;

}

/**
 * Send a message to HALL's brain API with retry logic and timeout
 */
async function sendToHallBrain(message: string): Promise<HallResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= BRAIN_API_MAX_RETRIES; attempt++) {
        try {
            if (attempt > 0) {
                // Exponential backoff: 1s, 2s
                await new Promise(r => setTimeout(r, 1000 * attempt));
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), BRAIN_API_TIMEOUT);

            const response = await fetch(HALL_BRAIN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, userId: 'xs-crm' }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HALL Brain API error: ${response.status}`);
            }

            const data = await response.json();
            let replyText = '';

            if (data.response) {
                try {
                    const parsed = typeof data.response === 'string' ? JSON.parse(data.response) : data.response;
                    replyText = parsed.text || parsed.message || JSON.stringify(parsed);
                } catch {
                    replyText = data.response;
                }
            }

            return { success: true, reply: replyText, messageId: `brain-${Date.now()}`, provider: 'brain' };
        } catch (err: any) {
            lastError = err;
            if (err.name === 'AbortError') {
                lastError = new Error('Brain API request timed out');
            }
        }
    }

    throw lastError || new Error('Brain API failed after retries');
}



/**
 * Get or create the xs-crm conversation in HALL's DB.
 * Messages table uses conversation_id (not phone_number).
 */
let xsCrmConversationId: string | null = null;

async function getOrCreateXsCrmConversation(): Promise<string | null> {
    if (xsCrmConversationId) return xsCrmConversationId;

    try {
        const hallDb = getHallSupabase();

        // Check if xs-crm conversation exists
        const { data } = await hallDb
            .from('conversations')
            .select('id')
            .eq('phone_number', 'xs-crm')
            .limit(1);

        if (data && data.length > 0) {
            xsCrmConversationId = data[0].id;
            return xsCrmConversationId;
        }

        // Create a new conversation for xs-crm
        const newId = crypto.randomUUID();
        const { error } = await hallDb.from('conversations').insert({
            id: newId,
            user_id: 'default',
            phone_number: 'xs-crm',
            contact_name: 'XS CRM Dashboard',
            channel: 'web',
            status: 'active',
            unread_count: 0,
            last_message_preview: ''
        });

        if (!error) {
            xsCrmConversationId = newId;
            return xsCrmConversationId;
        }
    } catch {
        // Silent fail
    }
    return null;
}

/**
 * Save a message to HALL's Supabase messages table
 * Uses conversation_id to match the actual table schema
 */
async function saveMessageToHall(content: string, direction: 'inbound' | 'outbound'): Promise<void> {
    try {
        const hallDb = getHallSupabase();
        const conversationId = await getOrCreateXsCrmConversation();

        await hallDb.from('messages').insert({
            id: crypto.randomUUID(),
            conversation_id: conversationId,
            content,
            direction,
            channel: 'web',
            message_type: 'text',
            status: direction === 'outbound' ? 'sent' : 'delivered',
            metadata: { source: 'xs-crm-dashboard' }
        });

        // Update conversation last_message
        if (conversationId) {
            await hallDb.from('conversations').update({
                last_message_at: new Date().toISOString(),
                last_message_preview: content.substring(0, 100)
            }).eq('id', conversationId);
        }
    } catch {
        // Silent fail - don't break the flow if message logging fails
    }
}

/**
 * Send a message to HALL via Brain API
 * Also saves messages to HALL's DB for persistence
 */
export async function sendToHall(message: string): Promise<HallResponse> {
    const _t0 = Date.now();
    // Save outbound message to HALL's DB
    saveMessageToHall(message, 'outbound');

    try {
        const result = await sendToHallBrain(message);
        if (result.success) {
            // Save HALL's reply to DB
            if (result.reply) {
                saveMessageToHall(result.reply, 'inbound');
            }
            activityLogger.logAiInteraction({ aiService: 'hall', agentType: 'brain_api', userPrompt: message, responseLength: result.reply?.length || 0, responseTimeMs: Date.now() - _t0 });
            return result;
        }
    } catch {
        // Brain API failed after retries
    }

    return { success: false, error: 'HALL Brain API is currently unreachable. Please try again later.' };
}

/**
 * Get HALL connection status
 */
export async function getHallStatus(): Promise<HallStatus> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const healthCheck = await fetch('https://gen-lang-client-0755290444.ue.r.appspot.com/health', {
            method: 'GET',
            signal: controller.signal
        }).catch(() => null);

        clearTimeout(timeoutId);

        const brainOnline = healthCheck?.ok || false;

        return {
            connected: brainOnline,
            provider: brainOnline ? 'hall-brain' : 'disconnected'
        };
    } catch {
        return { connected: false };
    }
}

/**
 * Get recent messages from HALL's conversation
 * Queries HALL's Supabase instance (xkoknmidesfzqktndwgf) where messages table lives
 */
export async function getHallMessages(limit = 20): Promise<any[]> {
    try {
        const hallDb = getHallSupabase();
        const conversationId = await getOrCreateXsCrmConversation();

        if (conversationId) {
            // Query by conversation_id (primary approach)
            const { data, error } = await hallDb
                .from('messages')
                .select('id, content, direction, created_at, status, metadata')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (!error && data) {
                return data.reverse();
            }
        }

        // Fallback: query by metadata source
        const { data: fallbackData, error: fallbackError } = await hallDb
            .from('messages')
            .select('id, content, direction, created_at, status, metadata')
            .eq('metadata->>source', 'xs-crm-dashboard')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (fallbackError) return [];
        return (fallbackData || []).reverse();
    } catch {
        return [];
    }
}

/**
 * Send message to HALL and return the AI response directly
 */
export async function askHall(message: string): Promise<string> {
    const result = await sendToHall(message);

    if (!result.success) {
        return `Error: ${result.error}`;
    }

    if (result.reply) {
        return result.reply;
    }

    return `Message sent to HALL via WhatsApp. HALL is processing your request and will respond shortly. (Message ID: ${result.messageId?.slice(-8)})`;
}

export default {
    sendToHall,
    getHallStatus,
    getHallMessages,
    askHall,
    HALL_PHONE_NUMBER
};
