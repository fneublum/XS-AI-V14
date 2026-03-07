import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Bot, X, Send, User, Sparkles, Loader2, Mic, StopCircle, Zap, MapPin } from 'lucide-react';
import { getBobResponse, BobContext } from '../services/geminiService';
import { User as UserType, Role } from '../types';
import { renderMarkdown } from '../utils/renderMarkdown';

interface AiCopilotSidebarProps {
    isOpen: boolean;
    onClose: () => void;
    currentUser: UserType | null;
    activeModule?: string;
    subModule?: string;
    contextData?: BobContext['data'];
    currentCompany?: string;
    allowedModules?: string[];
}

const MODULE_LABELS: Record<string, string> = {
    DASHBOARD: 'Dashboard', AI_UPLOAD: 'Automation', BUY: 'Purchase',
    SELL: 'Sales', LOGISTICS: 'Logistics',
    DATA: 'Data', FINANCE: 'Finance', CUSTOMER_PORTAL: 'Client Portal',
    SETTINGS: 'Settings'
};

// Quick suggestions based on current module
const MODULE_SUGGESTIONS: Record<string, string[]> = {
    DASHBOARD: ['Give me a summary of my data', 'What can I do on this platform?', 'Where are my Sales Orders?'],
    SELL: ['How do I create a sales order?', 'Show me my customers', 'How does the sales pipeline work?'],
    BUY: ['How do I create a purchase order?', 'How does cost calculation work?', 'Explain the margin formula', 'Compare supplier quotes', 'What is the Price List?'],
    LOGISTICS: ['How do I create a booking?', 'What are my active shipments?', 'How does the B/L module work?'],
    DATA: ['What data can I manage here?', 'How do I add a new product?', 'Show me my ports'],
    AI_UPLOAD: ['What documents can I scan?', 'How does OCR work?', 'What is the Proposal Engine?'],
    SETTINGS: ['How do I add a new user?', 'What roles are available?', 'How to configure email?'],
    FINANCE: ['What financial reports are available?', 'How do I track payments?'],
    CUSTOMER_PORTAL: ['What can I see in the portal?', 'Where are my orders?'],
};


