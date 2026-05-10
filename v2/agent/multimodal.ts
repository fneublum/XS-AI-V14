// Agent v2 — multimodal intake adapter.
//
// Converts audio blobs / files into agent-ready text by pushing them
// through the gemini-proxy edge function. The agent loop itself is
// text-driven (plus structured tool I/O); anything coming in as audio
// or PDF/image gets transcribed / summarized to text first, then
// concatenated into the user turn that hits Claude.
//
// Two entry points:
//   transcribeAudio(blob)  — for voice messages (browser or WhatsApp)
//   extractFromFile(blob)  — for PDFs, images, and other documents

import { invokeEdgeFunction } from '../../services/edgeAuth';

const AUDIO_PROMPT = `You are a transcription service. Output ONLY the verbatim transcription of the audio. No commentary, no language tags, no "here is the transcription" preamble. If the audio is empty or silent, output exactly: (silence)`;

const FILE_PROMPT = `You are a document extraction assistant inside an ERP. Summarize this document so an operations agent can act on it.

Output format (plain text, no markdown, no headers):
DOC_TYPE: <invoice|purchase-order|packing-list|bill-of-lading|receipt|contract|email|other>
KEY_FIELDS: <comma-separated key=value pairs for every field you can extract — names, numbers, dates, amounts, products, quantities>
SUMMARY: <one paragraph, max 120 words, of what this document says>

Be terse. Dates in ISO (YYYY-MM-DD). Amounts with their currency.`;

const AUDIO_MODEL = 'gemini-2.5-flash';
const FILE_MODEL = 'gemini-2.5-flash';

interface GeminiResponse {
  text?: string;
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: string;
}

function extractText(resp: GeminiResponse): string {
  if (resp.error) throw new Error(resp.error);
  if (resp.text) return resp.text.trim();
  const parts = resp.candidates?.[0]?.content?.parts ?? [];
  return parts.map(p => p.text ?? '').join('').trim();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Transcribe an audio blob to text. Accepts browser MediaRecorder
 * output (audio/webm;codecs=opus), WhatsApp OGG, m4a, mp3 — whatever
 * Gemini Flash accepts.
 */
export async function transcribeAudio(blob: Blob): Promise<string> {
  const mimeType = blob.type || 'audio/webm';
  const data = await blobToBase64(blob);
  const resp = await invokeEdgeFunction('gemini-proxy', {
    method: 'POST',
    body: {
      model: AUDIO_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data } },
            { text: AUDIO_PROMPT },
          ],
        },
      ],
      config: { temperature: 0 },
    },
  }) as GeminiResponse;
  return extractText(resp);
}

/**
 * Extract a structured text summary from a file (PDF, image, etc).
 * The agent feeds this summary into its context so it can reason
 * about the document's contents without needing vision itself.
 */
export async function extractFromFile(blob: Blob): Promise<string> {
  const mimeType = blob.type || 'application/octet-stream';
  const data = await blobToBase64(blob);
  const resp = await invokeEdgeFunction('gemini-proxy', {
    method: 'POST',
    body: {
      model: FILE_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data } },
            { text: FILE_PROMPT },
          ],
        },
      ],
      config: { temperature: 0 },
    },
  }) as GeminiResponse;
  return extractText(resp);
}

/**
 * Given a raw user turn (text + optional audio/file), produce the
 * single text string the agent loop will see. Audio transcribes,
 * files get extracted to a text summary, and anything the user also
 * typed gets appended on top.
 */
export async function composeUserTurnText(args: {
  text?: string;
  audio?: Blob;
  file?: Blob;
}): Promise<string> {
  const parts: string[] = [];
  if (args.audio) {
    const transcript = await transcribeAudio(args.audio);
    parts.push(`[voice]: ${transcript}`);
  }
  if (args.file) {
    const summary = await extractFromFile(args.file);
    parts.push(`[attached file]:\n${summary}`);
  }
  if (args.text?.trim()) parts.push(args.text.trim());
  return parts.join('\n\n');
}
