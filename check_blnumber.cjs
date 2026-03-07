const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qfskvevighylzzmyiwre.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmc2t2ZXZpZ2h5bHp6bXlpd3JlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODE2MzQsImV4cCI6MjA3OTY1NzYzNH0.MZ3S57O9J6LGHaN5zbuNmW8Gt7Hg5MaJSF-U-JhTa0Q';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function check() {
    // 1. Fetch recent packing lists and check their blNumber field
    console.log('=== Checking packing_lists blNumber field ===');
    const { data: pls, error } = await client
        .from('packing_lists')
        .select('id, plNumber, blNumber, createdAt')
        .order('createdAt', { ascending: false })
        .limit(10);

    if (error) {
        console.error('Error fetching PLs:', error);
        return;
    }

    console.log('Recent PLs:');
    pls.forEach(pl => {
        console.log(`  ${pl.plNumber} | blNumber: "${pl.blNumber}" | id: ${pl.id}`);
    });

    // 2. Try to update a PL's blNumber manually
    if (pls.length > 0) {
        const testPl = pls[0];
        console.log(`\n=== Testing update on ${testPl.plNumber} (${testPl.id}) ===`);
        console.log(`Current blNumber: "${testPl.blNumber}"`);

        const testValue = 'TEST_BL_' + Date.now();
        const { data: updated, error: updateErr } = await client
            .from('packing_lists')
            .update({ blNumber: testValue })
            .eq('id', testPl.id)
            .select('id, plNumber, blNumber')
            .single();

        if (updateErr) {
            console.error('Update error:', updateErr);
        } else {
            console.log('Update result:', updated);
        }

        // 3. Fetch it back to verify
        const { data: verified } = await client
            .from('packing_lists')
            .select('id, plNumber, blNumber')
            .eq('id', testPl.id)
            .single();

        console.log('Verified after update:', verified);

        // 4. Restore original value
        await client
            .from('packing_lists')
            .update({ blNumber: testPl.blNumber })
            .eq('id', testPl.id);
        console.log('Restored original value');
    }
}

check().catch(console.error);
