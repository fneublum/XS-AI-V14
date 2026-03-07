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
        const RECIPIENT = '+19047882483';
        const SENDER = '+19302057070'; // Our new number

        // WhatsApp requires a template to initiate conversation if no inbound message exists from the user in the last 24h
        const TEMPLATE_SID = 'HX1111f3f47537923173d927ab7f925ce8';

        console.log(`=== Sending Test Template to ${RECIPIENT} from ${SENDER} ===`);

        const params = new URLSearchParams({
            To: 'whatsapp:' + RECIPIENT,
            From: 'whatsapp:' + SENDER,
            ContentSid: TEMPLATE_SID
        });

        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json`, {
            method: 'POST',
            headers: {
                Authorization: auth,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        const res = await r.json();
        console.log("Send Status:", r.status);
        console.log("Response:", JSON.stringify(res, null, 2));

        if (res.error_code) {
            console.error(`FAILED! Twilio Error ${res.error_code}: ${res.error_message}`);
        } else {
            console.log("✅ Message successfully accepted by Twilio API! The 63005 Meta rejection should be gone now.");
        }

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
main();
