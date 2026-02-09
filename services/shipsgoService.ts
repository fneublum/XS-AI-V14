// ShipsGo Container Tracking API Service
// API Docs: https://shipsgo.com/en/grow-with-shipsgo/api-documentation
// Free: 3 credits on signup, 1 credit per new shipment (unlimited calls per shipment after)

const SHIPSGO_BASE_URL = 'https://shipsgo.com';

// Map carrier prefixes to ShipsGo shipping line names
const CARRIER_TO_SHIPSGO: Record<string, string> = {
    'ZIMU': 'ZIM LINE', 'ZISU': 'ZIM LINE',
    'MAEU': 'MAERSK LINE', 'MRKU': 'MAERSK LINE', 'MSKU': 'MAERSK LINE',
    'MSCU': 'MSC', 'MEDU': 'MSC',
    'CMDU': 'CMA CGM', 'CGMU': 'CMA CGM',
    'HLCU': 'HAPAG LLOYD', 'HLXU': 'HAPAG LLOYD',
    'COSU': 'COSCO', 'CCLU': 'COSCO',
    'EGLV': 'EVERGREEN', 'EGHU': 'EVERGREEN',
    'ONEY': 'ONE LINE', 'ONEU': 'ONE LINE',
    'HDMU': 'HYUNDAI MM', 'HMMU': 'HYUNDAI MM',
    'YMLU': 'YANG MING',
    'OOLU': 'OOCL',
    'SUDU': 'HAMBURG SUD',
};

export interface ShipsGoTrackingResult {
    requestId?: string;
    eta: string | null;
    etd: string | null;
    vesselName: string | null;
    status: string | null;
    source: string;
    lastPort: string | null;
    departurePort: string | null;
    arrivalPort: string | null;
    shippingLine: string | null;
    error: string | null;
    rawData?: any;
}

function detectShippingLine(identifier: string): string {
    const prefix = identifier.substring(0, 4).toUpperCase();
    return CARRIER_TO_SHIPSGO[prefix] || 'OTHERS';
}

function getAuthCode(): string {
    return (process.env as any).SHIPSGO_API_KEY || '';
}

// Step 1: Create a tracking request (POST)
export async function shipsgoTrackByContainer(containerNumber: string, shippingLine?: string): Promise<ShipsGoTrackingResult> {
    const authCode = getAuthCode();
    if (!authCode) {
        return { eta: null, etd: null, vesselName: null, status: null, source: 'ShipsGo', lastPort: null, departurePort: null, arrivalPort: null, shippingLine: null, error: 'ShipsGo API key not configured. Set SHIPSGO_API_KEY in environment.' };
    }

    const line = shippingLine || detectShippingLine(containerNumber);
    console.log(`[ShipsGo] Tracking container: ${containerNumber}, shipping line: ${line}`);

    try {
        // POST to create tracking request
        const postUrl = `${SHIPSGO_BASE_URL}/api/ContainerService/PostCustomContainerForm/?authCode=${encodeURIComponent(authCode)}&containerNumber=${encodeURIComponent(containerNumber)}&shippingLine=${encodeURIComponent(line)}`;

        const postResponse = await fetch(postUrl, { method: 'POST' });
        const postData = await postResponse.json();
        console.log('[ShipsGo] POST response:', postData);

        if (postData.errorCode || postData.ErrorCode) {
            return { eta: null, etd: null, vesselName: null, status: null, source: 'ShipsGo', lastPort: null, departurePort: null, arrivalPort: null, shippingLine: line, error: `ShipsGo error: ${postData.errorMessage || postData.ErrorMessage || JSON.stringify(postData)}` };
        }

        // GET the tracking data (may need to wait a moment for processing)
        const requestId = postData.RequestId || postData.requestId || containerNumber;
        return await shipsgoGetTracking(requestId, containerNumber);

    } catch (error: any) {
        console.error('[ShipsGo] Error:', error);
        return { eta: null, etd: null, vesselName: null, status: null, source: 'ShipsGo', lastPort: null, departurePort: null, arrivalPort: null, shippingLine: line, error: error.message || 'ShipsGo API call failed' };
    }
}

// Step 1b: Create a tracking request by B/L (POST)
export async function shipsgoTrackByBL(blNumber: string, shippingLine?: string): Promise<ShipsGoTrackingResult> {
    const authCode = getAuthCode();
    if (!authCode) {
        return { eta: null, etd: null, vesselName: null, status: null, source: 'ShipsGo', lastPort: null, departurePort: null, arrivalPort: null, shippingLine: null, error: 'ShipsGo API key not configured. Set SHIPSGO_API_KEY in environment.' };
    }

    const line = shippingLine || detectShippingLine(blNumber);
    console.log(`[ShipsGo] Tracking BL: ${blNumber}, shipping line: ${line}`);

    try {
        const postUrl = `${SHIPSGO_BASE_URL}/api/ContainerService/PostContainerInfoWithBl/?authCode=${encodeURIComponent(authCode)}&blContainersRef=${encodeURIComponent(blNumber)}&shippingLine=${encodeURIComponent(line)}`;

        const postResponse = await fetch(postUrl, { method: 'POST' });
        const postData = await postResponse.json();
        console.log('[ShipsGo] POST BL response:', postData);

        if (postData.errorCode || postData.ErrorCode) {
            return { eta: null, etd: null, vesselName: null, status: null, source: 'ShipsGo', lastPort: null, departurePort: null, arrivalPort: null, shippingLine: line, error: `ShipsGo error: ${postData.errorMessage || postData.ErrorMessage || JSON.stringify(postData)}` };
        }

        const requestId = postData.RequestId || postData.requestId || blNumber;
        return await shipsgoGetTracking(requestId, blNumber);

    } catch (error: any) {
        console.error('[ShipsGo] Error:', error);
        return { eta: null, etd: null, vesselName: null, status: null, source: 'ShipsGo', lastPort: null, departurePort: null, arrivalPort: null, shippingLine: line, error: error.message || 'ShipsGo API call failed' };
    }
}

