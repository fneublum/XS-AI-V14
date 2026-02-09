
// Helper to fetch data in chunks to avoid timeouts
const fetchTableData = async (client: any, table: string): Promise<any[]> => {
    let allData: any[] = [];
    const CHUNK_SIZE = 1000; // Increased chunk size slightly but keeping it safe
    let start = 0;
    let hasMore = true;
    const MAX_ROWS = 50000; // Safety cap

    while (hasMore && start < MAX_ROWS) {
        const end = start + CHUNK_SIZE - 1;
        const { data, error } = await client
            .from(table)
            .select('*')
            .range(start, end);

        if (error) {
            throw error;
        }

        if (data && data.length > 0) {
            allData = [...allData, ...data];
            // If we got less than requested, we are done
            if (data.length < CHUNK_SIZE) {
                hasMore = false;
            } else {
                start += CHUNK_SIZE;
                // Tiny delay between chunks of the SAME table to be nice to DB
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } else {
            hasMore = false;
        }
    }
    return allData;
};
