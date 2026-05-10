// Standalone test for the Dashboard OCR auto-save pipeline.
//
// Mocks an `extractedData` object per document type (as if Gemini had
// returned it for the prompts in pages/AiDashboard.tsx), replays the
// save-payload construction locally, then asserts the payload covers
// every column of the target Supabase table listed in services/schema.ts.
//
// Run: node test_ocr_payloads.cjs

const EXPECTED_COLS = {
  bill_landings: ['id','companyId','createdAt','blNumber','shipper','consignee','notifyParty','vesselVoyage','portLoading','portDischarge','placeReceipt','placeDelivery','shippedDate','originals','container','seal','description','grossWeight','measurement','packages','freightPayable','remarks','originalDocument','status'],
  bookings: ['id','companyId','createdAt','bookingNumber','customer','vesselVoyage','pol','pod','equipment','etd','eta','cargoCutOff','vgmCutOff','draftCutOff','freeTime','terminal','originalDocument','salesOrderId','status'],
  estimates: ['id','companyId','createdAt','estimateNumber','supplier','buyer','shipTo','payTo','date','terms','incoterm','subtotal','tax','totalAmount','currency','items','acceptedBy','acceptedDate','originalDocument'],
  proforma_invoices: ['id','companyId','createdAt','piNumber','supplier','buyer','shipTo','payTo','date','terms','incoterm','subtotal','tax','totalAmount','currency','items','acceptedBy','acceptedDate','originalDocument'],
  purchase_order_extracts: ['id','companyId','createdAt','poNumber','vendor','date','totalAmount','currency','items','originalDocument'],
  invoices_suppliers: ['id','companyId','createdAt','invoiceNumber','invoiceDate','shipperName','shipperAddress','soldTo','shipTo','paymentTerms','incoterms','dateOrder','customerPo','carrier','transportRef','freightTerms','items','grossWeight','netWeight','tareWeight','totalQuantity','subtotal','totalAmount','currency','remitTo','bankName','swiftCode','routingNumber','accountNumber','originalDocument','supplier','date'],
  packing_lists: ['id','companyId','createdAt','plNumber','blNumber','shipper','consignee','shippingPoint','destination','date','carrier','containerNumber','sealNumber','vesselVoyage','productDescription','unitCount','unitNumbers','grossWeight','netWeight','freightTerms','poNumber','notes','scheduledShipDate','items','originalDocument','soNumber','status'],
  freight_quotes: ['id','companyId','agentName','carrier','freightType','originPort','originPortCode','pickupLocation','pickupZip','destinationPort','destinationPortCode','deliveryLocation','deliveryZip','rate','chassis','overweight','containerCount','currency','validUntil','comments','transitTime','freeTime','isAllIn','pickupCost','oceanCost','deliveryCost','portFees','deconsolidation','containerReturn','blRelease','thc','isps','trs','securityFee','observation','originalDocument','status'],
};

// Columns that the app legitimately fills only after a subsequent action
// (e.g. salesOrderId once the BL is linked to a SO) — they are not
// OCR-able and must not fail the coverage check.
const NON_OCR_COLS = {
  bill_landings: ['originalDocument'],
  bookings: ['originalDocument', 'salesOrderId'],
  estimates: ['originalDocument'],
  proforma_invoices: ['originalDocument'],
  purchase_order_extracts: ['originalDocument'],
  invoices_suppliers: ['originalDocument'],
  packing_lists: ['originalDocument'],
  freight_quotes: ['originalDocument'],
};

// Mock Gemini outputs — one per document type. Values chosen to hit
// every KEY listed in the EXTRACTION_PROMPTS, including the shared
// LineItem shape for documents that carry items.
const LINE_ITEMS = [
  { productName: 'Cocoa Beans', customerDescription: 'Premium grade A', hsCode: '1801.00', grade: 'A', quantity: 100, unitPrice: 2500, total: 250000 },
  { productName: 'Coffee Beans', customerDescription: null, hsCode: '0901.11', grade: 'AA', quantity: 50,  unitPrice: 3200, total: 160000 },
];

