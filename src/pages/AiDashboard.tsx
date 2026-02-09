
import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Wifi, WifiOff, MessageCircle, Sparkles } from 'lucide-react';
import { askHall, getHallStatus, sendToHall, HALL_PHONE_NUMBER } from '../services/hallService';

interface AiDashboardProps {
    currentUser: any;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'hall';
    text: string;
    timestamp: Date;
    status: 'sending' | 'sent' | 'delivered' | 'error';
    twilioSid?: string;
}

const AiDashboard: React.FC<AiDashboardProps> = ({ currentUser }) => {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isConnected, setIsConnected] = useState(false);
    const [isChecking, setIsChecking] = useState(true);
    const [isSending, setIsSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const userName = currentUser?.name?.split(' ')[0] || 'You';

    // Check HALL connection on mount
    useEffect(() => {
        checkConnection();
    }, []);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Focus input on load
    useEffect(() => {
        if (!isChecking) inputRef.current?.focus();
    }, [isChecking]);

    const checkConnection = async () => {
        setIsChecking(true);
        try {
            const status = await getHallStatus();
            setIsConnected(status.connected);
            if (status.connected) {
                // Add welcome message
                addHallMessage("Connected to HALL via WhatsApp. Messages you send here will be delivered to HALL through Twilio. HALL will respond directly on WhatsApp.");
            }
        } catch {
            setIsConnected(false);
        }
        setIsChecking(false);
    };

    const addHallMessage = (text: string) => {
        setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: 'hall',
            text,
            timestamp: new Date(),
            status: 'delivered'
        }]);
    };

    const handleSend = async () => {
        const text = input.trim();
        if (!text || isSending) return;

        const messageId = crypto.randomUUID();

        // Add user message immediately
        setMessages(prev => [...prev, {
            id: messageId,
            role: 'user',
            text,
            timestamp: new Date(),
            status: 'sending'
        }]);

        setInput('');
        setIsSending(true);

        try {
            const result = await sendToHall(text);

            if (result.success) {
                // Mark message as sent
                setMessages(prev => prev.map(m =>
                    m.id === messageId
                        ? { ...m, status: 'delivered' as const, twilioSid: result.messageId }
                        : m
                ));

                // Show HALL's reply if available (brain API), or delivery confirmation (Twilio)
                if (result.reply) {
                    addHallMessage(result.reply);
                } else {
                    addHallMessage(`✅ Delivered via WhatsApp • SID: ${result.messageId?.slice(-8)}`);
                }
            } else {
                // Mark as error
                setMessages(prev => prev.map(m =>
                    m.id === messageId ? { ...m, status: 'error' as const } : m
                ));
                addHallMessage(`❌ Failed to send: ${result.error}`);
            }
        } catch (err: any) {
            setMessages(prev => prev.map(m =>
                m.id === messageId ? { ...m, status: 'error' as const } : m
            ));
            addHallMessage(`❌ Error: ${err.message || 'Connection failed'}`);
        }

        setIsSending(false);
        inputRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const formatTime = (date: Date) => {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    if (isChecking) {
        return (
            <div className="h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)' }}>
                <div className="text-center">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/30 animate-pulse">
                        <MessageCircle size={28} className="text-white" />
                    </div>
                    <p className="text-slate-300 text-sm font-medium">Connecting to HALL...</p>
                    <p className="text-slate-500 text-xs mt-1">Checking Twilio configuration</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col overflow-hidden rounded-xl" style={{ background: 'linear-gradient(180deg, #0f172a 0%, #1a1a2e 100%)' }}>

            {/* ─── Header ─── */}
            <div className="shrink-0 px-5 py-3 flex items-center justify-between border-b border-white/5" style={{ background: 'rgba(15,23,42,0.8)', backdropFilter: 'blur(20px)' }}>
                <div className="flex items-center gap-3">
                    {/* HALL Avatar */}
                    <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                            <Sparkles size={18} className="text-white" />
                        </div>
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900 ${isConnected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                    </div>
                    <div>
                        <h2 className="text-white font-semibold text-sm tracking-wide">HALL</h2>
                        <p className="text-xs text-slate-400 flex items-center gap-1">
                            {isConnected ? (
                                <><Wifi size={10} className="text-emerald-400" /> WhatsApp Connected</>
                            ) : (
                                <><WifiOff size={10} className="text-red-400" /> Disconnected</>
                            )}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 font-mono">{HALL_PHONE_NUMBER}</span>
                </div>
            </div>

            {/* ─── Messages Area ─── */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>

                {/* Empty state */}
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-center py-12 opacity-60">
                        <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-4">
                            <MessageCircle size={32} className="text-slate-500" />
                        </div>
                        <p className="text-slate-400 text-sm font-medium">No messages yet</p>
                        <p className="text-slate-600 text-xs mt-1 max-w-xs">
                            Send a message to HALL. It will be delivered via WhatsApp using your Twilio account.
                        </p>
                    </div>
                )}

                {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] group`}>
                            {/* Message bubble */}
                            <div
                                className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.role === 'user'
                                    ? 'bg-gradient-to-br from-indigo-500 to-indigo-600 text-white rounded-br-md'
                                    : 'bg-white/[0.07] text-slate-200 rounded-bl-md border border-white/[0.06]'
                                    }`}
                                style={msg.role === 'hall' ? { backdropFilter: 'blur(10px)' } : {}}
                            >
                                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                            </div>

                            {/* Metadata row */}
                            <div className={`flex items-center gap-1.5 mt-1 px-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <span className="text-[10px] text-slate-600">{formatTime(msg.timestamp)}</span>
                                {msg.role === 'user' && (
                                    <span className={`text-[10px] ${msg.status === 'sending' ? 'text-slate-500' :
                                        msg.status === 'delivered' ? 'text-emerald-400' :
                                            msg.status === 'error' ? 'text-red-400' :
                                                'text-blue-400'
                                        }`}>
                                        {msg.status === 'sending' ? '⏳' :
                                            msg.status === 'delivered' ? '✓✓' :
                                                msg.status === 'error' ? '✕' : '✓'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                ))}

                {/* Typing indicator */}
                {isSending && (
                    <div className="flex justify-start">
                        <div className="bg-white/[0.07] border border-white/[0.06] px-4 py-3 rounded-2xl rounded-bl-md" style={{ backdropFilter: 'blur(10px)' }}>
                            <span className="flex gap-1">
                                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                            </span>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* ─── Input Bar ─── */}
            <div className="shrink-0 px-4 py-3 border-t border-white/5" style={{ background: 'rgba(15,23,42,0.9)', backdropFilter: 'blur(20px)' }}>
                {!isConnected ? (
                    <div className="flex items-center justify-center gap-2 py-2">
                        <WifiOff size={14} className="text-red-400" />
                        <span className="text-red-400 text-xs">Twilio not configured</span>
                        <button
                            onClick={checkConnection}
                            className="text-xs text-indigo-400 hover:text-indigo-300 underline ml-2 transition-colors"
                        >
                            Retry
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-3">
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Message HALL..."
                            disabled={isSending}
                            className="flex-1 bg-white/[0.06] border border-white/[0.08] text-white placeholder-slate-500 rounded-full px-5 py-2.5 text-sm outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all disabled:opacity-50"
                            style={{ backdropFilter: 'blur(10px)' }}
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || isSending}
                            className="w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-br from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 shadow-lg shadow-indigo-500/20 active:scale-95"
                        >
                            {isSending ? (
                                <Loader2 size={16} className="text-white animate-spin" />
                            ) : (
                                <Send size={16} className="text-white" />
                            )}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AiDashboard;
