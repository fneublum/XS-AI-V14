import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
import { runAgentFromWhatsApp, transcribeWhatsAppAudio, sendWhatsAppReply } from "../_shared/agentServer.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Function to verify Meta signature
async function verifySignature(payloadText: string, signatureHeader: string | null, secret: string | undefined): Promise<boolean> {
    if (!signatureHeader || !secret) {
        console.error("Missing signature header or app secret — rejecting request.");
        return false;
    }

    try {
        const signatureParts = signatureHeader.split("sha256=");
        if (signatureParts.length !== 2) return false;

        // Convert the incoming hex signature to a Uint8Array
        const signatureHex = signatureParts[1];
        const signatureBytes = new Uint8Array(signatureHex.length / 2);
        for (let i = 0; i < signatureHex.length; i += 2) {
            signatureBytes[i / 2] = parseInt(signatureHex.substring(i, i + 2), 16);
        }

        // Import the secret key
        const key = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["verify", "sign"]
        );

        // Verify the signature against the raw payload
        const isValid = await crypto.subtle.verify(
            "HMAC",
            key,
            signatureBytes,
            new TextEncoder().encode(payloadText)
        );

        return isValid;
    } catch (err) {
        console.error("Error verifying signature:", err);
        return false;
    }
}

serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    // Handle Meta's Webhook Verification requirement (GET)
    if (req.method === "GET") {
        const url = new URL(req.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");

        const VERIFY_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN");

        if (mode === "subscribe" && token === VERIFY_TOKEN) {
            console.log("WEBHOOK_VERIFIED");
            return new Response(challenge, { status: 200 }); // Meta requires returning raw challenge text
        } else {
            console.error("Webhook verification failed.", { mode, passedToken: token, expectedToken: VERIFY_TOKEN });
            return new Response("Forbidden", { status: 403 });
        }
    }

    // Handle Incoming Messages and Status Updates (POST)
    if (req.method === "POST") {
        const payloadText = await req.text();
        const signature = req.headers.get("x-hub-signature-256");
        const appSecret = Deno.env.get("META_APP_SECRET");

        const isValid = await verifySignature(payloadText, signature, appSecret);
        if (!isValid) {
            console.error("Signature validation failed — rejecting request.");
            return new Response("Forbidden", { status: 403, headers: corsHeaders });
        }

        let payload: any;
        try {
            payload = JSON.parse(payloadText);
        } catch (e) {
            return new Response("Invalid JSON", { status: 400 });
        }

        console.log("Incoming Webhook JSON:", JSON.stringify(payload, null, 2));

        try {
            // Initialize Supabase Client for saving messages
            const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
            const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
            const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

            // Meta sends a batch list of entries
            if (payload.object === "whatsapp_business_account" && payload.entry) {
                for (const entry of payload.entry) {
                    for (const change of entry.changes || []) {
                        if (change.value && change.value.messages) {
                            // Handle incoming message
                            const messages = change.value.messages;
                            const contacts = change.value.contacts || [];

                            for (const msg of messages) {
                                const customerProfileName = contacts.find((c: any) => c.wa_id === msg.from)?.profile?.name || "Unknown";
                                const fromNumber = `+${msg.from}`; // add + back for consistency in db
                                const toNumber = `+${change.value.metadata.display_phone_number}`;
                                let messageBody = "";

                                if (msg.type === "text") messageBody = msg.text.body;
                                else if (msg.type === "image") messageBody = `[Image attached: ${msg.image.id}]`;
                                else if (msg.type === "document") messageBody = `[Document attached: ${msg.document.id}]`;
                                else if (msg.type === "audio" || msg.type === "voice") messageBody = `[Voice message: ${msg.audio?.id || msg.voice?.id}]`;
                                else messageBody = `[Unsupported message type: ${msg.type}]`;

                                // ── Agent routing (Phase 5) ────────────────────────────
                                // If the phone is on the allowlist, hand the message to
                                // the agent runtime instead of the legacy WhatsApp chat
                                // store. Falls through to legacy on any error so an agent
                                // outage doesn't black-hole customer messages.
                                let agentHandled = false;
                                try {
                                    const { data: allowed } = await supabase
                                        .from("agent_allowed_phones")
                                        .select("phone, userId, companyId")
                                        .eq("phone", fromNumber)
                                        .maybeSingle();

                                    if (allowed) {
                                        const userId = allowed.userId;
                                        const companyId = allowed.companyId || "ALL";

                                        let userText = "";
                                        if (msg.type === "text") {
                                            userText = msg.text.body;
                                        } else if (msg.type === "audio" || msg.type === "voice") {
                                            const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN") || "";
                                            const mediaId = msg.audio?.id || msg.voice?.id;
                                            if (mediaId && accessToken) {
                                                try {
                                                    userText = await transcribeWhatsAppAudio(mediaId, accessToken);
                                                } catch (err) {
                                                    console.error("[agent] audio transcribe failed", err);
                                                    userText = "[voice transcription failed]";
                                                }
                                            }
                                        } else {
                                            userText = messageBody; // passes image/document markers through
                                        }

                                        if (userText) {
                                            const threadId = `THR-WA-${fromNumber.replace(/\D/g, "")}`;
                                            // Ensure the thread exists (idempotent upsert).
                                            await supabase.from("agent_threads").upsert({
                                                id: threadId,
                                                userId,
                                                companyId: companyId === "ALL" ? null : companyId,
                                                channel: "whatsapp",
                                                title: `WhatsApp ${fromNumber}`,
                                            }, { onConflict: "id" });

                                            const result = await runAgentFromWhatsApp({
                                                supabase,
                                                threadId,
                                                userId,
                                                companyId,
                                                userText,
                                            });
                                            await sendWhatsAppReply(fromNumber, result.replyText);
                                            agentHandled = true;
                                        }
                                    }
                                } catch (err) {
                                    console.error("[agent] routing failed, falling through to legacy", err);
                                }
                                if (agentHandled) continue;

                                console.log(`Received message from ${fromNumber} (${customerProfileName}): ${messageBody}`);

                                // 1. Find or create the conversation
                                let { data: conv } = await supabase
                                    .from("wa_conversations")
                                    .select("*")
                                    .eq("phoneNumber", fromNumber)
                                    .eq("twilioNumber", toNumber)
                                    .single();

                                if (!conv) {
                                    const { data: newConv, error: convErr } = await supabase
                                        .from("wa_conversations")
                                        .insert([{
                                            id: crypto.randomUUID(),
                                            companyId: "",
                                            phoneNumber: fromNumber,
                                            twilioNumber: toNumber,
                                            contactName: customerProfileName || fromNumber,
                                            status: "active",
                                            unreadCount: 0,
                                            lastMessagePreview: "",
                                            lastMessageAt: new Date().toISOString(),
                                            createdAt: new Date().toISOString(),
                                        }])
                                        .select()
                                        .single();

                                    if (convErr) throw convErr;
                                    conv = newConv;
                                }

                                // 2. Insert the incoming message
                                const messageId = crypto.randomUUID();
                                const now = new Date().toISOString();

                                const { error: msgErr } = await supabase
                                    .from("wa_messages")
                                    .insert([{
                                        id: messageId,
                                        conversationId: conv.id,
                                        direction: "inbound",
                                        content: messageBody,
                                        messageType: msg.type,
                                        status: "delivered", // incoming is delivered immediately
                                        twilioSid: msg.id, // Meta message id
                                        metadata: {
                                            profileName: customerProfileName,
                                            source: "whatsapp-webhook",
                                            whatsappPayload: msg
                                        },
                                        createdAt: now
                                    }]);

                                if (msgErr) throw msgErr;

                                // 3. Update conversation last message preview
                                await supabase
                                    .from("wa_conversations")
                                    .update({
                                        lastMessagePreview: messageBody.substring(0, 100),
                                        lastMessageAt: now,
                                        unreadCount: (conv.unreadCount || 0) + 1,
                                        contactName: customerProfileName || undefined
                                    })
                                    .eq("id", conv.id);
                            }

                        } else if (change.value && change.value.statuses) {
                            // Handle delivery status update from outbound messages
                            for (const statusObj of change.value.statuses) {
                                console.log(`Message ${statusObj.id} status is now: ${statusObj.status}`);
                                // Optional: Update message status in wa_messages table where twilioSid = statusObj.id
                                await supabase
                                    .from("wa_messages")
                                    .update({ status: statusObj.status })
                                    .eq("twilioSid", statusObj.id);
                            }
                        }
                    }
                }
            }

            // Important: Always return 200 OK instantly for Meta webhooks to stop queue retries
            return new Response("EVENT_RECEIVED", { status: 200 });

        } catch (dbError) {
            console.error("Database or processing error:", dbError);
            // Still return 200 so Meta doesn't retry infinitely and block your queue, but log the error
            return new Response("EVENT_RECEIVED (with internal error logged)", { status: 200 });
        }
    }

    return new Response("Method not allowed", { status: 405 });
});
