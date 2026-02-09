
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { Product, Customer, Opportunity, DealStage, QuoteItem, SupplierQuote, Supplier, PurchaseOrder, SupplierOffer, Port, Shipment } from "../types";
import { getSupabaseClient } from "./supabase";

// --- Helper for System Instructions ---
const MODEL_ID = 'gemini-pro-latest';

const SALES_COPILOT_PROMPT = `
SYSTEM / DEVELOPER PROMPT — “Sales Rep Copilot UI” AGENT
Industry: B2B commodity trading (textile fibers, plastic resins, recycled materials/waste)
Order size: Minimum 1 full container
Markets: Local + international (EXW/FOB/CIF/DDP)

================================================================================
ROLE
================================================================================
You are the “Sales Rep Copilot UI” agent. You support human sales reps in real time with:
- Account briefing
- Deal support (quotes/orders)
- Live call assistance
- Reorder radar
- Shipment/docs status
- Opportunity building

You do NOT finalize deals, do NOT send messages, and do NOT invent facts.
You produce UI-ready structured output grounded in database records.

================================================================================
GLOBAL RULES
================================================================================
1) Source of truth is the database. Never fabricate customer/order/pricing/spec/shipment data.
2) Always cite the source for every factual claim using "table.column" or "view".
3) If data is missing, label it explicitly as unknown and provide conservative guidance.
4) You may recommend actions and create task payloads, but you do not execute irreversible actions.
5) When quoting/pricing: always reference historical pricing if available.
6) Spec reasoning must use:
   - products.specs (jsonb)
   - customer_product_prefs.specRules (jsonb)
   - and any offered/lot specs passed by the UI context.
7) Keep output concise but complete; prefer bullet-style strings inside the JSON.

================================================================================
OUTPUT CONTRACT (UI-READY JSON) — ALWAYS FOLLOW THIS EXACT SHAPE
================================================================================
Return only valid JSON in this schema:

{
  "header": {
    "title": "string",
    "subtitle": "string",
    "lastUpdated": "ISO-8601 timestamp"
  },
  "customerSnapshot": {
    "customerId": "string|null",
    "customerName": "string|null",
    "location": "string|null",
    "paymentTerms": "string|null",
    "creditLimit": "number|null",
    "lastOrderDate": "date|null",
    "lastInteractionAt": "timestamp|null"
  },
  "keyFacts": [
    { "label": "string", "value": "string", "source": "table.column|view" }
  ],
  "recentActivity": {
    "interactions": [
      { "occurredAt": "timestamp", "channel": "string", "summary": "string", "source": "customer_interactions.*" }
    ],
    "orders": [
      { "orderId": "string", "orderDate": "date|null", "status": "string|null", "totalAmount": "number|null", "currency": "string|null", "source": "sales_orders.*" }
    ]
  },
  "pricingGuidance": {
    "referenceBand": { "low": "number|null", "high": "number|null", "currency": "string|null", "basis": "string" },
    "recommended": { "target": "number|null", "stretch": "number|null", "walkAway": "number|null", "currency": "string|null" },
    "rationale": [
      { "point": "string", "source": "table.column|view" }
    ],
    "alerts": [
      { "severity": "low|med|high", "message": "string", "source": "table.column|view" }
    ]
  },
  "specCompatibility": {
    "status": "ok|warning|block|unknown",
    "checks": [
      { "attribute": "string", "expected": "string", "offered": "string", "result": "pass|fail|unknown", "source": "products.specs|customer_product_prefs.specRules|context" }
    ],
    "notes": "string"
  },
  "nextBestActions": [
    {
      "action": "string",
      "why": "string",
      "confidence": 0.0,
      "suggestedOwner": "sales|ops|manager",
      "createTask": true,
      "taskPayload": {
        "title": "string",
        "details": "string",
        "priority": 1,
        "dueAt": "timestamp|null"
      }
    }
  ],
  "drafts": {
    "email": { "subject": "string|null", "body": "string|null" },
    "whatsapp": { "body": "string|null" },
    "callScript": { "bullets": ["string"] }
  },
  "complianceAndRisk": [
    { "severity": "low|med|high", "risk": "string", "mitigation": "string", "source": "table.column|inferred" }
  ],
  "errors": [
    { "code": "string", "message": "string", "requiredInputs": ["string"] }
  ]
}

If no errors, return errors = [].

================================================================================
MODE-SPECIFIC BEHAVIOR (MANDATORY)
================================================================================
A) Account Brief (requires customerId)
Output: keyFacts (cadence, last price band, top products, terms, credit), nextBestActions (follow-up, reorder, cross-sell).

B) Deal Support (requires quoteId OR salesOrderId)
Output: pricingGuidance (reference band, target/stretch/walk-away), specCompatibility, drafts (email/whatsapp/callScript).

C) Live Call Assist (requires customerId; optional deal IDs)
Output: keyFacts (max 5), nextBestActions (max 1), callScript bullets (objection handlers).

D) Reorder Radar (customerId optional)
Output: keyFacts (top 5 most due/overdue), nextBestActions (createTask=true for confidence >= 0.70), drafts (short reorder WhatsApp).

E) Shipment/Docs Status (requires shipmentId OR salesOrderId)
Output: keyFacts (status, ETD/ETA, next milestone, missing docs), nextBestActions (ops task), drafts (update message).

F) Opportunity Builder (requires customerId)
Output: Suggest 1–3 concrete offers, price recommendation band, task payload.

================================================================================
PRICING BAND COMPUTATION
================================================================================
If >= 3 price_events: low=25th percentile, high=75th percentile.
Target = midpoint. Stretch = high + uplift. WalkAway = low - buffer.
Else: fallback to products.price, mark basis as "list price".

================================================================================
STYLE
================================================================================
- Output JSON only. No markdown. No extra commentary.
- Use clear, direct text.
`;

export const getGeminiInsight = async (prompt: string, context: string = ''): Promise<string> => {
    try {
        // FIX: Removed API_KEY constant to use process.env.API_KEY directly as per guidelines.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const modelId = MODEL_ID;
        const fullPrompt = `
      You are an AI assistant integrated into "XS CRM".
      Contextual Data: ${context}
      User's Request: "${prompt}"
    `;
        const response = await ai.models.generateContent({ model: modelId, contents: fullPrompt });
        return response.text || "No insights available at this time.";
    } catch (error) {
        console.error("Gemini API Error:", error);
        return "Unable to generate insight.";
    }
};

export const getQuoteRecommendation = async (productName: string, origin: string, destination: string): Promise<string> => {
    return getGeminiInsight(
        `I am creating a quote for ${productName} shipping from ${origin} to ${destination}.`,
        "Provide a quick estimation of potential freight risks and margin suggestion."
    );
}

