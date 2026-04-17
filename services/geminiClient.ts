// Gemini client shim — drop-in replacement for `@google/genai`'s
// `GoogleGenAI` class that routes every `generateContent` call through
// the `gemini-proxy` Supabase Edge Function instead of hitting the
// Google API directly. This keeps `GEMINI_API_KEY` server-side.
//
// Usage (unchanged from the SDK):
//   import { GoogleGenAI, Type } from './geminiClient';
//   const ai = new GoogleGenAI({ apiKey: 'ignored' });
//   const resp = await ai.models.generateContent({
//     model: 'gemini-2.0-flash',
//     contents: prompt,
//     config: { responseMimeType: 'application/json', responseSchema: ... }
//   });
//   resp.text;           // string (same as SDK)
//   resp.functionCalls;  // Array<{ name, args }> | undefined
//
// NOT supported yet (add to gemini-proxy as needed):
// - Streaming (generateContentStream)
// - File uploads (ai.files.upload)
// - Chat sessions (ai.chats.create)
// - Embeddings

import { invokeEdgeFunction } from './edgeAuth';

export interface GenerateContentRequest {
    model: string;
    contents: unknown;
    config?: Record<string, unknown>;
}

export interface GenerateContentResponse {
    text: string;
    functionCalls?: Array<{ name: string; args: unknown }>;
    candidates: unknown[];
    usageMetadata?: unknown;
}

class Models {
    async generateContent(req: GenerateContentRequest): Promise<GenerateContentResponse> {
        const data = await invokeEdgeFunction('gemini-proxy', {
            method: 'POST',
            body: req,
        });
        return {
            text: typeof data?.text === 'string' ? data.text : '',
            functionCalls: Array.isArray(data?.functionCalls) ? data.functionCalls : undefined,
            candidates: Array.isArray(data?.candidates) ? data.candidates : [],
            usageMetadata: data?.usageMetadata,
        };
    }
}

export class GoogleGenAI {
    models: Models;

    // The apiKey argument is preserved for API compatibility with the
    // real SDK but is ignored — the proxy holds the real key server-side.
    constructor(_opts?: { apiKey?: string }) {
        this.models = new Models();
    }
}

// Mirror of `@google/genai`'s Type enum (verified 2026-04-16 against
// @google/genai@1.30.0). These are the strings the REST API expects.
export const Type = {
    TYPE_UNSPECIFIED: 'TYPE_UNSPECIFIED',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    INTEGER: 'INTEGER',
    BOOLEAN: 'BOOLEAN',
    ARRAY: 'ARRAY',
    OBJECT: 'OBJECT',
    NULL: 'NULL',
} as const;

export type Type = (typeof Type)[keyof typeof Type];

export interface FunctionDeclaration {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
}
