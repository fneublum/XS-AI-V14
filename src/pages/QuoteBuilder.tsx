
import React, { useState, useEffect } from 'react';
import { Calculator, Send, Wand2, Loader2, Plus, Trash2, History, AlertCircle, Save, CheckCircle2, TrendingUp, ShoppingBag, Copy, Mail, RefreshCw } from 'lucide-react';
import { Customer, Product, Quote, QuoteItem, Opportunity, DealStage } from '../types';
import { getQuoteRecommendation, generateSalesEmail } from '../services/geminiService';
import { QuantityInput, PriceInput } from '../components/UnitInputs';

interface QuoteBuilderProps {
    customers: Customer[];
    products: Product[];
    opportunities: Opportunity[]; // Passed to show history
    onSaveQuote: (q: Quote) => void;
    onAddOpportunity: (o: Opportunity) => void;
    currentCompanyId: string;
}

const QuoteBuilder: React.FC<QuoteBuilderProps> = ({ customers, products, opportunities, onSaveQuote, onAddOpportunity, currentCompanyId }) => {
  // Quote Header State
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [validUntil, setValidUntil] = useState<string>(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

  // Quote Items State
  const [items, setItems] = useState<QuoteItem[]>([]);
  
  // Current Item Input State
  const [currentProductId, setCurrentProductId] = useState<string>('');
  const [currentQty, setCurrentQty] = useState<number>(44000); // Default Truckload in LBS
  const [currentPrice, setCurrentPrice] = useState<number>(0); 
  
  // AI & History UI State
  const [aiInsight, setAiInsight] = useState('');
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  
  // Email Draft State
  const [emailDraft, setEmailDraft] = useState('');
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);

  const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
  const currentProduct = products.find(p => p.id === currentProductId);

  // Derived Values
  const totalQuoteValue = items.reduce((sum, item) => sum + item.totalUSD, 0);

  // --- Automatic AI Email Generation ---
  useEffect(() => {
    if (!selectedCustomer || items.length === 0) {
        setEmailDraft('');
        return;
    }

    // Debounce the API call to avoid spamming while user is editing
    const timer = setTimeout(() => {
        handleGenerateEmail(true); // Auto flag
    }, 2000);

    return () => clearTimeout(timer);
  }, [items, selectedCustomer]);


  // --- Handlers ---

  const handleAddItem = () => {
      if (!currentProduct || !currentQty || !currentPrice) return;
      
      const newItem: QuoteItem = {
          productId: currentProduct.id,
          productName: currentProduct.name,
          grade: currentProduct.grade,
          quantityLBS: currentQty,
          unitPriceUSD: currentPrice,
          totalUSD: currentQty * currentPrice
      };

      setItems([...items, newItem]);
      
      // Reset inputs but keep quantity
      setCurrentProductId('');
      setCurrentPrice(0);
  };

  const handleRemoveItem = (index: number) => {
      const newItems = [...items];
      newItems.splice(index, 1);
      setItems(newItems);
  };

  const handleGenerateEmail = async (isAuto: boolean = false) => {
      if (!selectedCustomer) return;
      setIsGeneratingEmail(true);
      const draft = await generateSalesEmail(selectedCustomer.name, items, totalQuoteValue);
      setEmailDraft(draft);
      setIsGeneratingEmail(false);
  };

  const copyToClipboard = () => {
      navigator.clipboard.writeText(emailDraft);
  };

  const handleSave = (shouldEmail: boolean) => {
      if (!selectedCustomer || items.length === 0) return;
      
      setSaveStatus('saving');
      
      const newQuoteId = `Q${Date.now()}`;
      const companyId = currentCompanyId === 'ALL' ? selectedCustomer.companyId : currentCompanyId;

      // 1. Create the Quote Record
      const newQuote: Quote = {
          id: newQuoteId,
          companyId: companyId,
          customerId: selectedCustomer.id,
          customerName: selectedCustomer.name,
          items: items,
          totalAmountUSD: totalQuoteValue,
          status: 'Sent',
          createdDate: new Date().toISOString().split('T')[0],
          validUntil: validUntil
      };

      onSaveQuote(newQuote);

      // 2. Automatically Create Pipeline Opportunity
      // Summarize product name if multiple items
      const productNameSummary = items.length === 1 
          ? items[0].productName 
          : `Mixed Order (${items.length} Items)`;
      
      const totalVolume = items.reduce((acc, item) => acc + item.quantityLBS, 0);

      const newOpportunity: Opportunity = {
          id: `O${Date.now()}`,
          companyId: companyId,
          customerId: selectedCustomer.id,
          customerName: selectedCustomer.name,
          productName: productNameSummary,
          volumeLBS: totalVolume,
          value: totalQuoteValue,
          items: items.map(i => ({
              productId: i.productId,
              productName: i.productName,
              volumeLBS: i.quantityLBS,
              value: i.totalUSD
          })),
          stage: DealStage.QUOTE_SENT, // Automatically place in Quote Sent
          probability: 60, // Default probability for sent quote
          expectedCloseDate: validUntil,
          assignedTo: 'Sales Rep', // Could be current user if available
          comments: `Auto-generated from Quote #${newQuoteId}`
      };

      onAddOpportunity(newOpportunity);

      setTimeout(() => {
          setSaveStatus('saved');
          
          if (shouldEmail) {
             const subject = encodeURIComponent(`Quote #${newQuoteId} - ${productNameSummary}`);
             const body = encodeURIComponent(emailDraft || `Dear ${selectedCustomer.contactPerson},\n\nPlease find attached the quote for ${productNameSummary}.\n\nTotal: $${totalQuoteValue.toLocaleString()}\n\nBest regards,`);
             window.open(`mailto:${selectedCustomer.email}?subject=${subject}&body=${body}`, '_blank');
          }

          // Reset form after short delay
          setTimeout(() => {
            setSaveStatus('idle');
            setItems([]);
            setSelectedCustomerId('');
            setEmailDraft('');
          }, 1500);
      }, 800);
  };

  const handleAiAssist = async () => {
    if (!currentProduct) return;
    setIsLoadingAi(true);
    // Simple mock context for AI
    const result = await getQuoteRecommendation(currentProduct.name, currentProduct.specs.origin, "Customer Location");
    setAiInsight(result);
    setIsLoadingAi(false);
  };

  // --- History Filtering ---
  const customerHistory = opportunities.filter(o => o.customerId === selectedCustomerId);
  const lastSales = customerHistory.filter(o => o.stage === DealStage.CLOSED_WON).slice(0, 3);
  const openQuotes = customerHistory.filter(o => o.stage === DealStage.QUOTE_SENT || o.stage === DealStage.NEGOTIATION).slice(0, 3);

  return (
    <div className="relative min-h-[calc(100vh-8rem)] flex flex-col gap-6">
      <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Calculator className="text-blue-600" />
            Quote Engine
          </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        
        {/* Left Column: Configuration & Builder */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Header Info */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Customer</label>
                    <select 
                        className="w-full border border-slate-600 rounded-lg px-3 py-2 text-white bg-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
                        value={selectedCustomerId}
                        onChange={(e) => {
                            setSelectedCustomerId(e.target.value);
                            // Email draft will auto-update via useEffect
                        }}
                    >
                        <option value="">-- Select Customer --</option>
                        {customers.map(c => <option key={c.id} value={c.id}>{c.name} {c.nickname ? `(${c.nickname})` : ''}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Valid Until</label>
                    <input 
                        type="date" 
                        value={validUntil}
                        onChange={(e) => setValidUntil(e.target.value)}
                        className="w-full border border-slate-600 rounded-lg px-3 py-2 text-white bg-slate-900 focus:ring-2 focus:ring-blue-500 outline-none"
                        style={{ colorScheme: 'dark' }}
                    />
                </div>
             </div>
          </div>

          {/* Item Builder */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 relative">
              <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 flex items-center gap-2">
                  <ShoppingBag size={16} /> Add Line Item
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                  <div className="md:col-span-4">
                      <label className="block text-xs font-medium text-slate-500 mb-1">Product</label>
                      <select 
                        className="w-full border border-slate-600 rounded-lg px-3 py-2 text-sm bg-slate-900 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                        value={currentProductId}
                        onChange={(e) => { setCurrentProductId(e.target.value); setAiInsight(''); }}
                      >
                          <option value="">Select Product...</option>
                          {products.map(p => <option key={p.id} value={p.id}>{p.name} - {p.grade}</option>)}
                      </select>
                  </div>
                  <div className="md:col-span-3">
                      <QuantityInput 
                        value={currentQty}
                        onChange={setCurrentQty}
                      />
                  </div>
                  <div className="md:col-span-3">
                      <PriceInput 
                        value={currentPrice}
                        onChange={setCurrentPrice}
                        label={`Price ${currentProduct ? `(Base: ${currentProduct.price})` : ''}`}
                      />
                  </div>
                  <div className="md:col-span-2">
                      <button 
                        onClick={handleAddItem}
                        disabled={!currentProductId || !currentPrice}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-lg transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                        title="Add to Quote"
                      >
                          <Plus size={20} />
                      </button>
                  </div>
              </div>

              {/* AI Helper for Pricing */}
              {currentProductId && (
                  <div className="mt-4 p-3 bg-indigo-50 rounded-lg border border-indigo-100 flex items-start gap-3 animate-in fade-in">
                      <div className="p-2 bg-white rounded-full text-indigo-600 shadow-sm shrink-0">
                          <Wand2 size={14} />
                      </div>
                      <div className="flex-1">
                          <div className="flex justify-between items-start">
                             <p className="text-xs font-bold text-indigo-800 uppercase mb-1">AI Pricing Check</p>
                             {!aiInsight && <button onClick={handleAiAssist} className="text-xs text-indigo-600 hover:underline">Analyze</button>}
                          </div>
                          {isLoadingAi ? (
                              <div className="flex items-center gap-2 text-xs text-indigo-500"><Loader2 className="animate-spin" size={12}/> Analyzing market rates...</div>
                          ) : aiInsight ? (
                              <p className="text-xs text-indigo-700 leading-relaxed">{aiInsight}</p>
                          ) : (
                              <p className="text-xs text-indigo-400">Get a sanity check on pricing and freight risks before quoting.</p>
                          )}
                      </div>
                  </div>
              )}
          </div>

          {/* Items Table */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                          <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase">Product</th>
                          <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase text-right">Qty (LBS)</th>
                          <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase text-right">Price ($/LB)</th>
                          <th className="px-6 py-3 text-xs font-bold text-slate-500 uppercase text-right">Total</th>
                          <th className="px-6 py-3 w-10"></th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                      {items.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                              <td className="px-6 py-3">
                                  <p className="font-medium text-slate-800">{item.productName}</p>
                                  <p className="text-xs text-slate-500">{item.grade}</p>
                              </td>
                              <td className="px-6 py-3 text-right text-sm font-mono text-slate-600">{item.quantityLBS.toLocaleString()}</td>
                              <td className="px-6 py-3 text-right text-sm font-mono text-slate-600">${item.unitPriceUSD.toFixed(4)}</td>
                              <td className="px-6 py-3 text-right text-sm font-mono font-bold text-slate-800">${item.totalUSD.toLocaleString()}</td>
                              <td className="px-6 py-3 text-right">
                                  <button onClick={() => handleRemoveItem(idx)} className="text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                              </td>
                          </tr>
                      ))}
                      {items.length === 0 && (
                          <tr>
                              <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
                                  No items added yet. Use the form above to build your quote.
                              </td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
        </div>

        {/* Right Column: History Only */}
        <div className="lg:col-span-1 space-y-6 flex flex-col">
            
            {/* Customer History Section */}
            {selectedCustomer && (
                <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 animate-in slide-in-from-right duration-500 sticky top-4">
                    <h3 className="text-sm font-bold text-slate-800 uppercase mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
                        <History size={16} className="text-blue-500" /> History: <span className="text-slate-500 font-normal normal-case truncate">{selectedCustomer.nickname || selectedCustomer.name.split(' ')[0]}</span>
                    </h3>
                    
                    <div className="space-y-4">
                        {/* Recent Sales */}
                        <div>
                            <p className="text-[10px] font-bold text-emerald-600 uppercase mb-2 tracking-wider">Recent Sales</p>
                            <div className="space-y-2">
                                {lastSales.length > 0 ? lastSales.map(deal => (
                                    <div key={deal.id} className="p-2.5 bg-emerald-50 border border-emerald-100 rounded-lg hover:shadow-sm transition-shadow">
                                        <div className="flex justify-between font-bold text-slate-700 text-xs mb-1">
                                            <span>{deal.productName}</span>
                                            <span className="text-emerald-700">${deal.value.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between text-slate-500 text-[10px]">
                                            <span>{deal.volumeLBS.toLocaleString()} lbs</span>
                                            <span>{deal.expectedCloseDate}</span>
                                        </div>
                                    </div>
                                )) : <p className="text-xs text-slate-400 italic pl-1">No closed sales.</p>}
                            </div>
                        </div>

                        {/* Active Quotes */}
                        <div>
                            <p className="text-[10px] font-bold text-blue-600 uppercase mb-2 tracking-wider">Active Deals</p>
                            <div className="space-y-2">
                                {openQuotes.length > 0 ? openQuotes.map(deal => (
                                    <div key={deal.id} className="p-2.5 bg-blue-50 border border-blue-100 rounded-lg hover:shadow-sm transition-shadow">
                                        <div className="flex justify-between font-bold text-slate-700 text-xs mb-1">
                                            <span>{deal.productName}</span>
                                            <span className="text-blue-700">${deal.value.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between text-slate-500 text-[10px]">
                                            <span>{deal.stage}</span>
                                            <span>{deal.volumeLBS.toLocaleString()} lbs</span>
                                        </div>
                                    </div>
                                )) : <p className="text-xs text-slate-400 italic pl-1">No active deals.</p>}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
      </div>

      {/* Quote Summary (Full Width Footer) */}
      <div className="bg-slate-900 text-white p-6 rounded-xl shadow-xl border-t-4 border-blue-500 mt-2">
            <div className="flex flex-col md:flex-row justify-between items-end gap-6">
                <div className="w-full md:w-1/2">
                    <h3 className="text-lg font-bold border-b border-slate-700 pb-2 mb-4 flex items-center gap-2">
                        <Calculator size={20} className="text-blue-400"/> Quote Summary
                    </h3>
                        <div className="space-y-2 mb-4 text-sm text-slate-300">
                            <div className="flex justify-between">
                                <span>Line Items</span>
                                <span>{items.length}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Tax</span>
                                <span className="italic opacity-50">TBD on Invoice</span>
                            </div>
                        </div>
                        <div className="bg-slate-800 p-3 rounded-lg flex justify-between items-center">
                        <span className="text-slate-400 text-sm uppercase font-bold">Total Value</span>
                        <p className="text-3xl font-bold text-white tracking-tight">${totalQuoteValue.toLocaleString()}</p>
                    </div>
                </div>

                <div className="w-full md:w-1/2 flex flex-col gap-3">
                    <button 
                        onClick={() => handleSave(true)}
                        disabled={items.length === 0 || !selectedCustomer || saveStatus !== 'idle'}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 rounded-lg transition-all flex items-center justify-center gap-3 shadow-lg shadow-blue-900/50 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                    >
                        {saveStatus === 'saved' ? <CheckCircle2 size={24}/> : <Mail size={24} />} 
                        Save & Send Email
                    </button>
                    
                    <button 
                        onClick={() => handleSave(false)}
                        disabled={items.length === 0 || !selectedCustomer || saveStatus !== 'idle'}
                        className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-lg font-medium border border-slate-700 flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                            {saveStatus === 'saving' ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                            {saveStatus === 'saving' ? 'Saving...' : 'Save Only'}
                    </button>
                </div>
            </div>
      </div>

      {/* AI Email Drafter (Moved to Bottom) */}
      <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden flex flex-col min-h-[300px]">
        <div className="bg-gradient-to-r from-indigo-600 to-blue-600 p-4 text-white flex justify-between items-center">
            <div>
                <h3 className="font-bold flex items-center gap-2">
                    <Wand2 size={18} /> AI Email Drafter
                </h3>
                <p className="text-xs text-blue-100 opacity-90 mt-1">Auto-generates draft based on quote.</p>
            </div>
            {isGeneratingEmail && <Loader2 size={16} className="animate-spin text-white opacity-80" />}
        </div>
        
        <div className="flex-1 p-4 flex flex-col bg-slate-50">
            <div className="flex-1 bg-white border border-slate-200 rounded-lg p-3 text-sm text-slate-600 overflow-y-auto mb-3 whitespace-pre-wrap font-sans leading-relaxed shadow-inner min-h-[200px]">
                {isGeneratingEmail ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                        <Loader2 className="animate-spin text-indigo-500" size={24} />
                        <span className="text-xs">Crafting perfect pitch...</span>
                    </div>
                ) : emailDraft ? (
                    emailDraft
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 text-center p-4">
                        <Mail size={32} className="mb-2 opacity-20" />
                        <p className="text-xs">Add products above to see the AI draft an email automatically.</p>
                    </div>
                )}
            </div>
            
            <div className="flex gap-2">
                 <button 
                    onClick={() => handleGenerateEmail(false)}
                    disabled={items.length === 0 || !selectedCustomer || isGeneratingEmail}
                    className="flex-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed border border-indigo-200"
                >
                    <RefreshCw size={14} className={isGeneratingEmail ? 'animate-spin' : ''} /> Regenerate
                </button>
                <button 
                    onClick={copyToClipboard}
                    disabled={!emailDraft}
                    className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 p-2.5 rounded-lg transition-colors disabled:opacity-50"
                    title="Copy to Clipboard"
                >
                    <Copy size={16} />
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default QuoteBuilder;
