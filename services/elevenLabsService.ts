/**
 * ElevenLabs TTS Service for XS Agent
 * Provides text-to-speech using ElevenLabs API with audio queue management.
 */

const API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY || '';
const VOICE_ID = 'onwK4e9ZLuTAKqWW03F9'; // Daniel — Steady Broadcaster
const MODEL_ID = 'eleven_v3';              // Most expressive, emotion-aware
const API_URL = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`;

let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let speakingNow = false;
const audioQueue: string[] = [];
let processing = false;

// Callbacks for state changes
let onSpeakingChange: ((speaking: boolean) => void) | null = null;

export function setSpeakingCallback(cb: (speaking: boolean) => void) {
    onSpeakingChange = cb;
}

function setSpeaking(val: boolean) {
    speakingNow = val;
    onSpeakingChange?.(val);
}

/** Strip markdown + data artifacts for natural, conversational speech */
function cleanForSpeech(text: string): string {
    let clean = text
        // Remove emojis and special unicode symbols
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}]/gu, '')
        // Remove markdown headers
        .replace(/#{1,6}\s*/g, '')
        // Remove bold/italic markers but keep text
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/_(.+?)_/g, '$1')
        // Remove inline code backticks
        .replace(/`(.+?)`/g, '$1')
        // Remove code blocks entirely
        .replace(/```[\s\S]*?```/g, '')
        // Remove bullet points — convert to natural flow
        .replace(/^\s*[-*•]\s*/gm, '. ')
        // Remove numbered lists markers
        .replace(/^\s*\d+\.\s*/gm, '. ')
        // Remove markdown links, keep label
        .replace(/\[(.+?)\]\(.+?\)/g, '$1')
        // Remove pipe-separated data tables (read terribly)
        .replace(/\|[^|]+\|/g, '')
        .replace(/[-|]{3,}/g, '')
        // Convert paragraph breaks to natural pauses
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ', ')
        // Collapse multiple periods/commas
        .replace(/[.,]{2,}/g, '.')
        // Clean up extra whitespace
        .replace(/\s{2,}/g, ' ')
        .trim();

    // If the cleaned text is mostly data/numbers (>60% digits/special chars), summarize
    const dataRatio = (clean.replace(/[a-zA-Z\s]/g, '').length) / (clean.length || 1);
    if (dataRatio > 0.5 && clean.length > 200) {
        // Extract just the first meaningful sentence
        const firstSentence = clean.match(/^[^.!?]+[.!?]/);
        if (firstSentence) {
            clean = firstSentence[0] + ' I\'ve displayed the full details in the chat.';
        }
    }

    return clean;
}

/** Initialize AudioContext (must be called after user interaction) */
function getAudioContext(): AudioContext {
    if (!audioContext || audioContext.state === 'closed') {
        audioContext = new AudioContext();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    return audioContext;
}

/** Process the audio queue sequentially */
async function processQueue() {
    if (processing || audioQueue.length === 0) return;
    processing = true;

    while (audioQueue.length > 0) {
        const text = audioQueue.shift()!;
        const clean = cleanForSpeech(text);
        if (!clean || clean.length < 2) continue;

        // For very long responses, keep it concise for speech
        let toSpeak = clean;
        if (toSpeak.length > 500) {
            // Find a natural sentence break near 500 chars
            const cutoff = toSpeak.substring(0, 500);
            const lastPeriod = cutoff.lastIndexOf('.');
            if (lastPeriod > 100) {
                toSpeak = cutoff.substring(0, lastPeriod + 1) + ' The rest is shown in the chat.';
            } else {
                toSpeak = cutoff + '... The full details are in the chat.';
            }
        }

        try {
            setSpeaking(true);
            await playTTS(toSpeak);
        } catch (err) {
            console.warn('[ElevenLabs] TTS error, falling back to browser speech:', err);
            await fallbackSpeak(toSpeak);
        }
    }

    setSpeaking(false);
    processing = false;
}

/** Call ElevenLabs TTS API and play audio */
async function playTTS(text: string): Promise<void> {
    if (!API_KEY) {
        return fallbackSpeak(text);
    }

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'xi-api-key': API_KEY,
        },
        body: JSON.stringify({
            text,
            model_id: MODEL_ID,
            voice_settings: {
                stability: 0.35,          // Lower = more expressive, natural variation
                similarity_boost: 0.80,   // Keep voice character consistent
                style: 0.45,              // Add conversational expressiveness
                use_speaker_boost: true,
            },
        }),
    });

    if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const ctx = getAudioContext();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    return new Promise<void>((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        currentSource = source;
        source.onended = () => {
            currentSource = null;
            resolve();
        };
        source.start(0);
    });
}

/** Browser SpeechSynthesis fallback */
function fallbackSpeak(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
        if (!window.speechSynthesis) {
            resolve();
            return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;   // Slightly slower for natural feel
        utterance.pitch = 1.0;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
    });
}

/** Queue text to be spoken */
export function speakText(text: string) {
    audioQueue.push(text);
    processQueue();
}

/** Stop all audio playback */
export function stopSpeaking() {
    audioQueue.length = 0;
    if (currentSource) {
        try { currentSource.stop(); } catch { /* already stopped */ }
        currentSource = null;
    }
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    setSpeaking(false);
    processing = false;
}

/** Check if currently speaking */
export function isSpeakingNow(): boolean {
    return speakingNow;
}

/** Check if API key is configured */
export function isConfigured(): boolean {
    return !!API_KEY;
}
