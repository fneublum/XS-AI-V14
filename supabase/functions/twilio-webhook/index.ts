// Twilio WhatsApp Webhook — Supabase Edge Function
// Receives inbound WhatsApp messages from Twilio and stores them in the XS CRM database.
// Webhook URL: https://qfskvevighylzzmyiwre.supabase.co/functions/v1/twilio-webhook

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// The Twilio number used by this app (whatsapp:+19302007070)
const TWILIO_NUMBER = "+19302007070"; // Production WhatsApp Business number

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Twilio sends form-encoded data
    const formData = await req.formData();

    const from = formData.get("From")?.toString() || ""; // whatsapp:+1234567890
    const body = formData.get("Body")?.toString() || "";
    const messageSid = formData.get("MessageSid")?.toString() || "";
    const profileName = formData.get("ProfileName")?.toString() || "";
    const to = formData.get("To")?.toString() || ""; // whatsapp:+19302007070
    const numMedia = parseInt(formData.get("NumMedia")?.toString() || "0", 10);

    // Extract plain phone numbers (strip "whatsapp:" prefix)
    const senderPhone = from.replace("whatsapp:", "");
    const twilioPhone = to.replace("whatsapp:", "") || TWILIO_NUMBER;

    console.log(
      `[twilio-webhook] Message from ${senderPhone} (${profileName}): "${body.substring(0, 100)}"`,
    );

    // Initialize Supabase with service role key (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // --- Find or create conversation ---
    let conversationId: string;

    const { data: existingConv } = await supabase
      .from("wa_conversations")
      .select("id")
      .eq("phoneNumber", senderPhone)
      .eq("twilioNumber", twilioPhone)
      .limit(1);

    if (existingConv && existingConv.length > 0) {
      conversationId = existingConv[0].id;
    } else {
      // Create new conversation
      conversationId = crypto.randomUUID();
      const now = new Date().toISOString();

      const { error: convErr } = await supabase
        .from("wa_conversations")
        .insert({
          id: conversationId,
          companyId: "",
          twilioNumber: twilioPhone,
          phoneNumber: senderPhone,
          contactName: profileName || senderPhone,
          status: "active",
          unreadCount: 0,
          lastMessagePreview: "",
          lastMessageAt: now,
          createdAt: now,
        });

      if (convErr) {
        console.error("[twilio-webhook] Failed to create conversation:", convErr);
      }
    }

    // --- Insert message ---
    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();

    const messageType = numMedia > 0 ? "media" : "text";

    const { error: msgErr } = await supabase.from("wa_messages").insert({
      id: messageId,
      conversationId,
      content: body,
      direction: "inbound",
      messageType,
      status: "delivered",
      twilioSid: messageSid,
      metadata: {
        profileName,
        source: "twilio-webhook",
        numMedia,
      },
      createdAt: now,
    });

    if (msgErr) {
      console.error("[twilio-webhook] Failed to insert message:", msgErr);
    }

    // --- Update conversation metadata ---
    const { data: currentConv } = await supabase
      .from("wa_conversations")
      .select("unreadCount")
      .eq("id", conversationId)
      .single();

    await supabase
      .from("wa_conversations")
      .update({
        lastMessageAt: now,
        lastMessagePreview: body.substring(0, 100),
        unreadCount: (currentConv?.unreadCount || 0) + 1,
        contactName: profileName || undefined,
      })
      .eq("id", conversationId);

    console.log(
      `[twilio-webhook] Saved message ${messageId} in conversation ${conversationId}`,
    );

    // Return empty TwiML (no auto-reply)
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        status: 200,
        headers: {
          "Content-Type": "text/xml",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (err) {
    console.error("[twilio-webhook] Error:", err);
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      },
    );
  }
});
