import { getSupabaseClient } from './supabase';
import { AgentAction, AgentActionType } from './geminiService';

// --- Types ---

export interface AiConversation {
    id: string;
    userId: string;
    companyId: string;
    title: string;
    lastMessageAt: string;
    messageCount: number;
    createdAt: string;
}

export interface AiMessage {
    id: string;
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    actionType?: string;
    actionData?: any;
    createdAt: string;
}

export interface LearnedTask {
    id: string;
    userId: string;
    companyId: string;
    trigger: string;
    instruction: string;
    parameters: any;
    createdAt: string;
}

export interface CrudCallbacks {
    onAddCustomer?: (data: any) => Promise<any>;
    onUpdateCustomer?: (data: any) => Promise<any>;
    onAddSupplier?: (data: any) => Promise<any>;
    onUpdateSupplier?: (data: any) => Promise<any>;
    onAddProduct?: (data: any) => Promise<any>;
    onAddSalesOrder?: (data: any) => Promise<any>;
    onAddPurchaseOrder?: (data: any) => Promise<any>;
    onAddBooking?: (data: any) => Promise<any>;
    onAddCargoAgent?: (data: any) => Promise<any>;
    onAddFreightQuote?: (data: any) => Promise<any>;
    onDeleteCustomer?: (id: string) => Promise<any>;
    onDeleteSupplier?: (id: string) => Promise<any>;
    onDeleteProduct?: (id: string) => Promise<any>;
}

// --- Required Fields Registry ---

export const REQUIRED_FIELDS: Record<string, { field: string; label: string }[]> = {
    CREATE_CUSTOMER: [
        { field: 'customerName', label: 'Customer name' },
        { field: 'contactPerson', label: 'Contact person' },
        { field: 'email', label: 'Email' },
    ],
    CREATE_SUPPLIER: [
        { field: 'supplierName', label: 'Supplier name' },
    ],
    CREATE_SO: [
        { field: 'customerName', label: 'Customer name' },
        { field: 'productName', label: 'Product name' },
        { field: 'quantity', label: 'Quantity' },
        { field: 'price', label: 'Unit price' },
    ],
    CREATE_PO: [
        { field: 'supplierName', label: 'Supplier name' },
        { field: 'productName', label: 'Product name' },
        { field: 'quantity', label: 'Quantity' },
        { field: 'price', label: 'Unit price' },
    ],
    CREATE_FREIGHT_QUOTE: [
        { field: 'agentName', label: 'Cargo agent / carrier name' },
        { field: 'originPort', label: 'Origin port' },
        { field: 'destinationPort', label: 'Destination port' },
        { field: 'rate', label: 'Rate (USD)' },
    ],
    REQUEST_BOOKING: [
        { field: 'customerName', label: 'Customer name' },
        { field: 'pol', label: 'Port of Loading (POL)' },
        { field: 'pod', label: 'Port of Discharge (POD)' },
        { field: 'equipment', label: 'Equipment (e.g. 1x40HC)' },
    ],
    CREATE_CARGO_AGENT: [
        { field: 'agentName', label: 'Agent name' },
    ],
    CREATE_PRODUCT: [
        { field: 'productName', label: 'Product name' },
    ],
    DELETE_CUSTOMER: [
        { field: 'customerName', label: 'Customer name' },
    ],
    DELETE_SUPPLIER: [
        { field: 'supplierName', label: 'Supplier name' },
    ],
    DELETE_PRODUCT: [
        { field: 'productName', label: 'Product name' },
    ],
    DELETE_FREIGHT_QUOTE: [
        { field: 'agentName', label: 'Cargo agent name' },
    ],
};

// --- Entity Normalizer ---

