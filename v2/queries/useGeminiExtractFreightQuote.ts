// Phase 3B — Gemini extraction tuned for freight quotes.
//
// Takes a File (PDF / PNG / JPG) OR raw pasted text and returns a
// structured freight-quote draft. Routes through the Phase 1c
// gemini-proxy so no API key lives in the browser.

import { useMutation } from '@tanstack/react-query';
import { GoogleGenAI } from '../../services/geminiClient';

export interface ExtractedFreightQuote {
  agentName: string | null;
  carrier: string | null;
  freightType: 'OCEAN' | 'AIR' | 'TRUCK' | 'RAIL' | null;
  originPort: string | null;
  originPortCode: string | null;
  destinationPort: string | null;
  destinationPortCode: string | null;
  rate: number | null;
  currency: string | null;
  freeTime: number | null;
  transitTime: number | null;
  validUntil: string | null; // YYYY-MM-DD
  status: string | null;
  notes: string | null;
  raw: Record<string, unknown>;
}

export type FreightQuoteInput =
  | { kind: 'file';   file: File }
  | { kind: 'text';   text: string }
  | { kind: 'image';  dataUrl: string };

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

const EXTRACTION_PROMPT = `You are extracting fields from a FREIGHT QUOTE (ocean, air, or trucking).
Return a JSON object with exactly these keys. Missing values must be null
— never guess. Strings should preserve the original casing where
reasonable (e.g. port names "Santos", not "SANTOS").

{
  "agentName":           string | null,   // forwarding agent / NVOCC that issued the quote
  "carrier":             string | null,   // ocean carrier / airline / trucking line (e.g. MSC, Maersk, OOCL)
  "freightType":         "OCEAN" | "AIR" | "TRUCK" | "RAIL" | null,
  "originPort":          string | null,   // friendly name (e.g. "Santos")
  "originPortCode":      string | null,   // 5-char UN/LOCODE (e.g. "BRSSZ")
  "destinationPort":     string | null,
  "destinationPortCode": string | null,
  "rate":                number | null,   // numeric only, no currency symbol
  "currency":            string | null,   // ISO 4217 (USD, EUR, BRL, ...)
  "freeTime":            number | null,   // days of free time / demurrage
  "transitTime":         number | null,   // days in transit
  "validUntil":          string | null,   // YYYY-MM-DD
  "status":              "ACTIVE" | "PENDING" | "EXPIRED" | null,
  "notes":               string | null    // free-text summary of anything not captured above
}

Rules:
- UN/LOCODEs are always 5 characters (country code + port code), uppercase.
- If only a friendly port name is present, still emit originPort/destinationPort
  even when the code is null.
- rate is the all-in quote when present; if multiple lines, sum them.
- validUntil must be ISO (YYYY-MM-DD). Convert dates like "15/May/2026" accordingly.
- Return ONLY valid JSON, no markdown fences, no commentary.`;

function normalize(parsed: Record<string, unknown>): ExtractedFreightQuote {
  const str = (k: string): string | null => {
    const v = parsed[k];
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  };
  const num = (k: string): number | null => {
    const v = parsed[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v.replace(/[^0-9.\-]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const ft = str('freightType')?.toUpperCase();
  const freightType =
    ft === 'OCEAN' || ft === 'AIR' || ft === 'TRUCK' || ft === 'RAIL' ? ft : null;

  return {
    agentName:           str('agentName'),
    carrier:             str('carrier'),
    freightType,
    originPort:          str('originPort'),
    originPortCode:      str('originPortCode')?.toUpperCase().slice(0, 5) ?? null,
    destinationPort:     str('destinationPort'),
    destinationPortCode: str('destinationPortCode')?.toUpperCase().slice(0, 5) ?? null,
    rate:                num('rate'),
    currency:            str('currency')?.toUpperCase() ?? null,
    freeTime:            num('freeTime'),
    transitTime:         num('transitTime'),
    validUntil:          str('validUntil'),
    status:              str('status')?.toUpperCase() ?? null,
    notes:               str('notes'),
    raw:                 parsed,
  };
}

export function useGeminiExtractFreightQuote() {
  return useMutation<ExtractedFreightQuote, Error, FreightQuoteInput>({
    mutationFn: async (input) => {
      const ai = new GoogleGenAI({ apiKey: 'proxy' });

      const parts: Array<Record<string, unknown>> = [{ text: EXTRACTION_PROMPT }];

      if (input.kind === 'file') {
        const base64 = await fileToBase64(input.file);
        parts.push({
          inlineData: {
            mimeType: input.file.type || 'application/pdf',
            data: base64,
          },
        });
      } else if (input.kind === 'image') {
        const [header, data] = input.dataUrl.split(',');
        const m = /data:(.*?);base64/.exec(header ?? '');
        const mime = m?.[1] || 'image/png';
        parts.push({ inlineData: { mimeType: mime, data: data ?? '' } });
      } else {
        parts.push({ text: `--- PASTED QUOTE ---\n${input.text}\n--- END ---` });
      }

      const result = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: [{ role: 'user', parts }],
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
        const stripped = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```\s*$/, '');
        parsed = JSON.parse(stripped);
      }

      return normalize(parsed);
    },
  });
}