export const generateSalesEmail = async (customerName: string, items: QuoteItem[], totalValue: number): Promise<string> => {
    try {
        // FIX: Removed API_KEY constant to use process.env.API_KEY directly as per guidelines.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const modelId = MODEL_ID;
        const itemsList = items.map(i => `${i.quantityLBS.toLocaleString()} LBS of ${i.productName} (${i.grade})`).join(', ');
        const prompt = `Write a B2B sales email to "${customerName}". Context: Quote for ${itemsList}. Value: $${totalValue.toLocaleString()}. Goal: Ask for PO. Output strictly email body.`;
        const response = await ai.models.generateContent({ model: modelId, contents: prompt });
        return response.text || "Could not generate email draft.";
    } catch (error) {
        return "Error generating email.";
    }
};

export const generateContextualEmail = async (recipient: string, topic: string, keyPoints: string[], tone: string): Promise<{ subject: string; body: string } | null> => {
    try {
        // FIX: Removed API_KEY constant to use process.env.API_KEY directly as per guidelines.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `Write a B2B email to ${recipient} about ${topic}. Tone: ${tone}. Points: ${keyPoints.join(', ')}. Return JSON {subject, body}.`;
        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            // FIX: Corrected responseSchema to properly define a JSON object with properties.
            config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { subject: { type: Type.STRING }, body: { type: Type.STRING } } } }
        });
        if (response.text) return JSON.parse(response.text);
        return null;
    } catch (e) {
        return null;
    }
};

export const generateEmailSummary = async (subject: string, sender: string, body: string): Promise<string> => {
    try {
        // FIX: Removed API_KEY constant to use process.env.API_KEY directly as per guidelines.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `Summarize email. Sender: ${sender}, Subject: ${subject}, Body: ${body.substring(0, 2000)}.`;
        const response = await ai.models.generateContent({ model: MODEL_ID, contents: prompt });
        return response.text || "";
    } catch (e) { return "Error"; }
};

export const generateEmailReply = async (sender: string, originalBody: string, tone: string): Promise<string> => {
    try {
        // FIX: Removed API_KEY constant to use process.env.API_KEY directly as per guidelines.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `Draft reply to ${sender}. Original: ${originalBody.substring(0, 1500)}. Tone: ${tone}. Output body only.`;
        const response = await ai.models.generateContent({ model: MODEL_ID, contents: prompt });
        return response.text || "";
    } catch (e) { return "Error"; }
};

export const lookupLocation = async (query: string, type: 'city' | 'zip'): Promise<{ city: string, state: string, zip: string } | null> => {
    try {
        // FIX: Removed API_KEY constant to use process.env.API_KEY directly as per guidelines.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `Find location data for "${query}". Return JSON {city, state, zip}.`;
        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            // FIX: Corrected responseSchema to properly define a JSON object with properties.
            config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { city: { type: Type.STRING }, state: { type: Type.STRING }, zip: { type: Type.STRING } } } }
        });
        if (response.text) return JSON.parse(response.text);
        return null;
    } catch (e) { return null; }
};

export const getDomesticFreightEstimate = async (origin: string, destination: string, product: string, quantityLbs: number): Promise<{ estimatedCost: number, explanation: string } | null> => {
    try {
        // FIX: Removed API_KEY constant to use process.env.API_KEY directly as per guidelines.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `Estimate LTL/FTL trucking cost for ${quantityLbs} lbs of ${product} from ${origin} to ${destination}. Return JSON {estimatedCost: number, explanation: string}.`;
        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            // FIX: Corrected responseSchema to properly define a JSON object with properties.
            config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { estimatedCost: { type: Type.NUMBER }, explanation: { type: Type.STRING } } } }
        });
        if (response.text) return JSON.parse(response.text);
        return null;
    } catch (e) { return null; }
};

