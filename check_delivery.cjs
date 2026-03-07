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
        const sid = 'MMa95821c7649cfa4d3c5cded1c8333e14';

        console.log(`=== Checking Status for Message ${sid} ===`);

        let attempts = 0;
        let finalStatus = 'queued';
        let errCode = null;

        while (attempts < 5) {
            const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages/${sid}.json`, {
                headers: { Authorization: auth }
            });

            const res = await r.json();
            finalStatus = res.status;
            errCode = res.error_code;

            console.log(`Status: ${finalStatus} (Error: ${errCode || 'None'})`);

            if (finalStatus === 'delivered' || finalStatus === 'read' || finalStatus === 'failed' || finalStatus === 'undelivered') {
                break;
            }
            // Wait 2 seconds before checking again if still queued/sent
            await new Promise(res => setTimeout(res, 2000));
            attempts++;
        }

        if (finalStatus === 'failed' || finalStatus === 'undelivered') {
            console.error(`\n❌ MESSAGE FAILED! Twilio Error: ${errCode}`);
        } else {
            console.log(`\n✅ Message Delivered Successfully!`);
        }

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
main();
