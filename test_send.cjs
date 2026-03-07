const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
    'https://qfskvevighylzzmyiwre.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2t2ZXZpZ2h5bHp6bXlpd3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODE2MzQsImV4cCI6MjA3OTY1NzYzNH0.MZ3S57O9J6LGHaN5zbuNmW8Gt7Hg5MaJSF-U-JhTa0Q'
);

async function main() {
    const { data } = await sb.from('system_settings').select('value').eq('key', 'twilio_credentials').single();
    const c = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    const auth = 'Basic ' + Buffer.from(c.accountSid + ':' + c.authToken).toString('base64');

    // Test 1: Send APPROVED template (hall_notification_template)
    console.log('=== Test 1: Approved Template to +19044399343 ===');
    const p1 = new URLSearchParams({
        To: 'whatsapp:+19044399343',
        From: 'whatsapp:+19302007070',
        ContentSid: 'HX1111f3f47537923173d927ab7f925ce8' // hall_notification_template (APPROVED)
    });
    const r1 = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + c.accountSid + '/Messages.json', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: auth }, body: p1.toString()
    });
    const j1 = await r1.json();
    console.log('HTTP:', r1.status, 'SID:', j1.sid, 'Status:', j1.status, 'Err:', j1.error_code || j1.message || 'none');

    // Test 2: Send free-form message (will likely fail since no 24h session, but worth testing)
    console.log('\n=== Test 2: Free-form to +19044399343 ===');
    const p2 = new URLSearchParams({
        To: 'whatsapp:+19044399343',
        From: 'whatsapp:+19302007070',
        Body: 'Hello from XS CRM - payment method test!'
    });
    const r2 = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + c.accountSid + '/Messages.json', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: auth }, body: p2.toString()
    });
    const j2 = await r2.json();
    console.log('HTTP:', r2.status, 'SID:', j2.sid, 'Status:', j2.status, 'Err:', j2.error_code || j2.message || 'none');

    // Wait 20s and check statuses
    console.log('\nWaiting 20s for delivery...');
    await new Promise(r => setTimeout(r, 20000));

    // Check template message status
    const rb1 = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + c.accountSid + '/Messages/' + j1.sid + '.json', { headers: { Authorization: auth } });
    const jb1 = await rb1.json();
    console.log('\n=== Template Result ===');
    console.log('Status:', jb1.status, '| Error:', jb1.error_code, '| ErrMsg:', jb1.error_message);

    // Check free-form message status
    const rb2 = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + c.accountSid + '/Messages/' + j2.sid + '.json', { headers: { Authorization: auth } });
    const jb2 = await rb2.json();
    console.log('\n=== Free-form Result ===');
    console.log('Status:', jb2.status, '| Error:', jb2.error_code, '| ErrMsg:', jb2.error_message);

    if (jb1.status === 'delivered' || jb1.status === 'sent' || jb1.status === 'read') {
        console.log('\n🎉🎉🎉 TEMPLATE DELIVERED! WhatsApp is WORKING! 🎉🎉🎉');
    }
    if (jb2.status === 'delivered' || jb2.status === 'sent' || jb2.status === 'read') {
        console.log('🎉🎉🎉 FREE-FORM DELIVERED TOO! 🎉🎉🎉');
    }

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
