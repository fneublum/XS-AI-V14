// Translation + proposal-label helpers for the v2 Agent Sales Orders
// Proposal flow. Routes Gemini calls through the gemini-proxy Edge
// Function (same path as the OCR extraction hook), so no API key is
// embedded client-side.

import { GoogleGenAI } from '../../services/geminiClient';

const MODEL = 'gemini-2.5-flash';

/** Translate an array of product descriptions into the target country's
 *  primary business language. Returns parallel array of translations.
 *  Returns an empty array on failure so callers can no-op gracefully. */
export async function translateDescriptions(
  descriptions: string[],
  targetCountry: string,
): Promise<string[]> {
  if (descriptions.length === 0 || !targetCountry.trim()) return [];
  const prompt = `You are a professional translator. Translate these product descriptions to the main language spoken in ${targetCountry}. For example: Brazil → Portuguese, Mexico/Honduras/Colombia → Spanish, China → Chinese, United States → English.

Descriptions:
${descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

Return ONLY a JSON array with exactly ${descriptions.length} translated strings, in the same order. No explanation, no markdown, no code fences. Example: ["translated 1", "translated 2"]`;

  try {
    const ai = new GoogleGenAI({ apiKey: 'proxy' });
    const resp = await ai.models.generateContent({ model: MODEL, contents: prompt });
    const cleaned = (resp.text ?? '[]').replace(/```json\s*|\s*```/g, '').trim();
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export interface ProposalLabels {
  title?: string;
  intro?: string;
  closing?: string;
  labelSeller?: string;
  labelBuyer?: string;
  labelDate?: string;
  labelIncoterm?: string;
  labelPayment?: string;
  labelDescription?: string;
  labelQty?: string;
  labelUnitPrice?: string;
  labelAmount?: string;
  labelTotal?: string;
  labelValidity?: string;
  validityValue?: string;
}

/** Generate a localized set of proposal labels + a short intro/closing
 *  paragraph in the buyer's primary business language. Returns `{}`
 *  on failure — the PDF/email layer should fall back to English. */
export async function generateProposalLabels(
  sellerName: string,
  buyerName: string,
  targetCountry: string,
): Promise<ProposalLabels> {
  if (!targetCountry.trim()) return {};
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

  try {
    const ai = new GoogleGenAI({ apiKey: 'proxy' });
    const resp = await ai.models.generateContent({ model: MODEL, contents: prompt });
    const cleaned = (resp.text ?? '{}').replace(/```json\s*|\s*```/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return {};
    const parsed = JSON.parse(m[0]);
    return typeof parsed === 'object' && parsed !== null ? parsed as ProposalLabels : {};
  } catch {
    return {};
  }
}
