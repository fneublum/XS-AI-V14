
// Phase 1c: routed through gemini-proxy Edge Function instead of the
// SDK, so GEMINI_API_KEY never ships to the browser bundle. The shim
// re-exports GoogleGenAI / Type / FunctionDeclaration with matching
// shapes so every call site in this file works unchanged.
import { GoogleGenAI, Type, FunctionDeclaration } from "./geminiClient";
import { Product, Customer, Opportunity, DealStage, QuoteItem, SupplierQuote, Supplier, PurchaseOrder, SupplierOffer, Port, Shipment, FreightQuote, CostCalculation } from "../types";
import { getSupabaseClient } from "./supabase";
import { normalizeEntities } from "./aiAssistantService";
import { activityLogger } from './activityLogService';
import { getPersona, buildSystemPrompt } from './personaService';
import { buildMemoryContext, storeConversationExchange, runMemoryMaintenance } from './memoryService';

// --- Helper for System Instructions ---
const MODEL_ID = 'gemini-3-pro-preview';

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

/**
 * Translate product descriptions to a target country's language.
 * Uses direct Gemini API call (API key referrer updated to allow appspot.com).
 */
export const translateDescriptions = async (descriptions: string[], targetCountry: string): Promise<string[]> => {
    try {
        console.log('[translateDescriptions] Calling Gemini for', descriptions.length, 'items →', targetCountry);
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `You are a professional translator. Translate these product descriptions to the main language spoken in ${targetCountry}. For example: Brazil → Portuguese, Mexico/Honduras/Colombia → Spanish, China → Chinese, United States → English.

Descriptions:
${descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

Return ONLY a JSON array with exactly ${descriptions.length} translated strings, in the same order. No explanation, no markdown, no code fences. Example: ["translated 1", "translated 2"]`;

        const response = await ai.models.generateContent({ model: MODEL_ID, contents: prompt });
        const rawText = response.text || '[]';
        console.log('[translateDescriptions] Raw response:', rawText.substring(0, 300));
        const cleaned = rawText.replace(/```json\s*|\s*```/g, '').trim();
        const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
        if (!arrayMatch) {
            console.warn('[translateDescriptions] No JSON array found in response');
            return [];
        }
        const translated = JSON.parse(arrayMatch[0]);
        if (Array.isArray(translated) && translated.length > 0) {
            console.log('[translateDescriptions] ✅ Success:', translated.length, 'translations');
            return translated;
        }
        console.warn('[translateDescriptions] Empty or invalid response');
        return [];
    } catch (err) {
        console.error('[translateDescriptions] ❌ Error:', err);
        return [];
    }
};

/**
 * Generate localized UI labels AND a sales-oriented intro paragraph for a proposal document.
 * Returns labels (seller/buyer/description/qty/price/total/incoterm/payment/date + closing) in target country's language.
 */
export const generateProposalLabels = async (
    sellerName: string,
    buyerName: string,
    targetCountry: string
): Promise<Record<string, string>> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `You are a professional international business communications writer.
Generate a JSON object with localized labels and a short sales proposal intro for a B2B commodity trading company.
The seller is "${sellerName}" and the buyer is "${buyerName}", located in ${targetCountry}.
Write everything in the primary business language of ${targetCountry} (e.g. Brazil → Portuguese, Mexico → Spanish, China → Chinese, USA → English, etc.).

Return ONLY a raw JSON object (no markdown, no code fences) with exactly these keys:
{
  "title": "COMMERCIAL PROPOSAL" (translated),
  "labelSeller": "SELLER" (translated),
  "labelBuyer": "BUYER" (translated),
  "labelDate": "DATE" (translated),
  "labelIncoterm": "INCOTERM" (translated),
  "labelPayment": "PAYMENT TERMS" (translated),
  "labelDescription": "DESCRIPTION" (translated),
  "labelQty": "QTY / UNIT" (translated),
  "labelUnitPrice": "UNIT PRICE" (translated),
  "labelAmount": "AMOUNT" (translated),
  "labelTotal": "TOTAL" (translated),
  "labelValidity": "VALIDITY" (translated),
  "validityValue": "30 days from the date of this proposal" (translated),
  "intro": "A single short paragraph (2-3 sentences) in a warm, professional, sales-oriented tone addressed to ${buyerName}, expressing enthusiasm to offer high-quality products and the commitment to deliver value. Do NOT list products. Keep it under 50 words.",
  "closing": "A single closing sentence thanking ${buyerName} and inviting them to confirm or negotiate. Under 25 words."
}`;

        const response = await ai.models.generateContent({ model: MODEL_ID, contents: prompt });
        const rawText = (response.text || '{}').replace(/```json\s*|\s*```/g, '').trim();
        const objMatch = rawText.match(/\{[\s\S]*\}/);
        if (!objMatch) return {};
        return JSON.parse(objMatch[0]);
    } catch (err) {
        console.error('[generateProposalLabels] ❌ Error:', err);
        return {};
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
        const prompt = `Summarize this email as a concise bullet-point list. Focus on what the sender is asking for, key requests, action items, or important information. Each bullet should be one short line. Sender: ${sender}, Subject: ${subject}, Body: ${body.substring(0, 2000)}.`;
        const response = await ai.models.generateContent({ model: MODEL_ID, contents: prompt });
        return response.text || "";
    } catch (e) { return "Error"; }
};

export const generateEmailReply = async (sender: string, originalBody: string, tone: string): Promise<string> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `You are drafting an email reply. IMPORTANT RULES:
- Use ONLY the information provided below (email + reference documents + user instructions).
- NEVER use placeholders like [Insert Date] or **[value]**. If the data is in the reference documents, use the actual values. If a value is truly not available, omit that point or say "to be confirmed".
- Address each point/question in the original email using data from the reference documents.
- Tone: ${tone}.
- Output the email body only (no subject line, no "Subject:" prefix).

ORIGINAL EMAIL FROM ${sender}:
${originalBody.substring(0, 6000)}

Draft the reply now:`;
        const response = await ai.models.generateContent({ model: MODEL_ID, contents: prompt });
        return response.text || "";
    } catch (e) { return "Error"; }
};

/**
 * AI Email Agent — analyzes an email thread + ERP context and reasons a reply.
 * Returns structured JSON with the draft reply, reasoning, priority, and whether it expects a reply.
 */
export const reasonEmailReply = async (
    thread: { from: string; to: string; subject: string; body: string; date: string }[],
    erpContext: string,
    userEmail: string
): Promise<{
    shouldReply: boolean;
    draftReply: string;
    reasoning: string;
    priority: 'high' | 'medium' | 'low';
    expectsReply: boolean;
    category: string;
}> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        const threadText = thread.map((m, i) =>
            `--- Message ${i + 1} (${m.date}) ---\nFrom: ${m.from}\nTo: ${m.to}\nSubject: ${m.subject}\n\n${m.body.substring(0, 3000)}`
        ).join('\n\n');

        const prompt = `You are an AI email agent for a B2B commodity trading company (textile fibers, plastic resins, recycled materials).
The user's email is: ${userEmail}

TASK: Analyze this email thread and decide if/how to reply, using the ERP context provided.

EMAIL THREAD (oldest to newest):
${threadText}

ERP CONTEXT (matching records from the company database):
${erpContext.substring(0, 8000)}

RULES:
1. Decide if this email NEEDS a reply from us. Newsletters, automated notifications, marketing emails, and internal system alerts do NOT need replies.
2. If a reply is needed, draft a professional reply using ONLY real data from the ERP context. NEVER fabricate numbers, dates, or facts.
3. If data is missing, say "I will confirm and get back to you" instead of making up values.
4. **CRITICAL — LANGUAGE MATCHING**: You MUST detect the language used in the email thread (especially the most recent messages) and ALWAYS reply in that SAME language. If the thread is in Portuguese, your reply MUST be entirely in Portuguese. If in Spanish, reply in Spanish. If in English, reply in English. NEVER switch languages. This is the most important rule.
5. Reference specific order numbers, shipment details, prices, and dates from the ERP context when relevant.
6. Keep replies concise and action-oriented.
7. Determine priority: HIGH = money/urgent/overdue, MEDIUM = business operations, LOW = informational.
8. Determine if the LAST message in the thread expects a reply from us (the sender is waiting for our response).
9. When processing booking confirmations, freight quotes, shipping documents, or other operational documents that match existing records in the ERP context, NEVER ask the user whether to "create a new record" or "update the existing one". The system saves and updates records automatically — just confirm the document was received and logged.

Return ONLY valid JSON:
{
  "shouldReply": true/false,
  "draftReply": "the full email reply body (empty string if shouldReply=false)",
  "reasoning": "1-2 sentence explanation of why this reply is appropriate and what ERP data was used",
  "priority": "high|medium|low",
  "expectsReply": true/false (does the sender expect us to reply?),
  "category": "order|shipment|pricing|payment|documentation|general|no-reply"
}`;

        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        shouldReply: { type: Type.BOOLEAN },
                        draftReply: { type: Type.STRING },
                        reasoning: { type: Type.STRING },
                        priority: { type: Type.STRING },
                        expectsReply: { type: Type.BOOLEAN },
                        category: { type: Type.STRING }
                    }
                }
            }
        });

        if (response.text) {
            return JSON.parse(response.text);
        }
        return { shouldReply: false, draftReply: '', reasoning: 'No response from AI', priority: 'low', expectsReply: false, category: 'no-reply' };
    } catch (e) {
        console.error('reasonEmailReply error:', e);
        return { shouldReply: false, draftReply: '', reasoning: 'AI error', priority: 'low', expectsReply: false, category: 'no-reply' };
    }
};

