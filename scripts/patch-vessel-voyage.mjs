/**
 * Patch vesselVoyage for bookings 271051138 and 271230306
 * by re-OCR-ing their PDFs and updating only that column.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

// Load credentials from .env.local (never hard-code secrets in scripts)
const envRaw = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const env = Object.fromEntries(
  envRaw.split('\n').filter(l => l.includes('=')).map(l => {
    const idx = l.indexOf('='); return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
  })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY;
const GEMINI_KEY   = env.GEMINI_API_KEY;
const DIR          = '/Users/felipeneublum/Desktop/Bookings';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

const PROMPT = `From this booking confirmation PDF extract ONLY the vessel name and voyage number as JSON:
{"vesselVoyage": string|null}
Return ONLY valid JSON.`;

async function ocr(base64) {
  const resp = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: 'application/pdf', data: base64 } },
      { text: PROMPT },
    ]}],
  });
  return resp.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

function parseJson(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const TARGETS = [
  { bookingNumber: '271051138', file: 'Booking # 271051138 Updated.pdf' },
  { bookingNumber: '271230306', file: 'booking # 271230306 - Houston x Manaus.pdf' },
];

for (const { bookingNumber, file } of TARGETS) {
  console.log(`\n📄 ${bookingNumber} — ${file}`);
  const buf    = fs.readFileSync(path.join(DIR, file));
  const base64 = buf.toString('base64');

  console.log('   🔍 OCR…');
  const raw    = await ocr(base64);
  console.log(`   Raw: ${raw}`);
  const parsed = parseJson(raw);
  const vessel = parsed?.vesselVoyage?.trim() || null;
  console.log(`   vesselVoyage → ${vessel}`);

  if (!vessel) { console.log('   ⚠️  Nothing extracted — skipping.'); continue; }

  const { error } = await sb.from('bookings')
    .update({ vesselVoyage: vessel })
    .eq('bookingNumber', bookingNumber);

  if (error) console.log(`   ❌ Update failed: ${error.message}`);
  else        console.log(`   ✅ Updated.`);
}
console.log('\nDone.');
