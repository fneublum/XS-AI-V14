import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { to, text, templateName, languageCode = "en_US", components = [] } = await req.json();

        if (!to) {
            throw new Error("Missing recipient 'to' parameter");
        }
        if (!text && !templateName) {
            throw new Error("Must provide either 'text' or 'templateName'");
        }

        const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
        const ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");

        if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
            throw new Error("Missing WhatsApp configuration secrets");
        }

        const apiUrl = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
        let payload: any = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to.replace("+", ""), // WhatsApp Cloud API expects the number without the +
        };

        if (templateName) {
            payload.type = "template";
            payload.template = {
                name: templateName,
                language: {
                    code: languageCode,
                },
                components: components,
            };
        } else {
            payload.type = "text";
            payload.text = {
                preview_url: false,
                body: text,
            };
        }

        console.log(`Sending message via Meta Cloud API to ${payload.to}`, JSON.stringify(payload));

        const response = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Meta API Error:", data);
            throw new Error(JSON.stringify(data.error));
        }

        console.log("Success:", data);

        return new Response(JSON.stringify({ success: true, data }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
        });

    } catch (error: any) {
        console.error("Function error:", error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
        });
    }
});
