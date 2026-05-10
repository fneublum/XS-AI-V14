
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Mail, MessageCircle, Send, Loader2, Wifi, RefreshCw, Search, Plus,
    Check, CheckCheck, Clock, AlertCircle, X, Trash2, Eraser, Sparkles
} from 'lucide-react';
import { getSupabaseClient } from '../services/supabase';
import { invokeEdgeFunction } from '../services/edgeAuth';
import { BillOfLading, Booking, Estimate, ProformaInvoice, PurchaseOrderExtract, Invoice, PackingList, SupplierInvoice, Port } from '../types';

// ─── Lazy import of AiEmailAssistant ────────────────────────────────
const MyMailProcessorPage = React.lazy(() => import('./MyMailProcessorPage'));
const EmailBriefing = React.lazy(() => import('./EmailBriefing'));

// ─── Twilio credential cache ────────────────────────────────────────
const TWILIO_CACHE_TTL = 5 * 60 * 1000;
let twilioCredsCache: { accountSid: string; authToken: string; phoneNumber: string } | null = null;
let twilioCacheTimestamp = 0;

const TEMPLATE_NAME = 'hall_notification_template';

async function getTwilioCreds(): Promise<{ accountSid: string; authToken: string; phoneNumber: string } | null> {
    const now = Date.now();
    if (twilioCredsCache && (now - twilioCacheTimestamp) < TWILIO_CACHE_TTL) {
        return twilioCredsCache;
    }
    try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', 'twilio_credentials')
            .single();
        if (error || !data?.value) return null;
        const creds = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        twilioCredsCache = { accountSid: creds.accountSid, authToken: creds.authToken, phoneNumber: creds.phoneNumber };
        twilioCacheTimestamp = now;
        return twilioCredsCache;
    } catch {
        return null;
    }
}

// ─── Interfaces (camelCase matching main Supabase schema) ───────────
interface Conversation {
    id: string;
    companyId: string;
    twilioNumber: string;
    phoneNumber: string;
    contactName: string;
    status: string;
    unreadCount: number;
    lastMessagePreview: string;
    lastMessageAt: string;
    createdAt: string;
}

interface WaMessage {
    id: string;
    conversationId: string;
    content: string;
    direction: 'inbound' | 'outbound';
    messageType: string;
    status: string;
    twilioSid: string;
    metadata: any;
    createdAt: string;
}

interface ConnectionsHubProps {
    onNavigate?: (module: string, subModule: string) => void;
    onSaveBL?: (data: BillOfLading) => Promise<void> | void;
    onSaveBooking?: (data: Booking) => Promise<void> | void;
    onSaveEstimate?: (data: Estimate) => Promise<void> | void;
    onSaveProforma?: (data: ProformaInvoice) => Promise<void> | void;
    onSavePO?: (data: PurchaseOrderExtract) => Promise<void> | void;
    onSaveInvoice?: (data: Invoice) => Promise<void> | void;
    onSaveSupplierInvoice?: (data: SupplierInvoice) => Promise<void> | void;
    onSavePackingList?: (data: PackingList) => Promise<void> | void;
    currentCompanyId?: string;
    ports?: Port[];
    currentUser?: any;
}

type ActiveTab = 'email' | 'whatsapp' | 'briefing';