// Step 2: Get tracking data (GET)
async function shipsgoGetTracking(requestId: string, identifier: string): Promise<ShipsGoTrackingResult> {
    const authCode = getAuthCode();

    try {
        // Try with extended data for loading/discharge dates
        const getUrl = `${SHIPSGO_BASE_URL}/api/ContainerService/GetContainerInfo/?authCode=${encodeURIComponent(authCode)}&requestId=${encodeURIComponent(requestId)}&extended=true`;

        const getResponse = await fetch(getUrl);
        const getData = await getResponse.json();
        console.log('[ShipsGo] GET response:', getData);

        if (getData.errorCode || getData.ErrorCode) {
            // If data not ready yet, it might need a short delay
            if (getData.Message?.includes('processing') || getData.errorMessage?.includes('processing')) {
                return { eta: null, etd: null, vesselName: null, status: 'Processing - check again in a few seconds', source: 'ShipsGo', lastPort: null, departurePort: null, arrivalPort: null, shippingLine: null, error: 'Tracking request submitted. Data may take a few seconds to process. Try again shortly.' };
            }
            return { eta: null, etd: null, vesselName: null, status: null, source: 'ShipsGo', lastPort: null, departurePort: null, arrivalPort: null, shippingLine: null, error: `ShipsGo: ${getData.errorMessage || getData.ErrorMessage || getData.Message || JSON.stringify(getData)}` };
        }

        // Parse the response - ShipsGo returns an array of container tracking data
        const containers = Array.isArray(getData) ? getData : [getData];
        if (containers.length === 0) {
            return { eta: null, etd: null, vesselName: null, status: null, source: 'ShipsGo', lastPort: null, departurePort: null, arrivalPort: null, shippingLine: null, error: 'No tracking data returned' };
        }

        const tracking = containers[0];

        // Extract ETA and ETD from various possible fields
        const eta = tracking.EstimatedTimeOfArrival || tracking.estimatedTimeOfArrival || tracking.ETA || tracking.eta || null;
        const etd = tracking.EstimatedTimeOfDeparture || tracking.estimatedTimeOfDeparture || tracking.ETD || tracking.etd || tracking.DepartureDate || null;
        const vesselName = tracking.VesselName || tracking.vesselName || tracking.Vessel || null;
        const status = tracking.TransportStatus || tracking.transportStatus || tracking.Status || tracking.status || null;
        const lastPort = tracking.LastPort || tracking.lastPort || tracking.CurrentPort || null;
        const departurePort = tracking.DeparturePort || tracking.departurePort || tracking.PortOfLoading || null;
        const arrivalPort = tracking.ArrivalPort || tracking.arrivalPort || tracking.PortOfDischarge || null;
        const shippingLine = tracking.ShippingLine || tracking.shippingLine || null;

        return {
            requestId,
            eta: eta ? formatShipsGoDate(eta) : null,
            etd: etd ? formatShipsGoDate(etd) : null,
            vesselName,
            status,
            source: 'ShipsGo',
            lastPort,
            departurePort,
            arrivalPort,
            shippingLine,
            error: null,
            rawData: tracking,
        };
    } catch (error: any) {
        console.error('[ShipsGo] GET Error:', error);
        return { eta: null, etd: null, vesselName: null, status: null, source: 'ShipsGo', lastPort: null, departurePort: null, arrivalPort: null, shippingLine: null, error: error.message || 'Failed to get tracking data' };
    }
}

// Format ShipsGo date strings to MM/DD/YYYY
function formatShipsGoDate(dateStr: string): string {
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr; // Return as-is if parse fails
        return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}/${d.getFullYear()}`;
    } catch {
        return dateStr;
    }
}

// High-level function: try container number first, then BL
export async function shipsgoLookupETA(params: {
    containerNumbers?: string[];
    blNumber?: string;
    shippingLine?: string;
}): Promise<ShipsGoTrackingResult> {
    // Try container numbers first (more reliable)
    if (params.containerNumbers?.length) {
        for (const cn of params.containerNumbers) {
            console.log(`[ShipsGo] Trying container: ${cn}`);
            const result = await shipsgoTrackByContainer(cn, params.shippingLine);
            if (!result.error) return result;
            console.log(`[ShipsGo] Container ${cn} failed:`, result.error);
        }
    }

    // Fall back to BL number
    if (params.blNumber) {
        console.log(`[ShipsGo] Trying BL: ${params.blNumber}`);
        return await shipsgoTrackByBL(params.blNumber, params.shippingLine);
    }

    return { eta: null, etd: null, vesselName: null, status: null, source: 'ShipsGo', lastPort: null, departurePort: null, arrivalPort: null, shippingLine: null, error: 'No container number or BL number provided' };
}