export const getImportCostAnalysis = async (productName: string, fobPrice: number, origin: string, destination: string, deliveryCity: string, deliveryZip: string): Promise<string> => {
    try {
        // FIX: Removed API_KEY constant to use process.env.API_KEY directly as per guidelines.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `
      Analyze import costs for:
      Product: ${productName}
      FOB Price: $${fobPrice}
      Route: ${origin} to ${destination} (Final Delivery: ${deliveryCity} ${deliveryZip})
      
      Provide a text summary estimating potential duty rates (HTS), freight market trends for this route, and any other landed cost considerations (insurance, port fees).
      Keep it concise and helpful for a cost calculator.
    `;
        const response = await ai.models.generateContent({ model: MODEL_ID, contents: prompt });
        return response.text || "No analysis available.";
    } catch (error) {
        console.error("Gemini API Error:", error);
        return "Unable to generate analysis.";
    }
};

// --- SALES AGENT (UPDATED) ---

export const getSalesAgentResponse = async (
    userMessage: string,
    history: { role: 'user' | 'model', text: string }[],
    contextData: {
        customers: any[],
        opportunities: any[],
        products: any[],
        currentMode?: string,
        selectedId?: string
    }
): Promise<string> => {
    try {
        // FIX: Removed API_KEY constant to use process.env.API_KEY directly as per guidelines.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const modelId = MODEL_ID;

        // Filter Context based on Selection
        let targetedContext = {};
        if (contextData.selectedId) {
            const customer = contextData.customers.find(c => c.id === contextData.selectedId);
            const deals = contextData.opportunities.filter(o => o.customerId === contextData.selectedId);
            targetedContext = { customer, deals };
        } else {
            // General Overview Context (Sample)
            targetedContext = {
                recentDeals: contextData.opportunities.slice(0, 5),
                activeCustomers: contextData.customers.slice(0, 5)
            };
        }

        const inputPayload = {
            companyId: "ALL", // Default
            userId: "USER",
            mode: contextData.currentMode || "D", // Default to Reorder Radar/Overview if not specified
            customerId: contextData.selectedId || null,
            freeText: userMessage,
            context: {
                ...targetedContext,
                products: contextData.products.slice(0, 10) // Sample products
            }
        };

        const prompt = `
            ${SALES_COPILOT_PROMPT}

            INPUT DATA:
            ${JSON.stringify(inputPayload)}

            HISTORY:
            ${history.map(h => `${h.role}: ${h.text}`).join('\n')}
        `;

        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            config: {
                responseMimeType: "application/json"
            }
        });

        // Parse JSON response to avoid showing raw JSON if possible, or return text
        const text = response.text || "{}";
        try {
            // Attempt to unwrap if the model follows the schema strictness
            // If the user wants a chat response, we might need to adjust the prompt to be less 'JSON-only' 
            // BUT the current prompt enforces JSON.
            // For now, let's return the raw JSON text as the Sidebar expects a response. 
            // Ideally, we should parse it and format it nicely, but the sidebar renders {msg.text}.
            // If it's JSON, it looks ugly.
            // Converting to a friendly string:
            const data = JSON.parse(text);
            if (data.drafts && data.drafts.email && data.drafts.email.body) return data.drafts.email.body;
            if (data.nextBestActions && data.nextBestActions.length > 0) {
                return `Suggestion: ${data.nextBestActions[0].action}\nWhy: ${data.nextBestActions[0].why}`;
            }
            // Fallback:
            return "I analyzed the data. " + (data.keyFacts?.[0]?.value || "How can I help?");
        } catch (e) {
            // If not valid JSON, just return text
            return text;
        }

    } catch (error) {
        console.error("Sales Agent Error:", error);
        return "I'm having trouble connecting to Hall right now. Please check your connection or API key.";
    }
};

export const getHelpChatResponse = async (userMessage: string, history: any[]) => {
    try {
        // FIX: Removed API_KEY constant to use process.env.API_KEY directly as per guidelines.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `You are HALL, a direct and professional AI assistant.

CRITICAL RULES:
1. Be BRIEF and DIRECT. No unnecessary words.
2. Focus ONLY on what the user asked. Do NOT bring up unrelated topics.
3. Answer in 1-3 sentences maximum unless more detail is explicitly requested.
4. No greetings, pleasantries, or filler text.
5. Professional tone - no emojis, no exclamation marks.

History: ${JSON.stringify(history)}
User: ${userMessage}`;
        const response = await ai.models.generateContent({ model: MODEL_ID, contents: prompt });
        return response.text || "I am here to help.";
    } catch (e) { return "I'm having trouble connecting right now."; }
};

export const analyzeDocument = async (fileBase64: string, mimeType: string, prompt: string): Promise<string> => {
    try {
        // FIX: Removed API_KEY constant to use process.env.API_KEY directly as per guidelines.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        // DEBUG: List available models to verify access and correct names
        // (Keeping this for one more deploy to confirm)
        try {
            const modelsResponse = await ai.models.list();
            const modelNames = [];
            for await (const model of modelsResponse) {
                modelNames.push(model.name || model.displayName);
            }
            // console.log("GeminiService: Available Models:", JSON.stringify(modelNames)); 
            // Commenting out detailed list to reduce noise, unless needed.
        } catch (listError) {
            console.error("GeminiService: Failed to list models:", listError);
        }

        const validModel = 'gemini-pro-latest';
        console.log(`GeminiService: Switching to available model: ${validModel}`);

        const response = await ai.models.generateContent({
            model: validModel,
            contents: { parts: [{ inlineData: { mimeType: mimeType, data: fileBase64 } }, { text: prompt }] }
        });
        return response.text || "";
    } catch (e: any) {
        // Log key status for debugging (showing only first 8 chars)
        const keyStatus = process.env.API_KEY ? `Key present (${process.env.API_KEY.substring(0, 8)}...)` : 'Key undefined or empty';
        console.error("Gemini Document Analysis Error:", e);
        console.error(`API Key Status: ${keyStatus}`);
        return "Error analyzing doc: " + (e.message || String(e));
    }
};

export const generateCustomerDescription = async (name: string, customer: string, specs: string) => {
    try {
        // FIX: Removed API_KEY constant to use process.env.API_KEY directly as per guidelines.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `Convert "${name}" to customer desc for ${customer}. Specs: ${specs}. Return JSON {description, hsCode}.`;
        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            // FIX: Corrected responseSchema to properly define a JSON object with properties.
            config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { description: { type: Type.STRING }, hsCode: { type: Type.STRING } } } }
        });
        if (response.text) return JSON.parse(response.text);
        return null;
    } catch (e) { return null; }
};

// --- PROCUREMENT AGENT (NEW) ---
export const getProcurementAgentResponse = async (msg: string, hist: any[], ctx: any) => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const modelId = MODEL_ID; // gemini-pro-latest

        const prompt = `
            You are a specialized Procurement AI Assistant for X-Solution.
            You help with Supplier management, Purchase Orders (PO), and Offers.
            
            Key Responsibilities:
            - Find suppliers for specific products.
            - Summarize open purchase orders.
            - Compare supplier offers.
            
            CONTEXT DATA:
            - Active Suppliers: ${JSON.stringify(ctx.suppliers ? ctx.suppliers.slice(0, 10).map((s: any) => s.name) : [])}
            - Recent POs: ${JSON.stringify(ctx.purchaseOrders ? ctx.purchaseOrders.slice(0, 5) : [])}
            
            USER REQUEST: "${msg}"
            
            Provide a helpful, professional response based on the data.
        `;

        const response = await ai.models.generateContent({ model: modelId, contents: prompt });
        return response.text || "I couldn't generate a procurement response.";
    } catch (e) {
        console.error("Procurement Agent Error:", e);
        return "I'm having trouble accessing procurement data.";
    }
};

export const getLogisticsAgentResponse = async (
    msg: string,
    hist: { role: 'user' | 'model'; text: string }[],
    ctx: any
): Promise<{ text: string, toolCalls?: any[] }> => {
    try {
        // FIX: Removed API_KEY constant to use process.env.API_KEY directly as per guidelines.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        // Determine company context
        const companyName = ctx.companyName || 'XSOLUTION';

        const sendEmailTool: FunctionDeclaration = {
            name: "send_email",
            description: "Send an email to a recipient. Use this when the user asks to send updates or quotes via email.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    recipientName: { type: Type.STRING, description: "Name of the recipient company or person (e.g. 'INFINITY')" },
                    subject: { type: Type.STRING, description: "Email subject line" },
                    body: { type: Type.STRING, description: "Email body content (HTML or Text)" },
                },
                required: ["recipientName", "subject", "body"]
            }
        };

        const prompt = `
        You are a specialized Logistics AI Assistant for ${companyName}.
        
        You have access to the following operational data:
        - INVENTORY: Current stock levels and warehouse locations.
        - BOOKINGS: Shipping booking confirmations and statuses.
        - BILL OF LADINGS (BL): Shipping documents and tracking.
        - SHIPMENTS: Active container movements.
        - FREIGHT QUOTES: Rates from cargo agents.
        - CARGO AGENTS: List of partners.

        DATA CONTEXT:
        ${JSON.stringify(ctx)}

        CONVERSATION HISTORY:
        ${hist.map(h => `${h.role}: ${h.text}`).join('\n')}

        USER REQUEST: "${msg}"

        INSTRUCTIONS:
        1. Analyze the USER REQUEST and the DATA CONTEXT.
        2. Provide a specific, data-backed answer.
        3. If the user asks to SEND AN EMAIL (e.g. "Send update to Infinity"), call the 'send_email' tool.
           - Generate a professional email body summarizing the requested info.
           - Use the recipient name provided by the user or found in context.
        4. If identifying containers, bookings, or items, list them clearly.
        5. Keep responses concise and professional.
        6. IDENTITY & SIGNATURE:
           - You represent ${companyName}.
           - If asked about your email or signature, state that you communicate via the ${companyName} integrated platform using ${companyName} email.
           - When generating email drafts, sign off as:
             "Best regards,
             ${companyName} Logistics AI Assistant
             ${companyName} Global Logistics"
        `;

        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            config: {
                tools: [{ functionDeclarations: [sendEmailTool] }]
            }
        });

        return {
            text: response.text || (response.functionCalls ? "Processing request..." : "No response generated."),
            toolCalls: response.functionCalls
        };
    } catch (e) {
        console.error("Logistics Agent Error", e);
        return { text: "I'm having trouble analyzing the logistics data right now." };
    }
};

// --- CALCULATOR AGENT (NEW) ---
export const getCalculatorAgentResponse = async (msg: string, hist: any[], ctx: any) => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const modelId = MODEL_ID;

        const prompt = `
            You are an expert Logistics & Import Cost Calculator Assistant.
            You understand Incoterms (EXW, FOB, CIF, DDP), HS Codes, duty rates, and freight estimations.
            
            USER REQUEST: "${msg}"
            
            If the user asks for a calculation, ask for missing variables if needed (e.g., origin, weight, commodity).
            If they provide data, give a rough estimation logic.
            
            Note: You are a chat assistant, not the actual calculator engine, so provide guidance and estimates, not binding quotes.
        `;

        const response = await ai.models.generateContent({ model: modelId, contents: prompt });
        return response.text || "I can't calculate that right now.";
    } catch (e) {
        return "Calculation service unavailable.";
    }
};
// --- DATA AGENT (NEW) ---
export const getDataAgentResponse = async (msg: string, hist: any[], ctx: any) => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const modelId = MODEL_ID;

        const prompt = `
            You are the Master Data Assistant.
            You help manage records for Products, Customers, Suppliers, Ports, and Locations.
            
            USER REQUEST: "${msg}"
            
            Provide guidance on how to organize data or quick lookups if data is provided in context.
            If asked to 'clean' data, suggest standard formatting.
        `;

        const response = await ai.models.generateContent({ model: modelId, contents: prompt });
        return response.text || "Data assistant online.";
    } catch (e) {
        return "Data service unavailable.";
    }
};
// --- SETTINGS AGENT (NEW) ---
export const getSettingsAgentResponse = async (msg: string, hist: any[], ctx: any) => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const modelId = MODEL_ID;

        const prompt = `
            You are the System Admin Assistant.
            You help with configuring Users, Companies, Branding, and Database connections.
            
            USER REQUEST: "${msg}"
            
            If the user asks about adding users, explain the role types (ADMIN, MANAGER, USER, CARGO_AGENT, CUSTOMER).
            If they ask about integrations, mention Email (IMAP/SMTP) and Google Cloud Storage.
        `;

        const response = await ai.models.generateContent({ model: modelId, contents: prompt });
        return response.text || "Settings assistant online.";
    } catch (e) {
        return "Settings service unavailable.";
    }
};

// --- SUPER COPILOT: ACTIVE MODE ---

export type AgentActionType = 'CREATE_PO' | 'CREATE_SO' | 'CREATE_SUPPLIER' | 'CREATE_CUSTOMER' | 'CREATE_CARGO_AGENT' | 'CREATE_FREIGHT_QUOTE' | 'UPDATE_CUSTOMER' | 'UPDATE_SUPPLIER' | 'SHOW_FREIGHT_QUOTES' | 'SHOW_BOOKINGS' | 'REQUEST_BOOKING' | 'SHOW_BOLS' | 'CONFIRM' | 'CANCEL' | 'CHAT';

export interface AgentAction {
    type: AgentActionType;
    entities: {
        supplierName?: string;
        customerName?: string;
        agentName?: string;
        productName?: string;
        quantity?: number;
        unit?: 'LBS' | 'KGS';
        price?: number;
        currency?: string;
        originPort?: string;
        destinationPort?: string;
        rate?: number;
        contactPerson?: string;
        email?: string;
        phone?: string;
        country?: string;
        // Address fields for updates
        location?: string;
        city?: string;
        state?: string;
        zip?: string;
        address?: string;
        // Booking/BOL fields
        carrier?: string;
        bookingNumber?: string;
        blNumber?: string;
        vesselVoyage?: string;
        pol?: string;
        pod?: string;
        equipment?: string;
        etd?: string;
        eta?: string;
        // Filter fields for SHOW actions
        filterCarrier?: string;
        filterCustomer?: string;
        filterStatus?: string;
    };
    missingFields: string[];
    confirmed?: boolean;
}

export interface ActiveAgentResponse {
    text: string;
    action?: AgentAction;
}

/**
 * Parses user input to detect actionable intents (CREATE_PO, CREATE_SO, etc.)
 * Returns structured action or null if it's just a chat message.
 */
export const parseUserIntent = async (
    msg: string,
    pendingAction?: AgentAction
): Promise<AgentAction | null> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const modelId = MODEL_ID;

        // Check for confirmation/cancellation first
        const lowerMsg = msg.toLowerCase().trim();
        if (pendingAction && pendingAction.missingFields.length === 0) {
            if (['yes', 'confirm', 'ok', 'do it', 'proceed', 'save', 'create it'].includes(lowerMsg)) {
                return { ...pendingAction, type: 'CONFIRM', confirmed: true };
            }
            if (['no', 'cancel', 'stop', 'nevermind', 'abort'].includes(lowerMsg)) {
                return { type: 'CANCEL', entities: {}, missingFields: [] };
            }
        }

        const systemPrompt = `You are an intent parser for a business ERP application. Your job is to extract ALL available information from the user's message.

ACTIONS: 
- CREATE: CREATE_PO, CREATE_SO, CREATE_SUPPLIER, CREATE_CUSTOMER, CREATE_CARGO_AGENT, CREATE_FREIGHT_QUOTE
- UPDATE: UPDATE_CUSTOMER, UPDATE_SUPPLIER
- SHOW: SHOW_FREIGHT_QUOTES, SHOW_BOOKINGS, SHOW_BOLS
- REQUEST: REQUEST_BOOKING
- OTHER: CHAT

CRITICAL: 
- Extract EVERY piece of information mentioned.
- Use UPDATE actions when modifying an existing entity (keywords: update, change, add to, modify, set, fix).
- Use CREATE actions when creating a new entity (keywords: create, new, add, register).
- Use SHOW actions when user wants to see/list/display data (keywords: show, list, display, what are, get).
- Use REQUEST_BOOKING when user wants to request/book a container/shipment.

EXAMPLES:

Input: "Create customer FREEWAL PLASTICOS LTDA, contact Mr Mauricio, phone +5511996491198"
Output: {"type":"CREATE_CUSTOMER","entities":{"customerName":"FREEWAL PLASTICOS LTDA","contactPerson":"Mr Mauricio","phone":"+5511996491198"}}

Input: "Add address to customer FREEWAL: Rua Juraci Aletto 175, Mauá, SP, Brazil"
Output: {"type":"UPDATE_CUSTOMER","entities":{"customerName":"FREEWAL","address":"Rua Juraci Aletto 175","city":"Mauá","state":"SP","country":"Brazil"}}

Input: "Update FREEWAL phone to +5511999999999"
Output: {"type":"UPDATE_CUSTOMER","entities":{"customerName":"FREEWAL","phone":"+5511999999999"}}

Input: "Change supplier South Texas email to sales@stpetro.com"
Output: {"type":"UPDATE_SUPPLIER","entities":{"supplierName":"South Texas","email":"sales@stpetro.com"}}

Input: "Create PO for South Texas, 200k lbs PP Granular at $0.18"
Output: {"type":"CREATE_PO","entities":{"supplierName":"South Texas","productName":"PP Granular","quantity":200000,"unit":"LBS","price":0.18}}

Input: "Show all freight quotes"
Output: {"type":"SHOW_FREIGHT_QUOTES","entities":{}}

Input: "List freight quotes for carrier MSC"
Output: {"type":"SHOW_FREIGHT_QUOTES","entities":{"filterCarrier":"MSC"}}

Input: "What are our active freight quotes?"
Output: {"type":"SHOW_FREIGHT_QUOTES","entities":{"filterStatus":"ACTIVE"}}

Input: "Show my bookings"
Output: {"type":"SHOW_BOOKINGS","entities":{}}

Input: "List bookings for customer ABC Trading"
Output: {"type":"SHOW_BOOKINGS","entities":{"filterCustomer":"ABC Trading"}}

Input: "Show active bookings"
Output: {"type":"SHOW_BOOKINGS","entities":{"filterStatus":"ACTIVE"}}

Input: "Request a booking for customer XYZ, vessel EVER GIVEN, POL Shanghai, POD Los Angeles, 2x40HC"
Output: {"type":"REQUEST_BOOKING","entities":{"customerName":"XYZ","vesselVoyage":"EVER GIVEN","pol":"Shanghai","pod":"Los Angeles","equipment":"2x40HC"}}

Input: "Book a container from Ningbo to Long Beach for next week"
Output: {"type":"REQUEST_BOOKING","entities":{"pol":"Ningbo","pod":"Long Beach"}}

Input: "Show all bills of lading"
Output: {"type":"SHOW_BOLS","entities":{}}

Input: "List BOLs for vessel EVER GIVEN"
Output: {"type":"SHOW_BOLS","entities":{"vesselVoyage":"EVER GIVEN"}}

Input: "What's the weather today?"
Output: {"type":"CHAT","entities":{}}

Return ONLY valid JSON. No markdown, no explanation.`;

        const response = await ai.models.generateContent({
            model: modelId,
            contents: `Parse this message and extract ALL entities: "${msg}"`,
            config: { systemInstruction: systemPrompt }
        });

        const text = response.text?.trim() || '';

        // Try to parse JSON from response
        try {
            // Remove potential markdown code blocks
            const cleanJson = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(cleanJson);

            if (parsed.type === 'CHAT') {
                return null; // Not an action, just chat
            }

            // Determine missing required fields based on action type
            const missingFields: string[] = [];

            if (parsed.type === 'CREATE_PO') {
                if (!parsed.entities.supplierName) missingFields.push('supplier');
                if (!parsed.entities.productName) missingFields.push('product');
                if (!parsed.entities.quantity) missingFields.push('quantity');
                if (!parsed.entities.price) missingFields.push('price');
            } else if (parsed.type === 'CREATE_SO') {
                if (!parsed.entities.customerName) missingFields.push('customer');
                if (!parsed.entities.productName) missingFields.push('product');
                if (!parsed.entities.quantity) missingFields.push('quantity');
                if (!parsed.entities.price) missingFields.push('price');
            } else if (parsed.type === 'CREATE_SUPPLIER') {
                if (!parsed.entities.supplierName) missingFields.push('name');
                if (!parsed.entities.country) missingFields.push('country');
                if (!parsed.entities.contactPerson) missingFields.push('contactPerson');
                if (!parsed.entities.email) missingFields.push('email');
            } else if (parsed.type === 'CREATE_CUSTOMER') {
                if (!parsed.entities.customerName) missingFields.push('name');
                if (!parsed.entities.contactPerson) missingFields.push('contactPerson');
                if (!parsed.entities.email) missingFields.push('email');
            } else if (parsed.type === 'CREATE_CARGO_AGENT') {
                if (!parsed.entities.agentName) missingFields.push('name');
            } else if (parsed.type === 'CREATE_FREIGHT_QUOTE') {
                if (!parsed.entities.agentName) missingFields.push('agent');
                if (!parsed.entities.originPort) missingFields.push('originPort');
                if (!parsed.entities.destinationPort) missingFields.push('destinationPort');
                if (!parsed.entities.rate) missingFields.push('rate');
            } else if (parsed.type === 'REQUEST_BOOKING') {
                if (!parsed.entities.customerName) missingFields.push('customer');
                if (!parsed.entities.pol) missingFields.push('POL (Port of Loading)');
                if (!parsed.entities.pod) missingFields.push('POD (Port of Discharge)');
                if (!parsed.entities.equipment) missingFields.push('equipment (e.g., 1x40HC)');
            }
            // SHOW actions don't require mandatory fields - they just filter

            return {
                type: parsed.type,
                entities: parsed.entities || {},
                missingFields
            };
        } catch {
            console.warn("Could not parse intent JSON:", text);
            return null;
        }
    } catch (e) {
        console.error("Intent parsing error:", e);
        return null;
    }
};

/**
 * Dashboard Agent with Active Mode capabilities.
 * Can both answer questions AND execute actions.
 */
export const getDashboardAgentResponse = async (
    msg: string,
    hist: { role: 'user' | 'model', text: string }[],
    ctx: {
        stats: { customers: number, suppliers: number, activeDeals: number, activeShipments: number },
        recentActivity: { sales: string[], pos: string[], shipments: string[] }
    },
    pendingAction?: AgentAction,
    awaitingConfirmation?: boolean
): Promise<ActiveAgentResponse> => {
    try {
        // IMPORTANT: If awaiting confirmation, do NOT call LLM - let frontend handle Yes/No
        if (awaitingConfirmation && pendingAction) {
            // Return empty - frontend will handle this locally
            return { text: '' };
        }

        // 1. First, check if this is an actionable intent using the new enhanced system prompt
        // We are consolidating the parseUserIntent and the Dashboard Agent into a single powerful prompt
        // as requested by the user to use strict JSON structure.

        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const modelId = MODEL_ID; // gemini-pro-latest

        const systemInstruction = `
            You are HALL, an AI Executive Assistant for a business management and logistics platform. 
            You can help users with ANY task in the application.

            ## YOUR CAPABILITIES

            ### Purchase Orders (PO)
            - Create, edit, delete, and view Purchase Orders
            - Update PO status (draft, pending, approved, completed, cancelled)
            - Look up PO details by order number

            ### Sales Orders (SO)
            - Create, edit, delete, and view Sales Orders
            - Update SO status
            - Look up SO details by order number

            ### Customers
            - Create new customers with details (name, email, phone, address, etc.)
            - Edit, delete, search, and view customers
            - View customer order history

            ### Suppliers
            - Create new suppliers with details
            - Edit, delete, search, and view suppliers
            - View supplier purchase history

            ### Products
            - Create products (name, code, price, unit of measure, category)
            - Edit, delete, search, and view products
            - Check product pricing history

            ### Carriers
            - Create carriers (name, type: ocean/air/ground/rail, SCAC code)
            - Edit, delete, search, and view carriers

            ### Bookings (Freight Bookings)
            - Create bookings with origin, destination, carrier, dates
            - Edit, delete, and view bookings
            - Update booking status (pending, confirmed, in_transit, delivered, cancelled)
            - Track shipments by booking number
            - Link bookings to PO/SO

            ### Bill of Lading (BOL)
            - Create BOL with shipper, consignee, vessel, containers
            - Edit, delete, and view BOLs
            - Update BOL status (draft, issued, in_transit, delivered, completed)
            - Print BOL
            - Link BOL to booking

            ### Freight Quotes
            - Create freight quotes with origin, destination, mode, rates
            - Edit, delete, and view freight quotes
            - Compare multiple freight quotes
            - Accept/reject quotes
            - Update quote status (draft, sent, accepted, rejected, expired)

            ### Supplier Quotes
            - Request quotes from suppliers for products
            - Create, edit, delete, and view supplier quotes
            - Compare multiple supplier quotes
            - Accept quotes and convert to Purchase Order
            - Update quote status

            ### Reports & Queries
            - Sales and purchase reports by date range
            - Customer and supplier transaction history
            - Shipment and freight reports

            ### Navigation
            - Navigate to any page in the app

            ## AVAILABLE INTENTS

            **Purchase Orders:** create_purchase_order, edit_purchase_order, delete_purchase_order, view_purchase_orders, view_purchase_order_details, update_purchase_order_status
            
            **Sales Orders:** create_sales_order, edit_sales_order, delete_sales_order, view_sales_orders, view_sales_order_details, update_sales_order_status
            
            **Customers:** create_customer, edit_customer, delete_customer, view_customers, search_customer, get_customer_history
            
            **Suppliers:** create_supplier, edit_supplier, delete_supplier, view_suppliers, search_supplier, get_supplier_history
            
            **Products:** create_product, edit_product, delete_product, view_products, search_product, get_product_history
            
            **Carriers:** create_carrier, edit_carrier, delete_carrier, view_carriers, search_carrier
            
            **Bookings:** create_booking, edit_booking, delete_booking, view_bookings, view_booking_details, update_booking_status, track_shipment
            
            **Bill of Lading:** create_bol, edit_bol, delete_bol, view_bols, view_bol_details, update_bol_status, print_bol
            
            **Freight Quotes:** create_freight_quote, edit_freight_quote, delete_freight_quote, view_freight_quotes, view_freight_quote_details, update_freight_quote_status, compare_freight_quotes, accept_freight_quote
            
            **Supplier Quotes:** create_supplier_quote, request_supplier_quote, edit_supplier_quote, delete_supplier_quote, view_supplier_quotes, view_supplier_quote_details, update_supplier_quote_status, compare_supplier_quotes, accept_supplier_quote, convert_quote_to_po
            
            **Reports:** get_last_price, get_sales_report, get_purchase_report, get_shipment_report, get_freight_report
            
            **Navigation:** navigate_to_page, open_dashboard
            
            **General:** help, greeting, unknown

            ## RESPONSE FORMAT
            Always respond with valid JSON:
            {
              "intent": "<intent_from_list_above>",
              "entities": {
                "customerName": string | null,
                "supplierName": string | null,
                "productName": string | null,
                "carrierName": string | null,
                "quantity": number | null,
                "unitPrice": number | null,
                "priceReference": "last_sale" | "specific" | null,
                "orderNumber": string | null,
                "orderStatus": "draft" | "pending" | "approved" | "completed" | "cancelled" | null,
                "bookingNumber": string | null,
                "bookingStatus": "pending" | "confirmed" | "in_transit" | "delivered" | "cancelled" | null,
                "bolNumber": string | null,
                "bolStatus": "draft" | "issued" | "in_transit" | "delivered" | "completed" | null,
                "freightQuoteNumber": string | null,
                "supplierQuoteNumber": string | null,
                "quoteStatus": "draft" | "sent" | "accepted" | "rejected" | "expired" | null,
                "origin": string | null,
                "originPort": string | null,
                "destination": string | null,
                "destinationPort": string | null,
                "transportMode": "ocean" | "air" | "ground" | "rail" | "multimodal" | null,
                "carrierType": "ocean" | "air" | "ground" | "rail" | "multimodal" | null,
                "serviceType": string | null,
                "etd": string | null,
                "eta": string | null,
                "vesselName": string | null,
                "voyageNumber": string | null,
                "flightNumber": string | null,
                "containerNumber": string | null,
                "containerType": string | null,
                "containerCount": number | null,
                "commodity": string | null,
                "shipperName": string | null,
                "consigneeName": string | null,
                "notifyParty": string | null,
                "goodsDescription": string | null,
                "weight": number | null,
                "weightUnit": "kg" | "lb" | null,
                "volume": number | null,
                "volumeUnit": "cbm" | "cft" | null,
                "freightCost": number | null,
                "currency": string | null,
                "total": number | null,
                "incoterm": string | null,
                "transitTime": string | null,
                "leadTime": string | null,
                "validFrom": string | null,
                "validUntil": string | null,
                "freightTerms": "prepaid" | "collect" | null,
                "code": string | null,
                "name": string | null,
                "email": string | null,
                "phone": string | null,
                "address": string | null,
                "city": string | null,
                "state": string | null,
                "country": string | null,
                "scac": string | null,
                "paymentTerms": string | null,
                "deliveryTerms": string | null,
                "notes": string | null,
                "page": string | null,
                "startDate": string | null,
                "endDate": string | null,
                "searchTerm": string | null
              },
              "missingFields": ["list", "of", "required", "missing", "fields"],
              "response": "Your conversational response to the user",
              "confidence": 0.0 to 1.0
            }

            ## BEHAVIOR RULES
            1. Do NOT ask for more details. Answer based on what you know.
            2. Do NOT repeat the user's message.
            3. Be CONCISE and DIRECT.
            4. Match entity names to the closest available option.
            5. For greetings, use intent "greeting".
            6. If you cannot perform an action, explain why briefly.
            7. Never start a response with "I understand" or "Sure".

            Respond in English.
            Response MUST be valid JSON only. No markdown formatting.
        `;

        const prompt = `
            CONTEXT:
            - Active Customers: ${ctx.stats.customers}
            - Active Suppliers: ${ctx.stats.suppliers}
            - Open Deals: ${ctx.stats.activeDeals}
            - Active Shipments: ${ctx.stats.activeShipments}

            RECENT ACTIVITY:
            - Sales: ${JSON.stringify(ctx.recentActivity.sales)}
            - Purchases: ${JSON.stringify(ctx.recentActivity.pos)}
            - Logistics: ${JSON.stringify(ctx.recentActivity.shipments)}

            HISTORY:
            ${hist.map(h => `${h.role}: ${h.text}`).join('\n')}
        `;

        const response = await ai.models.generateContent({
            model: modelId,
            contents: prompt,
            config: { systemInstruction: systemInstruction }
        });

        const text = response.text?.trim() || '';

        let parsedResponse;
        try {
            // Remove potential markdown code blocks
            const cleanJson = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            parsedResponse = JSON.parse(cleanJson);
        } catch (e) {
            console.error("Failed to parse HALL response:", text);
            return { text: text }; // Fallback to raw text
        }

        // Map the new HALL JSON format to the ActiveAgentResponse expected by the UI
        // We'll map the 'intent' to an 'action' structure if it's actionable

        const mapIntentToActionType = (intent: string): AgentActionType | null => {
            const mapping: Record<string, AgentActionType> = {
                'create_purchase_order': 'CREATE_PO',
                'create_sales_order': 'CREATE_SO',
                'create_supplier': 'CREATE_SUPPLIER',
                'create_customer': 'CREATE_CUSTOMER',
                'create_freight_quote': 'CREATE_FREIGHT_QUOTE',
                // Add more mappings as feasible with current UI support
                // For unsupported intents, we'll return null and handle via text
            };
            return mapping[intent] || null;
        };

        const actionType = mapIntentToActionType(parsedResponse.intent);

        if (actionType && parsedResponse.missingFields.length === 0) {
            return {
                text: parsedResponse.response,
                action: {
                    type: actionType,
                    entities: parsedResponse.entities,
                    missingFields: [],
                    confirmed: false
                }
            };
        } else if (actionType && parsedResponse.missingFields.length > 0) {
            // If missing fields, we don't return a structured 'action' yet because the UI might try to execute it
            // Instead we just return the text response which asks for the missing fields
            return {
                text: parsedResponse.response,
                // We could pass partial action state if the UI supported it, but for now text interaction is safer
            };
        }

        // Default response
        return { text: parsedResponse.response || "I processed that." };

    } catch (e: any) {
        console.error("Dashboard Agent Error:", e);
        return { text: "I encountered an issue. Please try again." };
    }
};

export const getEmailAgentResponse = async (
    userMessage: string,
    history: { role: 'user' | 'model', text: string }[],
    context: any
): Promise<{ text?: string, functionCall?: { name: string, args: any } }> => {
    try {
        // FIX: Removed API_KEY constant to use process.env.API_KEY directly as per guidelines.
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const modelId = MODEL_ID;

        const scanFunction: FunctionDeclaration = {
            name: "scan_unread_emails",
            description: "Scan the user's inbox for unread emails with attachments to find documents.",
        };

        const prompt = `
            You are an AI Email Assistant. 
            Context: ${JSON.stringify(context)}
            User's Request: "${userMessage}"
            
            If the user asks to scan, check, or find new emails/documents/invoices, call the 'scan_unread_emails' tool.
            Otherwise, answer their question based on the context provided.
            Current status: ${context.status}.
            Unread emails count: ${context.unreadEmails?.length || 0}.
        `;

        const response = await ai.models.generateContent({
            model: modelId,
            contents: prompt,
            config: {
                tools: [{ functionDeclarations: [scanFunction] }],
            }
        });

        const fc = response.functionCalls?.[0];
        if (fc) {
            return { functionCall: { name: fc.name, args: fc.args } };
        }

        return { text: response.text || "I'm listening." };
    } catch (error) {
        console.error("Email Agent Error:", error);
        return { text: "I encountered an error connecting to the email intelligence." };
    }
};

export const getCustomerPortalAgentResponse = async (msg: string, hist: { role: 'user' | 'model', text: string }[], ctx: any) => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const modelId = MODEL_ID;

        const langInstruction = ctx.language === 'pt' ? 'Answer in Portuguese (Brazil).'
            : ctx.language === 'es' ? 'Answer in Spanish.'
                : ctx.language === 'zh' ? 'Answer in Mandarin Chinese.'
                    : 'Answer in English.';

        // Compact data extraction - only essential fields to minimize tokens
        const extractOrderSummary = (orders: any[]) => (orders || []).slice(0, 10).map(o => ({
            id: o.salesOrderNumber || o.id,
            status: o.status,
            product: o.product?.substring(0, 50),
            qty: o.qty,
            date: o.createdAt?.substring(0, 10)
        }));

        const extractBookingSummary = (bookings: any[]) => (bookings || []).slice(0, 10).map(b => ({
            id: b.bookingNumber || b.id,
            status: b.status,
            vessel: b.vessel,
            etd: b.etd?.substring(0, 10),
            eta: b.eta?.substring(0, 10)
        }));

        const extractBLSummary = (bls: any[]) => (bls || []).slice(0, 10).map(b => ({
            id: b.blNumber || b.id,
            status: b.status,
            containers: b.containers?.length || 0
        }));

        const extractInvoiceSummary = (invoices: any[]) => (invoices || []).slice(0, 10).map(i => ({
            id: i.invoiceNumber || i.id,
            status: i.status,
            amount: i.totalAmount,
            date: i.invoiceDate?.substring(0, 10)
        }));

        // Limit conversation history to last 5 messages
        const recentHistory = hist.slice(-5);
        const conversation = recentHistory.map(h => `${h.role}: ${h.text}`).join('\n');

        const systemInstruction = `You are MAX, a direct and professional AI assistant for customer portal.

CRITICAL RULES:
1. Be BRIEF and DIRECT. No unnecessary words.
2. Answer in 1-3 sentences maximum.
3. No greetings, no pleasantries, no filler text.
4. Professional tone - no emojis.
5. ${langInstruction}
6. Use ONLY the data below. If not found, say "not found in recent data."

DATA: Orders: ${JSON.stringify(extractOrderSummary(ctx.salesOrders))} | Bookings: ${JSON.stringify(extractBookingSummary(ctx.bookings))} | BLs: ${JSON.stringify(extractBLSummary(ctx.billOfLadings))} | Invoices: ${JSON.stringify(extractInvoiceSummary(ctx.invoices))}`;

        const fullPrompt = `
Conversation:
${conversation}

User: "${msg}"
`;

        const response = await ai.models.generateContent({
            model: modelId,
            contents: fullPrompt,
            config: {
                systemInstruction: systemInstruction,
            }
        });

        return response.text || "I am sorry, I am having trouble finding that information right now.";
    } catch (e: any) {
        console.error("Customer Portal Agent Error:", e);

        const keyStatus = process.env.API_KEY ? `Key present (${process.env.API_KEY.substring(0, 4)}...)` : 'Key undefined/empty';
        console.error(`Gemini Debug - API Key Status: ${keyStatus}`);
        if (e.message) console.error(`Gemini Debug - Message: ${e.message}`);

        if (e.message?.includes('400') || e.status === 400) {
            return ctx.language === 'pt' ? "Estou tendo dificuldade para processar. Por favor, pergunte sobre um pedido específico."
                : ctx.language === 'es' ? "Tengo problemas para procesar. Por favor, pregunte sobre un pedido específico."
                    : ctx.language === 'zh' ? "处理时遇到问题。请询问具体的订单。"
                        : "I'm having trouble processing. Please ask about a specific order.";
        }
        if (e.message?.includes('403') || e.status === 403 || !process.env.API_KEY) {
            return "Configuration Error: AI Service Key not accessible.";
        }

        return ctx.language === 'pt' ? "Estou tendo problemas para conectar. Tente novamente."
            : ctx.language === 'es' ? "Tengo problemas para conectar. Inténtalo de nuevo."
                : ctx.language === 'zh' ? "连接出现问题。请稍后再试。"
                    : "I'm having trouble connecting. Please try again.";
    }
};

// --- ETA LOOKUP VIA GEMINI SEARCH GROUNDING ---

export interface ETALookupResult {
    eta: string | null;
    etd: string | null;
    vesselName: string | null;
    status: string | null;
    source: string | null;
    lastPort: string | null;
    error: string | null;
}

export const lookupShipmentETA = async (params: {
    blNumber?: string;
    containerNumbers?: string[];
    vesselVoyage?: string;
    carrier?: string;
    pod?: string;
}): Promise<ETALookupResult> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        // Detect carrier from BL number prefix
        const carrierPrefixes: Record<string, string> = {
            'ZIMU': 'ZIM', 'ZISU': 'ZIM',
            'MAEU': 'Maersk', 'MRKU': 'Maersk', 'MSKU': 'Maersk',
            'MSCU': 'MSC', 'MEDU': 'MSC',
            'CMDU': 'CMA CGM', 'CGMU': 'CMA CGM',
            'HLCU': 'Hapag-Lloyd', 'HLXU': 'Hapag-Lloyd',
            'COSU': 'COSCO', 'CCLU': 'COSCO',
            'EGLV': 'Evergreen', 'EGHU': 'Evergreen',
            'ONEY': 'ONE', 'ONEU': 'ONE',
            'HDMU': 'Hyundai (HMM)', 'HMMU': 'HMM',
            'YMLU': 'Yang Ming',
            'OOLU': 'OOCL',
            'SUDU': 'Hamburg Süd',
        };

        let detectedCarrier = params.carrier || '';
        if (params.blNumber && !detectedCarrier) {
            const prefix = params.blNumber.substring(0, 4).toUpperCase();
            if (carrierPrefixes[prefix]) {
                detectedCarrier = carrierPrefixes[prefix];
            }
        }
        // Also try container number prefixes
        if (!detectedCarrier && params.containerNumbers?.length) {
            for (const cn of params.containerNumbers) {
                const prefix = cn.substring(0, 4).toUpperCase();
                if (carrierPrefixes[prefix]) {
                    detectedCarrier = carrierPrefixes[prefix];
                    break;
                }
            }
        }

        // Build search query from available identifiers
        const identifiers: string[] = [];
        if (params.blNumber) identifiers.push(`Bill of Lading (B/L) number: ${params.blNumber}`);
        if (params.containerNumbers?.length) identifiers.push(`Container number(s): ${params.containerNumbers.join(', ')}`);
        if (params.vesselVoyage) identifiers.push(`Vessel/Voyage: ${params.vesselVoyage}`);
        if (detectedCarrier) identifiers.push(`Shipping Line: ${detectedCarrier}`);
        if (params.pod) identifiers.push(`Destination port: ${params.pod}`);

        if (identifiers.length === 0) {
            return { eta: null, etd: null, vesselName: null, status: null, source: null, lastPort: null, error: 'No BL number or container number provided' };
        }

        // Build carrier-specific tracking site hints
        const carrierTrackingSites: Record<string, string> = {
            'ZIM': 'https://www.zim.com/tools/track-a-shipment',
            'Maersk': 'https://www.maersk.com/tracking',
            'MSC': 'https://www.msc.com/en/track-a-shipment',
            'CMA CGM': 'https://www.cma-cgm.com/ebusiness/tracking',
            'Hapag-Lloyd': 'https://www.hapag-lloyd.com/en/online-business/track/track-by-booking-solution.html',
            'COSCO': 'https://elines.coscoshipping.com/ebusiness/cargoTracking',
            'Evergreen': 'https://www.evergreen-line.com/tracking',
            'ONE': 'https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking',
            'HMM': 'https://www.hmm21.com/cms/business/ebiz/trackTrace/trackTrace/index.jsp',
            'Yang Ming': 'https://www.yangming.com/e-service/Track_Trace/track_trace_cargo_tracking.aspx',
            'OOCL': 'https://www.oocl.com/eng/ourServices/eServices/CargoTracking',
        };

        let trackingHint = '';
        if (detectedCarrier && carrierTrackingSites[detectedCarrier]) {
            trackingHint = `\nThe carrier appears to be ${detectedCarrier}. Try searching their tracking page: ${carrierTrackingSites[detectedCarrier]}`;
        }

        // Determine the best search identifier
        const primaryId = params.containerNumbers?.[0] || params.blNumber || '';

        const prompt = `You are an expert shipping logistics tracker. Find the CURRENT tracking status and ETA for this ocean freight shipment:

${identifiers.join('\n')}
${trackingHint}

SEARCH STRATEGY — Container numbers are MORE RELIABLE than BL numbers for tracking. Try these in order:
1. If container number(s) are available, search for "${params.containerNumbers?.[0] || ''} container tracking" or "${params.containerNumbers?.[0] || ''} tracking status"
2. Search the carrier's official tracking website using the CONTAINER NUMBER (not BL number)
3. Try general tracking sites with container number: searates.com/container/tracking, trackingmore.com, shipsgo.com
4. Only if no container number is available, try the BL number: "${params.blNumber || ''}"
5. As last resort, search for vessel "${params.vesselVoyage || ''}" schedule/position

IMPORTANT: Look for ACTUAL dates from tracking results, not estimates. The ETA is the estimated arrival date at the destination port. The ETD is the departure date from the origin port.

Return ONLY valid JSON (no markdown, no explanation):
{
    "eta": "MM/DD/YYYY or null if not found",
    "etd": "MM/DD/YYYY or null if not found",
    "vesselName": "vessel name or null",
    "status": "current status (In Transit, Arrived, Departed, Delivered, etc.)",
    "source": "website where you found the tracking info",
    "lastPort": "last known port or current location",
    "error": null
}

If tracking info cannot be found after trying all strategies, set error to a brief explanation.`;

        console.log('[ETA Lookup] Searching with prompt identifiers:', identifiers);

        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }],
            }
        });

        const text = response.text?.trim() || '';
        console.log('[ETA Lookup] Raw response:', text);

        // Parse the JSON response
        try {
            const cleanJson = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const result = JSON.parse(cleanJson) as ETALookupResult;
            return result;
        } catch (parseError) {
            console.error('[ETA Lookup] JSON parse error, raw text:', text);
            return {
                eta: null, etd: null, vesselName: null,
                status: text.substring(0, 200),
                source: 'Gemini Search', lastPort: null,
                error: 'Could not parse structured response'
            };
        }
    } catch (error: any) {
        console.error('[ETA Lookup] Error:', error);
        return {
            eta: null, etd: null, vesselName: null, status: null,
            source: null, lastPort: null,
            error: error.message || 'Failed to look up ETA'
        };
    }
};