// ─── PO Extraction Types ─────────────────────────────────────────────────────

export interface ExtractedPOLineItem {
    productName: string;
    productDescription?: string;
    sku?: string;
    hsCode?: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    total: number;
}

export interface ExtractedPOData {
    isPurchaseOrder: boolean;
    confidence: number;
    poNumber?: string;
    customerName: string;
    customerEmail: string;
    customerCompany?: string;
    customerContactPerson?: string;
    customerPhone?: string;
    customerAddress?: string;
    customerCity?: string;
    customerCountry?: string;
    items: ExtractedPOLineItem[];
    totalAmount: number;
    currency: string;
    paymentTerms?: string;
    incoterm?: string;
    deliveryDate?: string;
    shippingRequired: boolean;
    portOfLoading?: string;
    portOfDestination?: string;
    equipment?: string;
    notes?: string;
}

/**
 * AI Email Agent — extracts structured Purchase Order data from an email thread.
 * Identifies customer info, line items, shipping requirements, and payment terms.
 */
export const extractPOFromEmail = async (
    thread: { from: string; to: string; subject: string; body: string; date: string }[],
    erpContext: string,
    attachmentTexts?: string[]
): Promise<ExtractedPOData> => {
    const defaultResult: ExtractedPOData = {
        isPurchaseOrder: false, confidence: 0, customerName: '', customerEmail: '',
        items: [], totalAmount: 0, currency: 'USD', shippingRequired: false,
    };
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        const threadText = thread.map((m, i) =>
            `--- Message ${i + 1} (${m.date}) ---\nFrom: ${m.from}\nTo: ${m.to}\nSubject: ${m.subject}\n\n${m.body.substring(0, 4000)}`
        ).join('\n\n');

        const attachmentSection = attachmentTexts?.length
            ? `\n\nATTACHMENT CONTENT (extracted from PDF/image):\n${attachmentTexts.join('\n---\n').substring(0, 6000)}`
            : '';

        const prompt = `You are an AI agent for a B2B commodity trading company (textile fibers, plastic resins, recycled materials).

TASK: Extract structured Purchase Order (PO) data from this email thread. A PO is when a CUSTOMER is placing an order to BUY products from us.

EMAIL THREAD:
${threadText}
${attachmentSection}

ERP CONTEXT (existing records):
${erpContext.substring(0, 6000)}

EXTRACTION RULES:
1. Determine if this email actually contains a Purchase Order or order request. Look for: product names with quantities/prices, "PO", "order", "purchase order", item lists, delivery terms.
2. Extract the CUSTOMER info from the sender and email content. The customer is the one BUYING from us.
3. Extract ALL line items with product names, quantities, units, prices.
4. Identify shipping requirements: if international trade terms (incoterms like FOB, CIF, CFR) or port names are mentioned, set shippingRequired=true.
5. Use ERP context to fill gaps — if the sender matches a known customer, use their stored details.
6. Currency: look for $, USD, EUR, BRL, etc. Default to USD if unclear.
7. Calculate totalAmount as sum of all item totals.
8. Set confidence 0.0-1.0 based on how clearly this is a PO.

Return structured JSON with all extracted fields.`;

        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        isPurchaseOrder: { type: Type.BOOLEAN },
                        confidence: { type: Type.NUMBER },
                        poNumber: { type: Type.STRING },
                        customerName: { type: Type.STRING },
                        customerEmail: { type: Type.STRING },
                        customerCompany: { type: Type.STRING },
                        customerContactPerson: { type: Type.STRING },
                        customerPhone: { type: Type.STRING },
                        customerAddress: { type: Type.STRING },
                        customerCity: { type: Type.STRING },
                        customerCountry: { type: Type.STRING },
                        items: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    productName: { type: Type.STRING },
                                    productDescription: { type: Type.STRING },
                                    sku: { type: Type.STRING },
                                    hsCode: { type: Type.STRING },
                                    quantity: { type: Type.NUMBER },
                                    unit: { type: Type.STRING },
                                    unitPrice: { type: Type.NUMBER },
                                    total: { type: Type.NUMBER },
                                }
                            }
                        },
                        totalAmount: { type: Type.NUMBER },
                        currency: { type: Type.STRING },
                        paymentTerms: { type: Type.STRING },
                        incoterm: { type: Type.STRING },
                        deliveryDate: { type: Type.STRING },
                        shippingRequired: { type: Type.BOOLEAN },
                        portOfLoading: { type: Type.STRING },
                        portOfDestination: { type: Type.STRING },
                        equipment: { type: Type.STRING },
                        notes: { type: Type.STRING },
                    }
                }
            }
        });

        if (response.text) {
            return JSON.parse(response.text);
        }
        return defaultResult;
    } catch (e) {
        console.error('extractPOFromEmail error:', e);
        return defaultResult;
    }
};

/**
 * AI Email Agent — generates a follow-up email when no reply was received.
 */
export const reasonFollowUp = async (
    originalThread: { from: string; to: string; subject: string; body: string; date: string }[],
    daysSinceSent: number,
    erpContext: string
): Promise<{ draftFollowUp: string; reasoning: string }> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        const threadText = originalThread.map((m, i) =>
            `--- Message ${i + 1} (${m.date}) ---\nFrom: ${m.from}\nTo: ${m.to}\nSubject: ${m.subject}\n\n${m.body.substring(0, 2000)}`
        ).join('\n\n');

        const prompt = `You are an AI email agent for a B2B commodity trading company.

TASK: Write a follow-up email. We sent the last message ${daysSinceSent} days ago and haven't received a reply.

ORIGINAL THREAD:
${threadText}

ERP CONTEXT:
${erpContext.substring(0, 4000)}

RULES:
1. Be polite but clear — reference the original topic.
2. If ${daysSinceSent} <= 3: gentle check-in. If 4-7: firmer follow-up. If > 7: urgent/final follow-up.
3. Use ONLY real data from ERP context. Never fabricate.
4. **CRITICAL**: You MUST write the follow-up in the SAME language as the thread. If Portuguese, write in Portuguese. If Spanish, write in Spanish. NEVER switch languages.
5. Keep it short (3-5 sentences max).

Return ONLY valid JSON:
{
  "draftFollowUp": "the follow-up email body",
  "reasoning": "why this follow-up is appropriate"
}`;

        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        draftFollowUp: { type: Type.STRING },
                        reasoning: { type: Type.STRING }
                    }
                }
            }
        });

        if (response.text) return JSON.parse(response.text);
        return { draftFollowUp: '', reasoning: 'No AI response' };
    } catch (e) {
        console.error('reasonFollowUp error:', e);
        return { draftFollowUp: '', reasoning: 'AI error' };
    }
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
    const _t0 = Date.now();
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
        activityLogger.logAiInteraction({ aiService: 'gemini', agentType: 'sales_agent', userPrompt: userMessage, responseTimeMs: Date.now() - _t0, error: String(error) });
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
    const _t0 = Date.now();
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        console.log(`GeminiService analyzeDocument: Using model ${MODEL_ID}`);

        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: { parts: [{ inlineData: { mimeType: mimeType, data: fileBase64 } }, { text: prompt }] }
        });
        const result = response.text || "";

        // ── Brain Integration: Log every document OCR to the centralized brain ──
        // Detect document type from the prompt to build memory
        try {
            const { brainService } = await import('./brainService');
            const docTypeHint = detectDocTypeFromPrompt(prompt);
            const resultPreview = result.substring(0, 300);

            // Log interaction (fire-and-forget, never blocks the OCR response)
            brainService.logInteraction({
                source: 'document',
                type: 'document_extract',
                userId: 'system', // Will be enriched by the caller context
                companyId: '',
                inputSummary: `Document OCR [${mimeType}] — ${docTypeHint}`,
                outputSummary: resultPreview,
                metadata: {
                    mimeType,
                    docType: docTypeHint,
                    resultLength: result.length,
                    processingTimeMs: Date.now() - _t0,
                    promptHint: prompt.substring(0, 100)
                }
            }).catch(() => { }); // Never fail the OCR because of brain logging
        } catch {
            // Brain service not available — silent fail
        }

        return result;
    } catch (e: any) {
        const keyStatus = process.env.API_KEY ? `Key present (${process.env.API_KEY.substring(0, 8)}...)` : 'Key undefined or empty';
        console.error("Gemini Document Analysis Error:", e);
        console.error(`API Key Status: ${keyStatus}`);
        return "Error analyzing doc: " + (e.message || String(e));
    }
};

