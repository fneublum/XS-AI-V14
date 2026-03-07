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

        // Fetch logs
        const url = `https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json?To=%2B19302007070&PageSize=20`;
        console.log('Fetching:', url);
        const r = await fetch(url, { headers: { Authorization: auth } });
        const j = await r.json();

        console.log('=== Incoming Messages ===');
        let count = 0;
        for (const m of (j.messages || [])) {
            if (m.direction === 'inbound') {
                console.log(`[${m.date_created}] From: ${m.from} Body: ${m.body}`);
                count++;
            }
        }
        if (count === 0) console.log("No inbound messages found recently.");
    } catch (e) { console.error(e); }
    process.exit(0);
}
main();
