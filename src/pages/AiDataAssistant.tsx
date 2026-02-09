
import React, { useState, useRef, useEffect } from 'react';
import { Product, Supplier, Customer, Port } from '../types';
import { Bot, Sparkles, Send, Loader2, Database, UploadCloud, Mic, ArrowRight, StopCircle, FileText, CheckCircle2 } from 'lucide-react';
import { getDataAgentResponse, analyzeDocument } from '../services/geminiService';

interface AiDataAssistantProps {
    products: Product[];
    suppliers: Supplier[];
    customers: Customer[];
    ports: Port[];
}

interface AutomatedTask {
    id: string;
    title: string;
    type: 'AUDIT' | 'CLEAN' | 'ENRICH';
    desc: string;
    action: () => void;
}

const AiDataAssistant: React.FC<AiDataAssistantProps> = ({ products, suppliers, customers, ports }) => {
    // --- CHAT STATE ---
    const [messages, setMessages] = useState<{ role: 'user' | 'model', text: string, attachment?: string }[]>([
        { role: 'model', text: "Hello! I'm your Data Integrity Agent. I can help you audit, clean, and standardize your master data." }
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

    // Generate Automated Tasks based on Data Context
    useEffect(() => {
        const newTasks: AutomatedTask[] = [];

        // 1. Duplicate Check
        newTasks.push({
            id: 'task_data_1',
            title: 'Identify Duplicate Partners',
            type: 'CLEAN',
            desc: `Scan ${suppliers.length + customers.length} partners for similar names (e.g., 'Acme Inc' vs 'Acme').`,
            action: () => handleSend("Analyze the supplier and customer lists for potential duplicates based on name similarity. List any suspects.")
        });

        // 2. Data Enrichment (Products)
        const productsMissingCode = products.filter(p => !p.hsCode).length;
        newTasks.push({
            id: 'task_data_2',
            title: 'Standardize Product Specs',
            type: 'ENRICH',
            desc: `${productsMissingCode} products are missing HS Codes. Generate suggestions.`,
            action: () => handleSend("Review the product list. Identify items missing HS Codes or standard specifications and suggest values based on their names.")
        });

        // 3. Port/Location Validation
        newTasks.push({
            id: 'task_data_3',
            title: 'Validate Port Codes',
            type: 'AUDIT',
            desc: `Verify ${ports.length} port codes against standard UN/LOCODE formats.`,
            action: () => handleSend("Check the list of Ports. Are there any with non-standard codes or missing country information?")
        });

        setTasks(newTasks);
    }, [products, suppliers, customers, ports]);

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
            const response = await getDataAgentResponse(text, newHistory, {
                products,
                suppliers,
                customers
            });
            setMessages(prev => [...prev, { role: 'model', text: response }]);
        } catch (error) {
            setMessages(prev => [...prev, { role: 'model', text: "I encountered an error analyzing the data." }]);
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
        setUploadStatus('Scanning document...');
        
        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64Data = (e.target?.result as string).split(',')[1];
                
                // OCR / Analyze Document via Gemini
                const prompt = "Extract any product lists, supplier details, or customer contacts from this document. Format as a structured summary.";
                const analysis = await analyzeDocument(base64Data, file.type, prompt);
                
                // Add to Chat Context
                const newHistory = [
                    ...messages, 
                    { role: 'user' as const, text: `[Uploaded Data Source: ${file.name}]`, attachment: file.name },
                    { role: 'model' as const, text: `I've scanned ${file.name}. Here is the extracted data:\n\n${analysis}` }
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
                            <Sparkles size={18} className="text-blue-600"/> DATA TASKS
                        </h3>
                        <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                            {tasks.length} Ready
                        </span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        {tasks.map(task => (
                            <div key={task.id} className="p-4 rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-md transition-all group bg-white">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-1.5 rounded-lg ${
                                            task.type === 'CLEAN' ? 'bg-amber-100 text-amber-600' :
                                            task.type === 'ENRICH' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'
                                        }`}>
                                            {task.type === 'CLEAN' ? <Database size={14}/> : task.type === 'ENRICH' ? <Sparkles size={14}/> : <FileText size={14}/>}
                                        </div>
                                        <span className="font-bold text-sm text-slate-700">{task.title}</span>
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500 mb-3 leading-relaxed">{task.desc}</p>
                                <button 
                                    onClick={task.action}
                                    className="text-xs font-bold text-blue-600 flex items-center gap-1 group-hover:underline"
                                >
                                    Run Audit <ArrowRight size={12}/>
                                </button>
                            </div>
                        ))}
                        {tasks.length === 0 && (
                            <div className="text-center p-8 text-slate-400">
                                <CheckCircle2 size={32} className="mx-auto mb-2 opacity-50"/>
                                <p className="text-sm">Data is clean.</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. DOCUMENT DROP / UPLOAD */}
                <div className="h-[35%] bg-slate-900 rounded-3xl shadow-lg border border-slate-800 flex flex-col overflow-hidden relative">
                    <div className="p-4 border-b border-slate-800 flex justify-between items-center">
                        <h3 className="font-bold text-white flex items-center gap-2 text-sm">
                            <UploadCloud size={16} className="text-blue-400"/> IMPORT DATA
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
                            accept=".pdf,.jpg,.png,.csv,.txt"
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
                                <p className="text-slate-300 text-sm font-medium mb-1">Upload Product/Supplier Lists</p>
                                <p className="text-slate-500 text-xs">PDF, Image, or Text</p>
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
                            <h2 className="text-lg font-bold text-slate-800">DATA AGENT</h2>
                            <p className="text-xs text-slate-500 flex items-center gap-1">
                                <span className={`w-1.5 h-1.5 rounded-full ${isThinking ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}></span>
                                {isThinking ? 'Processing...' : isListening ? 'Listening...' : 'Ready for queries'}
                            </p>
                        </div>
                    </div>
                    {/* Context Pills */}
                    <div className="flex gap-2">
                        <span className="text-[10px] font-mono px-2 py-1 bg-slate-100 rounded text-slate-500 flex items-center gap-1">
                            <Database size={10}/> {products.length + suppliers.length + customers.length} Records
                        </span>
                    </div>
                </div>

                {/* Chat Area */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-white">
                    {messages.map((msg, idx) => (
                        <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-blue-100 text-blue-600'}`}>
                                {msg.role === 'user' ? <Database size={14} /> : <Sparkles size={14} />}
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
                            placeholder={isListening ? "Listening..." : "Ask to find duplicates, clean addresses, or summarize data..."}
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
                </div>
            </div>

        </div>
    );
};

export default AiDataAssistant;