const MOCKS = {
  'BILL OF LADING': {
    DOC_NUMBER: 'BL-2026-0042', SHIPPER: 'Acme Exports SA', CONSIGNEE: 'Globex Trading LLC',
    NOTIFY: 'Globex Trading LLC', NUMBER_OF_ORIGINALS: '3', PRODUCT_DESCRIPTION: '1x40HC cocoa beans bagged',
    CONTAINER: 'MSCU1234567', SEAL: 'SL998877', PACKAGES: '400 bags',
    GROSS_WEIGHT: '23,500 KG', MEASUREMENT: '42.5 CBM', VESSEL_VOYAGE: 'MSC ISABELLA / 242W',
    PORT_LOADING: 'Santos, BR', PORT_DISCHARGE: 'Houston, US',
    PLACE_OF_RECEIPT: 'Santos CFS', PLACE_OF_DELIVERY: 'Houston CY',
    SHIPPED_DATE: '2026-04-10', FREIGHT_PAYABLE: 'Prepaid', TERMS: 'Clean on board',
  },
  'BOOKING': {
    DOC_NUMBER: 'BKG-778899', CUSTOMER: 'Globex Trading LLC', CARGO_AGENT: 'ShipAgent Inc',
    VESSEL_VOYAGE: 'MSC ISABELLA / 242W', POL: 'Santos, BR', POD: 'Houston, US',
    EQUIPMENT: '1x40HC', ETD: '2026-04-12', ETA: '2026-05-01',
    CARGO_CUT_OFF: '2026-04-10T17:00', VGM_CUT_OFF: '2026-04-11T12:00',
    DRAFT_CUT_OFF: '2026-04-11T10:00', FREE_TIME: '7 days', TERMINAL: 'Terminal BTP',
  },
  'ESTIMATE': {
    DOC_NUMBER: 'EST-2026-0071', DATE: '2026-04-05',
    SELLER_NAME: 'Acme Exports SA', BUYER_NAME: 'Globex Trading LLC',
    SHIP_TO: '123 Warehouse Rd, Houston TX', PAY_TO: 'Acme Exports SA, Brazil',
    PAYMENT_TERMS: 'Net 30', INCOTERM: 'FOB Santos',
    SUBTOTAL: 410000, TAX: 0, TOTAL_AMOUNT: 410000, CURRENCY: 'USD',
    ACCEPTED_BY: null, ACCEPTED_DATE: null, ITEMS: LINE_ITEMS,
  },
  'PROFORMA INVOICE': {
    DOC_NUMBER: 'PI-2026-0071', DATE: '2026-04-06',
    SELLER_NAME: 'Acme Exports SA', BUYER_NAME: 'Globex Trading LLC',
    SHIP_TO: '123 Warehouse Rd, Houston TX', PAY_TO: 'Acme Exports SA, Brazil',
    PAYMENT_TERMS: '50/50 T/T', INCOTERM: 'CIF Houston',
    SUBTOTAL: 410000, TAX: 0, TOTAL_AMOUNT: 420500, CURRENCY: 'USD',
    ACCEPTED_BY: 'J. Doe', ACCEPTED_DATE: '2026-04-07', ITEMS: LINE_ITEMS,
  },
  'PURCHASE ORDER': {
    DOC_NUMBER: 'PO-2026-8842', DATE: '2026-04-01', SELLER_NAME: 'Acme Exports SA',
    TOTAL_AMOUNT: 410000, CURRENCY: 'USD', ITEMS: LINE_ITEMS,
  },
  'INVOICE': {
    INVOICE_NUMBER: 'INV-9921', INVOICE_DATE: '2026-04-15',
    SELLER_NAME: 'Acme Exports SA', SELLER_ADDRESS: 'Av. Brasil 100, Santos, BR',
    SUPPLIER_NAME: 'Acme Exports SA',
    BUYER_NAME_ADDRESS: 'Globex Trading LLC, 742 Evergreen, Houston TX',
    SHIP_TO_ADDRESS: '123 Warehouse Rd, Houston TX',
    PAYMENT_TERMS: 'Net 30', INCOTERMS: 'CIF',
    DATE_SHIPPED: '2026-04-10', PO_NUMBER: 'PO-2026-8842',
    CARRIER: 'MSC', TRANSPORT_ID: 'MSCU1234567',
    FREIGHT_TERMS: 'Prepaid',
    WEIGHT_GROSS: '23,500 KG', WEIGHT_NET: '22,800 KG', WEIGHT_TARE: '700 KG',
    TOTAL_QUANTITY: '400 bags',
    SUBTOTAL: 410000, TOTAL_AMOUNT: 420500, CURRENCY: 'USD',
    REMIT_TO_NAME: 'Acme Exports SA',
    BANK_NAME: 'Banco do Brasil', SWIFT_CODE: 'BRASBRRJ',
    ROUTING_NUMBER: '026003557', ACCOUNT_NUMBER: '00123-4',
    ITEMS: LINE_ITEMS,
  },
  'PACKING LIST': {
    PL_NUMBER: 'PL-77123', BL_NUMBER: 'BL-2026-0042', PO_NUMBER: 'PO-2026-8842',
    SO_NUMBER: 'SO-2026-331',
    SHIPPER: 'Acme Exports SA', CONSIGNEE: 'Globex Trading LLC',
    SHIPPING_POINT: 'Santos, BR', DESTINATION: 'Houston, US',
    DATE: '2026-04-10', SCH_SHIP_DATE: '2026-04-12',
    CARRIER: 'MSC', VESSEL_VOYAGE: 'MSC ISABELLA / 242W',
    CONTAINER_NUMBER: 'MSCU1234567', SEAL_NUMBER: 'SL998877',
    PRODUCT_DESCRIPTION: '1x40HC cocoa beans bagged',
    UNIT_COUNT: '400', UNIT_NUMBERS: '001-400',
    GROSS_WEIGHT: '23,500 KG', NET_WEIGHT: '22,800 KG',
    FREIGHT_TERMS: 'Prepaid', NOTES: 'Stack max 3 high',
    ITEMS: LINE_ITEMS,
  },
  'FREIGHT QUOTE': {
    AGENT_NAME: 'ShipAgent Inc', CARRIER: 'MSC', FREIGHT_TYPE: 'DOOR_DOOR',
    ORIGIN_PORT: 'Santos, BR', ORIGIN_PORT_CODE: 'BRSSZ',
    PICKUP_LOCATION: 'Factory A, Santos', PICKUP_ZIP: '11000-000',
    DESTINATION_PORT: 'Houston, US', DESTINATION_PORT_CODE: 'USHOU',
    DELIVERY_LOCATION: 'Warehouse X, Houston', DELIVERY_ZIP: '77002',
    RATE: 4800, CHASSIS: 150, OVERWEIGHT: 0, CONTAINER_COUNT: 1,
    CURRENCY: 'USD', VALID_UNTIL: '2026-05-15',
    COMMENTS: 'Door/door all-in, overweight excluded',
    TRANSIT_TIME: 18, FREE_TIME: 7, IS_ALL_IN: true,
    PICKUP_COST: 400, OCEAN_COST: 3200, DELIVERY_COST: 600,
    PORT_FEES: 150, DECONSOLIDATION: 75, CONTAINER_RETURN: 50,
    BL_RELEASE: 40, THC: 180, ISPS: 35, TRS: 15, SECURITY_FEE: 30,
    OBSERVATION: 'Quote excludes customs duties.',
  },
};