export const normalizeEntities = (entities: any): any => {
    const e = { ...entities };
    // carrierName → agentName (Gemini uses carrierName, we use agentName)
    if (!e.agentName && e.carrierName) e.agentName = e.carrierName;
    if (!e.agentName && e.name) e.agentName = e.name;
    // freightCost / unitPrice → rate (for freight quotes)
    if (!e.rate && e.freightCost) e.rate = e.freightCost;
    if (!e.rate && e.unitPrice) e.rate = e.unitPrice;
    // unitPrice → price (for PO/SO)
    if (!e.price && e.unitPrice) e.price = e.unitPrice;
    // carrier → agentName fallback
    if (!e.agentName && e.carrier) e.agentName = e.carrier;
    // origin/destination → originPort/destinationPort
    if (!e.originPort && e.origin) e.originPort = e.origin;
    if (!e.destinationPort && e.destination) e.destinationPort = e.destination;
    // pol/pod fallbacks for bookings
    if (!e.pol && e.originPort) e.pol = e.originPort;
    if (!e.pod && e.destinationPort) e.pod = e.destinationPort;
    if (!e.pol && e.origin) e.pol = e.origin;
    if (!e.pod && e.destination) e.pod = e.destination;
    // name → customerName / supplierName based on presence
    if (!e.customerName && e.name && !e.supplierName) e.customerName = e.name;
    if (!e.supplierName && e.name && !e.customerName) e.supplierName = e.name;
    // contactPerson fallback — if Gemini puts it in 'name' when customerName already exists
    if (!e.contactPerson && e.contact) e.contactPerson = e.contact;
    return e;
};

// --- Validate Action ---

export const validateAction = (action: AgentAction): string[] => {
    const requiredList = REQUIRED_FIELDS[action.type];
    if (!requiredList) return []; // SHOW_*, CHAT, etc. have no requirements

    const missing: string[] = [];
    for (const { field, label } of requiredList) {
        const val = (action.entities as any)[field];
        if (val === undefined || val === null || val === '' || val === 0) {
            missing.push(label);
        }
    }
    return missing;
};

// --- Merge Entities ---

export const mergeEntities = (
    pending: AgentAction,
    newEntities: Record<string, any>
): AgentAction => {
    const merged = { ...pending.entities };
    for (const [key, val] of Object.entries(newEntities)) {
        if (val !== null && val !== undefined && val !== '') {
            (merged as any)[key] = val;
        }
    }
    return { ...pending, entities: merged };
};

// --- Entity Resolution ---

export const findByName = (name: string, dataArray: any[]): any | null => {
    if (!name || !dataArray?.length) return null;
    const lower = name.toLowerCase().trim();
    // Exact match first
    const exact = dataArray.find(d => d.name?.toLowerCase() === lower);
    if (exact) return exact;
    // Partial match
    return dataArray.find(d => d.name?.toLowerCase().includes(lower)) || null;
};

// --- Action Execution ---