/**
 * Helper: detect document type from the OCR prompt text.
 * Used by brain to categorize document interactions without parsing the full prompt.
 */
function detectDocTypeFromPrompt(prompt: string): string {
    const p = prompt.toUpperCase();
    if (p.includes('BILL OF LADING') || p.includes('B/L')) return 'BILL_OF_LADING';
    if (p.includes('PURCHASE ORDER') || p.includes('PO NUMBER')) return 'PURCHASE_ORDER';
    if (p.includes('INVOICE') && p.includes('SUPPLIER')) return 'SUPPLIER_INVOICE';
    if (p.includes('INVOICE')) return 'INVOICE';
    if (p.includes('PROFORMA') || p.includes('ESTIMATE')) return 'ESTIMATE';
    if (p.includes('BOOKING')) return 'BOOKING';
    if (p.includes('PACKING LIST')) return 'PACKING_LIST';
    if (p.includes('FREIGHT') && p.includes('QUOTE')) return 'FREIGHT_QUOTE';
    if (p.includes('COMMISSION')) return 'COMMISSION_DOC';
    if (p.includes('CLASSIFY') || p.includes('IDENTIFY') || p.includes('CATEGORY')) return 'IDENTIFICATION';
    return 'GENERAL_DOCUMENT';
}

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
    const _t0 = Date.now();
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
        const responseText = response.text || "I couldn't generate a procurement response.";
        activityLogger.logAiInteraction({ aiService: 'gemini', agentType: 'procurement_agent', userPrompt: msg, responseLength: responseText.length, responseTimeMs: Date.now() - _t0 });
        return responseText;
    } catch (e) {
        activityLogger.logAiInteraction({ aiService: 'gemini', agentType: 'procurement_agent', userPrompt: msg, responseTimeMs: Date.now() - _t0, error: String(e) });
        console.error("Procurement Agent Error:", e);
        return "I'm having trouble accessing procurement data.";
    }
};

