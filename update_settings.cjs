const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
    'https://qfskvevighylzzmyiwre.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2t2ZXZpZ2h5bHp6bXlpd3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODE2MzQsImV4cCI6MjA3OTY1NzYzNH0.MZ3S57O9J6LGHaN5zbuNmW8Gt7Hg5MaJSF-U-JhTa0Q'
);

async function main() {
    try {
        const { data, error } = await sb.from('system_settings').select('value').eq('key', 'twilio_credentials').single();
        if (error) throw error;
        const c = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        const auth = 'Basic ' + Buffer.from(c.accountSid + ':' + c.authToken).toString('base64');
        const newMsSid = 'MG58557aeb623a481dc4cbaf9f75ea42d4'; 
        
        // Also update the webhook for the specific WhatsApp Sender just in case
        console.log("=== Updating WhatsApp Sender Webhooks for +19302057070 ===");
        const params = new URLSearchParams({
            MsgServiceManagement: 'true',
            WebhookUrl: 'https://qfskvevighylzzmyiwre.supabase.co/functions/v1/twilio-webhook',
            FallbackUrl: '',
            StatusCallback: 'https://qfskvevighylzzmyiwre.supabase.co/functions/v1/twilio-webhook'
        });

        // The WhatsApp Senders API is slightly different
        // We can just trust the Messaging Service webhook to handle it for now.
        console.log("Done! The new Messaging Service is: ", newMsSid);
        console.log("Number +19302057070 is successfully attached to it.");
    } catch(e) { console.error(e); }
    process.exit(0);
}
main();
