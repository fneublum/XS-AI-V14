/**
 * HALL Service - Direct Brain API + Twilio WhatsApp Integration
 * 
 * Strategy 1: Call HALL's brain API directly for instant AI responses
 * Strategy 2: Send via Twilio WhatsApp as fallback
 * 
 * HALL Brain API: https://gen-lang-client-0755290444.ue.r.appspot.com/api/brain/chat
 * App's Twilio Number: loaded from Supabase system_settings
 * HALL's WhatsApp: +19047882483
 */

import { getSupabaseClient } from './supabase';

// HALL's endpoints
export const HALL_PHONE_NUMBER = '+19047882483';
const HALL_BRAIN_URL = 'https://gen-lang-client-0755290444.ue.r.appspot.com/api/brain/chat';

// Cache for Twilio credentials
let twilioCredsCache: { accountSid: string; authToken: string; phoneNumber: string } | null = null;

/**
 * Load Twilio credentials from Supabase system_settings
 */
async function getTwilioCreds(): Promise<{ accountSid: string; authToken: string; phoneNumber: string } | null> {
    if (twilioCredsCache) return twilioCredsCache;

    try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', 'twilio_credentials')
            .single();

        if (error || !data?.value) {
            console.error('[hallService] No Twilio credentials found in system_settings');
            return null;
        }

        const creds = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        twilioCredsCache = {
            accountSid: creds.accountSid,
            authToken: creds.authToken,
            phoneNumber: creds.phoneNumber
        };
        return twilioCredsCache;
    } catch (error) {
        console.error('[hallService] Error loading Twilio credentials:', error);
        return null;
    }
}

export interface HallResponse {
    success: boolean;
    messageId?: string;
    reply?: string;
    error?: string;
}

export interface HallStatus {
    connected: boolean;
    provider?: string;
    phoneNumber?: string;
    twilioConfigured?: boolean;
}

/**
 * Send a message to HALL's brain API directly (instant response)
 */
async function sendToHallBrain(message: string): Promise<HallResponse> {
    console.log('[hallService] Sending via HALL Brain API...');

    const response = await fetch(HALL_BRAIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, userId: 'xs-crm' })
    });

    if (!response.ok) {
        throw new Error(`HALL Brain API error: ${response.status}`);
    }

    const data = await response.json();
    let replyText = '';

    // Parse the response (may be nested JSON string)
    if (data.response) {
        try {
            const parsed = typeof data.response === 'string' ? JSON.parse(data.response) : data.response;
            replyText = parsed.text || parsed.message || JSON.stringify(parsed);
        } catch {
            replyText = data.response;
        }
    }

    console.log('[hallService] HALL Brain replied:', replyText.substring(0, 80));
    return { success: true, reply: replyText, messageId: `brain-${Date.now()}` };
}

/**
 * Send a WhatsApp message to HALL via Twilio (fallback)
 */
async function sendToHallTwilio(message: string): Promise<HallResponse> {
    const creds = await getTwilioCreds();
    if (!creds) {
        return { success: false, error: 'Twilio credentials not configured. Go to Settings > Twilio Integration.' };
    }

    // Try Supabase RPC (server-side, no CORS issues)
    try {
        console.log('[hallService] Sending via Supabase RPC (Twilio)...');
        const supabase = getSupabaseClient();
        const { data: rpcResult, error: rpcError } = await supabase.rpc('send_twilio_message', {
            p_to: `whatsapp:${HALL_PHONE_NUMBER}`,
            p_from: `whatsapp:${creds.phoneNumber}`,
            p_body: message,
            p_account_sid: creds.accountSid,
            p_auth_token: creds.authToken
        });

        if (rpcError) throw new Error(rpcError.message);

        if (rpcResult) {
            const parsed = typeof rpcResult === 'string' ? JSON.parse(rpcResult) : rpcResult;
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.status && parsed.status >= 200 && parsed.status < 300) {
                const content = typeof parsed.content === 'string' ? JSON.parse(parsed.content) : parsed.content;
                console.log('[hallService] Message sent via Twilio RPC:', content?.sid);
                return { success: true, messageId: content?.sid || 'rpc-sent' };
            }
        }

        throw new Error('Unexpected RPC result');
    } catch (rpcErr: any) {
        console.warn('[hallService] Twilio RPC failed:', rpcErr.message);
        return { success: false, error: rpcErr.message };
    }
}

/**
 * Send a message to HALL
 * Strategy 1: HALL Brain API (instant AI response)
 * Strategy 2: Twilio WhatsApp (async, via Supabase RPC)
 */
export async function sendToHall(message: string): Promise<HallResponse> {
    // Strategy 1: Direct Brain API (instant response, no WhatsApp needed)
    try {
        const result = await sendToHallBrain(message);
        if (result.success) return result;
    } catch (err: any) {
        console.warn('[hallService] Brain API failed, falling back to Twilio:', err.message);
    }

    // Strategy 2: Twilio WhatsApp (async fallback)
    return sendToHallTwilio(message);
}

/**
 * Get HALL connection status
 */
export async function getHallStatus(): Promise<HallStatus> {
    try {
        // Check if HALL Brain API is reachable
        const healthCheck = await fetch('https://gen-lang-client-0755290444.ue.r.appspot.com/health', {
            method: 'GET',
            signal: AbortSignal.timeout(5000)
        }).catch(() => null);

        const brainOnline = healthCheck?.ok || false;
        const creds = await getTwilioCreds();

        return {
            connected: brainOnline || !!creds,
            twilioConfigured: !!creds,
            provider: brainOnline ? 'hall-brain' : 'twilio-direct',
            phoneNumber: creds?.phoneNumber || ''
        };
    } catch (error) {
        console.error('[hallService] Error getting status:', error);
        return { connected: false, twilioConfigured: false };
    }
}

/**
 * Get recent messages from HALL's conversation in Supabase
 */
async function getHallMessages(limit = 20): Promise<any[]> {
    try {
        const supabase = getSupabaseClient();
        const hallNumber = HALL_PHONE_NUMBER.replace('+', '');

        const { data, error } = await supabase
            .from('messages')
            .select('id, content, direction, created_at, phone_number, status')
            .or(`phone_number.eq.${HALL_PHONE_NUMBER},phone_number.eq.${hallNumber},phone_number.ilike.%${hallNumber}%`)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('[hallService] Error fetching messages:', error);
            return [];
        }

        return (data || []).reverse();
    } catch (error) {
        console.error('[hallService] Error getting HALL messages:', error);
        return [];
    }
}

/**
 * Send message to HALL and return the AI response directly
 */
export async function askHall(message: string, conversationHistory: { role: string; text: string }[] = []): Promise<string> {
    const result = await sendToHall(message);

    if (!result.success) {
        return `Error: ${result.error}`;
    }

    // If we got a direct brain reply, return it
    if (result.reply) {
        return result.reply;
    }

    // Twilio fallback — async response
    console.log('[hallService] Message delivered to HALL via Twilio, SID:', result.messageId);
    return `✅ Message sent to HALL via WhatsApp. HALL is processing your request and will respond shortly. (Message ID: ${result.messageId?.slice(-8)})`;
}

export default {
    sendToHall,
    getHallStatus,
    getHallMessages,
    askHall,
    HALL_PHONE_NUMBER
};