export const getLogisticsAgentResponse = async (
    msg: string,
    hist: { role: 'user' | 'model'; text: string }[],
    ctx: any
): Promise<{ text: string, toolCalls?: any[] }> => {
    const _t0 = Date.now();
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

        const result = {
            text: response.text || (response.functionCalls ? "Processing request..." : "No response generated."),
            toolCalls: response.functionCalls
        };
        activityLogger.logAiInteraction({ aiService: 'gemini', agentType: 'logistics_agent', userPrompt: msg, responseLength: result.text.length, responseTimeMs: Date.now() - _t0, toolsUsed: result.toolCalls?.map((tc: any) => tc.name) });
        return result;
    } catch (e) {
        activityLogger.logAiInteraction({ aiService: 'gemini', agentType: 'logistics_agent', userPrompt: msg, responseTimeMs: Date.now() - _t0, error: String(e) });
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

export type AgentActionType =
    // CREATE
    | 'CREATE_PO' | 'CREATE_SO' | 'CREATE_SUPPLIER' | 'CREATE_CUSTOMER' | 'CREATE_CARGO_AGENT'
    | 'CREATE_FREIGHT_QUOTE' | 'CREATE_PRODUCT' | 'CREATE_CARRIER' | 'CREATE_PORT' | 'CREATE_BANK' | 'CREATE_LOCATION'
    | 'REQUEST_BOOKING'
    // UPDATE
    | 'UPDATE_CUSTOMER' | 'UPDATE_SUPPLIER' | 'UPDATE_PRODUCT' | 'UPDATE_CARGO_AGENT'
    | 'UPDATE_SO_STATUS' | 'UPDATE_PO_STATUS' | 'UPDATE_BOOKING_STATUS'
    // DELETE
    | 'DELETE_CUSTOMER' | 'DELETE_SUPPLIER' | 'DELETE_PRODUCT' | 'DELETE_FREIGHT_QUOTE'
    | 'DELETE_CARGO_AGENT' | 'DELETE_CARRIER' | 'DELETE_PORT' | 'DELETE_BANK' | 'DELETE_LOCATION'
    | 'DELETE_SO' | 'DELETE_PO' | 'DELETE_BOOKING' | 'DELETE_BOL'
    | 'DELETE_INVOICE' | 'DELETE_SUPPLIER_INVOICE' | 'DELETE_PACKING_LIST' | 'DELETE_ESTIMATE' | 'DELETE_PROFORMA'
    // SHOW
    | 'SHOW_FREIGHT_QUOTES' | 'SHOW_BOOKINGS' | 'SHOW_BOLS' | 'SHOW_CUSTOMERS' | 'SHOW_SUPPLIERS'
    | 'SHOW_PRODUCTS' | 'SHOW_SALES_ORDERS' | 'SHOW_PURCHASE_ORDERS' | 'SHOW_INVOICES'
    | 'SHOW_SUPPLIER_INVOICES' | 'SHOW_ESTIMATES' | 'SHOW_PROFORMAS' | 'SHOW_PACKING_LISTS'
    | 'SHOW_COMMISSIONS' | 'SHOW_CARGO_AGENTS' | 'SHOW_CARRIERS' | 'SHOW_PORTS' | 'SHOW_BANKS' | 'SHOW_LOCATIONS'
    // FLOW
    | 'CONFIRM' | 'CANCEL' | 'CHAT';

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
        // Address fields
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
        // Product fields
        code?: string;
        category?: string;
        hsCode?: string;
        goodsDescription?: string;
        notes?: string;
        unitPrice?: number;
        weightUnit?: string;
        grade?: string;
        description?: string;
        sku?: string;
        stockStatus?: string;
        contact?: string;
        // Carrier fields
        carrierName?: string;
        scac?: string;
        name?: string;
        // Port fields
        portName?: string;
        portCode?: string;
        // Bank fields
        bankName?: string;
        bankCode?: string;
        swiftCode?: string;
        routingNumber?: string;
        accountNumber?: string;
        // Location fields
        locationName?: string;
        entityType?: string;
        entityName?: string;
        // Order/Doc identifiers
        orderNumber?: string;
        invoiceNumber?: string;
        estimateNumber?: string;
        piNumber?: string;
        plNumber?: string;
        // Status updates
        status?: string;
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
        recentActivity: { sales: string[], pos: string[], shipments: string[] },
        salesOrders?: any[],
        purchaseOrders?: any[],
        bookings?: any[],
        billOfLadings?: any[],
        freightQuotes?: any[],
        invoices?: any[],
        estimates?: any[],
        proformas?: any[],
        packingLists?: any[],
        supplierInvoices?: any[],
        commissions?: any[],
    },
    pendingAction?: AgentAction,
    awaitingConfirmation?: boolean,
    userId?: string
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

        // Load dynamic persona from Supabase (cached 5 min)
        const persona = await getPersona();
        const personaHeader = buildSystemPrompt(persona);

        // Load memory context from Supabase (topic-aware smart recall)
        const memoryContext = userId ? await buildMemoryContext(userId, msg, 8) : '';

        const systemInstruction = `
            ${personaHeader}${memoryContext}
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
            
            **Cargo Agents:** create_cargo_agent, edit_cargo_agent, delete_cargo_agent, view_cargo_agents, search_cargo_agent
            
            **Carriers:** create_carrier, edit_carrier, delete_carrier, view_carriers, search_carrier
            
            **Ports:** create_port, delete_port, view_ports
            
            **Banks:** create_bank, delete_bank, view_banks
            
            **Locations:** create_location, delete_location, view_locations
            
            **Sales Orders:** create_sales_order, delete_sales_order, view_sales_orders, update_so_status
            
            **Purchase Orders:** create_purchase_order, delete_purchase_order, view_purchase_orders, update_po_status
            
            **Bookings:** create_booking, delete_booking, view_bookings, view_booking_details, update_booking_status, track_shipment
            
            **Bill of Lading:** delete_bol, view_bols, view_bol_details
            
            **Freight Quotes:** create_freight_quote, edit_freight_quote, delete_freight_quote, view_freight_quotes, compare_freight_quotes
            
            **Invoices:** delete_invoice, view_invoices
            
            **Supplier Invoices:** delete_supplier_invoice, view_supplier_invoices
            
            **Packing Lists:** delete_packing_list, view_packing_lists
            
            **Estimates:** delete_estimate, view_estimates
            
            **Proformas:** delete_proforma, view_proformas
            
            **Commissions:** view_commissions
            
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
                "contactPerson": string | null,
                "agentName": string | null,
                "rate": number | null,
                "price": number | null,
                "pol": string | null,
                "pod": string | null,
                "equipment": string | null,
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

            ## DATA QUERY RULES
            When the user asks about Sales Orders (SO), Purchase Orders (PO), Bookings, Bills of Lading (BL), Freight Quotes, Invoices, Estimates, Proforma Invoices, Packing Lists (PL), Supplier Invoices, or Commissions:
            1. Search ALL provided DATA sections (SALES ORDERS, PURCHASE ORDERS, BOOKINGS, BILLS OF LADING, FREIGHT QUOTES, INVOICES, ESTIMATES, PROFORMAS, PACKING LISTS, SUPPLIER INVOICES, COMMISSIONS).
            2. Match by number, customer name, supplier name, carrier, port, or any relevant field. Use fuzzy/partial matching.
            3. Provide specific data-backed answers with actual values from the records.
            4. If multiple matches, list them concisely.
            5. If no match, say so clearly.
            6. For questions like "how much", "what price", "what status" — look up the specific record and answer directly.

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

            SALES ORDERS DATA:
            ${JSON.stringify(ctx.salesOrders || [])}

            PURCHASE ORDERS DATA:
            ${JSON.stringify(ctx.purchaseOrders || [])}

            BOOKINGS DATA:
            ${JSON.stringify(ctx.bookings || [])}

            BILLS OF LADING DATA:
            ${JSON.stringify(ctx.billOfLadings || [])}

            FREIGHT QUOTES DATA:
            ${JSON.stringify(ctx.freightQuotes || [])}

            INVOICES DATA:
            ${JSON.stringify(ctx.invoices || [])}

            ESTIMATES DATA:
            ${JSON.stringify(ctx.estimates || [])}

            PROFORMA INVOICES DATA:
            ${JSON.stringify(ctx.proformas || [])}

            PACKING LISTS DATA:
            ${JSON.stringify(ctx.packingLists || [])}

            SUPPLIER INVOICES DATA:
            ${JSON.stringify(ctx.supplierInvoices || [])}

            COMMISSIONS DATA:
            ${JSON.stringify(ctx.commissions || [])}

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
            console.error("Failed to parse XS AI response:", text);
            return { text: text }; // Fallback to raw text
        }

        // DEBUG: Log Gemini's raw parsed response for testing
        console.log('[XS-AI-DEBUG] Gemini parsed:', JSON.stringify(parsedResponse));

        // Map the new HALL JSON format to the ActiveAgentResponse expected by the UI
        // We'll map the 'intent' to an 'action' structure if it's actionable

        const mapIntentToActionType = (intent: string): AgentActionType | null => {
            const mapping: Record<string, AgentActionType> = {
                // CREATE
                'create_purchase_order': 'CREATE_PO',
                'create_sales_order': 'CREATE_SO',
                'create_supplier': 'CREATE_SUPPLIER',
                'create_customer': 'CREATE_CUSTOMER',
                'create_product': 'CREATE_PRODUCT',
                'create_freight_quote': 'CREATE_FREIGHT_QUOTE',
                'create_booking': 'REQUEST_BOOKING',
                'create_cargo_agent': 'CREATE_CARGO_AGENT',
                'create_carrier': 'CREATE_CARRIER',
                'create_port': 'CREATE_PORT',
                'create_bank': 'CREATE_BANK',
                'create_location': 'CREATE_LOCATION',
                // UPDATE
                'edit_customer': 'UPDATE_CUSTOMER',
                'edit_supplier': 'UPDATE_SUPPLIER',
                'edit_product': 'UPDATE_PRODUCT',
                'edit_cargo_agent': 'UPDATE_CARGO_AGENT',
                'update_so_status': 'UPDATE_SO_STATUS',
                'update_po_status': 'UPDATE_PO_STATUS',
                'update_booking_status': 'UPDATE_BOOKING_STATUS',
                // DELETE
                'delete_customer': 'DELETE_CUSTOMER',
                'delete_supplier': 'DELETE_SUPPLIER',
                'delete_product': 'DELETE_PRODUCT',
                'delete_freight_quote': 'DELETE_FREIGHT_QUOTE',
                'delete_cargo_agent': 'DELETE_CARGO_AGENT',
                'delete_carrier': 'DELETE_CARRIER',
                'delete_port': 'DELETE_PORT',
                'delete_bank': 'DELETE_BANK',
                'delete_location': 'DELETE_LOCATION',
                'delete_sales_order': 'DELETE_SO',
                'delete_purchase_order': 'DELETE_PO',
                'delete_booking': 'DELETE_BOOKING',
                'delete_bol': 'DELETE_BOL',
                'delete_invoice': 'DELETE_INVOICE',
                'delete_supplier_invoice': 'DELETE_SUPPLIER_INVOICE',
                'delete_packing_list': 'DELETE_PACKING_LIST',
                'delete_estimate': 'DELETE_ESTIMATE',
                'delete_proforma': 'DELETE_PROFORMA',
                // SHOW
                'view_freight_quotes': 'SHOW_FREIGHT_QUOTES',
                'view_bookings': 'SHOW_BOOKINGS',
                'view_bols': 'SHOW_BOLS',
                'view_customers': 'SHOW_CUSTOMERS',
                'view_suppliers': 'SHOW_SUPPLIERS',
                'view_products': 'SHOW_PRODUCTS',
                'view_sales_orders': 'SHOW_SALES_ORDERS',
                'view_purchase_orders': 'SHOW_PURCHASE_ORDERS',
                'view_invoices': 'SHOW_INVOICES',
                'view_supplier_invoices': 'SHOW_SUPPLIER_INVOICES',
                'view_estimates': 'SHOW_ESTIMATES',
                'view_proformas': 'SHOW_PROFORMAS',
                'view_packing_lists': 'SHOW_PACKING_LISTS',
                'view_commissions': 'SHOW_COMMISSIONS',
                'view_cargo_agents': 'SHOW_CARGO_AGENTS',
                'view_carriers': 'SHOW_CARRIERS',
                'view_ports': 'SHOW_PORTS',
                'view_banks': 'SHOW_BANKS',
                'view_locations': 'SHOW_LOCATIONS',
            };
            return mapping[intent] || null;
        };

        const actionType = mapIntentToActionType(parsedResponse.intent);

        if (actionType) {
            // Normalize Gemini's entity field names to our canonical names
            const normalizedEntities = normalizeEntities(parsedResponse.entities || {});
            return {
                text: parsedResponse.response,
                action: {
                    type: actionType,
                    entities: normalizedEntities,
                    missingFields: [], // Code-side validation in AiDashboard computes real missing fields
                    confirmed: false
                }
            };
        }

        // Default response
        const responseText = parsedResponse.response || "I processed that.";

        // Store conversation exchange in memory (async, don't await)
        if (userId) {
            storeConversationExchange(userId, msg, responseText).catch(() => { });
        }

        return { text: responseText };

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

// --- BOB AI ASSISTANT ---

export interface BobContext {
    activeModule: string;
    subModule: string;
    userName: string;
    userRole: string;
    currentCompany: string;
    allowedModules: string[];
    data: {
        customers?: { count: number; sample: string[] };
        products?: { count: number; sample: string[] };
        salesOrders?: { count: number; recent: any[] };
        suppliers?: { count: number; sample: string[] };
        opportunities?: { count: number };
        bookings?: { count: number; active: any[] };
        billOfLadings?: { count: number };
        shipments?: { count: number };
        freightQuotes?: { count: number };
        purchaseOrders?: { count: number };
        inventory?: { count: number };
        costCalculations?: { count: number };
        ports?: { count: number; sample: string[] };
        cargoAgents?: { count: number; sample: string[] };
    };
    actions?: {
        addPort?: (port: any) => Promise<any>;
    };
}

const BOB_SYSTEM_PROMPT = `You are **Bob**, a smart and friendly AI assistant built into the X-Solution AI Business Platform.