// ─── Helpers ────────────────────────────────────────────────────────
const formatChatTime = (dateStr: string): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatMessageTime = (dateStr: string): string => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const getInitialBg = (name: string): string => {
    const colors = [
        'bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-orange-500',
        'bg-pink-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-teal-500',
        'bg-amber-500', 'bg-rose-500'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
};

const getInitials = (name: string): string => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const POLL_INTERVAL = 8000;

// ─── WhatsApp Panel Component ───────────────────────────────────────
export const WhatsAppPanel: React.FC<{ currentUser?: any; currentCompanyId?: string }> = ({ currentUser, currentCompanyId }) => {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
    const [messages, setMessages] = useState<WaMessage[]>([]);
    const [input, setInput] = useState('');
    const [isSending, setIsSending] = useState(false);
    const [isLoadingConvs, setIsLoadingConvs] = useState(true);
    const [isLoadingMsgs, setIsLoadingMsgs] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [twilioConnected, setTwilioConnected] = useState(false);
    const [twilioPhone, setTwilioPhone] = useState('');
    const [showNewChat, setShowNewChat] = useState(false);
    const [newChatPhone, setNewChatPhone] = useState('');
    const [newChatName, setNewChatName] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastMsgRef = useRef<string | null>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (selectedConv) inputRef.current?.focus();
    }, [selectedConv]);

    // Init: check Twilio, then load conversations
    useEffect(() => {
        const init = async () => {
            const creds = await getTwilioCreds();
            setTwilioConnected(!!creds);
            if (creds?.phoneNumber) setTwilioPhone(creds.phoneNumber);
            await loadConversations();
        };
        init();
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, []);

    // Poll for new messages
    useEffect(() => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        if (selectedConv) {
            pollRef.current = setInterval(() => pollMessages(selectedConv.id), POLL_INTERVAL);
        }
        return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
    }, [selectedConv?.id]);

    const checkTwilio = async () => {
        const creds = await getTwilioCreds();
        setTwilioConnected(!!creds);
        if (creds?.phoneNumber) setTwilioPhone(creds.phoneNumber);
    };

    const loadConversations = async () => {
        setIsLoadingConvs(true);
        try {
            const creds = await getTwilioCreds();
            const phone = creds?.phoneNumber || twilioPhone;
            if (!phone) { setIsLoadingConvs(false); return; }

            const sb = getSupabaseClient();
            const { data, error } = await sb
                .from('wa_conversations')
                .select('*')
                .eq('twilioNumber', phone)
                .order('lastMessageAt', { ascending: false })
                .limit(100);
            if (!error && data) {
                setConversations(data);
            }
        } catch {
            // Silent
        }
        setIsLoadingConvs(false);
    };

    const loadMessages = async (conversationId: string) => {
        setIsLoadingMsgs(true);
        try {
            const sb = getSupabaseClient();
            const { data, error } = await sb
                .from('wa_messages')
                .select('*')
                .eq('conversationId', conversationId)
                .order('createdAt', { ascending: true })
                .limit(200);
            if (!error && data) {
                setMessages(data);
                if (data.length > 0) lastMsgRef.current = data[data.length - 1].id;
            }
        } catch {
            // Silent
        }
        setIsLoadingMsgs(false);
    };

    const pollMessages = useCallback(async (conversationId: string) => {
        try {
            const sb = getSupabaseClient();
            const { data, error } = await sb
                .from('wa_messages')
                .select('*')
                .eq('conversationId', conversationId)
                .order('createdAt', { ascending: true })
                .limit(200);
            if (!error && data && data.length > 0) {
                const lastId = data[data.length - 1].id;
                if (lastId !== lastMsgRef.current) {
                    lastMsgRef.current = lastId;
                    setMessages(data);
                }
            }
            // Also refresh conversation list
            const creds = await getTwilioCreds();
            const phone = creds?.phoneNumber || '';
            if (phone) {
                const { data: convData } = await sb
                    .from('wa_conversations')
                    .select('*')
                    .eq('twilioNumber', phone)
                    .order('lastMessageAt', { ascending: false })
                    .limit(100);
                if (convData) setConversations(convData);
            }
        } catch {
            // Silent
        }
    }, []);

    const selectConversation = (conv: Conversation) => {
        setSelectedConv(conv);
        loadMessages(conv.id);
        markConversationRead(conv.id);
    };

    const markConversationRead = async (conversationId: string) => {
        try {
            const sb = getSupabaseClient();
            await sb.from('wa_conversations').update({ unreadCount: 0 }).eq('id', conversationId);
            setConversations(prev => prev.map(c => c.id === conversationId ? { ...c, unreadCount: 0 } : c));
        } catch {
            // Silent
        }
    };

    // Check if there's an active 24h WhatsApp session (last inbound msg within 24h)
    const hasActiveSession = useCallback((): boolean => {
        const lastInbound = messages.filter(m => m.direction === 'inbound').pop();
        if (!lastInbound) return false;
        const diff = Date.now() - new Date(lastInbound.createdAt).getTime();
        return diff < 24 * 60 * 60 * 1000; // 24 hours
    }, [messages]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || isSending || !selectedConv) return;

        const creds = await getTwilioCreds();
        if (!creds) {
            alert('Twilio credentials not configured. Go to Settings > Twilio Integration.');
            return;
        }

        setInput('');
        setIsSending(true);

        const tempId = crypto.randomUUID();
        const now = new Date().toISOString();
        const tempMsg: WaMessage = {
            id: tempId,
            conversationId: selectedConv.id,
            content: text,
            direction: 'outbound',
            messageType: 'text',
            status: 'sending',
            twilioSid: '',
            metadata: { source: 'xs-crm-whatsapp' },
            createdAt: now
        };
        // Gate outbound: WhatsApp only permits free-form `text` messages
        // inside the 24h session window opened by an inbound. Outside
        // it we'd need a pre-approved template — the previous
        // `hall_notification_template` path was removed after Meta
        // rejected the template. Surface a clear error instead of
        // silently failing.
        if (!hasActiveSession()) {
            setInput(text);
            setIsSending(false);
            alert(
                `Cannot send: no active 24h WhatsApp session with this contact.\n\n` +
                `WhatsApp requires the contact to message you first to open the session. ` +
                `To send cold outbound you'd need an approved template in Meta Business Manager.`,
            );
            return;
        }

        setMessages(prev => [...prev, tempMsg]);

        try {
            const sb = getSupabaseClient();
            const toNumber = selectedConv.phoneNumber.startsWith('+')
                ? selectedConv.phoneNumber
                : `+${selectedConv.phoneNumber}`;

            let waData: any;
            try {
                waData = await invokeEdgeFunction('whatsapp-send', {
                    method: 'POST',
                    body: { to: toNumber, text },
                });
            } catch (err: any) {
                throw new Error(err?.message || `Meta WhatsApp API error`);
            }

            const messageSid = waData?.data?.messages?.[0]?.id || crypto.randomUUID();

            // Save to main Supabase
            await sb.from('wa_messages').insert({
                id: tempId,
                conversationId: selectedConv.id,
                content: text,
                direction: 'outbound',
                messageType: 'text',
                status: 'sent',
                twilioSid: messageSid,
                metadata: { source: 'xs-crm-whatsapp' },
                createdAt: now
            });

            // Update conversation
            await sb.from('wa_conversations').update({
                lastMessageAt: now,
                lastMessagePreview: text.substring(0, 100)
            }).eq('id', selectedConv.id);

            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'sent', twilioSid: messageSid } : m));

        } catch (err: any) {
            setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'error' } : m));
            console.log('WhatsApp send error:', err.message);
        }

        setIsSending(false);
        inputRef.current?.focus();
    };

    const handleNewChat = async () => {
        if (!newChatPhone.trim()) return;

        const creds = await getTwilioCreds();
        if (!creds) return;

        const phone = newChatPhone.trim().startsWith('+') ? newChatPhone.trim() : `+${newChatPhone.trim()}`;
        const name = newChatName.trim() || phone;

        try {
            const sb = getSupabaseClient();

            // Check if conversation exists
            const { data: existing } = await sb
                .from('wa_conversations')
                .select('*')
                .eq('phoneNumber', phone)
                .eq('twilioNumber', creds.phoneNumber)
                .limit(1);

            if (existing && existing.length > 0) {
                setSelectedConv(existing[0]);
                loadMessages(existing[0].id);
                setShowNewChat(false);
                setNewChatPhone('');
                setNewChatName('');
                return;
            }

            const newId = crypto.randomUUID();
            const now = new Date().toISOString();
            const { error } = await sb.from('wa_conversations').insert({
                id: newId,
                companyId: currentCompanyId || '',
                twilioNumber: creds.phoneNumber,
                phoneNumber: phone,
                contactName: name,
                status: 'active',
                unreadCount: 0,
                lastMessagePreview: '',
                lastMessageAt: now,
                createdAt: now
            });

            if (!error) {
                const newConv: Conversation = {
                    id: newId,
                    companyId: currentCompanyId || '',
                    twilioNumber: creds.phoneNumber,
                    phoneNumber: phone,
                    contactName: name,
                    status: 'active',
                    unreadCount: 0,
                    lastMessagePreview: '',
                    lastMessageAt: now,
                    createdAt: now
                };
                setConversations(prev => [newConv, ...prev]);
                setSelectedConv(newConv);
                setMessages([]);
            }
        } catch {
            // Silent
        }

        setShowNewChat(false);
        setNewChatPhone('');
    };

    const clearConversationMessages = async (conv: Conversation, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm(`Clear all messages with ${conv.contactName || conv.phoneNumber}?`)) return;
        try {
            const sb = getSupabaseClient();
            await sb.from('wa_messages').delete().eq('conversationId', conv.id);
            await sb.from('wa_conversations').update({ lastMessagePreview: '', unreadCount: 0 }).eq('id', conv.id);
            setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, lastMessagePreview: '', unreadCount: 0 } : c));
            if (selectedConv?.id === conv.id) setMessages([]);
        } catch { /* Silent */ }
    };

    const deleteConversation = async (conv: Conversation, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm(`Delete entire conversation with ${conv.contactName || conv.phoneNumber}? This will remove all messages permanently.`)) return;
        try {
            const sb = getSupabaseClient();
            await sb.from('wa_messages').delete().eq('conversationId', conv.id);
            await sb.from('wa_conversations').delete().eq('id', conv.id);
            setConversations(prev => prev.filter(c => c.id !== conv.id));
            if (selectedConv?.id === conv.id) {
                setSelectedConv(null);
                setMessages([]);
            }
        } catch { /* Silent */ }
        setNewChatName('');
    };

    const filteredConversations = searchQuery
        ? conversations.filter(c =>
            c.contactName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.phoneNumber?.includes(searchQuery) ||
            c.lastMessagePreview?.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : conversations;

    const groupedMessages = messages.reduce<{ date: string; msgs: WaMessage[] }[]>((acc, msg) => {
        const dateStr = new Date(msg.createdAt).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        const last = acc[acc.length - 1];
        if (last && last.date === dateStr) { last.msgs.push(msg); }
        else { acc.push({ date: dateStr, msgs: [msg] }); }
        return acc;
    }, []);

    // ─── Not configured state ───
    if (!twilioConnected && !isLoadingConvs) {
        return (
            <div className="h-full flex items-center justify-center bg-slate-50">
                <div className="text-center max-w-sm">
                    <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
                        <MessageCircle size={36} className="text-green-600" />
                    </div>
                    <h2 className="text-lg font-semibold text-slate-800 mb-2">WhatsApp Not Configured</h2>
                    <p className="text-sm text-slate-500 mb-6">
                        Configure your Twilio credentials to send and receive WhatsApp messages.
                    </p>
                    <button onClick={checkTwilio} className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors">
                        Check Connection
                    </button>
                    <p className="text-xs text-slate-400 mt-3">Go to Settings → Twilio Integration to set up credentials</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex overflow-hidden">

            {/* ── Left Panel: Conversation List ── */}
            <div className="w-[340px] shrink-0 flex flex-col border-r border-slate-200 bg-white">

                {/* Header */}
                <div className="shrink-0 px-4 py-3 border-b border-slate-200 bg-white">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
                                <MessageCircle size={16} className="text-white" />
                            </div>
                            <div>
                                <h2 className="text-sm font-semibold text-slate-800">WhatsApp</h2>
                                <p className="text-[10px] text-slate-400 flex items-center gap-1">
                                    <Wifi size={8} className="text-green-500" /> {twilioPhone || 'Twilio Connected'}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <button onClick={() => setShowNewChat(true)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-green-600 transition-colors" title="New chat">
                                <Plus size={16} />
                            </button>
                            <button onClick={loadConversations} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors" title="Refresh">
                                <RefreshCw size={14} />
                            </button>
                        </div>
                    </div>
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search conversations..."
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700 placeholder-slate-400 outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400/30 transition-all" />
                    </div>
                </div>

                {/* New Chat Dialog */}
                {showNewChat && (
                    <div className="shrink-0 px-4 py-3 bg-green-50 border-b border-green-200">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-green-800">New Conversation</span>
                            <button onClick={() => setShowNewChat(false)} className="text-green-600 hover:text-green-800"><X size={14} /></button>
                        </div>
                        <input type="text" value={newChatPhone} onChange={(e) => setNewChatPhone(e.target.value)} placeholder="Phone number (e.g. +1234567890)"
                            className="w-full px-3 py-1.5 mb-2 bg-white border border-green-300 rounded-md text-sm text-slate-700 outline-none focus:border-green-500" />
                        <input type="text" value={newChatName} onChange={(e) => setNewChatName(e.target.value)} placeholder="Contact name (optional)"
                            className="w-full px-3 py-1.5 mb-2 bg-white border border-green-300 rounded-md text-sm text-slate-700 outline-none focus:border-green-500" />
                        <button onClick={handleNewChat} disabled={!newChatPhone.trim()}
                            className="w-full px-3 py-1.5 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 disabled:opacity-40 transition-colors">
                            Start Chat
                        </button>
                    </div>
                )}

                {/* Conversation List */}
                <div className="flex-1 overflow-y-auto min-h-0">
                    {isLoadingConvs ? (
                        <div className="flex items-center justify-center h-40"><Loader2 size={20} className="text-green-500 animate-spin" /></div>
                    ) : filteredConversations.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-center px-4">
                            <MessageCircle size={24} className="text-slate-300 mb-2" />
                            <p className="text-xs text-slate-400">No conversations yet</p>
                            <button onClick={() => setShowNewChat(true)} className="mt-2 text-xs text-green-600 hover:text-green-700">Start a new chat</button>
                        </div>
                    ) : (
                        filteredConversations.map(conv => (
                            <div key={conv.id} onClick={() => selectConversation(conv)}
                                className={`group/conv flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-slate-100 transition-colors ${selectedConv?.id === conv.id ? 'bg-green-50' : 'hover:bg-slate-50'}`}>
                                <div className={`w-10 h-10 rounded-full ${getInitialBg(conv.contactName || conv.phoneNumber)} flex items-center justify-center shrink-0`}>
                                    <span className="text-white text-sm font-semibold">{getInitials(conv.contactName || conv.phoneNumber)}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                        <span className={`text-sm truncate ${conv.unreadCount > 0 ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>
                                            {conv.contactName || conv.phoneNumber}
                                        </span>
                                        <div className="flex items-center gap-1 shrink-0 ml-2">
                                            <div className="hidden group-hover/conv:flex items-center gap-0.5">
                                                <button onClick={(e) => clearConversationMessages(conv, e)} className="p-1 rounded hover:bg-amber-100 text-slate-300 hover:text-amber-600 transition-colors" title="Clear messages">
                                                    <Eraser size={12} />
                                                </button>
                                                <button onClick={(e) => deleteConversation(conv, e)} className="p-1 rounded hover:bg-red-100 text-slate-300 hover:text-red-500 transition-colors" title="Delete conversation">
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                            <span className="text-[10px] text-slate-400 group-hover/conv:hidden">{formatChatTime(conv.lastMessageAt)}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs text-slate-400 truncate pr-2">{conv.lastMessagePreview || 'No messages'}</p>
                                        {conv.unreadCount > 0 && (
                                            <span className="shrink-0 w-5 h-5 rounded-full bg-green-500 text-white text-[10px] flex items-center justify-center font-bold">
                                                {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* ── Right Panel: Chat Window ── */}
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
                {selectedConv ? (
                    <>
                        {/* Chat Header */}
                        <div className="shrink-0 px-4 py-3 flex items-center justify-between border-b border-slate-200 bg-white">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full ${getInitialBg(selectedConv.contactName || selectedConv.phoneNumber)} flex items-center justify-center`}>
                                    <span className="text-white text-sm font-semibold">{getInitials(selectedConv.contactName || selectedConv.phoneNumber)}</span>
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-slate-800">{selectedConv.contactName || selectedConv.phoneNumber}</h3>
                                    <p className="text-[11px] text-slate-400">{selectedConv.phoneNumber}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-1">
                                <button onClick={(e) => clearConversationMessages(selectedConv, e)} className="p-2 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition-colors" title="Clear messages">
                                    <Eraser size={14} />
                                </button>
                                <button onClick={(e) => deleteConversation(selectedConv, e)} className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors" title="Delete conversation">
                                    <Trash2 size={14} />
                                </button>
                                <button onClick={() => pollMessages(selectedConv.id)} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors" title="Refresh messages">
                                    <RefreshCw size={14} />
                                </button>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4"
                            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23e2e8f0\' fill-opacity=\'0.3\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }}>

                            {isLoadingMsgs ? (
                                <div className="flex items-center justify-center h-full"><Loader2 size={24} className="text-green-500 animate-spin" /></div>
                            ) : messages.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center opacity-60">
                                    <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-3"><Send size={24} className="text-green-500" /></div>
                                    <p className="text-sm text-slate-500 font-medium">No messages yet</p>
                                    <p className="text-xs text-slate-400 mt-1">Send a WhatsApp message to start the conversation</p>
                                </div>
                            ) : (
                                groupedMessages.map((group, gi) => (
                                    <div key={gi}>
                                        <div className="flex items-center justify-center my-4">
                                            <span className="px-3 py-1 bg-white rounded-lg shadow-sm text-[10px] text-slate-500 font-medium">{group.date}</span>
                                        </div>
                                        {group.msgs.map((msg) => (
                                            <div key={msg.id} className={`flex mb-1.5 ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[65%] px-3 py-2 rounded-lg shadow-sm text-sm ${msg.direction === 'outbound' ? 'bg-green-100 text-slate-800 rounded-tr-none' : 'bg-white text-slate-700 rounded-tl-none'
                                                    }`}>
                                                    <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>
                                                    <div className={`flex items-center gap-1 mt-0.5 ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                                                        <span className="text-[10px] text-slate-400">{formatMessageTime(msg.createdAt)}</span>
                                                        {msg.direction === 'outbound' && (
                                                            <span className="text-[10px]">
                                                                {msg.status === 'sending' ? <Clock size={10} className="text-slate-400" /> :
                                                                    msg.status === 'error' ? <AlertCircle size={10} className="text-red-400" /> :
                                                                        msg.status === 'delivered' ? <CheckCheck size={10} className="text-blue-500" /> :
                                                                            <Check size={10} className="text-slate-400" />}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ))
                            )}

                            {isSending && (
                                <div className="flex justify-end mb-1.5">
                                    <div className="bg-green-100 px-4 py-3 rounded-lg rounded-tr-none shadow-sm">
                                        <span className="flex gap-1">
                                            <span className="w-2 h-2 bg-green-500 rounded-full animate-bounce" />
                                            <span className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                                            <span className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                                        </span>
                                    </div>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Input Bar */}
                        <div className="shrink-0 px-4 py-3 border-t border-slate-200 bg-white">
                            <div className="flex items-center gap-3">
                                <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                    placeholder="Type a message..." disabled={isSending}
                                    className="flex-1 bg-slate-50 border border-slate-300 text-slate-900 placeholder-slate-400 rounded-full px-5 py-2.5 text-sm outline-none focus:border-green-500 focus:ring-2 focus:ring-green-500/20 transition-all disabled:opacity-50" />
                                <button onClick={handleSend} disabled={!input.trim() || isSending}
                                    className="w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-green-600 hover:bg-green-500 shadow-md active:scale-95">
                                    {isSending ? <Loader2 size={16} className="text-white animate-spin" /> : <Send size={16} className="text-white" />}
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center bg-slate-50">
                        <div className="w-24 h-24 rounded-full bg-green-100/60 flex items-center justify-center mb-4">
                            <MessageCircle size={40} className="text-green-400" />
                        </div>
                        <h3 className="text-lg font-medium text-slate-600 mb-1">WhatsApp Business</h3>
                        <p className="text-sm text-slate-400 max-w-xs">
                            Send and receive messages via Twilio WhatsApp. Select a conversation or start a new one.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── Main ConnectionsHub Component ──────────────────────────────────
const ConnectionsHub: React.FC<ConnectionsHubProps> = (props) => {
    const [activeTab, setActiveTab] = useState<ActiveTab>('email');

    return (
        <div className="h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden">
            {/* Tab Bar */}
            <div className="shrink-0 flex items-center gap-0 bg-white border-b border-slate-200 px-4">
                <button onClick={() => setActiveTab('email')}
                    className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-all ${activeTab === 'email' ? 'border-violet-600 text-violet-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                        }`}>
                    <Mail size={16} /> Email
                </button>
                <button onClick={() => setActiveTab('whatsapp')}
                    className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-all ${activeTab === 'whatsapp' ? 'border-green-600 text-green-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                        }`}>
                    <MessageCircle size={16} /> WhatsApp
                </button>
                <button onClick={() => setActiveTab('briefing')}
                    className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-all ${activeTab === 'briefing' ? 'border-purple-600 text-purple-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                        }`}>
                    <Sparkles size={16} /> Briefing
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden min-h-0">
                {activeTab === 'email' ? (
                    <React.Suspense fallback={<div className="h-full flex items-center justify-center"><Loader2 size={24} className="text-violet-500 animate-spin" /></div>}>
                        <MyMailProcessorPage
                            onSaveBL={props.onSaveBL} onSaveBooking={props.onSaveBooking}
                            onSaveEstimate={props.onSaveEstimate} onSaveProforma={props.onSaveProforma} onSavePO={props.onSavePO}
                            onSaveInvoice={props.onSaveInvoice} onSaveSupplierInvoice={props.onSaveSupplierInvoice}
                            onSavePackingList={props.onSavePackingList} currentCompanyId={props.currentCompanyId}
                        />
                    </React.Suspense>
                ) : activeTab === 'whatsapp' ? (
                    <WhatsAppPanel currentUser={props.currentUser} currentCompanyId={props.currentCompanyId} />
                ) : (
                    <React.Suspense fallback={<div className="h-full flex items-center justify-center"><Loader2 size={24} className="text-purple-500 animate-spin" /></div>}>
                        <EmailBriefing />
                    </React.Suspense>
                )}
            </div>
        </div>
    );
};

export default ConnectionsHub;
