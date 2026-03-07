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

        // The new Messaging Service we just created
        const msSid = 'MG58557aeb623a481dc4cbaf9f75ea42d4';
        const numSid = 'PN2ce569878d25a8dc2db90416d5d9b381'; // SID for +19302057070

        console.log(`=== Reassigning Phone Number (+19302057070) to New XSCRM Messaging Service ===`);

        // Step 1: Remove from old service
        // Actually, Twilio allows you to just update the IncomingPhoneNumber's MessagingServiceSid directly
        const updateParams = new URLSearchParams({ SmsApplicationSid: '', SmsUrl: '', SmsFallbackUrl: '', VoiceUrl: '' });

        // The correct way in Twilio API to move a number to a new Messaging Service is to update the number itself
        const params = new URLSearchParams({
            SmsApplicationSid: '', // Clear old app
            MessagingServiceSid: msSid // Assign to new Messaging Service
        });

        console.log("Updating phone number configuration...");
        const rUpdate = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/IncomingPhoneNumbers/${numSid}.json`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });
        const updateRes = await rUpdate.json();
        console.log("Update status:", rUpdate.status);

        // Step 2: Now try adding it to the Sender Pool again just to be sure it's fully linked in the new API
        console.log("Adding to Sender Pool...");
        const poolParams = new URLSearchParams({ PhoneNumberSid: numSid });
        const rPool = await fetch(`https://messaging.twilio.com/v1/Services/${msSid}/PhoneNumbers`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: poolParams.toString()
        });

        const poolRes = await rPool.json();
        console.log("Pool Add status:", rPool.status, poolRes);

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
main();
