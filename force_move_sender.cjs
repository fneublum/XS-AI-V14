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
        
        const newMsSid = 'MG58557aeb623a481dc4cbaf9f75ea42d4'; // New XSCRM
        const numSid = 'PN2ce569878d25a8dc2db90416d5d9b381'; // SID for +19302057070

        // 1. Find which old service this number belongs to
        console.log("=== Finding Old Messaging Service ===");
        const rSvc = await fetch(`https://messaging.twilio.com/v1/Services?PageSize=20`, { headers: { Authorization: auth } });
        const svcs = await rSvc.json();

        let oldMsSid = null;
        for (const svc of (svcs.services || [])) {
            // Check its sender pool
            const rPool = await fetch(`https://messaging.twilio.com/v1/Services/${svc.sid}/PhoneNumbers`, { headers: { Authorization: auth } });
            const pool = await rPool.json();
            
            for (const sender of (pool.phone_numbers || [])) {
               if (sender.sid === numSid) {
                   console.log(`Found number in old service: ${svc.friendly_name} (${svc.sid})`);
                   oldMsSid = svc.sid;
                   break;
               }
            }
            if (oldMsSid) break;
        }

        if (oldMsSid) {
           console.log(`\n=== Removing from Old Service (${oldMsSid}) ===`);
           const rDel = await fetch(`https://messaging.twilio.com/v1/Services/${oldMsSid}/PhoneNumbers/${numSid}`, {
               method: 'DELETE',
               headers: { Authorization: auth }
           });
           console.log("Delete status:", rDel.status);
        }

        console.log(`\n=== Adding to New XSCRM Service (${newMsSid}) ===`);
        const poolParams = new URLSearchParams({ PhoneNumberSid: numSid });
        const rAdd = await fetch(`https://messaging.twilio.com/v1/Services/${newMsSid}/PhoneNumbers`, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: poolParams.toString()
        });
        
        const addRes = await rAdd.json();
        console.log("Add status:", rAdd.status, addRes.sid ? "SUCCESS - " + addRes.sid : addRes);

        // Also update the webhook for WhatsApp senders (this is separate from SMS senders sometimes in Twilio)
        // If it's a dedicated WhatsApp sender, we might need to configure the WhatsApp sandbox/sender webhook directly
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
main();
