import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Bot, Send, Mic, StopCircle, User, Loader2, Target, Sparkles, Mail, Phone, DollarSign, Clock, Briefcase, X, MessageSquare, Maximize2, ArrowRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { getSalesAgentResponse } from '../services/geminiService';
import { IcrmTask, Opportunity, Customer, Product, Company, DealStage } from '../types';
import Pipeline from './Pipeline';

// --- VISUALIZATION HELPERS ---
interface RadarBlip {
    id: string;
    name: string;
    value: number; 
    urgency: number; 
    status: 'HEALTHY' | 'AT_RISK' | 'CHURNED';
    stage: string;
    colorIndex: number;
    iconIndex: number;
    customerId: string;
}

interface ICRMProps {
    opportunities: Opportunity[];
    customers: Customer[];
    products: Product[];
    currentCompanyId: string;
    availableCompanies: Company[];
    onAddOpportunity: (o: Opportunity) => void;
    onUpdateOpportunity: (o: Opportunity) => void;
    onDeleteOpportunity: (id: string) => void;
    addProduct: (p: Product) => void;
    addCustomer: (c: Customer) => void;
}


const ICRM: React.FC<ICRMProps> = ({
    opportunities, customers, products, currentCompanyId, availableCompanies,
    onAddOpportunity, onUpdateOpportunity, onDeleteOpportunity,
    addProduct, addCustomer
}) => {
    // --- STATE ---
    const [icrmView, setIcrmView] = useState<'CIRCLES' | 'CARDS'>('CIRCLES');
    const [blips, setBlips] = useState<RadarBlip[]>([]);
    const [selectedBlip, setSelectedBlip] = useState<RadarBlip | null>(null);
    
    // Chat State
    const [messages, setMessages] = useState<{role: 'user' | 'model', text: string}[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const [isListening, setIsListening] = useState(false);
    
    const chatEndRef = useRef<HTMLDivElement>(null);
    const recognitionRef = useRef<any>(null);
    
    // Generate Grid Positions (Center-Out Sort)
    const layoutBubbles = (items: RadarBlip[]) => {
        const count = items.length;
        if (count === 0) return [];
        const cols = 10;
        const rows = Math.ceil(count / cols);
        const gridCells: {r: number, c: number, dist: number}[] = [];
        const centerR = (rows - 1) / 2;
        const centerC = (cols - 1) / 2;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const dist = Math.sqrt(Math.pow(r - centerR, 2) + Math.pow(c - centerC, 2));
                gridCells.push({ r, c, dist });
            }
        }
        gridCells.sort((a, b) => a.dist - b.dist);
        const positions: {x: number, y: number}[] = [];
        const xStep = 100 / (cols + 1);
        const yStep = 100 / (rows + 1);
        for (let i = 0; i < count; i++) {
             if (i >= gridCells.length) break;
             const cell = gridCells[i];
             positions.push({ x: (cell.c + 1) * xStep, y: (cell.r + 1) * yStep });
        }
        return positions;
    };

    useEffect(() => {
        const opportunityBlips: RadarBlip[] = opportunities
            .filter(o => o.stage !== DealStage.CLOSED_LOST && o.stage !== DealStage.CLOSED_WON)
            .map((o, index) => {
                const closeDate = new Date(o.expectedCloseDate);
                const today = new Date();
                const daysUntilClose = (closeDate.getTime() - today.getTime()) / (1000 * 3600 * 24);
                let urgency = o.probability;
                if (daysUntilClose < 7) urgency += 20;
                if (daysUntilClose < 0) urgency += 30; // overdue
                urgency = Math.min(100, urgency);
    
                let status: 'HEALTHY' | 'AT_RISK' | 'CHURNED' = 'HEALTHY';
                if (urgency > 85) status = 'AT_RISK';
    
                const customer = customers.find(c => c.id === o.customerId);
    
                return {
                    id: o.id,
                    name: o.customerName,
                    value: o.value,
                    urgency: urgency,
                    status: customer?.status === 'At Risk' ? 'AT_RISK' : status,
                    stage: o.stage,
                    colorIndex: index % 6,
                    iconIndex: index % 6,
                    customerId: o.customerId
                };
            });
    
        setBlips(opportunityBlips.sort((a, b) => b.urgency - a.urgency));
        
        const highUrgencyCount = opportunityBlips.filter(b => b.urgency > 85).length;
    
        setMessages([{ 
            role: 'model', 
            text: JSON.stringify({
                header: { title: "Sales Copilot Ready", subtitle: "Portfolio Overview" },
                keyFacts: [{ label: "Total Open Deals", value: `${opportunityBlips.length}` }, { label: "High Urgency", value: `${highUrgencyCount}` }],
                nextBestActions: [{ action: "Select a client bubble to start Briefing" }]
            })
        }]);
    }, [opportunities, customers]);


    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (selectedBlip) {
            handleSendMessage(`Generate account brief for ${selectedBlip.name}`, 'A');
        }
    }, [selectedBlip]);

    const handleSendMessage = async (textOverride?: string, forcedMode?: string) => {
        const text = textOverride || input;
        if (!text.trim()) return;
        
        if (!textOverride) setInput('');
        setMessages(prev => [...prev, { role: 'user', text }]);
        setIsThinking(true);

        let agentMode = 'D'; // Default: Reorder Radar / General
        if (forcedMode) agentMode = forcedMode;
        else if (selectedBlip) agentMode = 'A';
        
        try {
            const response = await getSalesAgentResponse(text, messages, { 
                customers, 
                opportunities, 
                products: [],
                currentMode: agentMode,
                selectedId: selectedBlip?.customerId
            }); 
            setMessages(prev => [...prev, { role: 'model', text: response }]);
        } catch (e) {
            setMessages(prev => [...prev, { role: 'model', text: JSON.stringify({ header: { title: "Error" }, errors: [{ message: "Connection interrupted" }] }) }]);
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
        if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognition.lang = 'en-US';
            recognition.onstart = () => setIsListening(true);
            recognition.onend = () => setIsListening(false);
            recognition.onresult = (event: any) => {
                const transcript = event.results[0][0].transcript;
                if (transcript) {
                    setInput(transcript);
                    setTimeout(() => handleSendMessage(transcript), 800);
                }
            };
            recognitionRef.current = recognition;
            recognition.start();
        } else {
            alert("Voice input not supported.");
        }
    };

    const renderMessageContent = (content: string) => {
        try {
            const data = JSON.parse(content);
            if (!data.header) return <div className="whitespace-pre-wrap">{content}</div>;

            return (
                <div className="flex flex-col gap-3">
                    <div className="border-b border-slate-700/50 pb-2 mb-1">
                        <h4 className="font-bold text-sm text-blue-300">{data.header.title}</h4>
                        {data.header.subtitle && <p className="text-[10px] text-slate-400">{data.header.subtitle}</p>}
                    </div>
                    {data.customerSnapshot && (
                        <div className="grid grid-cols-2 gap-2 text-[10px] bg-slate-800/50 p-2 rounded">
                            {data.customerSnapshot.customerName && <div><span className="text-slate-500">Name:</span> {data.customerSnapshot.customerName}</div>}
                            {data.customerSnapshot.creditLimit && <div><span className="text-slate-500">Credit:</span> ${data.customerSnapshot.creditLimit.toLocaleString()}</div>}
                        </div>
                    )}
                    {data.keyFacts && data.keyFacts.length > 0 && (
                        <div className="space-y-1">
                            {data.keyFacts.map((fact: any, i: number) => (
                                <div key={i} className="text-xs flex justify-between">
                                    <span className="text-slate-400">{fact.label}:</span>
                                    <span className="font-medium text-slate-200">{fact.value}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {data.pricingGuidance && (
                        <div className="bg-slate-800/50 p-2 rounded border-l-2 border-emerald-500">
                            <p className="text-[10px] font-bold text-emerald-400 mb-1">Pricing Guidance</p>
                            <div className="flex gap-2 text-xs">
                                <span className="text-slate-300">Target: <span className="font-bold">${data.pricingGuidance.recommended?.target}</span></span>
                                <span className="text-slate-500">Floor: ${data.pricingGuidance.recommended?.walkAway}</span>
                            </div>
                        </div>
                    )}
                    {data.nextBestActions && data.nextBestActions.length > 0 && (
                        <div className="space-y-2 mt-1">
                            {data.nextBestActions.map((action: any, i: number) => (
                                <div key={i} className="flex gap-2 items-start bg-blue-500/10 p-2 rounded border border-blue-500/20">
                                    <Target size={14} className="text-blue-400 mt-0.5 shrink-0"/>
                                    <div>
                                        <p className="text-xs font-bold text-blue-200">{action.action}</p>
                                        <p className="text-[10px] text-slate-400">{action.why}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {data.drafts?.email && (
                         <div className="mt-1">
                             <div className="text-[10px] uppercase font-bold text-slate-500 mb-1">Email Draft</div>
                             <div className="bg-white/5 p-2 rounded text-xs text-slate-300 italic">
                                 {data.drafts.email.subject && <div className="font-bold mb-1">Sub: {data.drafts.email.subject}</div>}
                                 {data.drafts.email.body}
                             </div>
                         </div>
                    )}
                    {data.complianceAndRisk && data.complianceAndRisk.length > 0 && (
                        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 p-2 rounded mt-1">
                            <AlertTriangle size={14}/>
                            <span>{data.complianceAndRisk[0].risk}</span>
                        </div>
                    )}
                </div>
            );
        } catch (e) {
            return <div className="whitespace-pre-wrap">{content}</div>;
        }
    };

    const getBubbleSize = (stage: string) => {
        switch (stage) {
            case 'First Contact': return 51;
            case 'Requirements': return 62;
            case 'Quote Sent': return 72;
            case 'Negotiation': return 82;
            case 'PO Expected': return 82;
            case 'PO Received': return 90;
            default: return 72;
        }
    };

    const bubblePositions = useMemo(() => layoutBubbles(blips), [blips]);

    return (
        <div className="h-[calc(95vh-6rem)] flex flex-col bg-black rounded-3xl overflow-hidden shadow-2xl border border-slate-800 font-sans">
            <div className="p-3 bg-slate-900/50 backdrop-blur-sm border-b border-slate-800 flex items-center gap-2 shrink-0">
                <button onClick={() => setIcrmView('CIRCLES')} className={`px-3 py-1 text-xs font-bold rounded ${icrmView === 'CIRCLES' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>CIRCLES</button>
                <button onClick={() => setIcrmView('CARDS')} className={`px-3 py-1 text-xs font-bold rounded ${icrmView === 'CARDS' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>PIPELINE</button>
            </div>

            {icrmView === 'CIRCLES' ? (
                <div className="flex-1 flex flex-row overflow-hidden">
                    <div className="w-3/4 relative bg-black overflow-hidden flex items-center justify-center">
                        <div className="absolute inset-0 opacity-20 pointer-events-none" style={{backgroundImage: 'radial-gradient(circle, #333 1px, transparent 1px)', backgroundSize: '40px 40px'}}></div>
                        <div className="relative w-full h-full max-w-[1200px] max-h-[800px]">
                            {blips.map((blip, index) => {
                                const pos = bubblePositions[index] || { x: 50, y: 50 };
                                const isSelected = selectedBlip?.id === blip.id;
                                const size = getBubbleSize(blip.stage); 
                                const hue = Math.max(0, 60 - (blip.urgency * 0.6));
                                
                                return (
                                    <button
                                        key={blip.id}
                                        onClick={() => setSelectedBlip(blip)}
                                        className={`absolute rounded-full transition-all duration-700 ease-out flex items-center justify-center group/bubble shadow-2xl ${
                                            isSelected ? 'ring-4 ring-white z-50 scale-110' : 'z-10 hover:scale-110 hover:z-20 opacity-90 hover:opacity-100'
                                        } ${blip.urgency > 90 ? 'animate-pulse' : ''}`}
                                        style={{
                                            left: `${pos.x}%`,
                                            top: `${pos.y}%`,
                                            width: `${size}px`,
                                            height: `${size}px`,
                                            transform: 'translate(-50%, -50%)',
                                            background: `linear-gradient(135deg, hsl(${hue}, 100%, 75%), hsl(${hue}, 100%, 45%))`,
                                            boxShadow: isSelected ? '0 0 40px rgba(255,255,255,0.4)' : `0 10px 20px -5px hsl(${hue}, 100%, 20%)`
                                        }}
                                    >
                                        <div className="flex flex-col items-center justify-center p-1 text-center w-full h-full relative">
                                            <span className="text-[9px] font-medium text-white/90 uppercase tracking-wide mb-0.5 drop-shadow-sm leading-tight">{blip.name.replace('Client ', '')}</span>
                                            <span className="text-xs font-black text-white tracking-tight drop-shadow-md">${(blip.value / 1000).toFixed(1)}k</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex items-center gap-4 bg-slate-900/80 backdrop-blur-md px-6 py-2 rounded-full border border-slate-700 pointer-events-none z-20 shadow-xl">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Urgency</span>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-yellow-200 font-bold">Low</span>
                                <div className="w-32 h-1.5 rounded-full bg-gradient-to-r from-yellow-200 via-orange-500 to-red-600"></div>
                                <span className="text-[10px] text-red-500 font-bold">Critical</span>
                            </div>
                        </div>
                    </div>

                    <div className="w-1/4 bg-slate-900 border-l border-slate-800 flex flex-col z-40 relative shadow-2xl">
                        {selectedBlip ? (
                            <div className="p-4 border-b border-slate-800 bg-slate-800/50 backdrop-blur-sm animate-in slide-in-from-right">
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white shadow-lg" style={{ background: `hsl(${Math.max(0, 60 - (selectedBlip.urgency * 0.6))}, 100%, 45%)` }}>
                                            <User size={16} />
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-bold text-white leading-tight">{selectedBlip.name}</h3>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${selectedBlip.status === 'AT_RISK' ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{selectedBlip.status}</span>
                                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">{selectedBlip.stage}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <button onClick={() => setSelectedBlip(null)} className="text-slate-500 hover:text-white transition-colors"><X size={16}/></button>
                                </div>
                                <div className="flex gap-2">
                                     <button onClick={() => handleSendMessage(`Draft an email for ${selectedBlip.name}`, 'B')} className="flex-1 bg-white text-black py-1.5 rounded-lg text-xs font-bold hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"><Mail size={12}/> Draft Email</button>
                                     <button onClick={() => handleSendMessage(`Start live call assist for ${selectedBlip.name}`, 'C')} className="px-3 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors border border-slate-700"><Phone size={12}/></button>
                                </div>
                            </div>
                        ) : (
                             <div className="p-4 border-b border-slate-800 bg-slate-800/50">
                                 <div className="flex items-center gap-2 text-slate-300">
                                     <Sparkles size={16} className="text-blue-500"/>
                                     <h3 className="font-bold text-sm">Copilot Active</h3>
                                 </div>
                                 <p className="text-xs text-slate-500 mt-1">Select a client bubble for context.</p>
                             </div>
                        )}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-900">
                             {messages.map((msg, idx) => (
                                <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300'}`}>
                                        {msg.role === 'user' ? 'ME' : <Bot size={14}/>}
                                    </div>
                                    <div className={`px-3 py-2 rounded-2xl text-xs leading-relaxed max-w-[90%] shadow-sm ${
                                        msg.role === 'user' 
                                        ? 'bg-blue-600/20 text-blue-100 border border-blue-500/30 rounded-tr-none' 
                                        : 'bg-slate-800 text-slate-300 border border-slate-700 rounded-tl-none w-full'
                                    }`}>
                                        {renderMessageContent(msg.text)}
                                    </div>
                                </div>
                            ))}
                            {isThinking && (
                                <div className="flex gap-3">
                                    <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center"><Bot size={14} className="text-slate-300"/></div>
                                    <div className="bg-slate-800 px-3 py-2 rounded-2xl rounded-tl-none flex items-center gap-1">
                                        <span className="w-1 h-1 bg-blue-400 rounded-full animate-bounce"></span>
                                        <span className="w-1 h-1 bg-blue-400 rounded-full animate-bounce delay-75"></span>
                                        <span className="w-1 h-1 bg-blue-400 rounded-full animate-bounce delay-150"></span>
                                    </div>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>

                        <div className="p-3 bg-slate-900 border-t border-slate-800">
                            <div className="relative flex items-center">
                                 <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                    placeholder="Ask Copilot..."
                                    className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl pl-3 pr-20 py-2.5 focus:ring-1 focus:ring-blue-500 outline-none text-xs transition-all"
                                    disabled={isThinking}
                                />
                                <div className="absolute right-1 flex items-center gap-1">
                                    <button onClick={handleVoiceInput} className={`p-1.5 rounded-lg transition-all ${isListening ? 'text-red-500 bg-red-500/10' : 'text-slate-400 hover:text-white'}`}>
                                        {isListening ? <StopCircle size={14}/> : <Mic size={14}/>}
                                    </button>
                                    <button onClick={() => handleSendMessage()} disabled={!input.trim() || isThinking} className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-all">
                                        {isThinking ? <Loader2 size={14} className="animate-spin"/> : <Send size={14}/>}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 bg-slate-50 text-black p-4 overflow-auto custom-scrollbar">
                    <Pipeline 
                        opportunities={opportunities}
                        onAdd={onAddOpportunity}
                        onUpdate={onUpdateOpportunity}
                        onDelete={onDeleteOpportunity}
                        customers={customers}
                        products={products}
                        currentCompanyId={currentCompanyId}
                        availableCompanies={availableCompanies}
                        addProduct={addProduct}
                        addCustomer={addCustomer}
                    />
                </div>
            )}
        </div>
    );
};

export default ICRM;