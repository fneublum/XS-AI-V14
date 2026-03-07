const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
    'https://qfskvevighylzzmyiwre.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2t2ZXZpZ2h5bHp6bXlpd3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODE2MzQsImV4cCI6MjA3OTY1NzYzNH0.MZ3S57O9J6LGHaN5zbuNmW8Gt7Hg5MaJSF-U-JhTa0Q'
);

async function main() {
    const { data } = await sb.from('system_settings').select('value').eq('key', 'twilio_credentials').single();
    const c = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    const auth = 'Basic ' + Buffer.from(c.accountSid + ':' + c.authToken).toString('base64');

    // 1. Get full details of a recent failed message
    console.log('=== Last Failed Message Details ===');
    const r1 = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + c.accountSid + '/Messages.json?PageSize=1&Status=failed', {
        headers: { Authorization: auth }
    });
    const j1 = await r1.json();
    if (j1.messages && j1.messages.length > 0) {
        const m = j1.messages[0];
        console.log(JSON.stringify(m, null, 2));
    }

    // 2. Check WhatsApp Business Profile via Twilio
    console.log('\n=== WhatsApp Business Profile ===');
    const r2 = await fetch('https://messaging.twilio.com/v1/Services?PageSize=20', {
        headers: { Authorization: auth }
    });
    if (r2.ok) {
        const j2 = await r2.json();
        for (const svc of (j2.services || [])) {
            console.log(`Service: ${svc.friendly_name} (${svc.sid}) - Usecase: ${svc.usecase}`);
        }
    }

    // 3. Check Twilio WhatsApp-specific APIs
    console.log('\n=== Checking Twilio WhatsApp APIs ===');

    // Check phone number capabilities
    const r3 = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + c.accountSid + '/IncomingPhoneNumbers.json?PhoneNumber=%2B19302007070', {
        headers: { Authorization: auth }
    });
    const j3 = await r3.json();
    if (j3.incoming_phone_numbers && j3.incoming_phone_numbers.length > 0) {
        const pn = j3.incoming_phone_numbers[0];
        console.log('Phone:', pn.phone_number);
        console.log('SID:', pn.sid);
        console.log('Capabilities:', JSON.stringify(pn.capabilities));
        console.log('Status:', pn.status);
    }

    // 4. Try sending a message with explicit MessagingServiceSid bypass
    console.log('\n=== Testing with explicit From (no MessagingService) ===');
    const p4 = new URLSearchParams({
        To: 'whatsapp:+19044399343',
        From: 'whatsapp:+19302007070',
        ContentSid: 'HX1111f3f47537923173d927ab7f925ce8'
    });
    const r4 = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + c.accountSid + '/Messages.json', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: auth }, body: p4.toString()
    });
    const j4 = await r4.json();
    console.log('HTTP:', r4.status);
    console.log('SID:', j4.sid);
    console.log('Status:', j4.status);
    console.log('Error:', j4.error_code, j4.error_message);
    console.log('MessagingServiceSid:', j4.messaging_service_sid);

    if (j4.sid) {
        // Wait for delivery
        console.log('\nWaiting 15 seconds...');
        await new Promise(r => setTimeout(r, 15000));

        const rf = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + c.accountSid + '/Messages/' + j4.sid + '.json', {
            headers: { Authorization: auth }
        });
        const jf = await rf.json();
        console.log('\n=== Message Result ===');
        console.log('Status:', jf.status);
        console.log('Error Code:', jf.error_code);
        console.log('Error Message:', jf.error_message);
        console.log('Subresource URIs:', JSON.stringify(jf.subresource_uris));

        // Check if there's a feedback resource
        if (jf.subresource_uris && jf.subresource_uris.feedback) {
            const rfb = await fetch('https://api.twilio.com' + jf.subresource_uris.feedback, {
                headers: { Authorization: auth }
            });
            console.log('Feedback:', await rfb.text());
        }
    }

    // 5. Check Twilio alerts for more details
    console.log('\n=== Recent Twilio Alerts ===');
    const ra = await fetch('https://monitor.twilio.com/v1/Alerts?PageSize=5', {
        headers: { Authorization: auth }
    });
    if (ra.ok) {
        const ja = await ra.json();
        for (const alert of (ja.alerts || [])) {
            console.log(`Alert: ${alert.error_code} - ${alert.alert_text} - ${alert.date_created}`);
        }
    } else {
        console.log('Alerts API:', ra.status);
    }

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