const AiCopilotSidebar: React.FC<AiCopilotSidebarProps> = ({
    isOpen,
    onClose,
    currentUser,
    activeModule = 'DASHBOARD',
    subModule = '',
    contextData = {},
    currentCompany = 'ALL',
    allowedModules = []
}) => {
    const [messages, setMessages] = useState<{ role: 'user' | 'model', text: string }[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [hasGreeted, setHasGreeted] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const recognitionRef = useRef<any>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Get readable location
    const currentLocation = useMemo(() => {
        const label = MODULE_LABELS[activeModule] || activeModule;
        return subModule ? `${label} › ${subModule}` : label;
    }, [activeModule, subModule]);

    // Generate welcome message when sidebar opens
    useEffect(() => {
        if (isOpen && !hasGreeted && currentUser) {
            const greeting = `Hi **${currentUser.name}**! I'm Bob, your AI assistant. You're currently on **${currentLocation}**. How can I help you today?`;
            setMessages([{ role: 'model', text: greeting }]);
            setHasGreeted(true);
        }
    }, [isOpen, hasGreeted, currentUser, currentLocation]);

    // Reset greeting when module changes
    useEffect(() => {
        if (hasGreeted && messages.length <= 1) {
            setHasGreeted(false);
        }
    }, [activeModule, subModule]);

    // Scroll to bottom
    useEffect(() => {
        if (isOpen) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isOpen]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            setTimeout(() => inputRef.current?.focus(), 300);
        }
    }, [isOpen]);

    // Get suggestions for current module
    const suggestions = useMemo(() => {
        return MODULE_SUGGESTIONS[activeModule] || MODULE_SUGGESTIONS['DASHBOARD'];
    }, [activeModule]);

    const handleSend = async (overrideInput?: string) => {
        const text = overrideInput || input;
        if (!text.trim() || isThinking) return;

        const newMessages = [...messages, { role: 'user' as const, text }];
        setMessages(newMessages);
        setInput('');
        setIsThinking(true);

        try {
            const bobContext: BobContext = {
                activeModule,
                subModule,
                userName: currentUser?.name || 'User',
                userRole: currentUser?.role || 'USER',
                currentCompany,
                allowedModules,
                data: contextData
            };

            const response = await getBobResponse(text, newMessages, bobContext);
            setMessages(prev => [...prev, { role: 'model', text: response }]);
        } catch (error) {
            console.error('[Bob] Error:', error);
            setMessages(prev => [...prev, { role: 'model', text: "I'm having trouble right now. Please try again." }]);
        } finally {
            setIsThinking(false);
        }
    };

    const handleVoiceInput = () => {
        if (isListening) {
            recognitionRef.current?.stop();
            setIsListening(false);
            return;
        }

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('Voice input not supported in this browser.');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => setIsListening(true);
        recognition.onend = () => setIsListening(false);
        recognition.onerror = () => setIsListening(false);
        recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            if (transcript) {
                setInput(transcript);
                setTimeout(() => handleSend(transcript), 500);
            }
        };

        recognitionRef.current = recognition;
        recognition.start();
    };

    const handleClearChat = () => {
        setMessages([]);
        setHasGreeted(false);
    };

    // Only show chips if conversation is short
    const showSuggestions = messages.length <= 2;

    return (
        <>
            {/* Overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60]"
                    onClick={onClose}
                />
            )}

            {/* Sidebar */}
            <div className={`fixed top-0 right-0 h-full w-[420px] bg-white shadow-2xl z-[70] transform transition-transform duration-300 ease-in-out flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>

                {/* Header */}
                <div className="border-b border-indigo-100 flex items-center justify-between px-5 py-3 bg-gradient-to-r from-indigo-50 to-white">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-indigo-200">
                            <Bot size={20} />
                        </div>
                        <div>
                            <h2 className="font-bold text-slate-800 text-base leading-tight">Bob</h2>
                            <div className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                                <p className="text-[11px] text-slate-500 font-medium">AI Assistant</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={handleClearChat}
                            className="p-2 hover:bg-indigo-50 rounded-lg text-slate-400 hover:text-indigo-500 transition-colors text-xs font-medium"
                            title="Clear chat"
                        >
                            Clear
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Context Badge */}
                <div className="px-5 py-2 bg-slate-50/80 border-b border-slate-100 flex items-center gap-2">
                    <MapPin size={13} className="text-indigo-400" />
                    <span className="text-xs font-medium text-slate-500">
                        {currentLocation}
                    </span>
                    {currentUser && (
                        <span className="text-xs text-slate-400 ml-auto">
                            {currentUser.name} ({currentUser.role})
                        </span>
                    )}
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/30 custom-scrollbar">
                    {messages.map((msg, idx) => (
                        <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'user'
                                ? 'bg-slate-800 text-white'
                                : 'bg-gradient-to-br from-indigo-100 to-indigo-50 border border-indigo-200 text-indigo-500'
                                }`}>
                                {msg.role === 'user' ? <User size={14} /> : <Sparkles size={14} />}
                            </div>
                            <div className={`p-3.5 rounded-2xl text-sm leading-relaxed max-w-[85%] shadow-sm ${msg.role === 'user'
                                ? 'bg-slate-800 text-white rounded-tr-sm'
                                : 'bg-white border border-indigo-100/60 text-slate-700 rounded-tl-sm'
                                }`}>
                                {msg.role === 'model' ? renderMarkdown(msg.text) : msg.text}
                            </div>
                        </div>
                    ))}

                    {/* Thinking indicator */}
                    {isThinking && (
                        <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-100 to-indigo-50 border border-indigo-200 text-indigo-500 flex items-center justify-center shrink-0">
                                <Loader2 size={14} className="animate-spin" />
                            </div>
                            <div className="bg-white border border-indigo-100/60 px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm text-xs text-slate-400 italic flex items-center gap-2">
                                <span className="inline-flex gap-0.5">
                                    <span className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                    <span className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                    <span className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                </span>
                                Bob is thinking...
                            </div>
                        </div>
                    )}

                    {/* Suggestion Chips */}
                    {showSuggestions && !isThinking && (
                        <div className="pt-2">
                            <div className="flex items-center gap-1.5 mb-2">
                                <Zap size={12} className="text-amber-500" />
                                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Suggestions</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {suggestions.map((q, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleSend(q)}
                                        className="text-xs bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 px-3 py-1.5 rounded-full transition-all shadow-sm"
                                    >
                                        {q}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="p-4 border-t border-slate-100 bg-white">
                    <div className={`flex items-center gap-2 border rounded-xl p-2 transition-all ${isListening
                        ? 'border-red-400 ring-2 ring-red-100'
                        : 'border-slate-200 focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-50'
                        }`}>
                        <button
                            onClick={handleVoiceInput}
                            className={`p-2 rounded-lg transition-colors ${isListening
                                ? 'bg-red-50 text-red-600'
                                : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                                }`}
                        >
                            {isListening ? <StopCircle size={20} className="animate-pulse" /> : <Mic size={20} />}
                        </button>
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder="Ask Bob anything..."
                            className="flex-1 bg-transparent outline-none text-sm font-medium text-slate-700 placeholder:text-slate-400"
                            disabled={isThinking}
                        />
                        <button
                            onClick={() => handleSend()}
                            disabled={!input.trim() || isThinking}
                            className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                        >
                            <Send size={18} />
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};

export default AiCopilotSidebar;
