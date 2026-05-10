// Phase 3B — Gemini document extraction hook.
//
// Minimal end-to-end AI flow: the user uploads a PDF or image, we convert
// to base64, call Gemini via the Phase 1c gemini-proxy (no key in the
// browser), and surface the structured extraction as JSON.

import { useMutation } from '@tanstack/react-query';
import { GoogleGenAI } from '../../services/geminiClient';

export interface ExtractedDocument {
  kind: string;             // 'Purchase Order' | 'Invoice' | 'BL' | ...
  number: string | null;
  counterparty: string | null;
  date: string | null;
  totalAmount: number | null;
  currency: string | null;
  notes: string | null;
  raw: Record<string, unknown>;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] ?? '';
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

const EXTRACTION_PROMPT = `You are a document extraction assistant for a logistics/trading ERP.
Read the attached document and return a JSON object with these fields:
  - kind: one of "Purchase Order", "Invoice", "Bill of Lading", "Packing List", "Freight Quote", or "Other"
  - number: the primary reference number on the document (PO #, Invoice #, etc.) or null
  - counterparty: the other party (supplier for a PO, customer for an invoice) or null
  - date: the document date in YYYY-MM-DD format or null
  - totalAmount: the monetary total as a number (no currency symbol) or null
  - currency: the three-letter currency code (USD, EUR, BRL, etc.) or null
  - notes: any important free-text notes or observations, or null

Return ONLY valid JSON, no markdown fences, no commentary.`;

export function useGeminiExtract() {
  return useMutation<ExtractedDocument, Error, File>({
    mutationFn: async (file) => {
      const base64 = await fileToBase64(file);
      const ai = new GoogleGenAI({ apiKey: 'proxy' });

      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: EXTRACTION_PROMPT },
              {
                inlineData: {
                  mimeType: file.type || 'application/pdf',
                  data: base64,
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0,
        },
      });

      const text = (result as { text?: string }).text ?? '';
      if (!text) throw new Error('Empty response from Gemini.');

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text);
      } catch {
        // Some models wrap in code fences despite responseMimeType; try to recover.
        const stripped = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
        parsed = JSON.parse(stripped);
      }

      return {
        kind: String(parsed.kind ?? 'Other'),
        number: typeof parsed.number === 'string' ? parsed.number : null,
        counterparty: typeof parsed.counterparty === 'string' ? parsed.counterparty : null,
        date: typeof parsed.date === 'string' ? parsed.date : null,
        totalAmount: typeof parsed.totalAmount === 'number' ? parsed.totalAmount : null,
        currency: typeof parsed.currency === 'string' ? parsed.currency : null,
        notes: typeof parsed.notes === 'string' ? parsed.notes : null,
        raw: parsed,
      };
    },
  });
}
