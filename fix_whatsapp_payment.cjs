const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
    'https://qfskvevighylzzmyiwre.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2t2ZXZpZ2h5bHp6bXlpd3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODE2MzQsImV4cCI6MjA3OTY1NzYzNH0.MZ3S57O9J6LGHaN5zbuNmW8Gt7Hg5MaJSF-U-JhTa0Q'
);

async function main() {
    const { data } = await sb.from('system_settings').select('value').eq('key', 'twilio_credentials').single();
    const c = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    const auth = 'Basic ' + Buffer.from(c.accountSid + ':' + c.authToken).toString('base64');

    // 1. Get WhatsApp Senders details
    console.log('=== WhatsApp Senders ===');
    const r1 = await fetch('https://messaging.twilio.com/v1/Services/' + c.messagingServiceSid + '/PhoneNumbers', {
        headers: { Authorization: auth }
    });
    if (r1.ok) {
        const j1 = await r1.json();
        console.log('Phone Numbers in MessagingService:');
        for (const pn of (j1.phone_numbers || [])) {
            console.log(`  ${pn.phone_number} (${pn.sid}) - capabilities: ${JSON.stringify(pn.capabilities)}`);
        }
    } else {
        console.log('MessagingService PhoneNumbers:', r1.status, await r1.text());
    }

    // 2. Check the WhatsApp sender via content API
    console.log('\n=== WhatsApp Sender Status ===');
    const r2 = await fetch('https://messaging.twilio.com/v1/WhatsApp/Senders?PageSize=20', {
        headers: { Authorization: auth }
    });
    if (r2.ok) {
        const j2 = await r2.json();
        console.log('WhatsApp Senders:');
        for (const sender of (j2.whatsapp_senders || j2.senders || [])) {
            console.log(JSON.stringify(sender, null, 2));
        }
        // Show raw response if no known keys
        if (!j2.whatsapp_senders && !j2.senders) {
            console.log('Raw response:', JSON.stringify(j2, null, 2));
        }
    } else {
        console.log('WhatsApp Senders API:', r2.status, await r2.text());
    }

    // 3. Try to get individual sender
    console.log('\n=== Individual WhatsApp Sender ===');
    const r3 = await fetch('https://messaging.twilio.com/v1/WhatsApp/Senders/whatsapp:+19302007070', {
        headers: { Authorization: auth }
    });
    console.log('Status:', r3.status);
    const j3 = await r3.json();
    console.log(JSON.stringify(j3, null, 2));

    // 4. Check the Twilio WhatsApp channel/connector status
    console.log('\n=== Twilio Channels ===');
    const r4 = await fetch('https://messaging.twilio.com/v2/Channels?PageSize=20', {
        headers: { Authorization: auth }
    });
    if (r4.ok) {
        const j4 = await r4.json();
        console.log('Channels:', JSON.stringify(j4, null, 2));
    } else {
        console.log('Channels API:', r4.status);
        // Try v1
        const r4b = await fetch('https://messaging.twilio.com/v1/Channels?PageSize=20', {
            headers: { Authorization: auth }
        });
        if (r4b.ok) {
            console.log('Channels v1:', JSON.stringify(await r4b.json(), null, 2));
        } else {
            console.log('Channels v1:', r4b.status);
        }
    }

    // 5. Check if there's Twilio's WhatsApp-specific configuration API
    console.log('\n=== Twilio WhatsApp Config ===');
    const r5 = await fetch('https://messaging.twilio.com/v1/WhatsApp/Configuration', {
        headers: { Authorization: auth }
    });
    console.log('WhatsApp Config:', r5.status);
    if (r5.ok) {
        console.log(JSON.stringify(await r5.json(), null, 2));
    }

    // 6. Check most recent alerts for the WhatsApp number
    console.log('\n=== Recent Alerts (WhatsApp-specific) ===');
    const ra = await fetch('https://monitor.twilio.com/v1/Alerts?PageSize=10&LogLevel=error', {
        headers: { Authorization: auth }
    });
    if (ra.ok) {
        const ja = await ra.json();
        for (const alert of (ja.alerts || [])) {
            // Only show WhatsApp related alerts
            if (alert.error_code === '63005' || alert.error_code === 63005 ||
                (alert.alert_text && alert.alert_text.includes('WhatsApp'))) {
                console.log(`Alert: ${alert.error_code} - ${alert.alert_text?.substring(0, 200)} - ${alert.date_created}`);
                // Get alert details
                const rd = await fetch('https://monitor.twilio.com/v1/Alerts/' + alert.sid, {
                    headers: { Authorization: auth }
                });
                if (rd.ok) {
                    const jd = await rd.json();
                    console.log('  Details:', JSON.stringify({
                        error_code: jd.error_code,
                        more_info: jd.more_info,
                        request_url: jd.request_url,
                        resource_sid: jd.resource_sid,
                        response_body: jd.response_body?.substring(0, 300)
                    }, null, 2));
                }
            }
        }
    }

    // 7. Try sending a simple test message to see current error
    console.log('\n=== Send Test Message ===');
    const p7 = new URLSearchParams({
        To: 'whatsapp:+19044399343',
        From: 'whatsapp:+19302007070',
        ContentSid: 'HX1111f3f47537923173d927ab7f925ce8'
    });
    const r7 = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + c.accountSid + '/Messages.json', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: auth }, body: p7.toString()
    });
    const j7 = await r7.json();
    console.log('HTTP:', r7.status);
    console.log('SID:', j7.sid);
    console.log('Status:', j7.status);
    console.log('Error:', j7.error_code, j7.error_message);

    if (j7.sid) {
        console.log('\nWaiting 20 seconds for delivery...');
        await new Promise(r => setTimeout(r, 20000));

        const rf = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + c.accountSid + '/Messages/' + j7.sid + '.json', {
            headers: { Authorization: auth }
        });
        const jf = await rf.json();
        console.log('\n=== Message Result ===');
        console.log('Status:', jf.status);
        console.log('Error Code:', jf.error_code);
        console.log('Error Message:', jf.error_message);
    }

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