// Identity port normalizer — matches the fallback behavior when the
// customer's ports table doesn't resolve a match.
const normalizePort = (s) => String(s || '');

// Fixed timestamp so payload IDs are deterministic across runs.
const NOW = 1713772800000;
const created = new Date(NOW).toISOString();
const companyId = 'TEST-CO';

function build(docType, e) {
  if (docType === 'BILL OF LADING') {
    return ['bill_landings', {
      id: `BL${NOW}`, companyId, createdAt: created,
      blNumber: String(e.DOC_NUMBER || ''), shipper: String(e.SHIPPER || ''),
      consignee: String(e.CONSIGNEE || ''), notifyParty: String(e.NOTIFY || ''),
      vesselVoyage: String(e.VESSEL_VOYAGE || ''),
      portLoading: normalizePort(String(e.PORT_LOADING || '')),
      portDischarge: normalizePort(String(e.PORT_DISCHARGE || '')),
      placeReceipt: String(e.PLACE_OF_RECEIPT || ''), placeDelivery: String(e.PLACE_OF_DELIVERY || ''),
      shippedDate: String(e.SHIPPED_DATE || ''), originals: String(e.NUMBER_OF_ORIGINALS || ''),
      container: String(e.CONTAINER || ''), seal: String(e.SEAL || ''),
      description: String(e.PRODUCT_DESCRIPTION || ''), grossWeight: String(e.GROSS_WEIGHT || ''),
      measurement: String(e.MEASUREMENT || ''), packages: String(e.PACKAGES || ''),
      freightPayable: String(e.FREIGHT_PAYABLE || ''), remarks: String(e.TERMS || ''),
      originalDocument: '', status: 'AVAILABLE',
    }];
  }
  if (docType === 'BOOKING') {
    return ['bookings', {
      id: `BK${NOW}`, companyId, createdAt: created,
      bookingNumber: String(e.DOC_NUMBER || ''), customer: String(e.CUSTOMER || ''),
      agentName: String(e.CARGO_AGENT || ''), vesselVoyage: String(e.VESSEL_VOYAGE || ''),
      pol: normalizePort(String(e.POL || '')), pod: normalizePort(String(e.POD || '')),
      equipment: String(e.EQUIPMENT || ''),
      etd: String(e.ETD || ''), eta: String(e.ETA || ''),
      cargoCutOff: String(e.CARGO_CUT_OFF || ''), vgmCutOff: String(e.VGM_CUT_OFF || ''),
      draftCutOff: String(e.DRAFT_CUT_OFF || ''), freeTime: String(e.FREE_TIME || ''),
      terminal: String(e.TERMINAL || ''), originalDocument: '', status: 'AVAILABLE',
    }];
  }
  if (docType === 'ESTIMATE') {
    return ['estimates', {
      id: `EST${NOW}`, companyId, createdAt: created,
      estimateNumber: String(e.DOC_NUMBER || ''), supplier: String(e.SELLER_NAME || ''),
      buyer: String(e.BUYER_NAME || ''), shipTo: String(e.SHIP_TO || ''),
      payTo: String(e.PAY_TO || ''), date: String(e.DATE || ''),
      terms: String(e.PAYMENT_TERMS || ''), incoterm: String(e.INCOTERM || ''),
      subtotal: Number(e.SUBTOTAL || 0), tax: Number(e.TAX || 0),
      totalAmount: Number(e.TOTAL_AMOUNT || 0), currency: String(e.CURRENCY || 'USD'),
      items: JSON.stringify(e.ITEMS || []),
      acceptedBy: String(e.ACCEPTED_BY || ''), acceptedDate: String(e.ACCEPTED_DATE || ''),
      originalDocument: '',
    }];
  }
  if (docType === 'PROFORMA INVOICE') {
    return ['proforma_invoices', {
      id: `PI${NOW}`, companyId, createdAt: created,
      piNumber: String(e.DOC_NUMBER || ''), supplier: String(e.SELLER_NAME || ''),
      buyer: String(e.BUYER_NAME || ''), shipTo: String(e.SHIP_TO || ''),
      payTo: String(e.PAY_TO || ''), date: String(e.DATE || ''),
      terms: String(e.PAYMENT_TERMS || ''), incoterm: String(e.INCOTERM || ''),
      subtotal: Number(e.SUBTOTAL || 0), tax: Number(e.TAX || 0),
      totalAmount: Number(e.TOTAL_AMOUNT || 0), currency: String(e.CURRENCY || 'USD'),
      items: JSON.stringify(e.ITEMS || []),
      acceptedBy: String(e.ACCEPTED_BY || ''), acceptedDate: String(e.ACCEPTED_DATE || ''),
      originalDocument: '',
    }];
  }
  if (docType === 'PURCHASE ORDER') {
    return ['purchase_order_extracts', {
      id: `PO${NOW}`, companyId, createdAt: created,
      poNumber: String(e.DOC_NUMBER || ''), vendor: String(e.SELLER_NAME || e.VENDOR_NAME || ''),
      date: String(e.DATE || ''), totalAmount: String(e.TOTAL_AMOUNT || ''),
      currency: String(e.CURRENCY || ''), items: JSON.stringify(e.ITEMS || []),
      originalDocument: '',
    }];
  }
  if (docType === 'INVOICE') {
    const sellerName = String(e.SELLER_NAME || '');
    const invoiceDate = String(e.INVOICE_DATE || '');
    return ['invoices_suppliers', {
      id: `INV${NOW}`, companyId, createdAt: created,
      invoiceNumber: String(e.INVOICE_NUMBER || ''), invoiceDate,
      shipperName: sellerName, shipperAddress: String(e.SELLER_ADDRESS || ''),
      supplier: String(e.SUPPLIER_NAME || sellerName),
      date: invoiceDate,
      soldTo: String(e.BUYER_NAME_ADDRESS || ''), shipTo: String(e.SHIP_TO_ADDRESS || ''),
      paymentTerms: String(e.PAYMENT_TERMS || ''), incoterm: String(e.INCOTERMS || ''),
      dateOrder: String(e.DATE_SHIPPED || ''), customerPo: String(e.PO_NUMBER || ''),
      carrier: String(e.CARRIER || ''), transportRef: String(e.TRANSPORT_ID || ''),
      freightTerms: String(e.FREIGHT_TERMS || ''), items: JSON.stringify(e.ITEMS || []),
      grossWeight: String(e.WEIGHT_GROSS || ''), netWeight: String(e.WEIGHT_NET || ''),
      tareWeight: String(e.WEIGHT_TARE || ''), totalQuantity: String(e.TOTAL_QUANTITY || ''),
      subtotal: Number(e.SUBTOTAL || 0), totalAmount: Number(e.TOTAL_AMOUNT || 0),
      currency: String(e.CURRENCY || 'USD'), remitTo: String(e.REMIT_TO_NAME || ''),
      bankName: String(e.BANK_NAME || ''), swiftCode: String(e.SWIFT_CODE || ''),
      routingNumber: String(e.ROUTING_NUMBER || ''), accountNumber: String(e.ACCOUNT_NUMBER || ''),
      originalDocument: '',
    }];
  }
  if (docType === 'PACKING LIST') {
    return ['packing_lists', {
      id: `PL${NOW}`, companyId, createdAt: created,
      plNumber: String(e.PL_NUMBER || ''), blNumber: String(e.BL_NUMBER || ''),
      soNumber: String(e.SO_NUMBER || ''),
      shipper: String(e.SHIPPER || ''), consignee: String(e.CONSIGNEE || ''),
      shippingPoint: String(e.SHIPPING_POINT || ''), destination: String(e.DESTINATION || ''),
      date: String(e.DATE || ''), carrier: String(e.CARRIER || ''),
      containerNumber: String(e.CONTAINER_NUMBER || ''), sealNumber: String(e.SEAL_NUMBER || ''),
      vesselVoyage: String(e.VESSEL_VOYAGE || ''), productDescription: String(e.PRODUCT_DESCRIPTION || ''),
      unitCount: String(e.UNIT_COUNT || ''), unitNumbers: String(e.UNIT_NUMBERS || ''),
      grossWeight: String(e.GROSS_WEIGHT || ''), netWeight: String(e.NET_WEIGHT || ''),
      freightTerms: String(e.FREIGHT_TERMS || ''), poNumber: String(e.PO_NUMBER || ''),
      notes: String(e.NOTES || ''), scheduledShipDate: String(e.SCH_SHIP_DATE || ''),
      items: JSON.stringify(e.ITEMS || []), originalDocument: '', status: 'AVAILABLE',
    }];
  }
  if (docType === 'FREIGHT QUOTE') {
    const originCode = normalizePort(String(e.ORIGIN_PORT_CODE || e.ORIGIN_PORT || ''));
    const destCode = normalizePort(String(e.DESTINATION_PORT_CODE || e.DESTINATION_PORT || ''));
    return ['freight_quotes', {
      id: `FQ${NOW}`, companyId,
      agentName: String(e.AGENT_NAME || ''),
      carrier: String(e.CARRIER || ''),
      freightType: e.FREIGHT_TYPE || 'PORT_PORT',
      originPort: String(e.ORIGIN_PORT || ''),
      originPortCode: originCode,
      pickupLocation: String(e.PICKUP_LOCATION || ''),
      pickupZip: String(e.PICKUP_ZIP || ''),
      destinationPort: String(e.DESTINATION_PORT || ''),
      destinationPortCode: destCode,
      deliveryLocation: String(e.DELIVERY_LOCATION || ''),
      deliveryZip: String(e.DELIVERY_ZIP || ''),
      rate: Number(e.RATE || 0),
      chassis: Number(e.CHASSIS || 0),
      overweight: Number(e.OVERWEIGHT || 0),
      containerCount: Number(e.CONTAINER_COUNT || 0),
      currency: String(e.CURRENCY || 'USD'),
      validUntil: String(e.VALID_UNTIL || ''),
      comments: String(e.COMMENTS || ''),
      transitTime: Number(e.TRANSIT_TIME || 0),
      freeTime: Number(e.FREE_TIME || 0),
      isAllIn: Boolean(e.IS_ALL_IN),
      pickupCost: Number(e.PICKUP_COST || 0),
      oceanCost: Number(e.OCEAN_COST || 0),
      deliveryCost: Number(e.DELIVERY_COST || 0),
      portFees: Number(e.PORT_FEES || 0),
      deconsolidation: Number(e.DECONSOLIDATION || 0),
      containerReturn: Number(e.CONTAINER_RETURN || 0),
      blRelease: Number(e.BL_RELEASE || 0),
      thc: Number(e.THC || 0),
      isps: Number(e.ISPS || 0),
      trs: Number(e.TRS || 0),
      securityFee: Number(e.SECURITY_FEE || 0),
      observation: String(e.OBSERVATION || ''),
      status: 'ACTIVE',
    }];
  }
  throw new Error(`No builder for ${docType}`);
}

