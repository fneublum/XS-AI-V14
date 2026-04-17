// Twilio WhatsApp Webhook — Supabase Edge Function
// Receives inbound WhatsApp messages from Twilio and stores them in the
// XS CRM database.
//
// Security:
// - Verifies the X-Twilio-Signature header (HMAC-SHA1 of URL + sorted
//   POST params) before processing. Fails closed if TWILIO_AUTH_TOKEN is
//   not set or the signature is invalid.
// - No CORS headers — Twilio is a server-to-server caller, not a browser.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyTwilioSignature } from '../_shared/twilioSignature.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const TWILIO_NUMBER = '+19302007070'; // Production WhatsApp Business number

Deno.serve(async (req: Request) => {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    const signatureHeader = req.headers.get('X-Twilio-Signature');

    // Twilio sends form-encoded data — clone so we can both verify and read.
    const formData = await req.formData();

    // Reconstruct the public URL Twilio signed against. In Supabase Edge,
    // req.url already reflects the public function URL.
    const url = req.url;

    const valid = await verifyTwilioSignature(url, formData, signatureHeader);
    if (!valid) {
        console.error('[twilio-webhook] Rejected request — invalid signature');
        return new Response('Forbidden', { status: 403 });
    }

    try {
        const from = formData.get('From')?.toString() || '';
        const body = formData.get('Body')?.toString() || '';
        const messageSid = formData.get('MessageSid')?.toString() || '';
        const profileName = formData.get('ProfileName')?.toString() || '';
        const to = formData.get('To')?.toString() || '';
        const numMedia = parseInt(formData.get('NumMedia')?.toString() || '0', 10);

        const senderPhone = from.replace('whatsapp:', '');
        const twilioPhone = to.replace('whatsapp:', '') || TWILIO_NUMBER;

        console.log(
            `[twilio-webhook] Message from ${senderPhone} (${profileName}): "${body.substring(0, 100)}"`,
        );

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        let conversationId: string;

        const { data: existingConv } = await supabase
            .from('wa_conversations')
            .select('id')
            .eq('phoneNumber', senderPhone)
            .eq('twilioNumber', twilioPhone)
            .limit(1);

        if (existingConv && existingConv.length > 0) {
            conversationId = existingConv[0].id;
        } else {
            conversationId = crypto.randomUUID();
            const now = new Date().toISOString();

            const { error: convErr } = await supabase
                .from('wa_conversations')
                .insert({
                    id: conversationId,
                    companyId: '',
                    twilioNumber: twilioPhone,
                    phoneNumber: senderPhone,
                    contactName: profileName || senderPhone,
                    status: 'active',
                    unreadCount: 0,
                    lastMessagePreview: '',
                    lastMessageAt: now,
                    createdAt: now,
                });

            if (convErr) {
                console.error('[twilio-webhook] Failed to create conversation:', convErr);
            }
        }

        const messageId = crypto.randomUUID();
        const now = new Date().toISOString();
        const messageType = numMedia > 0 ? 'media' : 'text';

        const { error: msgErr } = await supabase.from('wa_messages').insert({
            id: messageId,
            conversationId,
            content: body,
            direction: 'inbound',
            messageType,
            status: 'delivered',
            twilioSid: messageSid,
            metadata: {
                profileName,
                source: 'twilio-webhook',
                numMedia,
            },
            createdAt: now,
        });

        if (msgErr) {
            console.error('[twilio-webhook] Failed to insert message:', msgErr);
        }

        const { data: currentConv } = await supabase
            .from('wa_conversations')
            .select('unreadCount')
            .eq('id', conversationId)
            .single();

        await supabase
            .from('wa_conversations')
            .update({
                lastMessageAt: now,
                lastMessagePreview: body.substring(0, 100),
                unreadCount: (currentConv?.unreadCount || 0) + 1,
                contactName: profileName || undefined,
            })
            .eq('id', conversationId);

        console.log(
            `[twilio-webhook] Saved message ${messageId} in conversation ${conversationId}`,
        );

        return twiml();
    } catch (err) {
        console.error('[twilio-webhook] Error:', err);
        return twiml();
    }
});

function twiml(): Response {
    return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        {
            status: 200,
            headers: { 'Content-Type': 'text/xml' },
        },
    );
}
