
import React, { useState, useRef, useEffect } from 'react';
import { Product, Customer, Opportunity } from '../types';
import { Bot, Sparkles, Send, Loader2, BarChart3, Mail, ShieldAlert, FileText, Database, User, UploadCloud, Mic, ArrowRight, StopCircle, Target, Briefcase, TrendingUp, CheckCircle2 } from 'lucide-react';
import { getSalesAgentResponse, analyzeDocument } from '../services/geminiService';

interface AISalesHubProps {
    products: Product[];
    customers: Customer[];
    opportunities: Opportunity[];
}

interface AutomatedTask {
    id: string;
    title: string;
    type: 'EMAIL' | 'REVIEW' | 'ALERT';
    desc: string;
    action: () => void;
}

const AISalesHub: React.FC<AISalesHubProps> = ({ products, customers, opportunities }) => {
    // --- CHAT STATE ---
    const [messages, setMessages] = useState<{ role: 'user' | 'model', text: string, attachment?: string }[]>([
        { role: 'model', text: "Hello! I'm your Sales Copilot. I'm ready to help you close deals, find leads, and automate your sales workflow." }
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

        // 1. Lead Scoring (At Risk Customers)
        newTasks.push({
            id: 'task_sales_1',
            title: 'Lead Scoring & Risk',
            type: 'REVIEW',
            desc: "Analyze customer list to identify top 3 'Active' clients with declining volume who might be at risk.",
            action: () => handleSend("Analyze my customer list. Identify the top 3 'Active' customers with declining volume who might be at risk.")
        });

        // 2. Pipeline Acceleration
        const negotiationDeals = opportunities.filter(o => o.stage === 'Negotiation');
        if (negotiationDeals.length > 0) {
            newTasks.push({
                id: 'task_sales_2',
                title: 'Accelerate Negotiations',
                type: 'ALERT',
                desc: `${negotiationDeals.length} deals in Negotiation. Suggest closing strategies for the highest value one.`,
                action: () => handleSend("Review opportunities in 'Negotiation' stage. Suggest closing strategies for the highest value deal.")
            });
        }

        // 3. Cross-Selling Opportunities
        newTasks.push({
            id: 'task_sales_3',
            title: 'Cross-Sell Discovery',
            type: 'REVIEW',
            desc: "Identify customers buying 'Resin' but missing 'Fiber Textile' from their portfolio.",
            action: () => handleSend("Look at customers buying 'Resin'. Which ones are not buying 'Fiber Textile'? Suggest them for cross-selling.")
        });

        // 4. Follow-Up Scheduler (Re-engagement)
        newTasks.push({
            id: 'task_sales_4',
            title: 'Dormant Client Re-engagement',
            type: 'EMAIL',
            desc: "Draft re-engagement emails for customers inactive for > 60 days.",
            action: () => handleSend("Identify customers who haven't placed an order in the last 60 days. Draft a friendly re-engagement email.")
        });

        // 5. High-Value Deal Focus
        newTasks.push({
            id: 'task_sales_5',
            title: 'High-Value Closing Push',
            type: 'ALERT',
            desc: "Prioritize deals > $50k expiring this month.",
            action: () => handleSend("Analyze the pipeline. Which deals > $50k are expiring this month? Prioritize them and suggest next steps.")
        });

        setTasks(newTasks);
    }, [customers, opportunities]);

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
            const response = await getSalesAgentResponse(text, newHistory, {
                customers,
                opportunities,
                products
            });
            setMessages(prev => [...prev, { role: 'model', text: response }]);
        } catch (error) {
            setMessages(prev => [...prev, { role: 'model', text: "I encountered an error connecting to the sales intelligence server." }]);
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
                const prompt = "Analyze this sales document (e.g., PO, RFQ). Identify the customer, products requested, quantities, and any special terms.";
                const analysis = await analyzeDocument(base64Data, file.type, prompt);
                
                // Add to Chat Context
                const newHistory = [
                    ...messages, 
                    { role: 'user' as const, text: `[Uploaded Sales Document: ${file.name}]`, attachment: file.name },
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
                            <Sparkles size={18} className="text-blue-600"/> SALES AUTOMATION
                        </h3>
                        <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                            {tasks.length} Suggested
                        </span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        {tasks.map(task => (
                            <div key={task.id} className="p-4 rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all group bg-white">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-1.5 rounded-lg ${
                                            task.type === 'EMAIL' ? 'bg-indigo-100 text-indigo-600' :
                                            task.type === 'REVIEW' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'
                                        }`}>
                                            {task.type === 'EMAIL' ? <Mail size={14}/> : task.type === 'REVIEW' ? <FileText size={14}/> : <Target size={14}/>}
                                        </div>
                                        <span className="font-bold text-sm text-slate-700">{task.title}</span>
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500 mb-3 leading-relaxed">{task.desc}</p>
                                <button 
                                    onClick={task.action}
                                    className="text-xs font-bold text-blue-600 flex items-center gap-1 group-hover:underline"
                                >
                                    Run Task <ArrowRight size={12}/>
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
                            <UploadCloud size={16} className="text-blue-400"/> RFQ / PO UPLOAD
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
                                <p className="text-slate-300 text-sm font-medium mb-1">Drop Customer PO / RFQ</p>
                                <p className="text-slate-500 text-xs">Auto-extract Deal Terms</p>
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
                        <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-lg shadow-blue-200">
                            <Bot size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">SALES COPILOT</h2>
                            <p className="text-xs text-slate-500 flex items-center gap-1">
                                <span className={`w-1.5 h-1.5 rounded-full ${isThinking ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}></span>
                                {isThinking ? 'Processing...' : isListening ? 'Listening...' : 'Ready to assist'}
                            </p>
                        </div>
                    </div>
                    {/* Context Pills */}
                    <div className="flex gap-2">
                        <span className="text-[10px] font-mono px-2 py-1 bg-slate-100 rounded text-slate-500 flex items-center gap-1">
                            <User size={10}/> {customers.length} Clients
                        </span>
                        <span className="text-[10px] font-mono px-2 py-1 bg-slate-100 rounded text-slate-500 flex items-center gap-1">
                            <TrendingUp size={10}/> {opportunities.length} Deals
                        </span>
                    </div>
                </div>

                {/* Chat Area */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-white">
                    {messages.map((msg, idx) => (
                        <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-blue-100 text-blue-600'}`}>
                                {msg.role === 'user' ? <User size={14} /> : <Sparkles size={14} />}
                            </div>
                            <div className={`p-4 rounded-2xl text-sm leading-relaxed max-w-[80%] shadow-sm ${
                                msg.role === 'user' 
                                ? 'bg-slate-100 text-slate-800 rounded-tr-none' 
                                : 'bg-blue-50/50 text-slate-700 border border-blue-100 rounded-tl-none'
                            }`}>
                                <div className="whitespace-pre-wrap">{msg.text}</div>
                                {msg.attachment && (
                                    <div className="mt-2 flex items-center gap-2 bg-white/50 p-2 rounded border border-blue-100 text-xs font-medium text-blue-700">
                                        <FileText size={12}/> {msg.attachment}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {isThinking && (
                        <div className="flex gap-4">
                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                                <Loader2 size={14} className="animate-spin" />
                            </div>
                            <div className="bg-white border border-blue-50 p-3 rounded-2xl rounded-tl-none shadow-sm">
                                <span className="flex gap-1">
                                    <span className="w-1.5 h-1.5 bg-blue-300 rounded-full animate-bounce"></span>
                                    <span className="w-1.5 h-1.5 bg-blue-300 rounded-full animate-bounce delay-75"></span>
                                    <span className="w-1.5 h-1.5 bg-blue-300 rounded-full animate-bounce delay-150"></span>
                                </span>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-6 border-t border-slate-100 bg-white">
                    <div className={`relative flex items-center border rounded-2xl shadow-inner transition-all ${isListening ? 'bg-red-50 border-red-200 ring-2 ring-red-100' : 'bg-slate-50 border-slate-200 focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-300'}`}>
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && !isThinking && handleSend()}
                            placeholder={isListening ? "Listening..." : "Ask about leads, deals, or market trends..."}
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
                                className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-all shadow-md transform active:scale-95"
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

export default AISalesHub;