═══════════════════════════════════════════════════════
IDENTITY & TONE
═══════════════════════════════════════════════════════
- Name: Bob
- Personality: Helpful, professional, concise, warm but not overly casual
- Use **bold** for key terms, bullet lists for clarity
- Keep answers short (2-5 sentences) unless user asks for detail
- Use emojis sparingly (max 1-2 per message) for friendliness
- Never fabricate data — only reference what's in the provided context
- If you don't have data, say so honestly and suggest where to find it

═══════════════════════════════════════════════════════
PLATFORM MODULE MAP
═══════════════════════════════════════════════════════
Here's what each module does:

**DASHBOARD** — Overview with KPIs, charts, and quick stats across all operations.

**AI_UPLOAD (Automation)** — AI-powered document processing tools:
  - Doc OCR: Scan and extract data from uploaded documents
  - Inbox Scanner: Process incoming emails automatically
  - Proposal Engine: Generate professional proposals
  - PL/Invoice Engine: Process packing lists and invoices via OCR
  - Logistics AI: AI-assisted logistics management
  - Commissions: Track and manage sales commissions

**BUY (Purchase)** — Procurement management:
  - Suppliers: Manage supplier database
  - Supplier Quotes: View and compare supplier offers
  - Purchase Orders: Create and track POs
  - Inventory: Monitor stock levels

**CALCULATOR** — Cost analysis tools:
  - Cost Calculation: Calculate landed costs with freight, duties, etc.
  - Saved Costs: History of previous calculations
  - Cost Sheet: Spreadsheet-style cost breakdown
  - Price List: Product price lists with margins

**SELL (Sales)** — Sales operations:
  - iCRM: Intelligent CRM with AI-powered insights
  - SMAIL Assistant: Smart email assistant for sales
  - Customers: Customer database
  - Pipeline: Sales opportunity pipeline
  - Customer 360: Full customer profile view
  - Price List: Sale pricing
  - Sales Orders: Create and manage sales orders
  - Sale Brazil: Brazil-specific sales module

**LOGISTICS** — Shipping and logistics:
  - Logistic Manager: AI-powered logistics assistant
  - Bill of Ladings: Manage B/L documents
  - Bookings: Shipping booking management
  - Freight Quotes: Rate quotes from carriers/agents

**DATA** — Master data management:
  - Cargo Agents, Banks, Carriers, Customers, Locations, Ports, Products, Suppliers

**FINANCE** — Financial operations and reporting.

**CUSTOMER_PORTAL** — External view for customers to track their orders.

**SETTINGS** — System admin: Users, Companies, Database Config, Branding, Integrations.

═══════════════════════════════════════════════════════
CAPABILITIES
═══════════════════════════════════════════════════════
1. **Data Queries**: Answer questions about visible data (customers, orders, products, etc.)
2. **Navigation Help**: Tell users which module to use for a task
3. **How-To Guide**: Explain step-by-step how to use features
4. **Insights**: Summarize data trends and key metrics from context
5. **Workflow Tips**: Suggest efficient workflows (e.g., "To create a full shipment flow, first create the SO, then the booking, then the B/L")
6. **Data Management**: Add ports to the database when users request it. Use the add_port function tool to create new port entries with code, name, and country.

═══════════════════════════════════════════════════════
RULES
═══════════════════════════════════════════════════════
1. ONLY reference data that appears in the context. Never invent customer names, order numbers, or amounts.
2. If the user asks about data not in your context, say "I don't have that data loaded right now. You can find it in [module name]."
3. When answering data questions, cite counts and names from context.
4. Keep formatting clean with markdown: **bold**, *italic*, bullet lists, numbered steps.
5. For "how to" questions, provide numbered steps.
6. Always consider the user's ROLE — they may not have access to all modules.
7. Never reveal passwords, API keys, or sensitive config.
8. When adding a port, use the standard UN/LOCODE port code if known (e.g., PKKAR for Karachi, BRSSZ for Santos). If unsure, generate a reasonable 5-letter code from the country ISO + first letters of the port name.
9. When you successfully add a port using the add_port tool, confirm the action to the user with the port details (code, name, country).
`;

export const getBobResponse = async (
    userMessage: string,
    history: { role: 'user' | 'model'; text: string }[],
    context: BobContext
): Promise<string> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        // Build the module label map for readable context
        const moduleLabels: Record<string, string> = {
            DASHBOARD: 'Dashboard', AI_UPLOAD: 'Automation', BUY: 'Purchase',
            CALCULATOR: 'Calculator', SELL: 'Sales', LOGISTICS: 'Logistics',
            DATA: 'Data', FINANCE: 'Finance', CUSTOMER_PORTAL: 'Client Portal',
            SETTINGS: 'Settings'
        };

        const currentModuleLabel = moduleLabels[context.activeModule] || context.activeModule;
        const currentLocation = context.subModule
            ? `${currentModuleLabel} > ${context.subModule}`
            : currentModuleLabel;

        // Build data summary string
        const dataParts: string[] = [];
        const d = context.data;
        if (d.customers) dataParts.push(`Customers: ${d.customers.count} total (e.g., ${d.customers.sample.join(', ')})`);
        if (d.products) dataParts.push(`Products: ${d.products.count} total (e.g., ${d.products.sample.join(', ')})`);
        if (d.suppliers) dataParts.push(`Suppliers: ${d.suppliers.count} total (e.g., ${d.suppliers.sample.join(', ')})`);
        if (d.salesOrders) dataParts.push(`Sales Orders: ${d.salesOrders.count} total. Recent: ${JSON.stringify(d.salesOrders.recent.slice(0, 3))}`);
        if (d.opportunities) dataParts.push(`Opportunities: ${d.opportunities.count} total`);
        if (d.bookings) dataParts.push(`Bookings: ${d.bookings.count} total. Active: ${JSON.stringify(d.bookings.active.slice(0, 3))}`);
        if (d.billOfLadings) dataParts.push(`Bills of Lading: ${d.billOfLadings.count} total`);
        if (d.shipments) dataParts.push(`Shipments: ${d.shipments.count} total`);
        if (d.freightQuotes) dataParts.push(`Freight Quotes: ${d.freightQuotes.count} total`);
        if (d.purchaseOrders) dataParts.push(`Purchase Orders: ${d.purchaseOrders.count} total`);
        if (d.inventory) dataParts.push(`Inventory Items: ${d.inventory.count} total`);
        if (d.costCalculations) dataParts.push(`Cost Calculations: ${d.costCalculations.count} total`);
        if (d.ports) dataParts.push(`Ports: ${d.ports.count} total (e.g., ${d.ports.sample.join(', ')})`);
        if (d.cargoAgents) dataParts.push(`Cargo Agents: ${d.cargoAgents.count} total (e.g., ${d.cargoAgents.sample.join(', ')})`);

        const contextPrompt = `
CURRENT SESSION:
- User: ${context.userName} (Role: ${context.userRole})
- Company: ${context.currentCompany}
- Current Location: 📍 ${currentLocation}
- Modules user can access: ${context.allowedModules.map(m => moduleLabels[m] || m).join(', ')}

DATA AVAILABLE (filtered by user permissions):
${dataParts.join('\n')}

CONVERSATION HISTORY:
${history.map(h => `${h.role === 'user' ? 'User' : 'Bob'}: ${h.text}`).join('\n')}

