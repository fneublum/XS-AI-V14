
import JSZip from 'jszip';
import { getSupabaseClient } from './supabase';

const TABLES = [
    'users',
    'companies',
    'customers',
    'suppliers',
    'cargo_agents',
    'carriers',
    'products',
    'ports',
    'saved_locations',
    'opportunities',
    'cost_calculations',
    'supplier_quotes',
    'supplier_offers',
    'purchase_orders',
    'freight_quotes',
    'inventory',
    'inventory_logs',
    'shipments',
    'bill_landings',
    'bookings',
    'estimates',
    'proforma_invoices',
    'invoices',
    'invoices_suppliers',
    'packing_lists',
    'purchase_order_extracts',
    'imagens',
    'commission_sales_orders'
];

export const LS_AUTO_BACKUP = 'xs_crm_auto_backup';
export const LS_LAST_BACKUP = 'xs_crm_last_backup';

// Helper to fetch data in chunks to avoid timeouts
const fetchTableData = async (client: any, table: string): Promise<any[]> => {
    let allData: any[] = [];
    const CHUNK_SIZE = 1000;
    let start = 0;
    let hasMore = true;
    const MAX_ROWS = 50000; // Safety cap

    while (hasMore && start < MAX_ROWS) {
        const end = start + CHUNK_SIZE - 1;

        // Select logic: For commission_sales_orders, exclude heavy columns if possible?
        // Actually for BACKUP we likely WANT the full data, but we must chunk it carefully.
        // If 1000 rows causes timeout due to base64, we might need smaller chunks.
        // Let's stick to 1000 for now as it's sequential. If it fails, we can lower CHUNK_SIZE.

        const { data, error } = await client
            .from(table)
            .select('*')
            .range(start, end);

        if (error) {
            throw error;
        }

        if (data && data.length > 0) {
            allData = [...allData, ...data];
            if (data.length < CHUNK_SIZE) {
                hasMore = false;
            } else {
                start += CHUNK_SIZE;
                // Tiny delay between chunks
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } else {
            hasMore = false;
        }
    }
    return allData;
};

export const backupAllData = async (): Promise<{ success: boolean; message: string }> => {
    const client = getSupabaseClient();
    if (!client) {
        return { success: false, message: "Supabase client not initialized." };
    }

    try {
        const zip = new JSZip();
        const dateStr = new Date().toISOString().replace(/[:.]/g, '-');
        const folder = zip.folder(`backup-${dateStr}`);

        // Fetch all tables sequentially with pagination to avoid network/DB saturation/timeouts
        for (const table of TABLES) {
            try {
                const data = await fetchTableData(client, table);
                if (data && data.length > 0) {
                    folder?.file(`${table}.json`, JSON.stringify(data, null, 2));
                }
            } catch (error: any) {
                console.error(`Error fetching table ${table}:`, error);
                folder?.file(`${table}_error.txt`, JSON.stringify(error, null, 2));
            }

            // Small delay to allow connection pool to recover between heavy fetches
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Generate Zip
        const content = await zip.generateAsync({ type: "blob" });

        // Trigger Download
        const url = window.URL.createObjectURL(content);
        const a = document.createElement("a");
        a.href = url;
        a.download = `XS_CRM_BACKUP_${dateStr}.zip`;
        document.body.appendChild(a);
        a.click();

        // Cleanup
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        return { success: true, message: "Backup downloaded successfully." };

    } catch (error: any) {
        console.error("Backup failed:", error);
        return { success: false, message: `Backup failed: ${error.message}` };
    }
};

export const checkAndTriggerAutoBackup = async () => {
    try {
        const isEnabled = localStorage.getItem(LS_AUTO_BACKUP) === 'true';
        if (!isEnabled) return;

        const lastRun = localStorage.getItem(LS_LAST_BACKUP);
        const now = Date.now();
        const oneHour = 3600000; // 1 hour in ms

        // If never run, or last run was > 1 hour ago
        if (!lastRun || (now - parseInt(lastRun) > oneHour)) {
            console.info(" initiating Automated Backup...");

            // Set timestamp BEFORE running to prevent double-triggering if it takes time
            localStorage.setItem(LS_LAST_BACKUP, now.toString());

            const result = await backupAllData();
            if (!result.success) {
                console.error("Auto-Backup Failed", result.message);
            } else {
                console.info("Auto-Backup Completed Successfully");
            }
        }
    } catch (e) {
        console.error("Auto-Backup Logic Error", e);
    }
};
