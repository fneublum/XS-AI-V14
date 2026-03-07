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
        const url = `https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Calls.json?To=%2B19302007070&PageSize=5`;

        console.log("Checking for incoming Voice Calls on +19302007070...");
        
        let checks = 0;
        let knownSids = new Set();
        
        while (checks < 15) {
            const r = await fetch(url, { headers: { Authorization: auth } });
            const j = await r.json();
            
            for (const m of (j.calls || [])) {
                if (m.direction === 'inbound') {
                    if (checks === 0) {
                        knownSids.add(m.sid);
                    } else if (!knownSids.has(m.sid)) {
                        console.log("\n\n============================");
                        console.log("   📞 NEW CALL RECEIVED 📞  ");
                        console.log("============================");
                        console.log(`Time: ${m.date_created}`);
                        console.log(`Status: ${m.status}`);
                        console.log(`From: ${m.from}`);
                        console.log("============================\n");
                        process.exit(0);
                    }
                }
            }
            await new Promise(res => setTimeout(res, 4000));
            checks++;
            process.stdout.write(".");
        }
        console.log("\nNo new calls observed.");
    } catch(e) { console.error(e); }
    process.exit(0);
}
main();
