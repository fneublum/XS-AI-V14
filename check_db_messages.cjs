const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
    'https://qfskvevighylzzmyiwre.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2t2ZXZpZ2h5bHp6bXlpd3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODE2MzQsImV4cCI6MjA3OTY1NzYzNH0.MZ3S57O9J6LGHaN5zbuNmW8Gt7Hg5MaJSF-U-JhTa0Q'
);

async function main() {
    try {
        console.log("=== Fetching latest messages from the DB ===");

        const { data, error } = await sb
            .from('wa_messages')
            .select(`
                id,
                direction,
                content,
                status,
                created_at,
                wa_conversations (
                    customer_name,
                    customer_phone
                )
            `)
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) throw error;

        if (!data || data.length === 0) {
            console.log("No messages found currently in DB.");
        } else {
            data.forEach((msg, idx) => {
                const prefix = msg.direction === 'inbound' ? '📥 [INBOUND]' : '📤 [OUTBOUND]';
                const name = msg.wa_conversations ? msg.wa_conversations.customer_name : "Unknown";
                const phone = msg.wa_conversations ? msg.wa_conversations.customer_phone : "Unknown";
                console.log(`${idx + 1}. ${prefix} from ${name} (${phone}) at ${msg.created_at} - Status: ${msg.status}`);
                console.log(`   Content: ${msg.content}`);
                console.log('--------------------------------------------------');
            });
        }
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}
main();
