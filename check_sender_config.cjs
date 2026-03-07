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

        console.log("=== Fetching Twilio Account Configurations for +19302007070 ===");

        const rNums = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/IncomingPhoneNumbers.json`, { headers: { Authorization: auth } });
        const nums = await rNums.json();

        let numInfo = null;
        for (const num of nums.incoming_phone_numbers || []) {
            if (num.phone_number === '+19302007070') {
                numInfo = num;
                break;
            }
        }

        if (numInfo) {
            console.log("\n--- Incoming Phone Number Config ---");
            console.log(JSON.stringify(numInfo, null, 2));
        } else {
            console.log("+19302007070 not found in regular Incoming Phone Numbers.");
        }

        // Try getting Messaging Services that might be linked
        const rSvc = await fetch(`https://messaging.twilio.com/v1/Services?PageSize=20`, { headers: { Authorization: auth } });
        const svcs = await rSvc.json();

        for (const svc of (svcs.services || [])) {
            const rPool = await fetch(`https://messaging.twilio.com/v1/Services/${svc.sid}/PhoneNumbers`, { headers: { Authorization: auth } });
            const pool = await rPool.json();

            for (const sender of (pool.phone_numbers || [])) {
                if (sender.phone_number === '+19302007070') {
                    console.log(`\n--- Linked to Messaging Service: ${svc.friendly_name} (${svc.sid}) ---`);
                    console.log("Service Config:", JSON.stringify(svc, null, 2));
                    console.log("\nSender Info in Pool:", JSON.stringify(sender, null, 2));
                }
            }
        }

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
main();
