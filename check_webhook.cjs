const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
    'https://qfskvevighylzzmyiwre.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2t2ZXZpZ2h5bHp6bXlpd3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODE2MzQsImV4cCI6MjA3OTY1NzYzNH0.MZ3S57O9J6LGHaN5zbuNmW8Gt7Hg5MaJSF-U-JhTa0Q'
);

async function main() {
    const { data } = await sb.from('system_settings').select('value').eq('key', 'twilio_credentials').single();
    const c = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    const auth = 'Basic ' + Buffer.from(c.accountSid + ':' + c.authToken).toString('base64');

    // Fix the HALL messaging service
    console.log('=== Fixing HALL Messaging Service ===');
    const hallSid = 'MGeb1fe78bc59c9704fc9cff798d5d6ea4';
    const params = new URLSearchParams({
        InboundRequestUrl: 'https://qfskvevighylzzmyiwre.supabase.co/functions/v1/twilio-webhook',
        StatusCallback: '' // Clear bad callback
    });

    const rf = await fetch(`https://messaging.twilio.com/v1/Services/${hallSid}`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });
    const rfJson = await rf.json();
    console.log('Update HALL Service:', rf.status, rfJson.inbound_request_url);

    // Fix the Phone Number webhook 
    const phoneSid = 'PNe9feef4a78f38c2284875514c656adba';
    const params2 = new URLSearchParams({
        SmsUrl: 'https://qfskvevighylzzmyiwre.supabase.co/functions/v1/twilio-webhook',
        StatusCallback: ''
    });
    const rp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/IncomingPhoneNumbers/${phoneSid}.json`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params2.toString()
    });
    const rpJson = await rp.json();
    console.log('Update Phone Number:', rp.status, rpJson.sms_url);

    // Test sending to dashboard target number +19047882483
    console.log('\n=== Testing Send to +19047882483 ===');
    const pTarget = new URLSearchParams({
        To: 'whatsapp:+19047882483',
        From: 'whatsapp:+19302007070',
        ContentSid: 'HX1111f3f47537923173d927ab7f925ce8'
    });
    const rt = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: pTarget.toString()
    });
    const jt = await rt.json();
    console.log('HTTP:', rt.status, 'SID:', jt.sid, 'Status:', jt.status, 'Error:', jt.error_code, jt.error_message);

    if (jt.sid) {
        console.log('Waiting 10s for delivery...');
        await new Promise(r => setTimeout(r, 10000));
        const rb = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages/${jt.sid}.json`, {
            headers: { Authorization: auth }
        });
        const jb = await rb.json();
        console.log('Final Status:', jb.status, 'Error:', jb.error_code, jb.error_message);
    }

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