USER MESSAGE: "${userMessage}"
`;

        // Use dynamic persona for Bob too
        const bobPersona = await getPersona();
        const bobPromptHeader = buildSystemPrompt(bobPersona);
        const dynamicBobPrompt = `${bobPromptHeader}\n\n${BOB_SYSTEM_PROMPT.split('PLATFORM MODULE MAP')[1] ? '═══════════════════════════════════════════════════════\nPLATFORM MODULE MAP' + BOB_SYSTEM_PROMPT.split('PLATFORM MODULE MAP')[1] : BOB_SYSTEM_PROMPT}`;

        // ── Function-calling tools for data management ──
        const addPortTool: FunctionDeclaration = {
            name: 'add_port',
            description: 'Add a new port to the ports database. Use this when the user asks to add, create, or register a new port.',
            parameters: {
                type: Type.OBJECT,
                properties: {
                    code: { type: Type.STRING, description: 'The UN/LOCODE port code (e.g., PKKAR for Karachi, BRSSZ for Santos). 3-5 uppercase letters.' },
                    name: { type: Type.STRING, description: 'The full port name (e.g., Karachi, Santos, Rotterdam)' },
                    country: { type: Type.STRING, description: 'The country where the port is located (e.g., Pakistan, Brazil, Netherlands)' },
                },
                required: ['code', 'name', 'country']
            }
        };

        const tools = context.actions?.addPort ? [{ functionDeclarations: [addPortTool] }] : undefined;

        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: contextPrompt,
            config: {
                systemInstruction: dynamicBobPrompt,
                tools
            }
        });

        // ── Handle function calls ──
        if (response.functionCalls && response.functionCalls.length > 0) {
            for (const fc of response.functionCalls) {
                if (fc.name === 'add_port' && context.actions?.addPort) {
                    const args = fc.args as { code: string; name: string; country: string };
                    try {
                        const newPort = {
                            id: `PRT${Date.now()}`,
                            companyId: 'ALL',
                            code: (args.code || '').toUpperCase(),
                            name: args.name || '',
                            country: args.country || ''
                        };
                        await context.actions.addPort(newPort);
                        return `✅ Port **${newPort.name}** (${newPort.code}) in **${newPort.country}** has been added to the database!\n\nYou can view it in **Data › Ports**.`;
                    } catch (err: any) {
                        console.error('[Bob AI] add_port error:', err);
                        return `⚠️ I tried to add the port but encountered an error: ${err.message || 'Unknown error'}. Please try adding it manually in **Data › Ports**.`;
                    }
                }
            }
        }

        return response.text || "I'm here to help! What would you like to know?";
    } catch (error) {
        console.error('[Bob AI] Error:', error);
        return "I'm having a small hiccup right now. Please try again in a moment.";
    }
};

// --- COST-PROFIT AI ---

export interface CostBreakdownEstimate {
    pickupCost: number;
    oceanFreight: number;
    deliveryCost: number;
    insuranceCost: number;
    dutyPercent: number;
    clearanceCost: number;
    explanation: string;
}

export const getCostProfitAnalysis = async (
    productName: string,
    quantity: number,
    unitPrice: number,
    incoterm: string,
    originPort: string,
    destinationPort: string,
    currency: string,
    freightQuotes: FreightQuote[],
    existingCalcs: CostCalculation[]
): Promise<{ estimate: CostBreakdownEstimate; sources: Record<string, 'db' | 'ai'> }> => {
    // Step 1: Try to match from existing freight quotes
    const sources: Record<string, 'db' | 'ai'> = {};
    const dbMatch = freightQuotes.find(fq =>
        fq.status === 'ACTIVE' &&
        (fq.originPort?.toLowerCase().includes(originPort.toLowerCase()) || fq.originPortCode?.toLowerCase() === originPort.toLowerCase()) &&
        (fq.destinationPort?.toLowerCase().includes(destinationPort.toLowerCase()) || fq.destinationPortCode?.toLowerCase() === destinationPort.toLowerCase())
    );

    const totalBase = unitPrice * quantity;
    let pickup = 0, ocean = 0, delivery = 0;

    if (dbMatch) {
        pickup = dbMatch.pickupCost || 0;
        ocean = dbMatch.oceanCost || dbMatch.rate || 0;
        delivery = dbMatch.deliveryCost || 0;
        sources.pickupCost = 'db';
        sources.oceanFreight = 'db';
        sources.deliveryCost = 'db';
    }

    // Step 2: Check existing calculations for similar product/route
    const similarCalc = existingCalcs.find(c =>
        c.productName?.toLowerCase() === productName.toLowerCase() &&
        c.poa?.toLowerCase().includes(originPort.toLowerCase()) &&
        c.pod?.toLowerCase().includes(destinationPort.toLowerCase())
    );

    // Step 3: AI fills in anything still missing
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `You are a cost estimation AI for international commodity trading (textile fibers, plastic resins, recycled materials).
Estimate the import cost breakdown for:
- Product: ${productName}
- Quantity: ${quantity} lbs
- Unit Price: ${unitPrice} ${currency}
- Total Base: $${totalBase.toFixed(2)}
- Incoterm: ${incoterm}
- Route: ${originPort} → ${destinationPort}
${dbMatch ? `- DB Freight Quote found: pickup=$${pickup}, ocean=$${ocean}, delivery=$${delivery}` : '- No freight quote in DB'}
${similarCalc ? `- Similar past calculation: duty=${similarCalc.dutyPercent}%, insurance=$${similarCalc.insuranceCost}, clearance=$${similarCalc.portClearanceCost}` : '- No past calculation for this product/route'}

Return JSON with these fields:
- pickupCost: number (origin pickup/drayage in USD, 0 if incoterm is not EXW)
- oceanFreight: number (ocean freight in USD, 0 if incoterm is CIF/CFR/DDP)
- deliveryCost: number (destination delivery/drayage in USD, 0 if incoterm is DDP)
- insuranceCost: number (cargo insurance in USD, typically 0.3-0.5% of CIF value)
- dutyPercent: number (import duty percentage, based on typical HTS codes for this product type)
- clearanceCost: number (customs clearance and port handling fees in USD)
- explanation: string (brief 2-3 sentence summary of your estimation rationale)

Use realistic US import cost estimates. If DB values are provided, use those and only estimate the missing ones.`;

        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        pickupCost: { type: Type.NUMBER },
                        oceanFreight: { type: Type.NUMBER },
                        deliveryCost: { type: Type.NUMBER },
                        insuranceCost: { type: Type.NUMBER },
                        dutyPercent: { type: Type.NUMBER },
                        clearanceCost: { type: Type.NUMBER },
                        explanation: { type: Type.STRING }
                    }
                }
            }
        });

        if (response.text) {
            const aiResult = JSON.parse(response.text) as CostBreakdownEstimate;

            // Merge: DB values take priority, AI fills gaps
            const estimate: CostBreakdownEstimate = {
                pickupCost: dbMatch?.pickupCost ? pickup : aiResult.pickupCost,
                oceanFreight: (dbMatch?.oceanCost || dbMatch?.rate) ? ocean : aiResult.oceanFreight,
                deliveryCost: dbMatch?.deliveryCost ? delivery : aiResult.deliveryCost,
                insuranceCost: similarCalc?.insuranceCost ?? aiResult.insuranceCost,
                dutyPercent: similarCalc?.dutyPercent ?? aiResult.dutyPercent,
                clearanceCost: similarCalc?.portClearanceCost ?? aiResult.clearanceCost,
                explanation: aiResult.explanation
            };

            // Set source tracking
            if (!sources.pickupCost) sources.pickupCost = 'ai';
            if (!sources.oceanFreight) sources.oceanFreight = 'ai';
            if (!sources.deliveryCost) sources.deliveryCost = 'ai';
            sources.insuranceCost = similarCalc?.insuranceCost != null ? 'db' : 'ai';
            sources.dutyPercent = similarCalc?.dutyPercent != null ? 'db' : 'ai';
            sources.clearanceCost = similarCalc?.portClearanceCost != null ? 'db' : 'ai';

            return { estimate, sources };
        }
    } catch (e) {
        // Fallback: return DB values + zeros
    }

    return {
        estimate: {
            pickupCost: pickup,
            oceanFreight: ocean,
            deliveryCost: delivery,
            insuranceCost: totalBase * 0.004,
            dutyPercent: similarCalc?.dutyPercent ?? 5,
            clearanceCost: similarCalc?.portClearanceCost ?? 350,
            explanation: 'Fallback estimates used. AI service unavailable.'
        },
        sources: {
            pickupCost: dbMatch ? 'db' : 'ai',
            oceanFreight: dbMatch ? 'db' : 'ai',
            deliveryCost: dbMatch ? 'db' : 'ai',
            insuranceCost: similarCalc ? 'db' : 'ai',
            dutyPercent: similarCalc ? 'db' : 'ai',
            clearanceCost: similarCalc ? 'db' : 'ai'
        }
    };
};

export interface MarginRecommendation {
    productName: string;
    recommendedMargin: number;
    reasoning: string;
}

export const getCostProfitSummary = async (
    items: Array<{ productName: string; unitLandedCost: number; supplierName: string; quantity: number; incoterm: string }>
): Promise<MarginRecommendation[]> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `You are a pricing strategy AI for international commodity trading (textile fibers, plastic resins, recycled materials).

