import React, { useState, useRef, useEffect } from 'react';
import { Bot, X, Send, User, Sparkles, Loader2, StopCircle, Mic } from 'lucide-react';
import { askHall, getHallStatus } from '../services/hallService';
import { User as UserType } from '../types';


interface AiCopilotSidebarProps {
    isOpen: boolean;
    onClose: () => void;
    currentUser: UserType | null;
    activeModule?: string;
    subModule?: string;
    contextData?: any;
}

const AiCopilotSidebar: React.FC<AiCopilotSidebarProps> = ({
    isOpen,
    onClose,
    currentUser,
    activeModule = 'DASHBOARD',
    subModule = '',
    contextData = {}
}) => {
    const [messages, setMessages] = useState<{ role: 'user' | 'model', text: string }[]>([
        { role: 'model', text: "HALL ready. How can I assist?" }
    ]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [hallStatus, setHallStatus] = useState<'ready' | 'connecting' | 'offline'>('connecting');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const recognitionRef = useRef<any>(null);

    // Check HALL connection status
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const status = await getHallStatus();
                setHallStatus(status.connected ? 'ready' : 'offline');
            } catch {
                setHallStatus('offline');
            }
        };

        if (isOpen) {
            checkStatus();
        }
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isOpen]);

    const handleSend = async (overrideInput?: string) => {
        const text = overrideInput || input;
        if (!text.trim()) return;

        const newHistory = [...messages, { role: 'user' as const, text }];
        setMessages(newHistory);
        setInput('');
        setIsThinking(true);

        try {
            // Send to HALL AI via hallService
            const response = await askHall(text, newHistory);
            setMessages(prev => [...prev, { role: 'model', text: response }]);
        } catch (error) {
            console.error("HALL Error:", error);
            setMessages(prev => [...prev, { role: 'model', text: "I'm having trouble connecting to HALL right now." }]);
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
            alert("Voice input not supported in this browser.");
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
            <div className={`fixed top-0 right-0 h-full w-[400px] bg-white shadow-2xl z-[70] transform transition-transform duration-300 ease-in-out flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>

                {/* Header */}
                <div className="h-20 border-b border-slate-100 flex items-center justify-between px-6 bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                            <Bot size={24} />
                        </div>
                        <div>
                            <h2 className="font-bold text-slate-800 text-lg">HALL - AI executive assistant</h2>
                            <div className="flex items-center gap-1.5">
                                <div className={`w-2 h-2 rounded-full ${hallStatus === 'ready' ? 'bg-emerald-500' : hallStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' : 'bg-slate-400'}`}></div>
                                <p className="text-xs text-slate-500 font-medium">{hallStatus === 'ready' ? 'Ready' : hallStatus === 'connecting' ? 'Connecting...' : 'Offline'}</p>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/30 custom-scrollbar">
                    {messages.map((msg, idx) => (
                        <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'user' ? 'bg-slate-800 text-white' : 'bg-white border border-slate-100 text-purple-500'}`}>
                                {msg.role === 'user' ? <User size={14} /> : <Sparkles size={14} />}
                            </div>
                            <div className={`p-4 rounded-2xl text-sm leading-relaxed max-w-[85%] shadow-sm ${msg.role === 'user'
                                ? 'bg-white border border-slate-200 text-slate-800 rounded-tr-none'
                                : 'bg-white border border-purple-100 text-slate-700 rounded-tl-none ring-1 ring-purple-50'
                                }`}>
                                {msg.text}
                            </div>
                        </div>
                    ))}
                    {isThinking && (
                        <div className="flex gap-3">
                            <div className="w-8 h-8 rounded-full bg-white border border-slate-100 text-red-500 flex items-center justify-center shrink-0">
                                <Loader2 size={14} className="animate-spin" />
                            </div>
                            <div className="bg-white border border-slate-100 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm text-xs text-slate-400 italic">
                                Thinking...
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="p-4 border-t border-slate-100 bg-white">
                    <div className={`flex items-center gap-2 border rounded-xl p-2 transition-all ${isListening ? 'border-red-400 ring-2 ring-red-100' : 'border-slate-200 focus-within:border-blue-300 focus-within:ring-2 focus-within:ring-blue-50'}`}>
                        <button
                            onClick={handleVoiceInput}
                            className={`p-2 rounded-lg transition-colors ${isListening ? 'bg-red-50 text-red-600' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}
                        >
                            {isListening ? <StopCircle size={20} className="animate-pulse" /> : <Mic size={20} />}
                        </button>
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder="Ask HALL anything..."
                            className="flex-1 bg-transparent outline-none text-sm font-medium text-slate-700 placeholder:text-slate-400"
                            disabled={isThinking}
                        />
                        <button
                            onClick={() => handleSend()}
                            disabled={!input.trim() || isThinking}
                            className="p-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
