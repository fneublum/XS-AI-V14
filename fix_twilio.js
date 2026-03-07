const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
    'https://qfskvevighylzzmyiwre.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2t2ZXZpZ2h5bHp6bXlpd3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODE2MzQsImV4cCI6MjA3OTY1NzYzNH0.MZ3S57O9J6LGHaN5zbuNmW8Gt7Hg5MaJSF-U-JhTa0Q'
);

async function main() {
    const { data } = await sb.from('system_settings').select('value').eq('key', 'twilio_credentials').single();
    const c = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    const auth = 'Basic ' + Buffer.from(c.accountSid + ':' + c.authToken).toString('base64');
    const msSid = 'MG2930ee449b981ca4cdd56a526c06d5c3';

    // Step 1: List current channel senders in pool
    console.log('=== Current Channel Senders ===');
    const r1 = await fetch(`https://messaging.twilio.com/v1/Services/${msSid}/ChannelSenders`, { headers: { Authorization: auth } });
    const d1 = await r1.json();
    (d1.senders || []).forEach(s => console.log(' ', s.sid, s.sender));

    // Step 2: Add whatsapp:+19302007070 to the sender pool
    console.log('\n=== Adding whatsapp:+19302007070 ===');
    const params = new URLSearchParams({ Sender: 'whatsapp:+19302007070' });
    const r2 = await fetch(`https://messaging.twilio.com/v1/Services/${msSid}/ChannelSenders`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });
    const d2 = await r2.json();
    console.log('Result:', r2.status, JSON.stringify(d2, null, 2));

    // Step 3: Verify
    console.log('\n=== Updated Channel Senders ===');
    const r3 = await fetch(`https://messaging.twilio.com/v1/Services/${msSid}/ChannelSenders`, { headers: { Authorization: auth } });
    const d3 = await r3.json();
    (d3.senders || []).forEach(s => console.log(' ', s.sid, s.sender));

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