For each product below, recommend an optimal selling margin percentage and explain your reasoning:

${items.map((item, i) => `${i + 1}. ${item.productName} — Unit Landed Cost: $${item.unitLandedCost.toFixed(4)}/lb, Supplier: ${item.supplierName}, Qty: ${item.quantity} lbs, Incoterm: ${item.incoterm}`).join('\n')}

Consider:
- Market competitiveness for commodity trading
- Volume-based pricing (larger quantities = lower margins acceptable)
- Incoterm complexity (DDP requires higher margin for risk)
- Typical margins for B2B commodity trading: 8-25%

Return a JSON array with one object per product:
- productName: string
- recommendedMargin: number (percentage, e.g. 15 for 15%)
- reasoning: string (1-2 sentence explanation)`;

        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            productName: { type: Type.STRING },
                            recommendedMargin: { type: Type.NUMBER },
                            reasoning: { type: Type.STRING }
                        }
                    }
                }
            }
        });

        if (response.text) {
            return JSON.parse(response.text) as MarginRecommendation[];
        }
        return items.map(item => ({ productName: item.productName, recommendedMargin: 15, reasoning: 'Default margin applied.' }));
    } catch (e) {
        return items.map(item => ({ productName: item.productName, recommendedMargin: 15, reasoning: 'AI unavailable. Default 15% margin applied.' }));
    }
};

export const getCostProfitOfferRanking = async (
    offers: Array<{ offerNumber: string; supplierName: string; items: Array<{ productName: string; unitPrice: number; quantity: number }>; incoterm: string; originPort?: string; destinationPort?: string }>
): Promise<{ ranking: Array<{ offerNumber: string; score: number; reasoning: string }>; summary: string }> => {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `You are a procurement AI for international commodity trading.

Rank these supplier offers from best to worst value:

${offers.map((o, i) => `${i + 1}. Offer #${o.offerNumber} from ${o.supplierName} (${o.incoterm})
   Items: ${o.items.map(it => `${it.productName}: ${it.quantity} lbs @ $${it.unitPrice}/lb`).join(', ')}
   Route: ${o.originPort || 'N/A'} → ${o.destinationPort || 'N/A'}`).join('\n\n')}

Consider: unit price, incoterm favorability (EXW=buyer bears more cost, DDP=seller bears), route logistics cost implications, and total value.

Return JSON:
- ranking: array of {offerNumber: string, score: number (1-100), reasoning: string}
- summary: string (2-3 sentence overall recommendation)`;

        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        ranking: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    offerNumber: { type: Type.STRING },
                                    score: { type: Type.NUMBER },
                                    reasoning: { type: Type.STRING }
                                }
                            }
                        },
                        summary: { type: Type.STRING }
                    }
                }
            }
        });

        if (response.text) return JSON.parse(response.text);
        return { ranking: [], summary: 'Unable to rank offers.' };
    } catch (e) {
        return { ranking: [], summary: 'AI service unavailable for ranking.' };
    }
};

// ============================================================================
// ORDER-SALE ENGINE — Step 5 (Order) & Step 6 (Logistics) AI automation
// ============================================================================

export interface SalesOrderAutoFill {
    saleType: 'LOCAL' | 'EXPORT';
    deliveryMethod: 'PORT_TO_PORT' | 'DOOR_TO_PORT' | 'DOOR_TO_DOOR' | 'PORT_TO_DOOR' | 'PICKUP' | 'DELIVERY';
    incoterm: string;
    paymentTerms: string;
    orderType: 'SPOT' | 'CONTRACT';
    deliveryDate: string;
    poa: string;
    pod: string;
    pickupLocation: string;
    notes: string;
    reasoning: string;
    confidence: number;
}

/**
 * Infer sensible defaults for a Sales Order based on Proposal + Customer + Supplier + Calculations.
 * Used by the Order-Sale Engine Step 5 "AI Autofill" button.
 */
export const autoFillSalesOrder = async (ctx: {
    proposal: { number?: string; seller?: string; buyer?: string; incoterm?: string; paymentTerms?: string; notes?: string };
    customer?: { name: string; country?: string; city?: string; paymentTerms?: string; preferredIncoterm?: string };
    supplier?: { name: string; city?: string; country?: string };
    calculations: Array<{ productName: string; quantity: number; supplierName?: string; originPort?: string; destinationPort?: string; loadingLocation?: string; incoterm?: string }>;
    availablePorts: Array<{ code: string; name: string; country?: string }>;
    paymentTermOptions: string[];
    companyCountry?: string;
}): Promise<SalesOrderAutoFill> => {
    const fallback: SalesOrderAutoFill = {
        saleType: 'EXPORT', deliveryMethod: 'PORT_TO_PORT', incoterm: ctx.proposal.incoterm || 'FOB',
        paymentTerms: ctx.proposal.paymentTerms || ctx.customer?.paymentTerms || 'Net 30',
        orderType: 'SPOT', deliveryDate: 'Prompt',
        poa: ctx.calculations[0]?.originPort || '', pod: ctx.calculations[0]?.destinationPort || '',
        pickupLocation: ctx.calculations[0]?.loadingLocation || '',
        notes: '', reasoning: 'Fallback defaults — AI unavailable.', confidence: 40
    };
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const totalQty = ctx.calculations.reduce((s, c) => s + (c.quantity || 0), 0);
        const prompt = `You are a Sales Operations AI for an international B2B commodity trader (textile fibers, plastic resins, recycled materials).
Convert the following commercial proposal context into a ready-to-file Sales Order with sensible defaults.

PROPOSAL
- Number: ${ctx.proposal.number || 'N/A'}
- Seller: ${ctx.proposal.seller || 'N/A'}
- Buyer: ${ctx.proposal.buyer || 'N/A'}
- Incoterm on proposal: ${ctx.proposal.incoterm || 'N/A'}
- Payment Terms on proposal: ${ctx.proposal.paymentTerms || 'N/A'}
- Notes: ${ctx.proposal.notes || '—'}

CUSTOMER
- Name: ${ctx.customer?.name || 'Unknown'}
- Country: ${ctx.customer?.country || 'Unknown'}
- City: ${ctx.customer?.city || '—'}
- Preferred Payment Terms: ${ctx.customer?.paymentTerms || '—'}
- Preferred Incoterm: ${ctx.customer?.preferredIncoterm || '—'}

SUPPLIER
- Name: ${ctx.supplier?.name || 'Unknown'}
- City/Country: ${[ctx.supplier?.city, ctx.supplier?.country].filter(Boolean).join(', ') || '—'}

LINE ITEMS (${ctx.calculations.length})
${ctx.calculations.map(c => `- ${c.productName}: ${c.quantity} lbs · incoterm ${c.incoterm || 'n/a'} · ${c.originPort || '?'} → ${c.destinationPort || '?'}`).join('\n')}
Total volume: ${totalQty.toLocaleString()} lbs

COMPANY OPERATES FROM: ${ctx.companyCountry || 'USA'}

PAYMENT TERM OPTIONS (must pick from this list): ${ctx.paymentTermOptions.join(', ')}

AVAILABLE PORTS (format "Name (CODE)"): ${ctx.availablePorts.slice(0, 80).map(p => `${p.name} (${p.code})`).join(', ')}

RULES
1. saleType: "LOCAL" if customer country matches supplier/company country, else "EXPORT".
2. deliveryMethod: LOCAL→"PICKUP" or "DELIVERY"; EXPORT→"PORT_TO_PORT" (default), "DOOR_TO_PORT" if supplier not at port, "DOOR_TO_DOOR" for DDP, "PORT_TO_DOOR" if customer not at port.
3. incoterm: keep proposal incoterm unless delivery method forces a change (PICKUP→EXW, DELIVERY→DDP, PORT_TO_PORT→FOB or CFR).
4. paymentTerms: pick from the provided list — prefer customer preference, else proposal, else "Net 30".
5. orderType: "CONTRACT" if line items reference recurring shipments or volumes >500k lbs, else "SPOT".
6. deliveryDate: a short phrase like "Prompt", "30 days ARO", "ASAP", or a rough month like "Dec 2026".
7. poa: format as "Name (CODE)" from available ports — use calculations[0].originPort as the seed if present.
8. pod: format as "Name (CODE)" from available ports — use calculations[0].destinationPort as the seed if present.
9. pickupLocation: supplier city, country (only when delivery method starts with DOOR_).
10. notes: 1-2 sentence summary combining incoterm, delivery, and any proposal notes.
11. reasoning: 2-3 sentence explanation of the key decisions.
12. confidence: 0-100 integer reflecting how confident the AI is in these defaults.