export const executeAction = async (
    action: AgentAction,
    crud: CrudCallbacks,
    companyId: string,
    dataArrays: {
        customers?: any[];
        suppliers?: any[];
        products?: any[];
    }
): Promise<{ success: boolean; message: string }> => {
    try {
        const e = action.entities;

        switch (action.type) {
            case 'CREATE_CUSTOMER': {
                if (!crud.onAddCustomer) return { success: false, message: 'Customer creation not available.' };
                const payload = {
                    id: `C${Date.now()}`,
                    companyId,
                    name: e.customerName || '',
                    contactPerson: e.contactPerson || '',
                    email: e.email || '',
                    phone: e.phone || '',
                    country: e.country || '',
                    city: e.city || '',
                    state: e.state || '',
                    location: e.address || e.location || '',
                    creditLimit: 0,
                    paymentTerms: 'Net 30',
                    status: 'Active',
                    totalVolumeLBS: 0,
                    lastOrderDate: new Date().toISOString().split('T')[0],
                };
                console.log('[XS-AI-DEBUG] CREATE_CUSTOMER payload:', JSON.stringify(payload));
                try {
                    const result = await crud.onAddCustomer(payload);
                    console.log('[XS-AI-DEBUG] CREATE_CUSTOMER result:', JSON.stringify(result));
                    return result
                        ? { success: true, message: `Customer "${e.customerName}" created.` }
                        : { success: false, message: 'Failed to create customer. Check console for details.' };
                } catch (err: any) {
                    console.error('[XS-AI-DEBUG] CREATE_CUSTOMER error:', err);
                    return { success: false, message: `Failed to create customer: ${err.message}` };
                }
            }

            case 'CREATE_SUPPLIER': {
                if (!crud.onAddSupplier) return { success: false, message: 'Supplier creation not available.' };
                const supplierPayload = {
                    id: `SUP${Date.now()}`,
                    companyId,
                    name: e.supplierName || '',
                    contactPerson: e.contactPerson || '',
                    email: e.email || '',
                    phone: e.phone || '',
                    country: e.country || '',
                    city: e.city || '',
                    state: e.state || '',
                    location: e.address || e.location || '',
                    categories: [],
                    rating: 0,
                    paymentTerms: 'Net 30',
                };
                console.log('[XS-AI-DEBUG] CREATE_SUPPLIER payload:', JSON.stringify(supplierPayload));
                try {
                    const result = await crud.onAddSupplier(supplierPayload);
                    console.log('[XS-AI-DEBUG] CREATE_SUPPLIER result:', JSON.stringify(result));
                    return result
                        ? { success: true, message: `Supplier "${e.supplierName}" created.` }
                        : { success: false, message: 'Failed to create supplier. Check console for details.' };
                } catch (err: any) {
                    console.error('[XS-AI-DEBUG] CREATE_SUPPLIER error:', err);
                    return { success: false, message: `Failed to create supplier: ${err.message}` };
                }
            }

            case 'CREATE_SO': {
                if (!crud.onAddSalesOrder) return { success: false, message: 'Sales order creation not available.' };
                // Resolve customer
                const customer = findByName(e.customerName || '', dataArrays.customers || []);
                // SO# = last sequential SO + 1, format `SO-NNNNN`. Falls
                // back to the timestamp-derived id only if the lookup
                // fails so we never block creation.
                let nextOrderNumber: string;
                try {
                    const { data } = await supabase()
                        .from('sales_orders')
                        .select('orderNumber')
                        .ilike('orderNumber', 'SO-%')
                        .limit(5000);
                    // Floor: 5082 → first generated number is 5083.
                    let max = 5082;
                    for (const row of (data ?? []) as Array<{ orderNumber?: string }>) {
                        const m = String(row.orderNumber ?? '').match(/(\d+)\s*$/);
                        const n = m ? parseInt(m[1], 10) : NaN;
                        if (Number.isFinite(n) && n > max) max = n;
                    }
                    nextOrderNumber = `SO-${String(max + 1).padStart(5, '0')}`;
                } catch {
                    nextOrderNumber = `SO-${Date.now().toString(36).toUpperCase()}`;
                }
                const result = await crud.onAddSalesOrder({
                    id: `SO${Date.now()}`,
                    companyId,
                    customerId: customer?.id || '',
                    customerName: e.customerName || customer?.name || '',
                    orderNumber: nextOrderNumber,
                    status: 'Draft',
                    items: e.productName ? [{
                        productName: e.productName,
                        quantity: e.quantity || 0,
                        unitPrice: e.price || 0,
                        total: (e.quantity || 0) * (e.price || 0),
                    }] : [],
                    totalAmount: (e.quantity || 0) * (e.price || 0),
                    currency: e.currency || 'USD',
                    incoterm: '',
                });
                return result
                    ? { success: true, message: `Sales order created for "${e.customerName}".` }
                    : { success: false, message: 'Failed to create sales order.' };
            }

            case 'CREATE_PO': {
                if (!crud.onAddPurchaseOrder) return { success: false, message: 'Purchase order creation not available.' };
                const supplier = findByName(e.supplierName || '', dataArrays.suppliers || []);
                const result = await crud.onAddPurchaseOrder({
                    id: `PO${Date.now()}`,
                    companyId,
                    supplierId: supplier?.id || '',
                    supplierName: e.supplierName || supplier?.name || '',
                    orderNumber: `PO-${Date.now().toString(36).toUpperCase()}`,
                    status: 'Draft',
                    items: e.productName ? [{
                        productName: e.productName,
                        quantity: e.quantity || 0,
                        unitPrice: e.price || 0,
                        total: (e.quantity || 0) * (e.price || 0),
                    }] : [],
                    totalAmount: (e.quantity || 0) * (e.price || 0),
                    currency: e.currency || 'USD',
                });
                return result
                    ? { success: true, message: `Purchase order created for "${e.supplierName}".` }
                    : { success: false, message: 'Failed to create purchase order.' };
            }

            case 'REQUEST_BOOKING': {
                if (!crud.onAddBooking) return { success: false, message: 'Booking creation not available.' };
                const result = await crud.onAddBooking({
                    id: `BK${Date.now()}`,
                    companyId,
                    bookingNumber: e.bookingNumber || `BK-${Date.now().toString(36).toUpperCase()}`,
                    customer: e.customerName || '',
                    vesselVoyage: e.vesselVoyage || '',
                    pol: e.pol || e.originPort || '',
                    pod: e.pod || e.destinationPort || '',
                    equipment: e.equipment || '',
                    etd: e.etd || '',
                    eta: e.eta || '',
                    status: 'Requested',
                });
                return result
                    ? { success: true, message: `Booking requested${e.customerName ? ` for "${e.customerName}"` : ''}.` }
                    : { success: false, message: 'Failed to create booking.' };
            }

            case 'CREATE_CARGO_AGENT': {
                if (!crud.onAddCargoAgent) return { success: false, message: 'Cargo agent creation not available.' };
                const result = await crud.onAddCargoAgent({
                    id: `AGT${Date.now()}`,
                    companyId,
                    name: e.agentName || '',
                    contactPerson: e.contactPerson || '',
                    email: e.email || '',
                    phone: e.phone || '',
                    country: e.country || '',
                });
                return result
                    ? { success: true, message: `Cargo agent "${e.agentName}" created.` }
                    : { success: false, message: 'Failed to create cargo agent.' };
            }

            case 'CREATE_PRODUCT': {
                // Direct Supabase insert — bypasses useSupabase hook to avoid .select().single() issues
                try {
                    const productId = `PRD${Date.now()}`;
                    const { error: insertErr } = await supabase()
                        .from('products')
                        .insert({
                            id: productId,
                            companyId,
                            name: e.productName || '',
                            sku: e.code || '',
                            category: e.category || 'General',
                            grade: '',
                            hsCode: e.hsCode || '',
                            supplier: e.supplierName || '',
                            price: e.price || e.unitPrice || 0,
                            stockStatus: 'Available',
                            specs: {},
                        });
                    if (insertErr) throw insertErr;
                    return { success: true, message: `Product "${e.productName}" created.` };
                } catch (err: any) {
                    console.error('[XS-AI-DEBUG] CREATE_PRODUCT error:', err);
                    return { success: false, message: `Failed to create product: ${err.message}` };
                }
            }

            case 'DELETE_CUSTOMER': {
                const customer = findByName(e.customerName || '', dataArrays.customers || []);
                if (!customer) return { success: false, message: `Customer "${e.customerName}" not found.` };
                try {
                    const { error } = await supabase()
                        .from('customers')
                        .delete()
                        .eq('id', customer.id);
                    if (error) throw error;
                    return { success: true, message: `Customer "${customer.name}" deleted.` };
                } catch (err: any) {
                    return { success: false, message: `Failed to delete customer: ${err.message}` };
                }
            }

            case 'DELETE_SUPPLIER': {
                const supplier = findByName(e.supplierName || '', dataArrays.suppliers || []);
                if (!supplier) return { success: false, message: `Supplier "${e.supplierName}" not found.` };
                try {
                    const { error } = await supabase()
                        .from('suppliers')
                        .delete()
                        .eq('id', supplier.id);
                    if (error) throw error;
                    return { success: true, message: `Supplier "${supplier.name}" deleted.` };
                } catch (err: any) {
                    return { success: false, message: `Failed to delete supplier: ${err.message}` };
                }
            }

            case 'DELETE_PRODUCT': {
                const product = findByName(e.productName || '', dataArrays.products || []);
                if (!product) return { success: false, message: `Product "${e.productName}" not found.` };
                try {
                    const { error } = await supabase()
                        .from('products')
                        .delete()
                        .eq('id', product.id);
                    if (error) throw error;
                    return { success: true, message: `Product "${product.name}" deleted.` };
                } catch (err: any) {
                    return { success: false, message: `Failed to delete product: ${err.message}` };
                }
            }

            case 'DELETE_FREIGHT_QUOTE': {
                // Find freight quote by agent name (since we don't have freight quotes in dataArrays, query Supabase)
                try {
                    let query = supabase().from('freight_quotes').select('id, agent_name').eq('company_id', companyId);
                    if (e.agentName) query = query.ilike('agent_name', `%${e.agentName}%`);
                    if (e.originPort) query = query.ilike('origin_port', `%${e.originPort}%`);
                    if (e.destinationPort) query = query.ilike('destination_port', `%${e.destinationPort}%`);
                    const { data: fqs, error: findErr } = await query.limit(1);
                    if (findErr) throw findErr;
                    if (!fqs || fqs.length === 0) return { success: false, message: `Freight quote not found matching "${e.agentName || 'unknown'}".` };
                    const { error: delErr } = await supabase().from('freight_quotes').delete().eq('id', fqs[0].id);
                    if (delErr) throw delErr;
                    return { success: true, message: `Freight quote from "${fqs[0].agent_name}" deleted.` };
                } catch (err: any) {
                    return { success: false, message: `Failed to delete freight quote: ${err.message}` };
                }
            }

            case 'CREATE_FREIGHT_QUOTE': {
                // Direct Supabase insert — bypasses useSupabase hook because select=* fails on this table
                try {
                    // Formatted FQ id — last "FQ-NNNN" + 1, fall back to UUID if lookup fails.
                    let fqId: string;
                    try {
                        const { data } = await supabase()
                            .from('freight_quotes')
                            .select('id')
                            .ilike('id', 'FQ-%')
                            .limit(5000);
                        let max = 0;
                        for (const row of (data ?? []) as Array<{ id?: string }>) {
                            const m = String(row.id ?? '').match(/(\d+)\s*$/);
                            const n = m ? parseInt(m[1], 10) : NaN;
                            if (Number.isFinite(n) && n > max) max = n;
                        }
                        fqId = `FQ-${String(max + 1).padStart(4, '0')}`;
                    } catch {
                        fqId = crypto.randomUUID();
                    }
                    const { error: insertErr } = await supabase()
                        .from('freight_quotes')
                        .insert({
                            id: fqId,
                            company_id: companyId,
                            agent_name: e.agentName || e.carrier || '',
                            carrier: e.carrier || '',
                            freight_type: 'PORT_PORT',
                            origin_port: e.originPort || '',
                            destination_port: e.destinationPort || '',
                            rate: e.rate || e.price || 0,
                            currency: e.currency || 'USD',
                            valid_until: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
                            free_time: 14,
                            status: 'ACTIVE',
                        });
                    if (insertErr) throw insertErr;
                    const agent = e.agentName || e.carrier || 'Agent';
                    return { success: true, message: `Freight quote created: ${agent}, ${e.originPort || ''} to ${e.destinationPort || ''}, $${e.rate || e.price || 0}.` };
                } catch (fqErr: any) {
                    return { success: false, message: `Failed to create freight quote: ${fqErr.message || 'Unknown error'}` };
                }
            }

            case 'UPDATE_CUSTOMER': {
                if (!crud.onUpdateCustomer) return { success: false, message: 'Customer update not available.' };
                const customer = findByName(e.customerName || '', dataArrays.customers || []);
                if (!customer) return { success: false, message: `Customer "${e.customerName}" not found.` };
                const updates: any = { ...customer };
                if (e.contactPerson) updates.contactPerson = e.contactPerson;
                if (e.email) updates.email = e.email;
                if (e.phone) updates.phone = e.phone;
                if (e.country) updates.country = e.country;
                if (e.city) updates.city = e.city;
                if (e.state) updates.state = e.state;
                if (e.address || e.location) updates.location = e.address || e.location;
                const result = await crud.onUpdateCustomer(updates);
                return result
                    ? { success: true, message: `Customer "${customer.name}" updated.` }
                    : { success: false, message: 'Failed to update customer.' };
            }

            case 'UPDATE_SUPPLIER': {
                if (!crud.onUpdateSupplier) return { success: false, message: 'Supplier update not available.' };
                const supplier = findByName(e.supplierName || '', dataArrays.suppliers || []);
                if (!supplier) return { success: false, message: `Supplier "${e.supplierName}" not found.` };
                const updates: any = { ...supplier };
                if (e.contactPerson) updates.contactPerson = e.contactPerson;
                if (e.email) updates.email = e.email;
                if (e.phone) updates.phone = e.phone;
                if (e.country) updates.country = e.country;
                if (e.city) updates.city = e.city;
                if (e.state) updates.state = e.state;
                if (e.address || e.location) updates.location = e.address || e.location;
                const result = await crud.onUpdateSupplier(updates);
                return result
                    ? { success: true, message: `Supplier "${supplier.name}" updated.` }
                    : { success: false, message: 'Failed to update supplier.' };
            }

            case 'SHOW_BOOKINGS':
            case 'SHOW_FREIGHT_QUOTES':
            case 'SHOW_BOLS':
                // These are read-only — handled by the AI text response, no CRUD needed
                return { success: true, message: 'Data shown in response.' };

            default:
                return { success: false, message: `Action type "${action.type}" not supported yet.` };
        }
    } catch (err: any) {
        return { success: false, message: `Error: ${err.message || 'Unknown error'}` };
    }
};

