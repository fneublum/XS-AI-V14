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

        const xscrmMsSid = 'MG58557aeb623a481dc4cbaf9f75ea42d4';
        const oldNumSid = 'PNe9feef4a78f38c2284875514c656adba'; // SID for +19302007070
        const oldSvcSid = 'MGeb1fe78bc59c9704fc9cff798d5d6ea4'; // HALL SID

        console.log(`=== Reassigning Old Phone Number (+19302007070) to XSCRM Messaging Service ===`);

        // 1. Remove from HALL Service pool
        console.log(`Removing from HALL Service (${oldSvcSid})...`);
        const rDel = await fetch(`https://messaging.twilio.com/v1/Services/${oldSvcSid}/PhoneNumbers/${oldNumSid}`, {
            method: 'DELETE',
            headers: { Authorization: auth }
        });
        console.log("Delete status from HALL:", rDel.status);

        // 2. Add to XSCRM Service pool
        console.log(`Adding to XSCRM Service (${xscrmMsSid})...`);
        const poolParams = new URLSearchParams({ PhoneNumberSid: oldNumSid });
        const rAdd = await fetch(`https://messaging.twilio.com/v1/Services/${xscrmMsSid}/PhoneNumbers`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: poolParams.toString()
        });
        const addRes = await rAdd.json();
        console.log("Add status to XSCRM:", rAdd.status, addRes.sid ? "SUCCESS - " + addRes.sid : addRes);

        // 3. Update the IncomingPhoneNumber's MessagingServiceSid property as well just to be safe
        console.log("Updating phone number object MessagingServiceSid...");
        const updateParams = new URLSearchParams({ MessagingServiceSid: xscrmMsSid });
        const rUpdate = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/IncomingPhoneNumbers/${oldNumSid}.json`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: updateParams.toString()
        });
        console.log("Number Object Update status:", rUpdate.status);

    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
main();
