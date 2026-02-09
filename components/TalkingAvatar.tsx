/**
 * TalkingAvatar - A visual avatar that animates when speaking
 * Adapted from HALL avatar project for the xsolution-ai-business-platform
 * Uses browser's native Web Speech API for TTS
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Volume2, VolumeX, Pause, Play } from 'lucide-react';

interface TalkingAvatarProps {
    text?: string;
    autoSpeak?: boolean;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    variant?: 'hall' | 'max' | 'bob'; // HALL = C-3PO robot, MAX = Executive female, BOB = Friendly male assistant
    lang?: 'en' | 'pt' | 'es' | 'zh'; // Language for TTS
    showControls?: boolean;
    onSpeakStart?: () => void;
    onSpeakEnd?: () => void;
}

type AvatarState = 'idle' | 'talking' | 'thinking' | 'paused';

// Simple TTS hook using browser's native SpeechSynthesis
const useTTS = () => {
    const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

    const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

    useEffect(() => {
        if (!isSupported) return;

        const loadVoices = () => {
            const availableVoices = window.speechSynthesis.getVoices();
            setVoices(availableVoices);
        };

        loadVoices();

        // Chrome loads voices asynchronously
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = loadVoices;
        }
    }, [isSupported]);

    const speak = useCallback((text: string, options?: { rate?: number; pitch?: number; lang?: string; onEnd?: () => void }) => {
        if (!isSupported || !text) return;

        // Cancel any ongoing speech
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = options?.rate || 1;
        utterance.pitch = options?.pitch || 1;

        // Set language based on option or default to English
        const langCode = options?.lang === 'pt' ? 'pt-BR'
            : options?.lang === 'es' ? 'es-ES'
                : options?.lang === 'zh' ? 'zh-CN'
                    : 'en-US';
        utterance.lang = langCode;

        // Select a preferred voice matching language
        if (voices.length > 0) {
            const langPrefix = langCode.split('-')[0];
            const googleVoice = voices.find(v => v.name.includes("Google") && v.lang.startsWith(langPrefix));
            const siriVoice = voices.find(v => v.name.includes("Siri") && v.lang.startsWith(langPrefix));
            const naturalVoice = voices.find(v => v.name.includes("Natural") && v.lang.startsWith(langPrefix));
            const anyLangVoice = voices.find(v => v.lang.startsWith(langPrefix));

            utterance.voice = googleVoice || siriVoice || naturalVoice || anyLangVoice || voices[0];
        }

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => {
            setIsSpeaking(false);
            setIsPaused(false);
            options?.onEnd?.();
        };
        utterance.onerror = (e) => {
            if (e.error !== 'interrupted') {
                console.error("TTS Error:", e);
            }
            setIsSpeaking(false);
            setIsPaused(false);
        };

        utteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
    }, [isSupported, voices]);

    const stop = useCallback(() => {
        if (isSupported) {
            window.speechSynthesis.cancel();
            setIsSpeaking(false);
            setIsPaused(false);
        }
    }, [isSupported]);

    const pause = useCallback(() => {
        if (isSupported && isSpeaking) {
            window.speechSynthesis.pause();
            setIsPaused(true);
        }
    }, [isSupported, isSpeaking]);

    const resume = useCallback(() => {
        if (isSupported && isPaused) {
            window.speechSynthesis.resume();
            setIsPaused(false);
        }
    }, [isSupported, isPaused]);

    return { speak, stop, pause, resume, isSpeaking, isPaused, isSupported };
};

export const TalkingAvatar: React.FC<TalkingAvatarProps> = ({
    text,
    autoSpeak = false,
    size = 'md',
    variant = 'hall',
    lang = 'en',
    showControls = true,
    onSpeakStart,
    onSpeakEnd,
}) => {
    const [avatarState, setAvatarState] = useState<AvatarState>('idle');
    const [isMuted, setIsMuted] = useState(false);
    const animationRef = useRef<number | null>(null);
    const [mouthFrame, setMouthFrame] = useState(0);

    const { speak, stop, pause, resume, isSpeaking, isPaused, isSupported } = useTTS();

    // Size configurations
    const sizeConfig = {
        sm: { width: 48, height: 48 },
        md: { width: 64, height: 64 },
        lg: { width: 96, height: 96 },
        xl: { width: 173, height: 173 },
    };

    const { width, height } = sizeConfig[size];

    // Eye blink mechanism
    const [isBlinking, setIsBlinking] = useState(false);

    useEffect(() => {
        const blinkInterval = setInterval(() => {
            setIsBlinking(true);
            setTimeout(() => setIsBlinking(false), 200);
        }, 4000 + Math.random() * 2000); // Random blink every 4-6s

        return () => clearInterval(blinkInterval);
    }, []);

    // Mouth animation frames for happy speaking
    const getMouthPath = () => {
        if (avatarState === 'talking') {
            const frames = [
                "M 35 65 Q 50 75 65 65", // Open smile
                "M 35 65 Q 50 68 65 65", // Closed smile
                "M 35 65 Q 50 80 65 65", // Low open
                "M 38 65 Q 50 72 62 65", // Small open
            ];
            return frames[mouthFrame];
        } else if (avatarState === 'thinking') {
            return "M 40 70 Q 50 65 60 70"; // Ooh face
        }
        return "M 35 65 Q 50 72 65 65"; // Resting smile
    };

    // Animate mouth when speaking
    useEffect(() => {
        if (avatarState === 'talking') {
            const animate = () => {
                setMouthFrame(prev => (prev + 1) % 4);
                animationRef.current = requestAnimationFrame(animate);
            };
            animationRef.current = requestAnimationFrame(animate);
        }

        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        };
    }, [avatarState]);

    // Handle speaking
    const handleSpeak = useCallback(() => {
        const avatarName = variant === 'max' ? 'MAX' : variant === 'bob' ? 'BOB' : 'HALL';
        console.log(`🔊 ${avatarName} Speak Requested:`, { text: text?.substring(0, 50), isSupported, isMuted, lang });
        if (!text) {
            console.warn('⚠️ No text to speak');
            return;
        }
        if (!isSupported) {
            console.warn('⚠️ TTS not supported');
            return;
        }
        if (isMuted) {
            console.warn(`⚠️ ${avatarName} is muted`);
            return;
        }

        console.log('✅ Speaking now...');
        setAvatarState('talking');
        onSpeakStart?.();

        speak(text, {
            rate: 1,
            pitch: 1,
            lang,
            onEnd: () => {
                console.log('✅ Speech ended');
                setAvatarState('idle');
                onSpeakEnd?.();
            },
        });
    }, [text, isSupported, isMuted, speak, onSpeakStart, onSpeakEnd]);

    // Auto-speak when text changes
    useEffect(() => {
        console.log('🔄 Auto-speak check:', { autoSpeak, hasText: !!text, textPreview: text?.substring(0, 30) });
        if (autoSpeak && text) {
            console.log('🚀 Triggering auto-speak...');
            handleSpeak();
        }
    }, [text, autoSpeak, handleSpeak]);

    // Sync avatar state with TTS state
    useEffect(() => {
        if (isSpeaking && !isPaused) {
            setAvatarState('talking');
        } else if (isPaused) {
            setAvatarState('paused');
        } else {
            setAvatarState('idle');
        }
    }, [isSpeaking, isPaused]);

    const handleToggleMute = () => {
        if (isMuted) {
            setIsMuted(false);
        } else {
            setIsMuted(true);
            stop();
        }
    };

    const handleTogglePause = () => {
        if (isPaused) {
            resume();
        } else {
            pause();
        }
    };

    // HALL - C-3PO Inspired Avatar (Golden metallic)
    const renderHallAvatar = () => {
        return (
            <div
                className={`relative transition-all duration-300 ${avatarState === 'talking' ? 'scale-105' : ''}`}
                style={{ width, height }}
            >
                {/* Golden glow when speaking */}
                <div className={`absolute inset-0 rounded-full bg-amber-400/30 blur-xl transition-opacity duration-500 ${avatarState === 'talking' ? 'opacity-100' : 'opacity-0'}`} />

                <svg viewBox="0 0 100 100" width={width} height={height} className="relative z-10 drop-shadow-xl">
                    <defs>
                        {/* Golden metallic gradient */}
                        <linearGradient id="goldMetal" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#FCD34D" />
                            <stop offset="30%" stopColor="#F59E0B" />
                            <stop offset="50%" stopColor="#FBBF24" />
                            <stop offset="70%" stopColor="#D97706" />
                            <stop offset="100%" stopColor="#B45309" />
                        </linearGradient>

                        {/* Bronze accent gradient */}
                        <linearGradient id="bronze" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#92400E" />
                            <stop offset="50%" stopColor="#78350F" />
                            <stop offset="100%" stopColor="#451A03" />
                        </linearGradient>

                        {/* Eye glow */}
                        <radialGradient id="eyeGlow" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="#FBBF24" />
                            <stop offset="70%" stopColor="#F59E0B" />
                            <stop offset="100%" stopColor="#D97706" />
                        </radialGradient>

                        {/* Active eye glow when speaking */}
                        <radialGradient id="eyeActive" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="#FEF3C7" />
                            <stop offset="50%" stopColor="#FCD34D" />
                            <stop offset="100%" stopColor="#F59E0B" />
                        </radialGradient>
                    </defs>

                    {/* Head - Elongated oval C-3PO style */}
                    <ellipse cx="50" cy="50" rx="35" ry="40" fill="url(#goldMetal)" stroke="#92400E" strokeWidth="1.5" />

                    {/* Face plate outline */}
                    <ellipse cx="50" cy="48" rx="28" ry="32" fill="none" stroke="#B45309" strokeWidth="0.5" opacity="0.5" />

                    {/* Forehead ridge */}
                    <path d="M 25 35 Q 50 25 75 35" stroke="#92400E" strokeWidth="1" fill="none" />

                    {/* Photoreceptor Eyes - Large round C-3PO style */}
                    <g transform={isBlinking ? "scale(1, 0.1) translate(0, 350)" : ""}>
                        {/* Left Eye Socket */}
                        <circle cx="35" cy="42" r="10" fill="#451A03" stroke="#78350F" strokeWidth="1" />
                        {/* Left Eye Glow */}
                        <circle cx="35" cy="42" r="7" fill={avatarState === 'talking' ? "url(#eyeActive)" : "url(#eyeGlow)"}>
                            {avatarState === 'talking' && (
                                <animate attributeName="r" values="7;8;7" dur="0.3s" repeatCount="indefinite" />
                            )}
                        </circle>
                        {/* Left Eye Highlight */}
                        <circle cx="33" cy="40" r="2" fill="white" opacity="0.6" />

                        {/* Right Eye Socket */}
                        <circle cx="65" cy="42" r="10" fill="#451A03" stroke="#78350F" strokeWidth="1" />
                        {/* Right Eye Glow */}
                        <circle cx="65" cy="42" r="7" fill={avatarState === 'talking' ? "url(#eyeActive)" : "url(#eyeGlow)"}>
                            {avatarState === 'talking' && (
                                <animate attributeName="r" values="7;8;7" dur="0.3s" repeatCount="indefinite" />
                            )}
                        </circle>
                        {/* Right Eye Highlight */}
                        <circle cx="63" cy="40" r="2" fill="white" opacity="0.6" />
                    </g>

                    {/* Nose ridge */}
                    <path d="M 50 50 L 50 58" stroke="#92400E" strokeWidth="1.5" strokeLinecap="round" />

                    {/* Mouth - Horizontal grill lines (C-3PO style) */}
                    <g>
                        {/* Mouth plate background */}
                        <rect x="35" y="65" width="30" height="12" rx="3" fill="#78350F" stroke="#92400E" strokeWidth="0.5" />

                        {/* Mouth grill lines - animate when talking */}
                        {[0, 1, 2, 3].map((i) => (
                            <rect
                                key={i}
                                x="38"
                                y={67 + i * 2.5}
                                width={avatarState === 'talking' ? 12 + (mouthFrame === i ? 10 : 0) : 24}
                                height="1.5"
                                rx="0.5"
                                fill={avatarState === 'talking' ? "#FCD34D" : "#92400E"}
                                opacity={avatarState === 'talking' ? 0.9 : 0.6}
                            >
                                {avatarState === 'talking' && (
                                    <animate
                                        attributeName="width"
                                        values={`${12 + i * 3};24;${12 + i * 3}`}
                                        dur="0.15s"
                                        repeatCount="indefinite"
                                        begin={`${i * 0.05}s`}
                                    />
                                )}
                            </rect>
                        ))}
                    </g>

                    {/* Side panels - Protocol droid aesthetic */}
                    <rect x="12" y="40" width="5" height="20" rx="2" fill="url(#bronze)" />
                    <rect x="83" y="40" width="5" height="20" rx="2" fill="url(#bronze)" />

                    {/* Cheek accents */}
                    <circle cx="22" cy="55" r="3" fill="#B45309" opacity="0.5" />
                    <circle cx="78" cy="55" r="3" fill="#B45309" opacity="0.5" />

                    {/* Top sensor/antenna */}
                    <rect x="47" y="8" width="6" height="4" rx="1" fill="url(#bronze)" />
                    <circle cx="50" cy="6" r="2" fill={avatarState === 'talking' ? "#FEF3C7" : "#D97706"}>
                        {avatarState === 'talking' && (
                            <animate attributeName="fill" values="#FEF3C7;#FBBF24;#FEF3C7" dur="0.5s" repeatCount="indefinite" />
                        )}
                    </circle>
                </svg>
            </div>
        );
    };

    // MAX - Executive Female Avatar (Light elegant colors)
    const renderMaxAvatar = () => {
        return (
            <div
                className={`relative transition-all duration-300 ${avatarState === 'talking' ? 'scale-105' : ''}`}
                style={{ width, height }}
            >
                {/* Soft pink glow when speaking */}
                <div className={`absolute inset-0 rounded-full bg-rose-300/30 blur-xl transition-opacity duration-500 ${avatarState === 'talking' ? 'opacity-100' : 'opacity-0'}`} />

                <svg viewBox="0 0 100 100" width={width} height={height} className="relative z-10 drop-shadow-xl">
                    <defs>
                        {/* Skin tone gradient */}
                        <linearGradient id="skinTone" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#FDF2F8" />
                            <stop offset="50%" stopColor="#FECDD3" />
                            <stop offset="100%" stopColor="#FBD5E8" />
                        </linearGradient>

                        {/* Hair gradient - elegant dark brunette */}
                        <linearGradient id="hairColor" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#4C3B4E" />
                            <stop offset="50%" stopColor="#3D2E40" />
                            <stop offset="100%" stopColor="#2E2130" />
                        </linearGradient>

                        {/* Eye gradient */}
                        <radialGradient id="eyeColorMax" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="#6366F1" />
                            <stop offset="70%" stopColor="#4F46E5" />
                            <stop offset="100%" stopColor="#3730A3" />
                        </radialGradient>

                        {/* Lip color */}
                        <linearGradient id="lipColor" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#F472B6" />
                            <stop offset="100%" stopColor="#EC4899" />
                        </linearGradient>
                    </defs>

                    {/* Hair - back layer (styled bob cut) */}
                    <ellipse cx="50" cy="48" rx="38" ry="42" fill="url(#hairColor)" />

                    {/* Face - elegant oval */}
                    <ellipse cx="50" cy="52" rx="28" ry="32" fill="url(#skinTone)" />

                    {/* Hair - front bangs */}
                    <path d="M 22 35 Q 35 20 50 22 Q 65 20 78 35 L 75 40 Q 60 30 50 32 Q 40 30 25 40 Z" fill="url(#hairColor)" />

                    {/* Hair sides */}
                    <path d="M 18 45 Q 15 60 22 75 L 28 72 Q 24 58 27 45 Z" fill="url(#hairColor)" />
                    <path d="M 82 45 Q 85 60 78 75 L 72 72 Q 76 58 73 45 Z" fill="url(#hairColor)" />

                    {/* Eyebrows - elegant arched */}
                    <path d="M 28 40 Q 36 36 44 40" stroke="#4C3B4E" strokeWidth="1.2" fill="none" strokeLinecap="round" />
                    <path d="M 56 40 Q 64 36 72 40" stroke="#4C3B4E" strokeWidth="1.2" fill="none" strokeLinecap="round" />

                    {/* Eyes - elegant almond shape */}
                    <g transform={isBlinking ? "scale(1, 0.1) translate(0, 400)" : ""}>
                        {/* Left eye */}
                        <ellipse cx="36" cy="48" rx="7" ry="5" fill="white" />
                        <circle cx="36" cy="48" r="4" fill="url(#eyeColorMax)">
                            {avatarState === 'talking' && (
                                <animate attributeName="r" values="4;4.5;4" dur="0.3s" repeatCount="indefinite" />
                            )}
                        </circle>
                        <circle cx="34" cy="46" r="1.5" fill="white" opacity="0.8" />

                        {/* Right eye */}
                        <ellipse cx="64" cy="48" rx="7" ry="5" fill="white" />
                        <circle cx="64" cy="48" r="4" fill="url(#eyeColorMax)">
                            {avatarState === 'talking' && (
                                <animate attributeName="r" values="4;4.5;4" dur="0.3s" repeatCount="indefinite" />
                            )}
                        </circle>
                        <circle cx="62" cy="46" r="1.5" fill="white" opacity="0.8" />
                    </g>

                    {/* Eyelashes */}
                    <path d="M 29 46 L 27 44" stroke="#2E2130" strokeWidth="0.8" strokeLinecap="round" />
                    <path d="M 31 45 L 30 43" stroke="#2E2130" strokeWidth="0.8" strokeLinecap="round" />
                    <path d="M 69 45 L 70 43" stroke="#2E2130" strokeWidth="0.8" strokeLinecap="round" />
                    <path d="M 71 46 L 73 44" stroke="#2E2130" strokeWidth="0.8" strokeLinecap="round" />

                    {/* Nose - subtle */}
                    <path d="M 50 52 L 50 58" stroke="#E8B4B8" strokeWidth="1" strokeLinecap="round" />
                    <circle cx="50" cy="59" r="2" fill="none" stroke="#E8B4B8" strokeWidth="0.5" />

                    {/* Cheeks - subtle blush */}
                    <ellipse cx="30" cy="58" rx="5" ry="3" fill="#FCA5A5" opacity="0.3" />
                    <ellipse cx="70" cy="58" rx="5" ry="3" fill="#FCA5A5" opacity="0.3" />

                    {/* Lips - animated for speech */}
                    <path
                        d={avatarState === 'talking'
                            ? `M 42 68 Q 46 ${70 + mouthFrame} 50 ${69 + mouthFrame} Q 54 ${70 + mouthFrame} 58 68 Q 54 ${72 - mouthFrame} 50 ${71 - mouthFrame} Q 46 ${72 - mouthFrame} 42 68`
                            : "M 43 68 Q 50 71 57 68 Q 50 70 43 68"
                        }
                        fill="url(#lipColor)"
                        stroke="#DB2777"
                        strokeWidth="0.5"
                    />

                    {/* Earrings - subtle pearl drops */}
                    <circle cx="22" cy="55" r="2" fill="#F9FAFB" stroke="#E5E7EB" strokeWidth="0.5">
                        {avatarState === 'talking' && (
                            <animate attributeName="cy" values="55;56;55" dur="0.5s" repeatCount="indefinite" />
                        )}
                    </circle>
                    <circle cx="78" cy="55" r="2" fill="#F9FAFB" stroke="#E5E7EB" strokeWidth="0.5">
                        {avatarState === 'talking' && (
                            <animate attributeName="cy" values="55;56;55" dur="0.5s" repeatCount="indefinite" />
                        )}
                    </circle>
                </svg>
            </div>
        );
    };

    // BOB - Friendly Male Avatar (Professional, Blue theme)
    // BOB - Friendly Male Avatar (Professional, Blue theme)
    // REDESIGNED: Circle with Sound Wave Animation
    const renderBobAvatar = () => {
        return (
            <div
                className="relative flex items-center justify-center rounded-full bg-slate-900 overflow-hidden shadow-xl border border-slate-700"
                style={{ width, height }}
            >
                {/* Background Glow */}
                <div className={`absolute inset-0 bg-blue-500/10 transition-opacity duration-300 ${avatarState === 'talking' ? 'opacity-100' : 'opacity-50'}`} />

                {/* Central Wave Container */}
                <div className="flex items-center justify-center gap-[3px] h-1/2">
                    {/* Only animate when talking */}
                    {avatarState === 'talking' ? (
                        <>
                            {[...Array(5)].map((_, i) => (
                                <div
                                    key={i}
                                    className="w-[4px] bg-blue-400 rounded-full animate-wave"
                                    style={{
                                        animationDuration: `${0.8 + Math.random() * 0.5}s`,
                                        animationDelay: `${i * 0.1}s`,
                                        height: '40%'
                                    }}
                                >
                                    <style>{`
                                        @keyframes wave {
                                            0%, 100% { height: 30%; opacity: 0.5; }
                                            50% { height: 100%; opacity: 1; background-color: #60A5FA; }
                                        }
                                        .animate-wave {
                                            animation-name: wave;
                                            animation-iteration-count: infinite;
                                            animation-timing-function: ease-in-out;
                                        }
                                    `}</style>
                                </div>
                            ))}
                        </>
                    ) : (
                        // Static State - Small subtle dots/lines
                        <>
                            {[...Array(5)].map((_, i) => (
                                <div
                                    key={i}
                                    className="w-[4px] bg-slate-600/50 rounded-full h-[30%]"
                                />
                            ))}
                        </>
                    )}
                </div>

                {/* Outer Ring pulse when talking */}
                {avatarState === 'talking' && (
                    <div className="absolute inset-0 rounded-full border border-blue-400/30 animate-ping opacity-20" />
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col items-center gap-2">
            {/* Render appropriate avatar based on variant */}
            {variant === 'max' ? renderMaxAvatar() : variant === 'bob' ? renderBobAvatar() : renderHallAvatar()}

            {/* Controls - Minimal */}
            {showControls && isSupported && (
                <div className="flex items-center gap-2 bg-white/50 backdrop-blur-sm px-2 py-1 rounded-full shadow-sm border border-slate-100">
                    <button
                        className="p-1 rounded-full hover:bg-slate-100 transition-colors text-slate-500 hover:text-slate-700"
                        onClick={(e) => { e.stopPropagation(); handleToggleMute(); }}
                        title={isMuted ? 'Unmute' : 'Mute'}
                    >
                        {isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                    </button>
                    {isSpeaking && (
                        <button
                            className="p-1 rounded-full hover:bg-slate-100 transition-colors text-slate-500 hover:text-slate-700"
                            onClick={(e) => { e.stopPropagation(); handleTogglePause(); }}
                            title={isPaused ? 'Resume' : 'Pause'}
                        >
                            {isPaused ? <Play size={12} /> : <Pause size={12} />}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default TalkingAvatar;