Return JSON ONLY.`;

        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        saleType: { type: Type.STRING },
                        deliveryMethod: { type: Type.STRING },
                        incoterm: { type: Type.STRING },
                        paymentTerms: { type: Type.STRING },
                        orderType: { type: Type.STRING },
                        deliveryDate: { type: Type.STRING },
                        poa: { type: Type.STRING },
                        pod: { type: Type.STRING },
                        pickupLocation: { type: Type.STRING },
                        notes: { type: Type.STRING },
                        reasoning: { type: Type.STRING },
                        confidence: { type: Type.NUMBER }
                    }
                }
            }
        });
        if (response.text) return { ...fallback, ...JSON.parse(response.text) } as SalesOrderAutoFill;
        return fallback;
    } catch (e) {
        console.error('[autoFillSalesOrder] AI call failed:', e);
        return fallback;
    }
};

export interface FreightQuoteRecommendation {
    bestQuoteId: string;
    reasoning: string;
    ranked: Array<{ quoteId: string; score: number; pros: string[]; cons: string[] }>;
    transitInsight: string;
}

/**
 * Rank a set of matching freight quotes for a given route/weight and pick the best one
 * balancing rate, transit time, free time, agent reliability, and validity.
 */
export const recommendFreightQuote = async (ctx: {
    route: { originPort: string; destinationPort: string; pickup?: string };
    totalWeightKg: number;
    containers: number;
    incoterm: string;
    customerCountry?: string;
    orderType: 'SPOT' | 'CONTRACT';
    quotes: Array<{ id: string; agentName?: string; carrier?: string; rate: number; currency?: string; freightType?: string; transitTime?: number; freeTime?: number; validUntil?: string; notes?: string }>;
}): Promise<FreightQuoteRecommendation> => {
    const fallback: FreightQuoteRecommendation = {
        bestQuoteId: ctx.quotes.sort((a, b) => a.rate - b.rate)[0]?.id || '',
        reasoning: 'Lowest rate selected (AI unavailable).',
        ranked: ctx.quotes.map(q => ({ quoteId: q.id, score: 50, pros: [`Rate: $${q.rate}`], cons: [] })),
        transitInsight: ''
    };
    if (ctx.quotes.length === 0) return { ...fallback, bestQuoteId: '', reasoning: 'No matching quotes on file.' };
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `You are a Freight Logistics AI. Pick the best freight quote for this shipment.

SHIPMENT
- Route: ${ctx.route.originPort} → ${ctx.route.destinationPort}${ctx.route.pickup ? ` (pickup: ${ctx.route.pickup})` : ''}
- Total weight: ${ctx.totalWeightKg.toLocaleString()} kg
- Containers: ${ctx.containers} x 40ft HC
- Incoterm: ${ctx.incoterm}
- Customer country: ${ctx.customerCountry || 'Unknown'}
- Order type: ${ctx.orderType}

QUOTES
${ctx.quotes.map((q, i) => `${i + 1}. [${q.id}] ${q.agentName || 'Agent'} / ${q.carrier || '—'} — $${q.rate} ${q.currency || 'USD'}/container (${q.freightType || 'PORT_PORT'}). Transit: ${q.transitTime || '?'}d, Free time: ${q.freeTime || '?'}d, Valid until: ${q.validUntil || '—'}. Notes: ${q.notes || '—'}`).join('\n')}

Consider:
- Total landed cost (rate × containers), NOT just unit rate
- Transit time vs. customer urgency (SPOT = faster preferred)
- Free time vs. demurrage risk at POD
- Agent reputation, carrier reliability
- Expiring quotes (soon-to-expire quotes carry risk)
- CONTRACT orders prefer agents with repeat-business relationships

Return JSON:
- bestQuoteId: id of the winning quote
- reasoning: 2-3 sentence rationale
- ranked: array of { quoteId, score (1-100), pros (3-4 bullets), cons (2-3 bullets) } — one entry per quote, sorted best to worst
- transitInsight: 1-2 sentence ETA / demurrage outlook`;

        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        bestQuoteId: { type: Type.STRING },
                        reasoning: { type: Type.STRING },
                        ranked: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    quoteId: { type: Type.STRING },
                                    score: { type: Type.NUMBER },
                                    pros: { type: Type.ARRAY, items: { type: Type.STRING } },
                                    cons: { type: Type.ARRAY, items: { type: Type.STRING } }
                                }
                            }
                        },
                        transitInsight: { type: Type.STRING }
                    }
                }
            }
        });
        if (response.text) return JSON.parse(response.text) as FreightQuoteRecommendation;
        return fallback;
    } catch (e) {
        console.error('[recommendFreightQuote] AI call failed:', e);
        return fallback;
    }
};

/**
 * Generate a polished booking request email for a freight agent.
 */
export const generateBookingEmail = async (ctx: {
    orderNumber: string;
    shipper: string;
    supplier: string;
    customer: string;
    agentName?: string;
    incoterm: string;
    deliveryMethod: string;
    origin: string;
    destination: string;
    pickup?: string;
    totalWeightKg: number;
    totalWeightLbs: number;
    containers: number;
    products: Array<{ productName: string; quantityLbs: number; quantityKg: number }>;
    specialNotes?: string;
    deliveryDate?: string;
    paymentTerms?: string;
}): Promise<{ subject: string; body: string }> => {
    const fallback = {
        subject: `Booking Request - Order ${ctx.orderNumber} - ${ctx.customer}`,
        body: `Dear ${ctx.agentName || 'Freight Agent'},\n\nWe would like to request a booking for order ${ctx.orderNumber}.\n\nRoute: ${ctx.origin} → ${ctx.destination}\nContainers: ${ctx.containers} x 40ft HC\nWeight: ${Math.round(ctx.totalWeightKg).toLocaleString()} kg\n\nPlease confirm availability.\n\nBest regards`
    };
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `Write a professional, concise booking request email to a freight agent.

CONTEXT
- Order #: ${ctx.orderNumber}
- Shipper (us): ${ctx.shipper}
- Supplier: ${ctx.supplier}
- Customer: ${ctx.customer}
- Freight Agent: ${ctx.agentName || 'Freight Agent'}
- Incoterm: ${ctx.incoterm}
- Delivery Method: ${ctx.deliveryMethod.replace(/_/g, ' ')}
- Origin (POA): ${ctx.origin}
- Destination (POD): ${ctx.destination}
${ctx.pickup ? `- Pickup Location: ${ctx.pickup}` : ''}
- Total weight: ${Math.round(ctx.totalWeightKg).toLocaleString()} kg (${ctx.totalWeightLbs.toLocaleString()} lbs)
- Containers: ${ctx.containers} x 40ft HC
- Desired delivery: ${ctx.deliveryDate || 'Prompt'}
- Payment Terms: ${ctx.paymentTerms || 'N/A'}

PRODUCTS
${ctx.products.map(p => `- ${p.productName}: ${Math.round(p.quantityLbs).toLocaleString()} lbs (${Math.round(p.quantityKg).toLocaleString()} kg)`).join('\n')}

${ctx.specialNotes ? `SPECIAL INSTRUCTIONS: ${ctx.specialNotes}` : ''}

REQUIREMENTS
- Professional B2B tone, warm but direct
- Include all critical logistics info in a clean block layout using plain text (no markdown, no emoji)
- Ask for: vessel options, earliest ETD, cut-off dates, confirmed ETA, and booking confirmation
- Request any required pre-alerts or documentation
- Sign off generically ("Best regards")
- Keep it under 250 words

Return JSON: { subject: string, body: string }`;

        const response = await ai.models.generateContent({
            model: MODEL_ID,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: { subject: { type: Type.STRING }, body: { type: Type.STRING } }
                }
            }
        });
        if (response.text) return JSON.parse(response.text);
        return fallback;
    } catch (e) {
        console.error('[generateBookingEmail] AI call failed:', e);
        return fallback;
    }
};
