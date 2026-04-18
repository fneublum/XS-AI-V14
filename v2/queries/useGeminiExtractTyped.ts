// Phase 3B — Reusable Gemini extraction hook.
//
// Generalizes the Freight Quote flow: any page can call this with its
// own extraction prompt + normalizer and get the same file/image/text
// input pipeline.

import { useMutation } from '@tanstack/react-query';
import { GoogleGenAI } from '../../services/geminiClient';

export type ExtractInput =
  | { kind: 'file';  file: File }
  | { kind: 'text';  text: string }
  | { kind: 'image'; dataUrl: string };

export interface ExtractSpec<T> {
  /** Prompt describing the target document and JSON schema. */
  prompt: string;
  /** Convert the parsed JSON into the target draft shape. */
  normalize: (parsed: Record<string, unknown>) => T;
  /** Gemini model id. Defaults to 'gemini-2.0-flash'. */
  model?: string;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const result = reader.result as string;
      resolve((result.split(',')[1] ?? ''));
    };
    reader.readAsDataURL(file);
  });
}

export function useGeminiExtractTyped<T>(spec: ExtractSpec<T>) {
  return useMutation<T, Error, ExtractInput>({
    mutationFn: async (input) => {
      const ai = new GoogleGenAI({ apiKey: 'proxy' });

      const parts: Array<Record<string, unknown>> = [{ text: spec.prompt }];
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
        parts.push({ text: `--- PASTED DOCUMENT ---\n${input.text}\n--- END ---` });
      }

      const result = await ai.models.generateContent({
        model: spec.model ?? 'gemini-2.0-flash',
        contents: [{ role: 'user', parts }],
        config: { responseMimeType: 'application/json', temperature: 0 },
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

      return spec.normalize(parsed);
    },
  });
}
