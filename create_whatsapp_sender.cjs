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
        const webhookUrl = 'https://qfskvevighylzzmyiwre.supabase.co/functions/v1/twilio-webhook';

        // 1. Create a new Messaging Service
        console.log("=== Creating Messaging Service 'XSCRM WhatsApp' ===");
        const msParams = new URLSearchParams({
            FriendlyName: 'XSCRM WhatsApp',
            InboundRequestUrl: webhookUrl,
            StatusCallback: webhookUrl
        });
        const rMs = await fetch(`https://messaging.twilio.com/v1/Services`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: msParams.toString()
        });
        const ms = await rMs.json();
        console.log("Messaging Service Created:", ms.sid);

        if (!ms.sid) {
            console.error("Failed to create Messaging Service:", ms);
            process.exit(1);
        }

        // 2. We need to know which phone number the user wants to use. 
        // We'll list available Twilio numbers that can be added to the sender pool.
        console.log("\n=== Available Twilio Phone Numbers ===");
        const rNums = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/IncomingPhoneNumbers.json`, { headers: { Authorization: auth } });
        const nums = await rNums.json();

        // 3. Add numbers to the sender pool if requested. Since we don't know the new number yet, 
        // we'll just print them and add the first one that isn't already assigned if possible, 
        // or let the user decide. Usually, WhatsApp senders require approval through the console.
        
        console.log("Note: WhatsApp Senders technically require entering your Facebook Business profile details via the Twilio Console (Messaging > Senders > WhatsApp Senders > New Sender) to link the two if they aren't linked yet.");
        console.log("However, we can try to add an existing Twilio number to this new Messaging Service pool.");

        let targetNumber = null;
        for (const num of nums.incoming_phone_numbers || []) {
            console.log(`- ${num.phone_number} (Friendly: ${num.friendly_name})`);
            // Let's use +1 930-205-7070 or +1 947-210-7070 since we saw them in the screenshot earlier
            if (num.phone_number === '+19302057070' || num.phone_number === '+19472107070') {
               targetNumber = num.phone_number;
            }
        }

        if (targetNumber) {
           console.log(`\n=== Adding ${targetNumber} to Messaging Service Sender Pool ===`);
           const poolParams = new URLSearchParams({ Sender: targetNumber });
           const rPool = await fetch(`https://messaging.twilio.com/v1/Services/${ms.sid}/ChannelSenders`, {
               method: 'POST',
               headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
               body: poolParams.toString()
           });
           const poolRes = await rPool.json();
           console.log("Added to pool status:", rPool.status, poolRes);
        } else {
             console.log("\nCouldn't automatically find one of the new numbers to add to the pool. You may need to add it manually in the console.");
        }

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
main();
