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
        const url = `https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json?To=%2B19302007070&PageSize=5`;

        console.log("Listening for new SMS verification codes from Meta on +19302007070...");
        
        let checks = 0;
        let knownSids = new Set();
        
        // Loop for ~2 minutes, checking every 3 seconds
        while (checks < 40) {
            const r = await fetch(url, { headers: { Authorization: auth } });
            const j = await r.json();
            
            for (const m of (j.messages || [])) {
                if (m.direction === 'inbound') {
                    if (checks === 0) {
                        knownSids.add(m.sid);
                    } else if (!knownSids.has(m.sid)) {
                        console.log("\n\n============================");
                        console.log("   🚀 NEW SMS RECEIVED 🚀   ");
                        console.log("============================");
                        console.log(`Time: ${m.date_created}`);
                        console.log(`From: ${m.from}`);
                        console.log(`Body: ${m.body}`);
                        console.log("============================\n");
                        process.exit(0);
                    }
                }
            }
            await new Promise(res => setTimeout(res, 3000));
            checks++;
            process.stdout.write(".");
        }
        console.log("\nTimed out. No Meta SMS received after 2 minutes.");
    } catch(e) { console.error(e); }
    process.exit(0);
}
main();
