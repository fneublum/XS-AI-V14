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
        const phoneSid = 'PNe9feef4a78f38c2284875514c656adba';

        // We need to forward to +19047882483 (User's phone). Twilio has a built-in TwiML Bin we can create, 
        // or we can just point it to a hardcoded URL that returns TwiML.
        // A simple way to do this without hosting is to use Twilio's generic forwarding webhook, or create a quick Supabase edge function if needed.
        // Even simpler: The user uses "TALKYTO", which typically has a specific Voice URL. Let's see if we can find the Talkyto TwiML app in the account.

        const rApps = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Applications.json`, { headers: { Authorization: auth } });
        const apps = await rApps.json();

        let targetVoiceUrl = '';
        console.log("=== TwiML Apps ===");
        for (const app of apps.applications || []) {
            console.log(`- ${app.friendly_name}: ${app.voice_url}`);
            if (app.friendly_name.toLowerCase().includes('talkyto')) {
                targetVoiceUrl = app.voice_url;
            }
        }

        // If no explicit Talkyto app, let's check other phone numbers to copy their Voice URL
        if (!targetVoiceUrl) {
            const rNums = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/IncomingPhoneNumbers.json`, { headers: { Authorization: auth } });
            const nums = await rNums.json();
            for (const num of nums.incoming_phone_numbers || []) {
                if (num.friendly_name.toLowerCase().includes('talkyto') && num.voice_url) {
                    targetVoiceUrl = num.voice_url;
                    break;
                }
            }
        }

        console.log("Target Voice URL:", targetVoiceUrl || "NOT FOUND");

        if (targetVoiceUrl) {
            console.log("Applying Voice URL to +19302007070...");
            const params = new URLSearchParams({ VoiceUrl: targetVoiceUrl });
            const rUpdate = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/IncomingPhoneNumbers/${phoneSid}.json`, {
                method: 'POST',
                headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString()
            });
            console.log("Update status:", rUpdate.status);
        } else {
            console.log("Could not automatically find the Talkyto Voice URL. We need to create a simple forwarder.");
            // We can write a quick Supabase function or use an ephemeral endpoint. Let's use twimlets for an instant forward
            // http://twimlets.com/forward?PhoneNumber=19047882483
            targetVoiceUrl = "http://twimlets.com/forward?PhoneNumber=19047882483";
            console.log("Using Twimlets forwarder to +19047882483:", targetVoiceUrl);

            const params = new URLSearchParams({ VoiceUrl: targetVoiceUrl });
            const rUpdate = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/IncomingPhoneNumbers/${phoneSid}.json`, {
                method: 'POST',
                headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString()
            });
            console.log("Update status:", rUpdate.status);
        }

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
main();
