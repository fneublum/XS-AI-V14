
import React, { useState, useRef, useEffect } from 'react';
import { Supplier, PurchaseOrder, SupplierOffer } from '../types';
import { Bot, Sparkles, Send, Loader2, BarChart3, Mail, ShieldAlert, FileText, Database, User, UploadCloud, Mic, Play, CheckCircle2, ArrowRight, StopCircle } from 'lucide-react';
import { getProcurementAgentResponse, analyzeDocument } from '../services/geminiService';

interface AiProcurementProps {
    suppliers: Supplier[];
    purchaseOrders: PurchaseOrder[];
    supplierOffers: SupplierOffer[];
}

interface AutomatedTask {
    id: string;
    title: string;
    type: 'EMAIL' | 'REVIEW' | 'ALERT';
    desc: string;
    action: () => void;
}

const AiProcurement: React.FC<AiProcurementProps> = ({ suppliers, purchaseOrders, supplierOffers }) => {
    // --- CHAT STATE ---
    const [messages, setMessages] = useState<{ role: 'user' | 'model', text: string, attachment?: string }[]>([
        { role: 'model', text: "Hello! I'm your Procurement Copilot. I'm ready to help you automate tasks, analyze documents, or negotiate with suppliers." }
    ]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // --- UPLOAD STATE ---
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // --- AUTOMATION STATE ---
    const [tasks, setTasks] = useState<AutomatedTask[]>([]);

    // --- VOICE STATE ---
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<any>(null);

    // Auto-scroll chat
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Generate Automated Tasks based on Data
    useEffect(() => {
        const newTasks: AutomatedTask[] = [];

        // 1. Check for Pending Offers
        const pendingOffers = supplierOffers.filter(o => o.status === 'Received');
        if (pendingOffers.length > 0) {
            newTasks.push({
                id: 'task_1',
                title: 'Review New Offers',
                type: 'REVIEW',
                desc: `${pendingOffers.length} new supplier offers waiting for comparison.`,
                action: () => handleSend(`Analyze the ${pendingOffers.length} pending supplier offers. Which one offers the best unit price?`)
            });
        }

        // 2. Check for Draft POs
        const draftPOs = purchaseOrders.filter(p => p.status === 'Draft');
        if (draftPOs.length > 0) {
            newTasks.push({
                id: 'task_2',
                title: 'Draft POs Pending',
                type: 'EMAIL',
                desc: `${draftPOs.length} Purchase Orders ready to be sent.`,
                action: () => handleSend(`Help me draft the email to send PO #${draftPOs[0].id} to ${draftPOs[0].supplierName}.`)
            });
        }

        // 3. General Market Check
        newTasks.push({
            id: 'task_3',
            title: 'US Market Prices Research',
            type: 'ALERT',
            desc: 'Analyze current US market pricing trends for key commodities.',
            action: () => handleSend("Research current US market prices for plastic resins and textile fibers. Provide a summary of price trends for the last month.")
        });

        setTasks(newTasks);
    }, [supplierOffers, purchaseOrders]);

    // --- HANDLERS ---

    const handleSend = async (overrideInput?: string) => {
        const text = overrideInput || input;
        if (!text.trim()) return;

        // UI Update
        const newHistory = [...messages, { role: 'user' as const, text }];
        setMessages(newHistory);
        setInput('');
        setIsThinking(true);

        // API Call
        try {
            const response = await getProcurementAgentResponse(text, newHistory, {
                suppliers,
                purchaseOrders,
                offers: supplierOffers
            });
            setMessages(prev => [...prev, { role: 'model', text: response }]);
        } catch (error) {
            setMessages(prev => [...prev, { role: 'model', text: "I encountered an error connecting to the server." }]);
        } finally {
            setIsThinking(false);
        }
    };

    const handleVoiceInput = () => {
        if (isListening) {
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
            setIsListening(false);
            return;
        }

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Voice input is not supported in this browser.");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            setIsListening(true);
        };

        recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            if (transcript) {
                setInput(transcript); // Show what was heard
                setTimeout(() => handleSend(transcript), 500); // Auto-send after a brief pause
            }
        };

        recognition.onerror = (event: any) => {
            console.error("Speech recognition error", event.error);
            setIsListening(false);
        };

        recognition.onend = () => {
            setIsListening(false);
        };

        recognitionRef.current = recognition;
        recognition.start();
    };

    const handleFileUpload = async (file: File) => {
        setIsUploading(true);
        setUploadStatus('Analyzing document...');
        
        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64Data = (e.target?.result as string).split(',')[1];
                
                // OCR / Analyze Document via Gemini
                const prompt = "Analyze this document. Identify the document type, the sender, total amount, and summarize the key line items or terms.";
                const analysis = await analyzeDocument(base64Data, file.type, prompt);
                
                // Add to Chat Context
                const newHistory = [
                    ...messages, 
                    { role: 'user' as const, text: `[Uploaded Document: ${file.name}]`, attachment: file.name },
                    { role: 'model' as const, text: `I've analyzed ${file.name}. Here is the summary:\n\n${analysis}` }
                ];
                setMessages(newHistory);
                setUploadStatus('Done');
                setTimeout(() => {
                    setIsUploading(false);
                    setUploadStatus('');
                }, 2000);
            };
            reader.readAsDataURL(file);
        } catch (error) {
            setUploadStatus('Error');
            setIsUploading(false);
        }
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    };

    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    return (
        <div className="h-[calc(100vh-6rem)] w-full flex gap-6 p-2 overflow-hidden animate-in fade-in">
            
            {/* --- LEFT COLUMN (35%) --- */}
            <div className="w-[35%] flex flex-col gap-6 h-full">
                
                {/* 1. AUTOMATION WINDOW */}
                <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                    <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <Sparkles size={18} className="text-purple-600"/> AUTOMATION
                        </h3>
                        <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-1 rounded-full">
                            {tasks.length} Suggested
                        </span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        {tasks.map(task => (
                            <div key={task.id} className="p-4 rounded-xl border border-slate-200 hover:border-purple-300 hover:shadow-md transition-all group bg-white">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-1.5 rounded-lg ${
                                            task.type === 'EMAIL' ? 'bg-blue-100 text-blue-600' :
                                            task.type === 'REVIEW' ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'
                                        }`}>
                                            {task.type === 'EMAIL' ? <Mail size={14}/> : task.type === 'REVIEW' ? <FileText size={14}/> : <ShieldAlert size={14}/>}
                                        </div>
                                        <span className="font-bold text-sm text-slate-700">{task.title}</span>
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500 mb-3 leading-relaxed">{task.desc}</p>
                                <button 
                                    onClick={task.action}
                                    className="text-xs font-bold text-purple-600 flex items-center gap-1 group-hover:underline"
                                >
                                    Auto-Run Task <ArrowRight size={12}/>
                                </button>
                            </div>
                        ))}
                        {tasks.length === 0 && (
                            <div className="text-center p-8 text-slate-400">
                                <CheckCircle2 size={32} className="mx-auto mb-2 opacity-50"/>
                                <p className="text-sm">All automated tasks cleared.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. DOCUMENT DROP / UPLOAD */}
                <div className="h-[35%] bg-slate-900 rounded-3xl shadow-lg border border-slate-800 flex flex-col overflow-hidden relative">
                    <div className="p-4 border-b border-slate-800 flex justify-between items-center">
                        <h3 className="font-bold text-white flex items-center gap-2 text-sm">
                            <UploadCloud size={16} className="text-blue-400"/> DOC DROP / UPLOAD
                        </h3>
                    </div>
                    <div 
                        className="flex-1 flex flex-col items-center justify-center p-6 text-center cursor-pointer transition-colors hover:bg-slate-800/50"
                        onDrop={onDrop}
                        onDragOver={onDragOver}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            className="hidden" 
                            onChange={(e) => e.target.files && handleFileUpload(e.target.files[0])} 
                            accept=".pdf,.jpg,.png"
                        />
                        
                        {isUploading ? (
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 size={32} className="text-blue-400 animate-spin"/>
                                <p className="text-slate-300 text-xs font-mono animate-pulse">{uploadStatus}</p>
                            </div>
                        ) : (
                            <>
                                <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3 border border-slate-700">
                                    <FileText size={24} className="text-slate-400"/>
                                </div>
                                <p className="text-slate-300 text-sm font-medium mb-1">Drop or upload here</p>
                                <p className="text-slate-500 text-xs">OCR & Data Extraction Ready</p>
                            </>
                        )}
                    </div>
                </div>

            </div>

            {/* --- RIGHT COLUMN (65%) --- */}
            {/* 3. COPILOT */}
            <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-xl flex flex-col overflow-hidden">
                {/* Copilot Header */}
                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                            <Bot size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">COPILOT</h2>
                            <p className="text-xs text-slate-500 flex items-center gap-1">
                                <span className={`w-1.5 h-1.5 rounded-full ${isThinking ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}></span>
                                {isThinking ? 'Thinking...' : isListening ? 'Listening...' : 'AI Assistant Active'}
                            </p>
                        </div>
                    </div>
                    {/* Context Pills */}
                    <div className="flex gap-2">
                        <span className="text-[10px] font-mono px-2 py-1 bg-slate-100 rounded text-slate-500 flex items-center gap-1">
                            <Database size={10}/> {suppliers.length} Spl
                        </span>
                        <span className="text-[10px] font-mono px-2 py-1 bg-slate-100 rounded text-slate-500 flex items-center gap-1">
                            <FileText size={10}/> {purchaseOrders.length} POs
                        </span>
                    </div>
                </div>

                {/* Chat Area */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-white">
                    {messages.map((msg, idx) => (
                        <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-indigo-100 text-indigo-600'}`}>
                                {msg.role === 'user' ? <User size={14} /> : <Sparkles size={14} />}
                            </div>
                            <div className={`p-4 rounded-2xl text-sm leading-relaxed max-w-[80%] shadow-sm ${
                                msg.role === 'user' 
                                ? 'bg-slate-100 text-slate-800 rounded-tr-none' 
                                : 'bg-indigo-50/50 text-slate-700 border border-indigo-100 rounded-tl-none'
                            }`}>
                                <div className="whitespace-pre-wrap">{msg.text}</div>
                                {msg.attachment && (
                                    <div className="mt-2 flex items-center gap-2 bg-white/50 p-2 rounded border border-indigo-100 text-xs font-medium text-indigo-700">
                                        <FileText size={12}/> {msg.attachment}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {isThinking && (
                        <div className="flex gap-4">
                            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                                <Loader2 size={14} className="animate-spin" />
                            </div>
                            <div className="bg-white border border-indigo-50 p-3 rounded-2xl rounded-tl-none shadow-sm">
                                <span className="flex gap-1">
                                    <span className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce"></span>
                                    <span className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce delay-75"></span>
                                    <span className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce delay-150"></span>
                                </span>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-6 border-t border-slate-100 bg-white">
                    <div className={`relative flex items-center border rounded-2xl shadow-inner transition-all ${isListening ? 'bg-red-50 border-red-200 ring-2 ring-red-100' : 'bg-slate-50 border-slate-200 focus-within:ring-2 focus-within:ring-indigo-100 focus-within:border-indigo-300'}`}>
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && !isThinking && handleSend()}
                            placeholder={isListening ? "Listening..." : "Type or speak to Copilot..."}
                            className={`w-full pl-5 pr-32 py-4 bg-transparent outline-none font-medium ${isListening ? 'text-red-500 placeholder-red-400' : 'text-slate-700 placeholder-slate-400'}`}
                            disabled={isThinking || isListening}
                        />
                        
                        <div className="absolute right-2 flex items-center gap-1">
                            <button 
                                onClick={handleVoiceInput}
                                className={`p-2 rounded-full transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200'}`} 
                                title="Voice Input"
                            >
                                {isListening ? <StopCircle size={20} /> : <Mic size={20} />}
                            </button>
                            <button 
                                onClick={() => handleSend()}
                                disabled={!input.trim() || isThinking || isListening}
                                className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-all shadow-md transform active:scale-95"
                            >
                                <Send size={20} />
                            </button>
                        </div>
                    </div>
                    <div className="flex justify-center mt-3 gap-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        <span className="flex items-center gap-1"><span className="w-1 h-1 bg-slate-300 rounded-full"></span> TEXT</span>
                        <span className="flex items-center gap-1"><span className={`w-1 h-1 rounded-full ${isListening ? 'bg-red-500 animate-pulse' : 'bg-slate-300'}`}></span> VOICE</span>
                    </div>
                </div>
            </div>

        </div>
    );
};

export default AiProcurement;
