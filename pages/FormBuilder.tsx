
import React, { useState, useEffect, useRef } from 'react';
import { 
    Save, Plus, Trash2, Bot, Sparkles, Send, LayoutTemplate, 
    Type, FileText, Hash, Calendar, DollarSign, Loader2, 
    ArrowUp, ArrowDown, AlignLeft, MapPin, List, Minus, 
    X, Database, Image as ImageIcon, Box, Grid, Move, 
    AlignCenter, AlignRight, Bold, Italic, Type as TypeIcon,
    Eye, Check, Building
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { getSupabaseClient } from '../services/supabase';

// --- Types ---
interface FormStyle {
    fontSize?: number;
    fontWeight?: 'normal' | 'bold';
    textAlign?: 'left' | 'center' | 'right';
    color?: string;
    backgroundColor?: string;
    width?: string; // '100%', '50%', '33%'
    marginTop?: number;
    marginBottom?: number;
}

interface FormField {
    id: string;
    type: 'text' | 'textarea' | 'date' | 'number' | 'currency' | 'table' | 'address' | 'image' | 'company_logo' | 'separator' | 'header' | 'signature';
    label: string;
    value?: string; // For static text
    placeholder?: string;
    required: boolean;
    dataSource?: string; // e.g., 'customers.name', 'sales_orders.totalAmount'
    style: FormStyle;
}

interface FormLayout {
    id: string;
    name: string;
    type: 'CONTRACT' | 'PROFORMA' | 'INVOICE' | 'OTHER';
    fields: FormField[];
}

// --- Schema Definitions for Drag & Drop ---
const DB_SCHEMA = [
    {
        table: 'customers',
        label: 'Customer Data',
        icon: UserIcon,
        fields: [
            { key: 'name', label: 'Company Name' },
            { key: 'contactPerson', label: 'Contact Person' },
            { key: 'email', label: 'Email Address' },
            { key: 'phone', label: 'Phone Number' },
            { key: 'taxId', label: 'Tax ID' },
            { key: 'address_full', label: 'Full Address' }, // Virtual field
        ]
    },
    {
        table: 'sales_orders',
        label: 'Sales Order',
        icon: FileText,
        fields: [
            { key: 'orderNumber', label: 'Order #' },
            { key: 'orderDate', label: 'Order Date' },
            { key: 'totalAmount', label: 'Total Amount' },
            { key: 'currency', label: 'Currency' },
            { key: 'paymentTerms', label: 'Payment Terms' },
            { key: 'incoterm', label: 'Incoterm' },
        ]
    },
    {
        table: 'company',
        label: 'My Company',
        icon: Building,
        fields: [
            { key: 'name', label: 'My Company Name' },
            { key: 'address', label: 'My Address' },
            { key: 'city', label: 'My City' },
            { key: 'country', label: 'My Country' },
        ]
    }
];

import { User as UserIcon } from 'lucide-react';

const FormBuilder: React.FC = () => {
    // --- State ---
    const [layouts, setLayouts] = useState<FormLayout[]>([]);
    const [currentLayout, setCurrentLayout] = useState<FormLayout>({
        id: 'new',
        name: 'New Document Template',
        type: 'PROFORMA',
        fields: []
    });
    
    const [activeTab, setActiveTab] = useState<'ELEMENTS' | 'DATA' | 'AI'>('ELEMENTS');
    const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [previewMode, setPreviewMode] = useState(false);
    const [systemLogoUrl, setSystemLogoUrl] = useState<string>('');

    // AI Chat
    const [messages, setMessages] = useState<{role: 'user' | 'model', text: string}[]>([
        { role: 'model', text: "I'm your Design Copilot. Ask me to help structure a contract or suggest standard legal clauses." }
    ]);
    const [chatInput, setChatInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    const client = getSupabaseClient();

    // --- Effects ---
    useEffect(() => {
        loadLayouts();
        fetchSystemLogo();
    }, []);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const fetchSystemLogo = async () => {
        if (!client) return;
        // Fetch the system logo or the first available logo
        const { data } = await client.from('imagens').select('url').eq('type', 'LOGO').limit(1);
        if (data && data.length > 0) {
            setSystemLogoUrl(data[0].url);
        }
    };

    const loadLayouts = async () => {
        if (!client) return;
        const { data } = await client.from('form_layouts').select('*');
        if (data && data.length > 0) {
             const parsedData = data.map(d => ({
                 ...d,
                 fields: typeof d.layout === 'string' ? JSON.parse(d.layout) : d.layout
             }));
             setLayouts(parsedData);
        }
    };

    const handleSave = async () => {
        if (!client) return;
        
        if (!currentLayout.name || currentLayout.name.trim() === '' || currentLayout.name === 'New Document Template') {
            alert("Please enter a unique name for this form template before saving.");
            return;
        }

        setIsSaving(true);
        
        const payload = {
            id: currentLayout.id === 'new' ? `FORM_${Date.now()}` : currentLayout.id,
            companyId: 'ALL', 
            name: currentLayout.name,
            layout: currentLayout.fields 
        };

        const { error } = await client.from('form_layouts').upsert(payload);
        
        setIsSaving(false);
        if (error) {
            alert('Error saving layout: ' + error.message);
        } else {
            // Reload layouts to update the dropdown list
            loadLayouts();
            // If it was new, update current ID so subsequent saves are updates
            if (currentLayout.id === 'new') {
                setCurrentLayout(prev => ({ ...prev, id: payload.id }));
            }
        }
    };

    // --- Field Operations ---
    
    const addField = (type: string, defaultLabel: string, dataSource?: string) => {
        const newField: FormField = {
            id: `f_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            type: type as any,
            label: defaultLabel,
            required: false,
            dataSource: dataSource,
            style: {
                fontSize: 12,
                width: '100%',
                textAlign: 'left',
                fontWeight: 'normal',
                marginTop: 2,
                marginBottom: 2
            }
        };
        // Default stylings
        if (type === 'header') {
            newField.style.fontSize = 24;
            newField.style.fontWeight = 'bold';
        }
        if (type === 'company_logo') {
            newField.style.width = '33%'; // Default to taking up 1/3 of the line
        }

        setCurrentLayout(prev => ({ ...prev, fields: [...prev.fields, newField] }));
        setSelectedFieldId(newField.id);
    };

    const removeField = (id: string) => {
        setCurrentLayout(prev => ({ ...prev, fields: prev.fields.filter(f => f.id !== id) }));
        if (selectedFieldId === id) setSelectedFieldId(null);
    };

    const moveField = (index: number, direction: 'up' | 'down') => {
        if (direction === 'up' && index === 0) return;
        if (direction === 'down' && index === currentLayout.fields.length - 1) return;
        
        const newFields = [...currentLayout.fields];
        const swapIndex = direction === 'up' ? index - 1 : index + 1;
        [newFields[index], newFields[swapIndex]] = [newFields[swapIndex], newFields[index]];
        
        setCurrentLayout(prev => ({ ...prev, fields: newFields }));
    };

    const updateField = (id: string, updates: Partial<FormField>) => {
        setCurrentLayout(prev => ({
            ...prev,
            fields: prev.fields.map(f => f.id === id ? { ...f, ...updates } : f)
        }));
    };

    const updateFieldStyle = (id: string, styleUpdates: Partial<FormStyle>) => {
        setCurrentLayout(prev => ({
            ...prev,
            fields: prev.fields.map(f => f.id === id ? { ...f, style: { ...f.style, ...styleUpdates } } : f)
        }));
    };

    // --- AI ---
    const handleAiSend = async () => {
        if (!chatInput.trim()) return;
        const text = chatInput;
        setChatInput('');
        setMessages(prev => [...prev, { role: 'user', text }]);
        setIsThinking(true);

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const model = 'gemini-3-flash-preview';
            
            const prompt = `
                You are a UI/UX Form Design Assistant for a B2B CRM.
                Current Form: ${currentLayout.name} (${currentLayout.type})
                
                User Request: "${text}"

                Provide concise advice. If the user asks for a legal clause, provide the text they can copy.
            `;

            const result = await ai.models.generateContent({
                model,
                contents: prompt
            });

            setMessages(prev => [...prev, { role: 'model', text: result.text || "No response generated." }]);
        } catch (e) {
            setMessages(prev => [...prev, { role: 'model', text: "Connection error." }]);
        } finally {
            setIsThinking(false);
        }
    };

    const selectedField = currentLayout.fields.find(f => f.id === selectedFieldId);

    // --- Renderers ---
    const renderCanvasField = (field: FormField, index: number) => {
        const isSelected = selectedFieldId === field.id;
        
        return (
            <div 
                key={field.id}
                onClick={(e) => { e.stopPropagation(); setSelectedFieldId(field.id); }}
                className={`relative group transition-all cursor-pointer border hover:border-blue-300 ${isSelected ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50/10' : 'border-transparent'}`}
                style={{
                    width: field.style.width,
                    marginTop: `${field.style.marginTop}px`,
                    marginBottom: `${field.style.marginBottom}px`,
                    // Handle alignment for image/logo containers
                    display: (field.type === 'image' || field.type === 'company_logo') ? 'flex' : 'block',
                    justifyContent: field.style.textAlign === 'center' ? 'center' : field.style.textAlign === 'right' ? 'flex-end' : 'flex-start'
                }}
            >
                {/* Visual Representation */}
                <div style={{ 
                    fontSize: `${field.style.fontSize}px`, 
                    fontWeight: field.style.fontWeight, 
                    textAlign: field.style.textAlign,
                    color: field.style.color || '#1e293b',
                    width: '100%'
                }}>
                    {field.type === 'company_logo' && (
                        systemLogoUrl ? (
                            <img 
                                src={systemLogoUrl} 
                                alt="Company Logo" 
                                style={{ 
                                    maxHeight: '80px', 
                                    maxWidth: '100%', 
                                    objectFit: 'contain' 
                                }} 
                            />
                        ) : (
                            <div className="border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-slate-400 text-xs">
                                <Building size={24} className="mx-auto mb-1 opacity-50"/>
                                Company Logo
                            </div>
                        )
                    )}
                    {field.type === 'header' && (
                        <h1 className="leading-tight">{field.value || field.label}</h1>
                    )}
                    {field.type === 'separator' && (
                        <hr className="border-slate-300 my-2"/>
                    )}
                    {field.type === 'signature' && (
                        <div className="pt-8 border-t border-slate-800 w-48 mt-8">
                            <p className="text-xs uppercase tracking-wider">{field.label}</p>
                        </div>
                    )}
                    {(field.type === 'text' || field.type === 'number' || field.type === 'currency' || field.type === 'date') && (
                        <div className="flex flex-col">
                            {/* If it has a data source, show a badge, else show label as static text if value is present, or label as field label */}
                            <label className="text-[0.6em] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
                                {field.dataSource ? (
                                    <span className="flex items-center gap-1 text-blue-500"><Database size={10}/> {field.label}</span>
                                ) : field.label}
                            </label>
                            <div className="p-2 border border-slate-200 rounded bg-slate-50 text-slate-400 font-mono text-[0.8em]">
                                {field.dataSource ? `{${field.dataSource}}` : (field.placeholder || 'Input Area')}
                            </div>
                        </div>
                    )}
                     {field.type === 'textarea' && (
                        <div className="flex flex-col">
                             <label className="text-[0.6em] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{field.label}</label>
                             <div className="p-2 border border-slate-200 rounded bg-slate-50 text-slate-400 h-20 text-[0.8em]">
                                {field.value || field.placeholder || 'Multi-line text area'}
                             </div>
                        </div>
                    )}
                    {field.type === 'image' && (
                         <div className="border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-slate-400 text-xs w-full flex flex-col items-center justify-center h-24">
                            <ImageIcon size={24} className="mb-1 opacity-50"/>
                            Image Placeholder
                        </div>
                    )}
                    {field.type === 'table' && (
                        <div className="w-full border border-slate-200 rounded overflow-hidden">
                            <div className="bg-slate-100 p-2 text-[0.8em] font-bold text-slate-600 border-b border-slate-200">Line Items Table</div>
                            <div className="p-4 text-center text-slate-400 text-[0.7em] italic">
                                [Dynamic Product Rows Will Appear Here]
                            </div>
                        </div>
                    )}
                </div>

                {/* Floating Controls */}
                {isSelected && !previewMode && (
                    <div className="absolute -top-3 -right-3 flex gap-1 bg-slate-800 text-white p-1 rounded-lg shadow-xl z-20 scale-90">
                        <button onClick={(e) => { e.stopPropagation(); moveField(index, 'up'); }} className="p-1 hover:bg-slate-700 rounded"><ArrowUp size={12}/></button>
                        <button onClick={(e) => { e.stopPropagation(); moveField(index, 'down'); }} className="p-1 hover:bg-slate-700 rounded"><ArrowDown size={12}/></button>
                        <button onClick={(e) => { e.stopPropagation(); removeField(field.id); }} className="p-1 hover:bg-red-600 rounded bg-red-500"><Trash2 size={12}/></button>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="h-[calc(100vh-6rem)] flex flex-col bg-slate-100 overflow-hidden">
            
            {/* --- Top Bar --- */}
            <div className="bg-slate-900 text-white px-4 py-2 flex justify-between items-center shadow-md z-20 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="bg-blue-600 p-1.5 rounded-lg"><LayoutTemplate size={18}/></div>
                    <div>
                        <input 
                            value={currentLayout.name} 
                            onChange={e => setCurrentLayout({...currentLayout, name: e.target.value})}
                            className="bg-transparent border-none text-sm font-bold focus:ring-0 p-0 w-64 placeholder-slate-500 focus:bg-slate-800 rounded px-2 transition-colors"
                            placeholder="Form Name (Required)"
                        />
                        <div className="text-[10px] text-slate-400 flex gap-2 px-2">
                             <span>{currentLayout.fields.length} elements</span>
                             <span>•</span>
                             <span>A4 Size</span>
                        </div>
                    </div>
                </div>
                
                <div className="flex items-center gap-2">
                    <select 
                        value={currentLayout.id}
                        onChange={(e) => {
                            if (e.target.value === 'new') {
                                setCurrentLayout({ id: 'new', name: 'New Template', type: 'PROFORMA', fields: [] });
                            } else {
                                const l = layouts.find(x => x.id === e.target.value);
                                if (l) setCurrentLayout(l);
                            }
                        }}
                        className="bg-slate-800 border-none text-xs rounded px-3 py-1.5 text-slate-300"
                    >
                        <option value="new">+ New</option>
                        {layouts.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>

                    <button onClick={() => setPreviewMode(!previewMode)} className={`p-2 rounded hover:bg-slate-800 ${previewMode ? 'text-blue-400' : 'text-slate-400'}`} title="Preview">
                        <Eye size={18}/>
                    </button>
                    <button 
                        onClick={handleSave} 
                        disabled={isSaving}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm font-bold flex items-center gap-2"
                    >
                        {isSaving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} Save
                    </button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                
                {/* --- Left Sidebar (Tools) --- */}
                <div className="w-72 bg-slate-900 border-r border-slate-800 flex flex-col z-10 shrink-0">
                    <div className="flex border-b border-slate-800">
                        <button onClick={() => setActiveTab('ELEMENTS')} className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-2 ${activeTab === 'ELEMENTS' ? 'text-white bg-slate-800 border-b-2 border-blue-500' : 'text-slate-500 hover:text-slate-300'}`}><Box size={14}/> Elements</button>
                        <button onClick={() => setActiveTab('DATA')} className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-2 ${activeTab === 'DATA' ? 'text-white bg-slate-800 border-b-2 border-blue-500' : 'text-slate-500 hover:text-slate-300'}`}><Database size={14}/> Data</button>
                        <button onClick={() => setActiveTab('AI')} className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-2 ${activeTab === 'AI' ? 'text-white bg-slate-800 border-b-2 border-blue-500' : 'text-slate-500 hover:text-slate-300'}`}><Sparkles size={14}/> AI</button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        {activeTab === 'ELEMENTS' && (
                            <div className="space-y-4">
                                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Branding</p>
                                <div className="grid grid-cols-1 gap-2">
                                     <button onClick={() => addField('company_logo', 'Company Logo')} className="flex items-center gap-3 p-3 bg-slate-800 rounded hover:bg-slate-700 border border-slate-700 transition-colors">
                                        <div className="bg-pink-600 p-1.5 rounded text-white"><Building size={16}/></div>
                                        <div className="text-left">
                                            <span className="text-xs text-white block font-bold">Company Logo</span>
                                            <span className="text-[10px] text-slate-400">Auto-fetched from settings</span>
                                        </div>
                                    </button>
                                </div>

                                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mt-2">Basic Content</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => addField('header', 'Header Text')} className="flex flex-col items-center justify-center p-3 bg-slate-800 rounded hover:bg-slate-700 border border-slate-700 transition-colors">
                                        <Type size={20} className="text-white mb-2"/>
                                        <span className="text-[10px] text-slate-300">Header</span>
                                    </button>
                                    <button onClick={() => addField('text', 'Text Input')} className="flex flex-col items-center justify-center p-3 bg-slate-800 rounded hover:bg-slate-700 border border-slate-700 transition-colors">
                                        <TypeIcon size={20} className="text-white mb-2"/>
                                        <span className="text-[10px] text-slate-300">Text Field</span>
                                    </button>
                                    <button onClick={() => addField('textarea', 'Text Area')} className="flex flex-col items-center justify-center p-3 bg-slate-800 rounded hover:bg-slate-700 border border-slate-700 transition-colors">
                                        <AlignLeft size={20} className="text-white mb-2"/>
                                        <span className="text-[10px] text-slate-300">Text Area</span>
                                    </button>
                                    <button onClick={() => addField('image', 'Image Placeholder')} className="flex flex-col items-center justify-center p-3 bg-slate-800 rounded hover:bg-slate-700 border border-slate-700 transition-colors">
                                        <ImageIcon size={20} className="text-white mb-2"/>
                                        <span className="text-[10px] text-slate-300">Image</span>
                                    </button>
                                </div>
                                
                                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mt-4">Structure</p>
                                <div className="grid grid-cols-2 gap-2">
                                     <button onClick={() => addField('separator', 'Line')} className="flex flex-col items-center justify-center p-3 bg-slate-800 rounded hover:bg-slate-700 border border-slate-700 transition-colors">
                                        <Minus size={20} className="text-white mb-2"/>
                                        <span className="text-[10px] text-slate-300">Divider</span>
                                    </button>
                                    <button onClick={() => addField('table', 'Items Table')} className="flex flex-col items-center justify-center p-3 bg-slate-800 rounded hover:bg-slate-700 border border-slate-700 transition-colors">
                                        <List size={20} className="text-white mb-2"/>
                                        <span className="text-[10px] text-slate-300">Items Table</span>
                                    </button>
                                    <button onClick={() => addField('signature', 'Sign Here')} className="flex flex-col items-center justify-center p-3 bg-slate-800 rounded hover:bg-slate-700 border border-slate-700 transition-colors">
                                        <Check size={20} className="text-white mb-2"/>
                                        <span className="text-[10px] text-slate-300">Signature</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'DATA' && (
                            <div className="space-y-6">
                                {DB_SCHEMA.map((group, idx) => (
                                    <div key={idx}>
                                        <div className="flex items-center gap-2 text-slate-400 mb-2">
                                            <group.icon size={14}/>
                                            <span className="text-xs font-bold uppercase">{group.label}</span>
                                        </div>
                                        <div className="space-y-1">
                                            {group.fields.map(field => (
                                                <button 
                                                    key={field.key}
                                                    onClick={() => addField('text', field.label, `${group.table}.${field.key}`)}
                                                    className="w-full text-left p-2 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 flex items-center gap-2 border border-slate-700/50 group"
                                                >
                                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 group-hover:scale-125 transition-transform"></div>
                                                    {field.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {activeTab === 'AI' && (
                            <div className="flex flex-col h-full">
                                <div className="flex-1 space-y-4">
                                     {messages.map((msg, idx) => (
                                        <div key={idx} className={`text-xs p-3 rounded-lg ${msg.role === 'user' ? 'bg-blue-600 text-white ml-4' : 'bg-slate-800 text-slate-300 mr-4'}`}>
                                            {msg.text}
                                        </div>
                                    ))}
                                    {isThinking && <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={12} className="animate-spin"/> Thinking...</div>}
                                    <div ref={chatEndRef}/>
                                </div>
                                <div className="mt-4 pt-4 border-t border-slate-800 relative">
                                    <input 
                                        className="w-full bg-slate-800 text-white text-xs rounded-lg pl-3 pr-10 py-3 border border-slate-700 focus:border-blue-500 outline-none"
                                        placeholder="Ask Copilot..."
                                        value={chatInput}
                                        onChange={e => setChatInput(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAiSend()}
                                    />
                                    <button onClick={handleAiSend} className="absolute right-2 top-1/2 mt-2 -translate-y-1/2 text-slate-400 hover:text-white p-1">
                                        <Send size={14}/>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* --- Main Canvas --- */}
                <div className="flex-1 bg-slate-100 overflow-auto flex justify-center p-8 relative" onClick={() => setSelectedFieldId(null)}>
                    {/* The A4 Paper */}
                    <div 
                        className={`bg-white shadow-2xl transition-all duration-300 relative ${previewMode ? 'scale-100' : 'scale-[0.85] origin-top'}`}
                        style={{ width: '210mm', minHeight: '297mm', padding: '20mm' }}
                    >
                        {/* Placeholder Grid BG if in edit mode */}
                        {!previewMode && (
                            <div className="absolute inset-0 pointer-events-none opacity-5" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '20px 20px' }}></div>
                        )}

                        <div className="flex flex-col h-full relative z-10">
                            {currentLayout.fields.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-slate-300 border-2 border-dashed border-slate-100 rounded-xl m-10">
                                    <LayoutTemplate size={64} className="mb-4 opacity-50"/>
                                    <p className="text-lg font-medium">Empty Canvas</p>
                                    <p className="text-sm">Drag elements from the sidebar</p>
                                </div>
                            ) : (
                                currentLayout.fields.map((field, idx) => renderCanvasField(field, idx))
                            )}
                        </div>
                    </div>
                </div>

                {/* --- Right Inspector Panel --- */}
                {selectedField && !previewMode && (
                    <div className="w-72 bg-white border-l border-slate-200 flex flex-col shrink-0 z-10 animate-in slide-in-from-right-4">
                        <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="font-bold text-slate-800 text-sm">Properties</h3>
                            <button onClick={() => setSelectedFieldId(null)}><X size={16} className="text-slate-400 hover:text-slate-600"/></button>
                        </div>
                        
                        <div className="p-4 space-y-6 overflow-y-auto flex-1">
                            {/* Content */}
                            <div>
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Content</h4>
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-medium text-slate-600 mb-1">Label / Text</label>
                                        <input 
                                            className="w-full border border-slate-300 rounded p-1.5 text-sm" 
                                            value={selectedField.label}
                                            onChange={e => updateField(selectedField.id, { label: e.target.value })}
                                        />
                                    </div>
                                    {(selectedField.type === 'text' || selectedField.type === 'textarea') && (
                                        <div>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">Placeholder</label>
                                            <input 
                                                className="w-full border border-slate-300 rounded p-1.5 text-sm" 
                                                value={selectedField.placeholder || ''}
                                                onChange={e => updateField(selectedField.id, { placeholder: e.target.value })}
                                            />
                                        </div>
                                    )}
                                     <div>
                                        <label className="block text-xs font-medium text-slate-600 mb-1">Data Mapping</label>
                                        <select 
                                            className="w-full border border-slate-300 rounded p-1.5 text-xs bg-slate-50"
                                            value={selectedField.dataSource || ''}
                                            onChange={e => updateField(selectedField.id, { dataSource: e.target.value })}
                                        >
                                            <option value="">-- None (Static) --</option>
                                            {DB_SCHEMA.flatMap(g => g.fields.map(f => (
                                                <option key={`${g.table}.${f.key}`} value={`${g.table}.${f.key}`}>
                                                    {g.label}: {f.label}
                                                </option>
                                            )))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Appearance */}
                            <div>
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Appearance</h4>
                                <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">Font Size</label>
                                            <input 
                                                type="number"
                                                className="w-full border border-slate-300 rounded p-1.5 text-sm" 
                                                value={selectedField.style.fontSize}
                                                onChange={e => updateFieldStyle(selectedField.id, { fontSize: Number(e.target.value) })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-600 mb-1">Width</label>
                                            <select 
                                                className="w-full border border-slate-300 rounded p-1.5 text-sm"
                                                value={selectedField.style.width}
                                                onChange={e => updateFieldStyle(selectedField.id, { width: e.target.value })}
                                            >
                                                <option value="100%">100%</option>
                                                <option value="75%">75%</option>
                                                <option value="66%">66%</option>
                                                <option value="50%">50%</option>
                                                <option value="33%">33%</option>
                                                <option value="25%">25%</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-slate-600 mb-1">Alignment</label>
                                        <div className="flex border border-slate-200 rounded overflow-hidden">
                                            <button onClick={() => updateFieldStyle(selectedField.id, { textAlign: 'left' })} className={`flex-1 p-1.5 hover:bg-slate-50 ${selectedField.style.textAlign === 'left' ? 'bg-blue-50 text-blue-600' : 'text-slate-500'}`}><AlignLeft size={14} className="mx-auto"/></button>
                                            <button onClick={() => updateFieldStyle(selectedField.id, { textAlign: 'center' })} className={`flex-1 p-1.5 hover:bg-slate-50 ${selectedField.style.textAlign === 'center' ? 'bg-blue-50 text-blue-600' : 'text-slate-500'}`}><AlignCenter size={14} className="mx-auto"/></button>
                                            <button onClick={() => updateFieldStyle(selectedField.id, { textAlign: 'right' })} className={`flex-1 p-1.5 hover:bg-slate-50 ${selectedField.style.textAlign === 'right' ? 'bg-blue-50 text-blue-600' : 'text-slate-500'}`}><AlignRight size={14} className="mx-auto"/></button>
                                        </div>
                                    </div>
                                    
                                     <div>
                                        <label className="block text-xs font-medium text-slate-600 mb-1">Weight</label>
                                        <div className="flex border border-slate-200 rounded overflow-hidden">
                                            <button onClick={() => updateFieldStyle(selectedField.id, { fontWeight: 'normal' })} className={`flex-1 p-1.5 hover:bg-slate-50 ${selectedField.style.fontWeight === 'normal' ? 'bg-blue-50 text-blue-600' : 'text-slate-500'}`}><TypeIcon size={14} className="mx-auto"/></button>
                                            <button onClick={() => updateFieldStyle(selectedField.id, { fontWeight: 'bold' })} className={`flex-1 p-1.5 hover:bg-slate-50 ${selectedField.style.fontWeight === 'bold' ? 'bg-blue-50 text-blue-600' : 'text-slate-500'}`}><Bold size={14} className="mx-auto"/></button>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-medium text-slate-600 mb-1">Text Color</label>
                                        <div className="flex gap-2">
                                            {['#1e293b', '#64748b', '#ef4444', '#3b82f6', '#10b981'].map(color => (
                                                <button 
                                                    key={color}
                                                    onClick={() => updateFieldStyle(selectedField.id, { color })}
                                                    className={`w-6 h-6 rounded-full border ${selectedField.style.color === color ? 'ring-2 ring-offset-1 ring-slate-400' : 'border-slate-200'}`}
                                                    style={{ backgroundColor: color }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="pt-4 border-t border-slate-100">
                                <button onClick={() => removeField(selectedField.id)} className="w-full py-2 bg-red-50 text-red-600 text-xs font-bold rounded hover:bg-red-100 flex items-center justify-center gap-2">
                                    <Trash2 size={14}/> Delete Element
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default FormBuilder;