// --- Conversation Persistence ---

const supabase = () => getSupabaseClient();

export const loadOrCreateConversation = async (
    userId: string,
    companyId: string
): Promise<{ conversationId: string; messages: AiMessage[] }> => {
    // Find most recent conversation for this user
    const { data: existing } = await supabase()
        .from('ai_conversations')
        .select('*')
        .eq('userId', userId)
        .eq('companyId', companyId)
        .order('lastMessageAt', { ascending: false })
        .limit(1);

    if (existing && existing.length > 0) {
        const conv = existing[0];
        // Load messages
        const { data: msgs } = await supabase()
            .from('ai_messages')
            .select('*')
            .eq('conversationId', conv.id)
            .order('createdAt', { ascending: true })
            .limit(50);

        return {
            conversationId: conv.id,
            messages: (msgs || []) as AiMessage[],
        };
    }

    // Create new conversation
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    await supabase().from('ai_conversations').insert({
        id: newId,
        userId,
        companyId,
        title: '',
        lastMessageAt: now,
        messageCount: 0,
        createdAt: now,
    });

    return { conversationId: newId, messages: [] };
};

export const saveMessage = async (
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    actionType?: string,
    actionData?: any
): Promise<void> => {
    const now = new Date().toISOString();
    const msgId = crypto.randomUUID();

    await supabase().from('ai_messages').insert({
        id: msgId,
        conversationId,
        role,
        content,
        actionType: actionType || null,
        actionData: actionData || {},
        createdAt: now,
    });

    // Update conversation
    await supabase()
        .from('ai_conversations')
        .update({ lastMessageAt: now, messageCount: undefined })
        .eq('id', conversationId);

    // Increment message count via RPC would be ideal, but just update timestamp
};

