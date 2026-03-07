const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
    'https://qfskvevighylzzmyiwre.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2t2ZXZpZ2h5bHp6bXlpd3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODE2MzQsImV4cCI6MjA3OTY1NzYzNH0.MZ3S57O9J6LGHaN5zbuNmW8Gt7Hg5MaJSF-U-JhTa0Q'
);

async function main() {
    try {
        const { data, error: fetchErr } = await sb.from('system_settings').select('value').eq('key', 'twilio_credentials').single();
        if (fetchErr) throw fetchErr;

        const creds = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        creds.phoneNumber = '+19302057070'; // Update the phone number

        console.log("Saving new Twilio credentials to database...");
        const { error: upsertErr } = await sb.from('system_settings').upsert({
            key: 'twilio_credentials',
            value: creds,
            updated_at: new Date().toISOString()
        }, { onConflict: 'key' });

        if (upsertErr) throw upsertErr;
        console.log("✅ Successfully updated database system_settings to use +19302057070");
    } catch (e) {
        console.error("Error:", e);
    }
}
main();
