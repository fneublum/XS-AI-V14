
import React, { useState, useRef, useEffect } from 'react';
import { Shipment, Booking, BillOfLading, InventoryItem, FreightQuote, Company } from '../types';
import { Bot, Sparkles, Send, Loader2, FileText, UploadCloud, Mic, ArrowRight, StopCircle, Ship, AlertTriangle, Scale, ClipboardList, Copy, Mail, X, CheckCircle2 } from 'lucide-react';
import { getLogisticsAgentResponse, analyzeDocument } from '../services/geminiService';
import { getAccountFor, getTokenFor } from '../services/smailAuth';

interface AiLogisticsProps {
    shipments: Shipment[];
    bookings: Booking[];
    billOfLadings: BillOfLading[];
    inventory: InventoryItem[];
    freightQuotes: FreightQuote[];
    currentCompanyId: string;
    availableCompanies: Company[];
}

interface AutomatedTask {
    id: string;
    title: string;
    type: 'ALERT' | 'AUDIT' | 'OPTIMIZE';
    desc: string;
    action: () => void;
}

const AiLogistics: React.FC<AiLogisticsProps> = ({ shipments, bookings, billOfLadings, inventory, freightQuotes, currentCompanyId, availableCompanies }) => {
    // --- CHAT STATE ---
    const [messages, setMessages] = useState<{ role: 'user' | 'model', text: string, attachment?: string }[]>([
        { role: 'model', text: "Hello! I'm your Logistics Copilot. I can help track shipments, audit freight rates, and monitor inventory levels." }
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

    // --- EMAIL MODAL STATE ---
    const [showEmailModal, setShowEmailModal] = useState(false);
    const [emailDraft, setEmailDraft] = useState({ to: '', subject: '', body: '' });
    const [isSendingEmail, setIsSendingEmail] = useState(false);
    const [copySuccess, setCopySuccess] = useState<number | null>(null);

    // Auto-scroll chat
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Generate Automated Tasks based on Data
    useEffect(() => {
        const newTasks: AutomatedTask[] = [];

        // 1. Late Shipment Audit
        const lateShipments = shipments.filter(s => s.status === 'In Transit' && new Date(s.eta) < new Date());
        if (lateShipments.length > 0) {
            newTasks.push({
                id: 'task_log_1',
                title: 'Delay Alert',
                type: 'ALERT',
                desc: `Found ${lateShipments.length} shipments past their ETA that are not marked 'Delivered'.`,
                action: () => handleSend("Identify shipments that are still 'In Transit' but have an ETA in the past. Suggest follow-up actions.")
            });
        }

        // 2. Freight Rate Comparison
        newTasks.push({
            id: 'task_log_2',
            title: 'Freight Rate Audit',
            type: 'OPTIMIZE',
            desc: `Compare ${freightQuotes.length} active freight quotes to find the best rates for major routes.`,
            action: () => handleSend("Analyze active freight quotes. Which carrier offers the best rate for 'Shanghai to Los Angeles'? Also identify any outliers.")
        });

        // 3. Inventory Health
        const lowStock = inventory.filter(i => i.quantityLBS < 10000); // Arbitrary threshold
        if (lowStock.length > 0) {
            newTasks.push({
                id: 'task_log_3',
                title: 'Low Stock Warning',
                type: 'ALERT',
                desc: `${lowStock.length} items are below 10,000 LBS. Review for reordering.`,
                action: () => handleSend("List inventory items that are currently low in stock (below 10,000 LBS). Suggest priority for reordering.")
            });
        }

        // 4. Booking Reconciliation
        newTasks.push({
            id: 'task_log_4',
            title: 'Booking Reconciliation',
            type: 'AUDIT',
            desc: "Cross-reference recent Bookings with Bill of Ladings to ensure documentation is complete.",
            action: () => handleSend("Check recent bookings. Which ones do not yet have a corresponding Bill of Lading in the system?")
        });

        // 5. Detention Risk
        newTasks.push({
            id: 'task_log_5',
            title: 'Detention Risk Check',
            type: 'ALERT',
            desc: "Identify containers arriving within 3 days to prioritize clearance and avoid detention fees.",
            action: () => handleSend("Identify shipments arriving in the next 3 days. Remind me to check Free Time and Detention terms for these.")
        });

        setTasks(newTasks);
    }, [shipments, bookings, inventory, freightQuotes]);

    // --- HANDLERS ---

    const handleSend = async (overrideInput?: string) => {
        const text = overrideInput || input;
        if (!text.trim()) return;

        // UI Update
        const newHistory = [...messages, { role: 'user' as const, text }];
        setMessages(newHistory);
        setInput('');
        setIsThinking(true);

        // Determine Company Context
        const company = availableCompanies.find(c => c.id === currentCompanyId);
        const companyName = company?.name || 'XSOLUTION';

        // API Call
        try {
            const response = await getLogisticsAgentResponse(text, newHistory, {
                shipments,
                bookings,
                inventory,
                freightQuotes,
                companyName // Pass context
            });
            // Handle structured response
            setMessages(prev => [...prev, { role: 'model', text: response.text }]);
        } catch (error) {
            setMessages(prev => [...prev, { role: 'model', text: "I encountered an error connecting to the logistics intelligence server." }]);
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
                setInput(transcript);
                setTimeout(() => handleSend(transcript), 500);
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
                const prompt = "Analyze this logistics document (BL, Packing List, or Arrival Notice). Extract container numbers, weights, and key dates.";
                const analysis = await analyzeDocument(base64Data, file.type, prompt);

                // Add to Chat Context
                const newHistory = [
                    ...messages,
                    { role: 'user' as const, text: `[Uploaded Logistics Doc: ${file.name}]`, attachment: file.name },
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

    // --- ACTION HANDLERS ---

    const handleCopy = (text: string, index: number) => {
        navigator.clipboard.writeText(text);
        setCopySuccess(index);
        setTimeout(() => setCopySuccess(null), 2000);
    };

    const handlePrepareEmail = (text: string) => {
        setEmailDraft({
            to: '',
            subject: 'Logistics Update',
            body: text
        });
        setShowEmailModal(true);
    };

    const handleSendDraft = async () => {
        if (!emailDraft.to || !emailDraft.subject || !emailDraft.body) {
            alert("Please fill in all fields.");
            return;
        }

        setIsSendingEmail(true);

        try {
            let token = '';
            let senderEmail = '';

            // 1. Try MSAL Automation Account
            const msalAccount = getAccountFor('automation');
            if (msalAccount) {
                try {
                    token = await getTokenFor('automation', ['Mail.Send']);
                    senderEmail = msalAccount.username;
                } catch (e) {
                    console.warn("MSAL token fetch failed, falling back...", e);
                }
            }

            // 2. Fallback to Legacy/Manual Storage if no MSAL token
            if (!token) {
                const storedAccounts = localStorage.getItem('ai_email_accounts');
                const accounts = storedAccounts ? JSON.parse(storedAccounts) : [];
                // Just grab the first available account, prioritizing OUTLOOK then GMAIL
                const legacyAccount = accounts.find((a: any) => a.provider === 'OUTLOOK') || accounts.find((a: any) => a.provider === 'GMAIL');

                if (legacyAccount && legacyAccount.provider === 'OUTLOOK') {
                    senderEmail = legacyAccount.email;
                    const config = JSON.parse(legacyAccount.refreshToken || '{}');
                    if (config.tenantId && config.clientId) {
                        const originalEndpoint = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
                        const bodyParams = new URLSearchParams({
                            client_id: config.clientId,
                            scope: 'https://graph.microsoft.com/.default',
                            client_secret: legacyAccount.password,
                            grant_type: 'client_credentials'
                        });

                        // Try direct call first, fall back to CORS proxy
                        let tokenResp;
                        try {
                            tokenResp = await fetch(originalEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: bodyParams });
                        } catch {
                            const proxyEndpoint = `https://api.allorigins.win/raw?url=${encodeURIComponent(originalEndpoint)}`;
                            tokenResp = await fetch(proxyEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: bodyParams });
                        }

                        if (!tokenResp.ok) throw new Error("Legacy Auth failed");
                        const tokenData = await tokenResp.json();
                        token = tokenData.access_token;
                    }
                } else if (legacyAccount && legacyAccount.provider === 'GMAIL') {
                    // Not implementing Gmail send for this specific flow in this turn, assuming Outlook dominance based on previous context
                    // But if we were, it would be here.
                    throw new Error("Only Outlook accounts are fully supported for this action currently.");
                }
            }

            if (!token || !senderEmail) {
                alert(`No email account connected. Please connect an account in the Automation section.`);
                setIsSendingEmail(false);
                return;
            }

            // Send Mail via Graph
            await fetch(`https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: {
                        subject: emailDraft.subject,
                        body: {
                            contentType: "HTML",
                            content: emailDraft.body.replace(/\n/g, '<br/>')
                        },
                        toRecipients: [{ emailAddress: { address: emailDraft.to } }]
                    },
                    saveToSentItems: true
                })
            });

            setMessages(prev => [...prev, { role: 'model', text: `✅ Email sent successfully to ${emailDraft.to} (via ${senderEmail}).` }]);
            setShowEmailModal(false);

        } catch (error) {
            console.error(error);
            alert("Failed to send email. Please check your internet connection or credentials.");
        } finally {
            setIsSendingEmail(false);
        }
    };

    return (
        <div className="h-[calc(100vh-6rem)] w-full flex gap-6 p-2 overflow-hidden animate-in fade-in relative">

            {/* --- LEFT COLUMN (35%) --- */}
            <div className="w-[35%] flex flex-col gap-6 h-full">

                {/* 1. AUTOMATION WINDOW */}
                <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                    <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <Sparkles size={18} className="text-cyan-600" /> LOGISTICS TASKS
                        </h3>
                        <span className="text-[10px] font-bold bg-cyan-100 text-cyan-700 px-2 py-1 rounded-full">
                            {tasks.length} Suggested
                        </span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        {tasks.map(task => (
                            <div key={task.id} className="p-4 rounded-xl border border-slate-200 hover:border-cyan-300 hover:shadow-md transition-all group bg-white">
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-1.5 rounded-lg ${task.type === 'ALERT' ? 'bg-red-100 text-red-600' :
                                            task.type === 'OPTIMIZE' ? 'bg-emerald-100 text-emerald-600' : 'bg-blue-100 text-blue-600'
                                            }`}>
                                            {task.type === 'ALERT' ? <AlertTriangle size={14} /> : task.type === 'OPTIMIZE' ? <Scale size={14} /> : <ClipboardList size={14} />}
                                        </div>
                                        <span className="font-bold text-sm text-slate-700">{task.title}</span>
                                    </div>
                                </div>
                                <p className="text-xs text-slate-500 mb-3 leading-relaxed">{task.desc}</p>
                                <button
                                    onClick={task.action}
                                    className="text-xs font-bold text-cyan-600 flex items-center gap-1 group-hover:underline"
                                >
                                    Run Task <ArrowRight size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 2. DOCUMENT DROP / UPLOAD */}
                <div className="h-[35%] bg-slate-900 rounded-3xl shadow-lg border border-slate-800 flex flex-col overflow-hidden relative">
                    <div className="p-4 border-b border-slate-800 flex justify-between items-center">
                        <h3 className="font-bold text-white flex items-center gap-2 text-sm">
                            <UploadCloud size={16} className="text-cyan-400" /> LOGISTICS DOCS
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
                                <Loader2 size={32} className="text-cyan-400 animate-spin" />
                                <p className="text-slate-300 text-xs font-mono animate-pulse">{uploadStatus}</p>
                            </div>
                        ) : (
                            <>
                                <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center mb-3 border border-slate-700">
                                    <FileText size={24} className="text-slate-400" />
                                </div>
                                <p className="text-slate-300 text-sm font-medium mb-1">Drop BL / Packing List</p>
                                <p className="text-slate-500 text-xs">Auto-Extract Container Info</p>
                            </>
                        )}
                    </div>
                </div>

            </div>

            {/* --- RIGHT COLUMN (65%) --- */}
            {/* 3. COPILOT */}
            <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-xl flex flex-col overflow-hidden relative">
                {/* Copilot Header */}
                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-cyan-600 rounded-full flex items-center justify-center text-white shadow-lg shadow-cyan-200">
                            <Bot size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">LOGISTICS COPILOT</h2>
                            <p className="text-xs text-slate-500 flex items-center gap-1">
                                <span className={`w-1.5 h-1.5 rounded-full ${isThinking ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}></span>
                                {isThinking ? 'Processing...' : isListening ? 'Listening...' : 'Ready to assist'}
                            </p>
                        </div>
                    </div>
                    {/* Context Pills */}
                    <div className="flex gap-2">
                        <span className="text-[10px] font-mono px-2 py-1 bg-slate-100 rounded text-slate-500 flex items-center gap-1">
                            <Ship size={10} /> {shipments.length} Active
                        </span>
                        <span className="text-[10px] font-mono px-2 py-1 bg-slate-100 rounded text-slate-500 flex items-center gap-1">
                            <ClipboardList size={10} /> {bookings.length} BKGs
                        </span>
                    </div>
                </div>

                {/* Chat Area */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-white">
                    {messages.map((msg, idx) => (
                        <div key={idx} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-cyan-100 text-cyan-600'}`}>
                                {msg.role === 'user' ? <Bot size={14} /> : <Sparkles size={14} />}
                            </div>
                            <div className={`p-4 rounded-2xl text-sm leading-relaxed max-w-[80%] shadow-sm ${msg.role === 'user'
                                ? 'bg-slate-100 text-slate-800 rounded-tr-none'
                                : 'bg-cyan-50/50 text-slate-700 border border-cyan-100 rounded-tl-none'
                                }`}>
                                <div className="whitespace-pre-wrap">{msg.text}</div>
                                {msg.attachment && (
                                    <div className="mt-2 flex items-center gap-2 bg-white/50 p-2 rounded border border-cyan-100 text-xs font-medium text-cyan-700">
                                        <FileText size={12} /> {msg.attachment}
                                    </div>
                                )}
                                {/* Action Buttons for AI Replies */}
                                {msg.role === 'model' && (
                                    <div className="mt-3 flex gap-2 border-t border-cyan-100/50 pt-2">
                                        <button
                                            onClick={() => handleCopy(msg.text, idx)}
                                            className="text-[10px] flex items-center gap-1 text-slate-500 hover:text-cyan-700 bg-white/80 px-2 py-1 rounded border border-cyan-100/50 hover:bg-white transition-colors"
                                        >
                                            {copySuccess === idx ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                                            {copySuccess === idx ? 'Copied' : 'Copy'}
                                        </button>
                                        <button
                                            onClick={() => handlePrepareEmail(msg.text)}
                                            className="text-[10px] flex items-center gap-1 text-slate-500 hover:text-cyan-700 bg-white/80 px-2 py-1 rounded border border-cyan-100/50 hover:bg-white transition-colors"
                                        >
                                            <Mail size={12} /> Email
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {isThinking && (
                        <div className="flex gap-4">
                            <div className="w-8 h-8 rounded-full bg-cyan-100 text-cyan-600 flex items-center justify-center shrink-0">
                                <Loader2 size={14} className="animate-spin" />
                            </div>
                            <div className="bg-white border border-cyan-50 p-3 rounded-2xl rounded-tl-none shadow-sm">
                                <span className="flex gap-1">
                                    <span className="w-1.5 h-1.5 bg-cyan-300 rounded-full animate-bounce"></span>
                                    <span className="w-1.5 h-1.5 bg-cyan-300 rounded-full animate-bounce delay-75"></span>
                                    <span className="w-1.5 h-1.5 bg-cyan-300 rounded-full animate-bounce delay-150"></span>
                                </span>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-6 border-t border-slate-100 bg-white">
                    <div className={`relative flex items-center border rounded-2xl shadow-inner transition-all ${isListening ? 'bg-red-50 border-red-200 ring-2 ring-red-100' : 'bg-slate-50 border-slate-200 focus-within:ring-2 focus-within:ring-cyan-100 focus-within:border-cyan-300'}`}>
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && !isThinking && handleSend()}
                            placeholder={isListening ? "Listening..." : "Ask about shipments, rates, or delays..."}
                            className={`w-full pl-5 pr-32 py-4 bg-transparent outline-none font-medium ${isListening ? 'text-red-500 placeholder-red-400' : 'text-slate-700 placeholder-slate-400'}`}
                            disabled={isThinking || isListening}
                        />

                        <div className="absolute right-2 flex items-center gap-1">
                            <button
                                onClick={handleVoiceInput}
                                className={`p-2 rounded-full transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200'}`}
                                title="Voice Input"
                            >
                                {isListening ? <StopCircle size={14} /> : <Mic size={14} />}
                            </button>
                            <button
                                onClick={() => handleSend()}
                                disabled={!input.trim() || isThinking || isListening}
                                className="p-2 bg-cyan-600 text-white rounded-xl hover:bg-cyan-700 disabled:opacity-50 disabled:hover:bg-cyan-600 transition-all shadow-md transform active:scale-95"
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

                {/* Email Draft Modal */}
                {showEmailModal && (
                    <div className="absolute inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
                        <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95">
                            <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2"><Mail size={18} className="text-cyan-600" /> Review Email Draft</h3>
                                <button onClick={() => setShowEmailModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">To:</label>
                                    <input
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
                                        placeholder="recipient@example.com"
                                        value={emailDraft.to}
                                        onChange={(e) => setEmailDraft({ ...emailDraft, to: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subject:</label>
                                    <input
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
                                        placeholder="Subject"
                                        value={emailDraft.subject}
                                        onChange={(e) => setEmailDraft({ ...emailDraft, subject: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Body:</label>
                                    <textarea
                                        className="w-full border border-slate-300 rounded-lg p-2 text-sm h-48 resize-none focus:ring-2 focus:ring-cyan-500 outline-none"
                                        value={emailDraft.body}
                                        onChange={(e) => setEmailDraft({ ...emailDraft, body: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
                                <button
                                    onClick={() => setShowEmailModal(false)}
                                    className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-bold transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSendDraft}
                                    disabled={isSendingEmail}
                                    className="px-6 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-bold transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isSendingEmail ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                                    Send Email
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

        </div>
    );
};

export default AiLogistics;