export const getRecentMemory = async (
    userId: string,
    limit: number = 20
): Promise<string> => {
    const { data: convs } = await supabase()
        .from('ai_conversations')
        .select('id')
        .eq('userId', userId)
        .order('lastMessageAt', { ascending: false })
        .limit(3);

    if (!convs?.length) return '';

    const convIds = convs.map(c => c.id);
    const { data: msgs } = await supabase()
        .from('ai_messages')
        .select('role, content, createdAt')
        .in('conversationId', convIds)
        .order('createdAt', { ascending: false })
        .limit(limit);

    if (!msgs?.length) return '';

    return msgs.reverse().map(m => `${m.role}: ${m.content}`).join('\n');
};

// --- Learned Tasks ---

export const loadLearnedTasks = async (
    userId: string,
    companyId: string
): Promise<LearnedTask[]> => {
    const { data } = await supabase()
        .from('ai_learned_tasks')
        .select('*')
        .eq('userId', userId)
        .or(`companyId.eq.${companyId},companyId.eq.ALL`);

    return (data || []) as LearnedTask[];
};

export const saveLearnedTask = async (
    userId: string,
    companyId: string,
    trigger: string,
    instruction: string
): Promise<void> => {
    const now = new Date().toISOString();
    await supabase().from('ai_learned_tasks').insert({
        id: crypto.randomUUID(),
        userId,
        companyId,
        trigger: trigger.toLowerCase().trim(),
        instruction,
        parameters: {},
        createdAt: now,
    });
};

export const matchLearnedTask = (
    message: string,
    tasks: LearnedTask[]
): LearnedTask | null => {
    if (!tasks.length) return null;
    const lower = message.toLowerCase().trim();
    return tasks.find(t => lower.includes(t.trigger)) || null;
};
