/**
 * Persona Service
 * ================
 * Loads/saves AI assistant personas from Supabase system_settings.
 * Supports multiple assistants via key-based storage.
 * Provides in-memory caching (5 min TTL) to avoid repeated DB calls.
 */

import { getSupabaseClient } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────
export interface AIPersona {
    name: string;
    personality: string;
    tone: string;
    expertise: string;
    responseStyle: string;
    customInstructions: string;
}

export interface AssistantOption {
    id: string;
    label: string;
    settingsKey: string;
    defaultPersona: AIPersona;
}

// ─── Available Assistants ───────────────────────────────────────────
export const ASSISTANTS: AssistantOption[] = [
    {
        id: 'xs_ai',
        label: 'XS Agent',
        settingsKey: 'ai_persona',
        defaultPersona: {
            name: 'XS Agent',
            personality: 'Professional, concise, direct',
            tone: 'Executive-level, no emojis, start with the answer',
            expertise: 'Business management, logistics, international trade, supply chain',
            responseStyle: 'Maximum 2 sentences. When confirming actions, list only key fields in one line.',
            customInstructions: ''
        }
    },
    {
        id: 'email_agent',
        label: 'Email Agent',
        settingsKey: 'ai_persona_email',
        defaultPersona: {
            name: 'Email Agent',
            personality: 'Professional email communicator',
            tone: 'Formal business correspondence, clear and structured',
            expertise: 'Email composition, follow-ups, client communications',
            responseStyle: 'Draft complete emails. Use proper greeting and sign-off.',
            customInstructions: ''
        }
    },
    {
        id: 'logistics_agent',
        label: 'Logistics Agent',
        settingsKey: 'ai_persona_logistics',
        defaultPersona: {
            name: 'Logistics Agent',
            personality: 'Detail-oriented, precise, shipping expert',
            tone: 'Technical and informative, focused on logistics data',
            expertise: 'Ocean freight, container shipping, port operations, Incoterms, cargo tracking',
            responseStyle: 'Include relevant shipping details. Reference booking/BL numbers when available.',
            customInstructions: ''
        }
    },
    {
        id: 'sales_agent',
        label: 'Sales Agent',
        settingsKey: 'ai_persona_sales',
        defaultPersona: {
            name: 'Sales Agent',
            personality: 'Results-driven, customer-focused, persuasive',
            tone: 'Friendly but professional, solution-oriented',
            expertise: 'Sales processes, pricing, customer relationships, deal closing',
            responseStyle: 'Focus on value proposition. Highlight key benefits and pricing.',
            customInstructions: ''
        }
    },
    {
        id: 'bob',
        label: 'Bob (General Assistant)',
        settingsKey: 'ai_persona_bob',
        defaultPersona: {
            name: 'Bob',
            personality: 'Warm, helpful, proactive',
            tone: 'Conversational, approachable, supportive',
            expertise: 'General business queries, platform navigation, task management',
            responseStyle: 'Concise but friendly. Offer actionable suggestions.',
            customInstructions: ''
        }
    }
];

// ─── Default Persona (XS AI is the main one) ────────────────────────
export const DEFAULT_PERSONA: AIPersona = ASSISTANTS[0].defaultPersona;

// ─── Cache ──────────────────────────────────────────────────────────
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const personaCaches: Map<string, { persona: AIPersona; timestamp: number }> = new Map();

// ─── Load Persona ───────────────────────────────────────────────────
export async function getPersona(settingsKey: string = 'ai_persona'): Promise<AIPersona> {
    // Find the assistant config for defaults
    const assistant = ASSISTANTS.find(a => a.settingsKey === settingsKey);
    const defaultPersona = assistant?.defaultPersona || DEFAULT_PERSONA;

    // Return cached if fresh
    const cached = personaCaches.get(settingsKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return cached.persona;
    }

    try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', settingsKey)
            .single();

        if (error || !data?.value) {
            console.log(`[PersonaService] No persona in DB for ${settingsKey}, using default`);
            personaCaches.set(settingsKey, { persona: { ...defaultPersona }, timestamp: Date.now() });
            return { ...defaultPersona };
        }

        const stored = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;

        // Merge with defaults to ensure all fields exist
        const persona: AIPersona = {
            name: stored.name || defaultPersona.name,
            personality: stored.personality || defaultPersona.personality,
            tone: stored.tone || defaultPersona.tone,
            expertise: stored.expertise || defaultPersona.expertise,
            responseStyle: stored.responseStyle || defaultPersona.responseStyle,
            customInstructions: stored.customInstructions || ''
        };
        personaCaches.set(settingsKey, { persona, timestamp: Date.now() });

        console.log(`[PersonaService] Persona loaded from DB (${settingsKey}):`, persona.name);
        return persona;
    } catch (e: any) {
        console.error('[PersonaService] Failed to load persona:', e.message);
        return { ...defaultPersona };
    }
}

// ─── Save Persona ───────────────────────────────────────────────────
export async function savePersona(persona: AIPersona, settingsKey: string = 'ai_persona'): Promise<boolean> {
    try {
        const supabase = getSupabaseClient();

        // Check if row exists
        const { data: existing } = await supabase
            .from('system_settings')
            .select('key')
            .eq('key', settingsKey)
            .single();

        if (existing) {
            const { error } = await supabase
                .from('system_settings')
                .update({ value: persona })
                .eq('key', settingsKey);
            if (error) throw error;
        } else {
            const { error } = await supabase
                .from('system_settings')
                .insert({ key: settingsKey, value: persona });
            if (error) throw error;
        }

        // Refresh cache
        personaCaches.set(settingsKey, { persona: { ...persona }, timestamp: Date.now() });

        console.log(`[PersonaService] Persona saved (${settingsKey})`);
        return true;
    } catch (e: any) {
        console.error('[PersonaService] Failed to save persona:', e.message);
        return false;
    }
}

// ─── Clear Cache ────────────────────────────────────────────────────
export function clearPersonaCache(): void {
    personaCaches.clear();
    console.log('[PersonaService] All caches cleared');
}

// ─── Build System Prompt ────────────────────────────────────────────
export function buildSystemPrompt(persona: AIPersona): string {
    const parts: string[] = [];

    parts.push(`You are ${persona.name}, an executive AI for a business management and logistics platform.`);

    if (persona.tone) {
        parts.push(persona.tone + '.');
    }

    if (persona.responseStyle) {
        parts.push(persona.responseStyle);
    }

    if (persona.personality) {
        parts.push(`Personality: ${persona.personality}.`);
    }

    if (persona.expertise) {
        parts.push(`Expertise: ${persona.expertise}.`);
    }

    if (persona.customInstructions) {
        parts.push(persona.customInstructions);
    }

    return parts.join(' ');
}
