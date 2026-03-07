// Twilio Send — Supabase Edge Function
// Sends WhatsApp messages via Twilio REST API with explicit From number
// (bypasses Messaging Service SID override from the send_twilio_message RPC)
// URL: https://qfskvevighylzzmyiwre.supabase.co/functions/v1/twilio-send

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

Deno.serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    try {
        const body = await req.json();
        const { to, from, message, accountSid, authToken, contentSid, messagingServiceSid } = body;

        if (!to || !from || !accountSid || !authToken) {
            return new Response(
                JSON.stringify({ error: "Missing required fields: to, from, accountSid, authToken" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (!message && !contentSid) {
            return new Response(
                JSON.stringify({ error: "Either message or contentSid is required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
        const authHeader = "Basic " + btoa(`${accountSid}:${authToken}`);

        // Helper to send a Twilio message
        const sendTwilio = async (params: Record<string, string>) => {
            const formBody = new URLSearchParams(params);
            const resp = await fetch(twilioUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": authHeader,
                },
                body: formBody.toString(),
            });
            return { resp, data: await resp.json() };
        };

        // Build params: contentSid takes priority (required for WhatsApp Business templates)
        // When using ContentSid, Body must NOT be included
        const params: Record<string, string> = { To: to, From: from };

        if (contentSid) {
            // Template message — no Body allowed
            params.ContentSid = contentSid;
            console.log("Sending template message with ContentSid:", contentSid);
        } else if (message) {
            // Free-form message (only works within 24-hour session window)
            params.Body = message;
            console.log("Sending free-form message");
        }

        const { resp: twilioResp, data: twilioData } = await sendTwilio(params);
        console.log("Twilio response:", JSON.stringify({ ok: twilioResp.ok, code: twilioData.code, sid: twilioData.sid }));

        if (!twilioResp.ok) {
            return new Response(
                JSON.stringify({ error: twilioData.message || "Twilio API error", code: twilioData.code }),
                { status: twilioResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        return new Response(
            JSON.stringify({ success: true, sid: twilioData.sid, status: twilioData.status }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (err: any) {
        return new Response(
            JSON.stringify({ error: err.message || "Internal error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