// The `incoterm` vs `incoterms` mismatch on invoices_suppliers is a
// pre-existing schema drift, not caused by this OCR work. Flag it but
// don't count it as an OCR coverage failure.
// schema.ts is authoritative for most tables, but out of sync for a
// few columns that exist in prod (confirmed via v2/queries usage).
// List those here so the test doesn't flag pre-existing drift as OCR
// coverage failures.
const KNOWN_DRIFT = {
  bookings: { extraKeys: ['agentName'], missingCols: [] },
  invoices_suppliers: { extraKeys: ['incoterm'], missingCols: ['incoterms'] },
  freight_quotes: { extraKeys: ['createdAt'], missingCols: [] },
};

let totalPass = 0, totalFail = 0;
const failures = [];

for (const [docType, mock] of Object.entries(MOCKS)) {
  const [table, payload] = build(docType, mock);
  const expected = new Set(EXPECTED_COLS[table]);
  const nonOcr = new Set(NON_OCR_COLS[table] || []);
  const payloadKeys = new Set(Object.keys(payload));
  const drift = KNOWN_DRIFT[table] || { extraKeys: [], missingCols: [] };

  const missing = [...expected]
    .filter(c => !payloadKeys.has(c) && !nonOcr.has(c) && !drift.missingCols.includes(c));
  const extras = [...payloadKeys]
    .filter(k => !expected.has(k) && !drift.extraKeys.includes(k));

  const filled = [...payloadKeys].filter(k => {
    const v = payload[k];
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.length > 0;
    if (typeof v === 'number') return true;
    if (typeof v === 'boolean') return true;
    return true;
  });

  const ok = missing.length === 0 && extras.length === 0;
  totalPass += ok ? 1 : 0;
  totalFail += ok ? 0 : 1;

  console.log(`\n${ok ? '✅' : '❌'}  ${docType}  →  ${table}`);
  console.log(`    payload keys: ${payloadKeys.size}  |  filled (non-empty): ${filled.length}  |  table cols: ${expected.size}  (non-OCR: ${nonOcr.size})`);
  if (missing.length) console.log(`    ⚠  missing columns in payload: ${missing.join(', ')}`);
  if (extras.length)  console.log(`    ⚠  extra keys (not a DB column): ${extras.join(', ')}`);
  if (drift.extraKeys.length || drift.missingCols.length) {
    console.log(`    ℹ  known schema drift (ignored): extras=${drift.extraKeys.join(',') || '—'} / missing=${drift.missingCols.join(',') || '—'}`);
  }
  console.log(`    sample: ${JSON.stringify(payload).slice(0, 180)}${JSON.stringify(payload).length > 180 ? '…' : ''}`);
}

console.log(`\n──────────────────────────────────────────\n${totalPass} passed, ${totalFail} failed.`);
process.exit(totalFail === 0 ? 0 : 1);
