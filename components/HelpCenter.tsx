
import React, { useState, useRef, useEffect } from 'react';
import { X, HelpCircle, Book, MessageSquare, FileText, Calculator, Truck, ShoppingBag, TrendingUp, Search, Send, Sparkles, User, Bot, Loader2, Briefcase } from 'lucide-react';
import { getHelpChatResponse, getProcurementAgentResponse } from '../services/geminiService';
import { Supplier, PurchaseOrder, SupplierOffer } from '../types';

interface HelpCenterProps {
  isOpen: boolean;
  onClose: () => void;
  procurementData: {
      suppliers: Supplier[];
      purchaseOrders: PurchaseOrder[];
      offers: SupplierOffer[];
  };
}

const HelpCenter: React.FC<HelpCenterProps> = ({ isOpen, onClose, procurementData }) => {
  const [activeTab, setActiveTab] = useState<'GUIDE' | 'FAQ' | 'CHAT'>('GUIDE');
  
  // Chat State
  const [chatAgent, setChatAgent] = useState<'SUPPORT' | 'PROCUREMENT'>('SUPPORT');
  
  const [messages, setMessages] = useState<{role: 'user' | 'model', text: string}[]>([
      { role: 'model', text: "Hi! I'm Hall, your AI assistant. How can I help you today?" }
  ]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Reset chat when switching agents
  useEffect(() => {
      if (chatAgent === 'SUPPORT') {
          setMessages([{ role: 'model', text: "Hi! I'm Hall, your System Support agent. Ask me anything about navigating the CRM or using features." }]);
      } else {
          setMessages([{ role: 'model', text: "Hello. I'm your Procurement Copilot. I have access to your supplier database, recent POs, and offers. What insights do you need?" }]);
      }
  }, [chatAgent]);

  // Auto-scroll to bottom of chat
  useEffect(() => {
      if (activeTab === 'CHAT') {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
  }, [messages, activeTab]);

  const handleSendMessage = async () => {
      if (!inputText.trim()) return;
      
      const userMsg = inputText;
      setInputText(''); // Clear input immediately
      
      // Add user message
      const newHistory = [...messages, { role: 'user' as const, text: userMsg }];
      setMessages(newHistory);
      setIsTyping(true);

      // Get AI response based on selected agent
      let response = "";
      if (chatAgent === 'SUPPORT') {
          response = await getHelpChatResponse(userMsg, messages);
      } else {
          response = await getProcurementAgentResponse(userMsg, messages, procurementData);
      }
      
      setMessages(prev => [...prev, { role: 'model', text: response }]);
      setIsTyping(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSendMessage();
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose}></div>

      {/* Panel */}
      <div className="relative w-full max-w-md bg-white h-full shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col">
        <div className="p-6 bg-slate-900 text-white flex justify-between items-center shrink-0">
            <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <HelpCircle size={24} className="text-blue-400"/> AI Help Center
                </h2>
                <p className="text-slate-400 text-sm mt-1">Guides, Support & Intelligence</p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                <X size={24} />
            </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 shrink-0">
            <button
                onClick={() => setActiveTab('GUIDE')}
                className={`flex-1 py-3 text-xs font-bold border-b-2 transition-colors flex justify-center items-center gap-2 ${activeTab === 'GUIDE' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
                <Book size={14}/> GUIDES
            </button>
            <button
                onClick={() => setActiveTab('FAQ')}
                className={`flex-1 py-3 text-xs font-bold border-b-2 transition-colors flex justify-center items-center gap-2 ${activeTab === 'FAQ' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
                <FileText size={14}/> FAQ
            </button>
            <button
                onClick={() => setActiveTab('CHAT')}
                className={`flex-1 py-3 text-xs font-bold border-b-2 transition-colors flex justify-center items-center gap-2 ${activeTab === 'CHAT' ? 'border-indigo-600 text-indigo-600 bg-indigo-50' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
                <Sparkles size={14}/> AI CHAT
            </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-slate-50 flex flex-col relative">
            {activeTab === 'GUIDE' && (
                <div className="p-6 space-y-6">
                    <GuideSection
                        title="Procurement (BUY)"
                        icon={ShoppingBag}
                        color="text-teal-600"
                        items={[
                            "Create 'Quote Requests' to send to suppliers.",
                            "Log incoming 'Supplier Offers' to compare prices.",
                            "Issue 'Purchase Orders' once a deal is made.",
                            "Use 'Freight Quotes' to find best shipping rates."
                        ]}
                    />
                    <GuideSection
                        title="Sales (SELL)"
                        icon={TrendingUp}
                        color="text-blue-600"
                        items={[
                            "Track leads in the 'Pipeline' board.",
                            "Use 'Quote Builder' to generate professional PDF quotes.",
                            "Analyze 'Customer Status' for 360° views.",
                            "Use 'Price List' to manage sell prices vs landed costs."
                        ]}
                    />
                    <GuideSection
                        title="Calculator"
                        icon={Calculator}
                        color="text-amber-600"
                        items={[
                            "Calculate Import DDP costs (Duty, Freight, Clearance).",
                            "Determine break-even and target sales prices.",
                            "Save calculation history for future reference."
                        ]}
                    />
                    <GuideSection
                        title="Logistics"
                        icon={Truck}
                        color="text-purple-600"
                        items={[
                            "Track 'Shipments' from origin to destination.",
                            "Manage 'Inventory' stock levels in warehouses.",
                            "Monitor 'Control Tower' for transit status."
                        ]}
                    />
                </div>
            )}

            {activeTab === 'FAQ' && (
                <div className="p-6 space-y-4">
                    <FaqItem question="How do I calculate a sales price?" answer="Go to Calculator > Cost/Profit. Enter your supplier's base price and logistics costs. The system will calculate DDP. Then set your target margin to see the recommended sales price." />
                    <FaqItem question="Where do I add a new product?" answer="Go to Data > Products. Click 'Add Product'. You can also quick-add products while creating a Quote or PO." />
                    <FaqItem question="How do I track a shipment?" answer="Go to Stock > Shipments. Enter the container number and ETA. Use the 'Control Tower' in the Logistics module for a visual overview." />
                    <FaqItem question="Can I export data?" answer="Currently, data export is available in specific modules like the Price List. Look for the 'Export CSV' button." />
                </div>
            )}

            {activeTab === 'CHAT' && (
                <>
                    {/* Agent Switcher */}
                    <div className="px-4 pt-4 pb-2 bg-slate-50 flex justify-center sticky top-0 z-10 shadow-sm">
                        <div className="bg-white p-1 rounded-xl flex text-xs font-bold w-full border border-slate-200">
                            <button 
                                onClick={() => setChatAgent('SUPPORT')} 
                                className={`flex-1 py-2 rounded-lg transition-all flex items-center justify-center gap-2 ${chatAgent === 'SUPPORT' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
                            >
                                <Bot size={14} /> System Support
                            </button>
                            <button 
                                onClick={() => setChatAgent('PROCUREMENT')}
                                className={`flex-1 py-2 rounded-lg transition-all flex items-center justify-center gap-2 ${chatAgent === 'PROCUREMENT' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
                            >
                                <Briefcase size={14} /> Procurement AI
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 p-4 space-y-4 overflow-y-auto custom-scrollbar pb-20">
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                                    msg.role === 'user' ? 'bg-slate-800 text-white' : 
                                    chatAgent === 'PROCUREMENT' ? 'bg-purple-600 text-white' : 'bg-blue-600 text-white'
                                }`}>
                                    {msg.role === 'user' ? <User size={14}/> : <Bot size={14}/>}
                                </div>
                                <div className={`p-3 rounded-2xl text-sm max-w-[85%] whitespace-pre-wrap ${
                                    msg.role === 'user' 
                                    ? 'bg-slate-100 text-slate-800 rounded-tr-none' 
                                    : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none shadow-sm'
                                }`}>
                                    {msg.text}
                                </div>
                            </div>
                        ))}
                        {isTyping && (
                            <div className="flex gap-3">
                                <div className={`w-8 h-8 rounded-full text-white flex items-center justify-center shrink-0 ${chatAgent === 'PROCUREMENT' ? 'bg-purple-600' : 'bg-blue-600'}`}><Bot size={14}/></div>
                                <div className="bg-white border border-slate-200 p-3 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-75"></span>
                                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-150"></span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                    
                    {/* Chat Input */}
                    <div className="absolute bottom-0 left-0 w-full p-4 bg-white border-t border-slate-200">
                        <div className="relative flex items-center">
                            <input
                                type="text"
                                value={inputText}
                                onChange={(e) => setInputText(e.target.value)}
                                onKeyDown={handleKeyPress}
                                placeholder={chatAgent === 'SUPPORT' ? "Ask how to use the CRM..." : "Ask about suppliers, prices, or POs..."}
                                className={`w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-300 rounded-xl outline-none text-sm transition-all focus:ring-2 ${chatAgent === 'PROCUREMENT' ? 'focus:ring-purple-500' : 'focus:ring-blue-500'}`}
                                disabled={isTyping}
                            />
                            <button 
                                onClick={handleSendMessage}
                                disabled={!inputText.trim() || isTyping}
                                className={`absolute right-2 p-2 text-white rounded-lg disabled:opacity-50 transition-colors ${chatAgent === 'PROCUREMENT' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                            >
                                {isTyping ? <Loader2 size={16} className="animate-spin"/> : <Send size={16} />}
                            </button>
                        </div>
                        <p className="text-[10px] text-slate-400 text-center mt-2 flex items-center justify-center gap-1">
                            <Sparkles size={10}/> Powered by Gemini
                        </p>
                    </div>
                </>
            )}
        </div>

        {/* Footer (Hidden in Chat mode) */}
        {activeTab !== 'CHAT' && (
            <div className="p-4 border-t border-slate-200 bg-white shrink-0">
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 flex gap-3">
                    <div className="p-2 bg-white rounded-full text-blue-600 h-fit shadow-sm"><Search size={16}/></div>
                    <div>
                        <h4 className="text-sm font-bold text-blue-800">Need more help?</h4>
                        <p className="text-xs text-blue-600 mt-1">Contact your system administrator for access issues or bug reports.</p>
                    </div>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

const GuideSection = ({ title, icon: Icon, color, items }: { title: string, icon: any, color: string, items: string[] }) => (
    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <h3 className={`font-bold flex items-center gap-2 mb-3 ${color}`}>
            <Icon size={18} /> {title}
        </h3>
        <ul className="space-y-2">
            {items.map((item, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-600">
                    <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0"></div>
                    {item}
                </li>
            ))}
        </ul>
    </div>
);

const FaqItem = ({ question, answer }: { question: string, answer: string }) => (
    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <h4 className="font-bold text-slate-800 text-sm mb-2 flex items-start gap-2">
            <HelpCircle size={16} className="text-slate-400 shrink-0 mt-0.5" /> {question}
        </h4>
        <p className="text-sm text-slate-600 pl-6 leading-relaxed">{answer}</p>
    </div>
);

export default HelpCenter;
