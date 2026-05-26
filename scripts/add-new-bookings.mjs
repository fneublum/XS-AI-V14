/**
 * One-shot script: OCR two new booking PDFs from ~/Desktop/Bookings
 * and insert them into Supabase.
 *
 * New bookings (not yet in DB):
 *   • Booking # 271230293.pdf
 *   • KE1136 - BOOKING CONFIRMATION 271164593.pdf
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

const SUPABASE_URL  = env.VITE_SUPABASE_URL;
const SUPABASE_KEY  = env.VITE_SUPABASE_ANON_KEY;
const GEMINI_KEY    = env.GEMINI_API_KEY;
const BOOKINGS_DIR  = '/Users/felipeneublum/Desktop/Bookings';

const sb  = createClient(SUPABASE_URL, SUPABASE_KEY);
const ai  = new GoogleGenAI({ apiKey: GEMINI_KEY });

const PROMPT_BOOKING = `Extract Booking Confirmation fields as JSON:
{"bookingNumber": string|null, "customer": string|null, "agentName": string|null, "vesselVoyage": string|null, "pol": string|null, "pod": string|null, "equipment": string|null, "etd": string|null, "eta": string|null, "cargoCutOff": string|null, "vgmCutOff": string|null, "draftCutOff": string|null, "freeTime": string|null, "terminal": string|null}
For "pol" and "pod" return ONLY the 5-letter UN/LOCODE (uppercase), e.g. "USHOU" — never the city name or descriptive form.
Return ONLY valid JSON.`;

// ── helpers ──────────────────────────────────────────────────────────────────

function toIsoDateString(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y  = d.getUTCFullYear();
  const m  = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dy}`;
}

function pickStr(o, k) {
  const v = o[k];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function parseJsonLoose(raw) {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function resolvePortCode(raw) {
  if (!raw) return null;
  const candidate = raw.replace(/\s*-.*$/, '').trim().toUpperCase();
  if (!/^[A-Z]{5}$/.test(candidate)) return raw;
  const { data } = await sb.from('ports').select('code').eq('code', candidate).maybeSingle();
  return data?.code ?? candidate;
}

async function ocrBooking(base64) {
  const resp = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'application/pdf', data: base64 } },
        { text: PROMPT_BOOKING },
      ],
    }],
  });
  return resp.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ── main ─────────────────────────────────────────────────────────────────────

const NEW_FILES = [
  'Booking # 271230293.pdf',
  'KE1136 - BOOKING CONFIRMATION 271164593.pdf',
];

for (const filename of NEW_FILES) {
  const filePath = path.join(BOOKINGS_DIR, filename);
  console.log(`\n📄 Processing: ${filename}`);

  if (!fs.existsSync(filePath)) {
    console.log(`   ❌ File not found: ${filePath}`);
    continue;
  }

  const buf    = fs.readFileSync(filePath);
  const base64 = buf.toString('base64');

  console.log(`   🔍 OCR with Gemini 2.5 Flash…`);
  const rawText = await ocrBooking(base64);
  console.log(`   Raw OCR:\n${rawText}\n`);

  const parsed = parseJsonLoose(rawText);
  if (!parsed) {
    console.log(`   ❌ Could not parse JSON from OCR output.`);
    continue;
  }

  const bookingNumber = pickStr(parsed, 'bookingNumber') ?? `BK-${Date.now()}`;

  // Duplicate guard
  const { data: existing } = await sb.from('bookings')
    .select('id')
    .eq('bookingNumber', bookingNumber)
    .maybeSingle();

  if (existing?.id) {
    console.log(`   ⚠️  Booking ${bookingNumber} already in DB (${existing.id}) — updating PDF only.`);
    await sb.from('bookings')
      .update({ originalDocument: `data:application/pdf;base64,${base64}` })
      .eq('id', existing.id);
    continue;
  }

  const [pol, pod] = await Promise.all([
    resolvePortCode(pickStr(parsed, 'pol')),
    resolvePortCode(pickStr(parsed, 'pod')),
  ]);

  const row = {
    id:               `BK${Date.now()}`,
    bookingNumber,
    companyId:        null,
    customer:         pickStr(parsed, 'customer'),
    agentName:        pickStr(parsed, 'agentName'),
    vesselVoyage:     pickStr(parsed, 'vesselVoyage'),
    pol,
    pod,
    equipment:        pickStr(parsed, 'equipment'),
    etd:              toIsoDateString(pickStr(parsed, 'etd')),
    eta:              toIsoDateString(pickStr(parsed, 'eta')),
    cargoCutOff:      toIsoDateString(pickStr(parsed, 'cargoCutOff')),
    vgmCutOff:        toIsoDateString(pickStr(parsed, 'vgmCutOff')),
    draftCutOff:      toIsoDateString(pickStr(parsed, 'draftCutOff')),
    freeTime:         pickStr(parsed, 'freeTime'),
    terminal:         pickStr(parsed, 'terminal'),
    originalDocument: `data:application/pdf;base64,${base64}`,
    status:           'AVAILABLE',
    createdAt:        new Date().toISOString(),
  };

  console.log(`   📝 Inserting booking ${bookingNumber}…`);
  console.log(`      pol=${pol}  pod=${pod}  etd=${row.etd}  eta=${row.eta}`);
  console.log(`      cutOff=${row.cargoCutOff}  vgm=${row.vgmCutOff}  draft=${row.draftCutOff}`);
  console.log(`      terminal=${row.terminal}  equipment=${row.equipment}`);

  const { error } = await sb.from('bookings').insert(row);
  if (error) {
    console.log(`   ❌ Insert failed: ${error.message}`);
  } else {
    console.log(`   ✅ Inserted as ${row.id}`);
  }
}

console.log('\n✅ Done.');
