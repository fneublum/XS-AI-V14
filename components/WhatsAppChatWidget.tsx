
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, Send, Loader2, RefreshCw, ChevronDown, ChevronUp, Check, CheckCheck, Clock, Trash2, UploadCloud, Mail, LogIn, Plus, ArrowLeft, User, Phone, Search } from 'lucide-react';
import { getSupabaseClient } from '../services/supabase';
import { invokeEdgeFunction } from '../services/edgeAuth';

import { getAccountFor, loginFor, loginRequest, initializeMsal, getGoogleAccount, loginForGoogle } from '../services/smailAuth';

// ─── Config ─────────────────────────────────────────────────────────
const WA_NUMBER = '+19302007070';
const TEMPLATE_CONTENT_SID = 'HX1111f3f47537923173d927ab7f925ce8';

// ─── Types ──────────────────────────────────────────────────────────
interface WaMessage {
    id: string;
    conversationId: string;
    content: string;
    direction: 'inbound' | 'outbound';
    status: string;
    createdAt: string;
}

interface WaConversation {
    id: string;
    phoneNumber: string;
    contactName: string;
    lastMessageAt: string;
    lastMessagePreview: string;
    unreadCount?: number;
}

interface Props {
    currentCompanyId?: string;
    onOcrUpload?: (file: File) => void;
}

// ─── Component ──────────────────────────────────────────────────────
const WhatsAppChatWidget: React.FC<Props> = ({ currentCompanyId, onOcrUpload }) => {
    // ── Views: 'contacts' | 'chat' | 'addContact' ──
    const [view, setView] = useState<'contacts' | 'chat' | 'addContact'>('contacts');
    const [conversations, setConversations] = useState<WaConversation[]>([]);
    const [activeConv, setActiveConv] = useState<WaConversation | null>(null);
    const [messages, setMessages] = useState<WaMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    // Add contact form
    const [newContactName, setNewContactName] = useState('');
    const [newContactPhone, setNewContactPhone] = useState('');

    // Email auth
    const [emailLoggedIn, setEmailLoggedIn] = useState(false);
    const [emailAddress, setEmailAddress] = useState('');
    const [emailLoggingIn, setEmailLoggingIn] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const ocrFileRef = useRef<HTMLInputElement>(null);
    const realtimeRef = useRef<any>(null);

    const sb = getSupabaseClient();

    // ── Check email auth status ─────────────────────────────────────
    useEffect(() => {
        const checkEmail = async () => {
            try {
                await initializeMsal();
                const outlookAccount = getAccountFor('automation');
                if (outlookAccount) {
                    setEmailLoggedIn(true);
                    setEmailAddress(outlookAccount.username || '');
                    return;
                }
            } catch (e) { /* MSAL not ready */ }

            const googleAccount = getGoogleAccount();
            if (googleAccount) {
                setEmailLoggedIn(true);
                setEmailAddress(googleAccount.email || '');
                return;
            }

            setEmailLoggedIn(false);
        };
        checkEmail();
    }, []);

    const handleOutlookLogin = async () => {
        setEmailLoggingIn(true);
        try {
            await loginFor('automation', loginRequest.scopes);
        } catch (e: any) {
            if (e.message !== 'Redirecting') {
                console.error('Outlook login error:', e);
                setEmailLoggingIn(false);
            }
        }
    };

    const handleGmailLogin = async () => {
        setEmailLoggingIn(true);
        try {
            const result = await loginForGoogle();
            if (result.email) {
                setEmailLoggedIn(true);
                setEmailAddress(result.email);
            }
        } catch (e) {
            console.error('Gmail login error:', e);
        }
        setEmailLoggingIn(false);
    };

    // ── Load all conversations ──────────────────────────────────────
    const loadConversations = useCallback(async () => {
        setLoading(true);
        const { data } = await sb
            .from('wa_conversations')
            .select('id, phoneNumber, contactName, lastMessageAt, lastMessagePreview, unreadCount')
            .order('lastMessageAt', { ascending: false });
        if (data) setConversations(data);
        setLoading(false);
    }, [sb]);

    useEffect(() => { loadConversations(); }, [loadConversations]);

    // ── Real-time subscription for conversations list ────────────────
    useEffect(() => {
        const channel = sb
            .channel('wa-conv-list')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'wa_conversations',
            }, () => {
                loadConversations();
            })
            .subscribe();

        return () => { sb.removeChannel(channel); };
    }, [sb, loadConversations]);

    // ── Load messages for active conversation ───────────────────────
    const loadMessages = useCallback(async (cid: string) => {
        const { data } = await sb
            .from('wa_messages')
            .select('*')
            .eq('conversationId', cid)
            .order('createdAt', { ascending: true })
            .limit(100);
        if (data) setMessages(data);
    }, [sb]);

    // ── Real-time subscription for active conversation ──────────────
    useEffect(() => {
        if (!activeConv) return;

        loadMessages(activeConv.id);

        const channel = sb
            .channel(`wa-msg-${activeConv.id}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'wa_messages',
                filter: `conversationId=eq.${activeConv.id}`,
            }, (payload: any) => {
                const newMsg = payload.new as WaMessage;
                setMessages(prev => {
                    if (prev.some(m => m.id === newMsg.id)) return prev;
                    return [...prev, newMsg];
                });
                // Also refresh conversation list so sidebar shows latest preview
                loadConversations();
            })
            .subscribe();

        realtimeRef.current = channel;

        return () => { sb.removeChannel(channel); };
    }, [activeConv, sb, loadMessages, loadConversations]);

    // ── Polling fallback for messages (every 8s) ────────────────────
    useEffect(() => {
        if (!activeConv) return;
        const interval = setInterval(() => {
            loadMessages(activeConv.id);
        }, 8000);
        return () => clearInterval(interval);
    }, [activeConv, loadMessages]);

    // ── Auto-scroll ─────────────────────────────────────────────────
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // ── Clear messages ──────────────────────────────────────────────
    const clearMessages = useCallback(async () => {
        if (!activeConv || !confirm('Clear all messages?')) return;
        await sb.from('wa_messages').delete().eq('conversationId', activeConv.id);
        await sb.from('wa_conversations').update({ lastMessagePreview: '', unreadCount: 0 }).eq('id', activeConv.id);
        setMessages([]);
    }, [activeConv, sb]);

    // ── Send message via Twilio ─────────────────────────────────────
    // Phase 1c: goes through invokeEdgeFunction so the Supabase anon key
    // and server-issued user JWT come from env / sessionStorage — no more
    // hardcoded JWT in the bundle.
    const callWhatsAppSend = async (payload: any) => {
        try {
            const result = await invokeEdgeFunction('whatsapp-send', {
                method: 'POST',
                body: payload,
            });
            return { ok: true, result };
        } catch (err: any) {
            return { ok: false, result: { error: err?.message || String(err) } };
        }
    };

    // Check if we have a 24h session
    const hasActiveSession = useCallback(async (cid: string): Promise<boolean> => {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data } = await sb
            .from('wa_messages')
            .select('id')
            .eq('conversationId', cid)
            .eq('direction', 'inbound')
            .gte('createdAt', cutoff)
            .limit(1);
        return !!(data && data.length > 0);
    }, [sb]);

    const handleSend = async () => {
        if (!input.trim() || !activeConv || sending) return;
        const text = input.trim();
        setInput('');
        setSending(true);

        // Format target phone
        const targetPhone = activeConv.phoneNumber.startsWith('+')
            ? activeConv.phoneNumber
            : `+${activeConv.phoneNumber}`;

        try {


            // Try sending the free-form message directly
            const { ok, result } = await callWhatsAppSend({ to: targetPhone, text });

            if (!ok) {
                // Free-form failed (likely no 24h session) — try template to open session
                console.warn('[Messages] Free-form failed, trying template...', result.error);
                const { ok: tplOk, result: tplResult } = await callWhatsAppSend({
                    to: targetPhone,
                    templateName: 'hall_notification_template',
                    languageCode: 'en_US',
                });

                if (tplOk) {
                    // Template sent — wait briefly then retry free-form
                    await new Promise(r => setTimeout(r, 1500));
                    const retry = await callWhatsAppSend({ to: targetPhone, text });
                    if (!retry.ok) console.warn('[Messages] Follow-up after template failed:', retry.result.error);
                } else {
                    // Both failed — show friendly error
                    throw new Error(
                        `Could not reach ${activeConv.contactName}. Ask them to send a WhatsApp message to ${WA_NUMBER} first to open a session.`
                    );
                }
            }

            // Save outbound message
            const msgId = crypto.randomUUID();
            await sb.from('wa_messages').insert({
                id: msgId,
                conversationId: activeConv.id,
                content: text,
                direction: 'outbound',
                messageType: 'text',
                status: 'sent',
                twilioSid: '',
                createdAt: new Date().toISOString(),
            });

            await sb.from('wa_conversations').update({
                lastMessageAt: new Date().toISOString(),
                lastMessagePreview: text.substring(0, 100),
            }).eq('id', activeConv.id);

            setMessages(prev => [
                ...prev,
                { id: msgId, conversationId: activeConv.id, content: text, direction: 'outbound', status: 'sent', createdAt: new Date().toISOString() },
            ]);
        } catch (err: any) {
            console.error('[Messages] Send error:', err);
            setMessages(prev => [
                ...prev,
                { id: crypto.randomUUID(), conversationId: activeConv.id, content: `⚠ ${err.message}`, direction: 'outbound', status: 'failed', createdAt: new Date().toISOString() },
            ]);
        }
        setSending(false);
    };

    // ── Add new contact ─────────────────────────────────────────────
    const handleAddContact = async () => {
        if (!newContactName.trim() || !newContactPhone.trim()) return;

        const phoneClean = newContactPhone.replace(/[^0-9+]/g, '');
        const phoneFormatted = phoneClean.startsWith('+') ? phoneClean : `+${phoneClean}`;

        // Check if conversation already exists
        const existing = conversations.find(c =>
            c.phoneNumber.replace(/[^0-9]/g, '') === phoneFormatted.replace(/[^0-9]/g, '')
        );
        if (existing) {
            setActiveConv(existing);
            setView('chat');
            setNewContactName('');
            setNewContactPhone('');
            return;
        }

        const newId = crypto.randomUUID();
        await sb.from('wa_conversations').insert({
            id: newId,
            phoneNumber: phoneFormatted,
            contactName: newContactName.trim(),
            lastMessageAt: new Date().toISOString(),
            lastMessagePreview: '',
            unreadCount: 0,
        });

        const newConv: WaConversation = {
            id: newId,
            phoneNumber: phoneFormatted,
            contactName: newContactName.trim(),
            lastMessageAt: new Date().toISOString(),
            lastMessagePreview: '',
            unreadCount: 0,
        };

        setConversations(prev => [newConv, ...prev]);
        setActiveConv(newConv);
        setView('chat');
        setNewContactName('');
        setNewContactPhone('');
    };

    // ── Helpers ─────────────────────────────────────────────────────
    const statusIcon = (status: string) => {
        if (status === 'delivered' || status === 'read') return <CheckCheck size={12} className="text-emerald-400" />;
        if (status === 'sent') return <Check size={12} className="text-slate-400" />;
        if (status === 'failed') return <span className="text-red-400 text-[10px]">✗</span>;
        return <Clock size={12} className="text-slate-300" />;
    };

    const timeAgo = (dateStr: string) => {
        if (!dateStr) return '';
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'now';
        if (mins < 60) return `${mins}m`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h`;
        return `${Math.floor(hrs / 24)}d`;
    };

    const getInitials = (name: string) => {
        return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
    };

    const filteredConversations = searchQuery
        ? conversations.filter(c =>
            c.contactName.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.phoneNumber.includes(searchQuery)
        )
        : conversations;

    // ── Collapsed State ─────────────────────────────────────────────
    if (collapsed) {
        return (
            <button
                onClick={() => setCollapsed(false)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-violet-50 to-white border border-violet-200 rounded-2xl hover:from-violet-100 transition-all shadow-sm"
            >
                <div className="flex items-center gap-2">
                    <MessageCircle size={16} className="text-violet-600" />
                    <span className="text-sm font-semibold text-violet-800">Messages</span>
                </div>
                <ChevronUp size={14} className="text-violet-400" />
            </button>
        );
    }

    // ── Email Login Gate ────────────────────────────────────────────
    if (!emailLoggedIn) {
        return (
            <div className="flex flex-col bg-white rounded-2xl border border-violet-200 shadow-sm overflow-hidden h-full">
                <div className="shrink-0 px-4 py-2.5 bg-gradient-to-r from-violet-50 to-white border-b border-violet-100 flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-sm">
                        <MessageCircle size={16} />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-800 text-sm leading-tight">Messages</h3>
                        <p className="text-[10px] text-slate-400">Email login required</p>
                    </div>
                </div>

                {/* Scrollable body — at ~420px column width the two
                 *  provider cards don't fit vertically alongside the
                 *  heading, so give this surface its own y-scroll. */}
                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6 flex flex-col items-center">
                    <Mail size={32} className="mx-auto mb-3 text-slate-300 shrink-0" />
                    <p className="text-sm text-slate-500 text-center shrink-0">No accounts connected yet.</p>
                    <p className="text-xs text-slate-400 mt-1 mb-6 text-center shrink-0">Use the sign-in buttons below to connect your email.</p>

                    <div className="w-full space-y-4">
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col items-center text-center space-y-3">
                            <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center">
                                <Mail size={24} className="text-blue-600" />
                            </div>
                            <div>
                                <h4 className="font-bold text-slate-800 text-sm">Microsoft Outlook</h4>
                                <p className="text-[11px] text-slate-500 mt-0.5">Send and scan emails via Microsoft 365</p>
                            </div>
                            <button onClick={handleOutlookLogin} disabled={emailLoggingIn}
                                className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-md shadow-blue-200">
                                {emailLoggingIn ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
                                Sign in with Microsoft
                            </button>
                        </div>

                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 flex flex-col items-center text-center space-y-3">
                            <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center">
                                <Mail size={24} className="text-red-500" />
                            </div>
                            <div>
                                <h4 className="font-bold text-slate-800 text-sm">Google Gmail</h4>
                                <p className="text-[11px] text-slate-500 mt-0.5">Send and scan emails via Google Workspace</p>
                            </div>
                            <button onClick={handleGmailLogin} disabled={emailLoggingIn}
                                className="w-full py-2.5 bg-red-500 text-white rounded-xl font-bold text-sm hover:bg-red-600 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-md shadow-red-200">
                                {emailLoggingIn ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
                                Sign in with Google
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── Add Contact View ────────────────────────────────────────────
    if (view === 'addContact') {
        return (
            <div className="flex flex-col bg-white rounded-2xl border border-violet-200 shadow-sm overflow-hidden h-full">
                <div className="shrink-0 px-4 py-2.5 bg-gradient-to-r from-violet-50 to-white border-b border-violet-100 flex items-center gap-2">
                    <button onClick={() => setView('contacts')} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                        <ArrowLeft size={16} />
                    </button>
                    <h3 className="font-bold text-slate-800 text-sm">New Contact</h3>
                </div>
                <div className="flex-1 p-4 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Name</label>
                        <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 focus-within:border-violet-300">
                            <User size={16} className="text-slate-400" />
                            <input
                                type="text"
                                value={newContactName}
                                onChange={(e) => setNewContactName(e.target.value)}
                                placeholder="Contact name"
                                className="flex-1 bg-transparent outline-none text-sm text-slate-700"
                                autoFocus
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">WhatsApp Number</label>
                        <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3 py-2 focus-within:border-violet-300">
                            <Phone size={16} className="text-slate-400" />
                            <input
                                type="tel"
                                value={newContactPhone}
                                onChange={(e) => setNewContactPhone(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddContact()}
                                placeholder="+1 (555) 123-4567"
                                className="flex-1 bg-transparent outline-none text-sm text-slate-700"
                            />
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">Include country code (e.g. +1 for US)</p>
                    </div>
                    <button
                        onClick={handleAddContact}
                        disabled={!newContactName.trim() || !newContactPhone.trim()}
                        className="w-full py-2.5 bg-violet-600 text-white rounded-xl font-bold text-sm hover:bg-violet-700 transition-all flex items-center justify-center gap-2 disabled:opacity-40 shadow-md shadow-violet-200"
                    >
                        <MessageCircle size={16} />
                        Start Conversation
                    </button>
                </div>
            </div>
        );
    }

    // ── Chat View ───────────────────────────────────────────────────
    if (view === 'chat' && activeConv) {
        return (
            <div className="flex flex-col bg-white rounded-2xl border border-violet-200 shadow-sm overflow-hidden h-full">
                {/* Header */}
                <div className="shrink-0 px-4 py-2.5 bg-gradient-to-r from-violet-50 to-white border-b border-violet-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button onClick={() => { setView('contacts'); setActiveConv(null); setMessages([]); }}
                            className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                            <ArrowLeft size={16} />
                        </button>
                        <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-sm">
                            {getInitials(activeConv.contactName)}
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800 text-sm leading-tight">{activeConv.contactName}</h3>
                            <p className="text-[10px] text-slate-400">{activeConv.phoneNumber}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={clearMessages} title="Clear messages"
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                            <Trash2 size={13} />
                        </button>
                        <button onClick={() => loadMessages(activeConv.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-violet-50 hover:text-violet-600 transition-colors">
                            <RefreshCw size={13} />
                        </button>
                        <button onClick={() => setCollapsed(true)}
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
                            <ChevronDown size={13} />
                        </button>
                    </div>
                </div>

                {/* Messages */}
                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
                    {messages.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 py-8">
                            <MessageCircle size={28} className="mb-2 text-violet-300" />
                            <p className="text-xs text-center">Send a message to {activeConv.contactName}</p>
                        </div>
                    ) : messages.map(msg => (
                        <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[85%] px-2.5 py-1.5 rounded-xl text-xs leading-relaxed ${msg.direction === 'outbound'
                                ? 'bg-violet-500 text-white rounded-br-sm'
                                : 'bg-slate-100 text-slate-700 rounded-bl-sm'
                                }`}>
                                {msg.content}
                                <div className={`flex items-center justify-end gap-1 mt-0.5 ${msg.direction === 'outbound' ? 'text-violet-200' : 'text-slate-400'}`}>
                                    <span className="text-[9px]">{timeAgo(msg.createdAt)}</span>
                                    {msg.direction === 'outbound' && statusIcon(msg.status)}
                                </div>
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="shrink-0 p-2 border-t border-violet-50 bg-white/80">
                    <div className="flex items-center gap-1.5 border border-slate-200 rounded-xl p-1.5 focus-within:border-violet-300 transition-all">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder={`Message ${activeConv.contactName}...`}
                            className="flex-1 bg-transparent outline-none text-xs text-slate-700 placeholder:text-slate-400 px-1"
                            disabled={sending}
                        />
                        <button onClick={handleSend} disabled={!input.trim() || sending}
                            className="p-1.5 bg-violet-500 text-white rounded-lg hover:bg-violet-600 disabled:opacity-40 transition-all">
                            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        </button>
                    </div>
                </div>

                {/* OCR Drop Zone */}
                {onOcrUpload && (
                    <div
                        className={`shrink-0 mx-2 mb-2 border-2 border-dashed rounded-xl p-4 flex items-center justify-center gap-2 cursor-pointer transition-all ${dragOver
                            ? 'border-orange-400 bg-orange-100'
                            : 'border-orange-200 bg-orange-50 hover:border-orange-300 hover:bg-orange-100/70'
                            }`}
                        onClick={() => ocrFileRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(e) => {
                            e.preventDefault(); setDragOver(false);
                            const f = e.dataTransfer.files?.[0];
                            if (f) onOcrUpload(f);
                        }}
                    >
                        <input type="file" ref={ocrFileRef} className="hidden" accept="application/pdf,image/jpeg,image/png,image/webp"
                            onChange={(e) => { if (e.target.files?.[0]) { onOcrUpload(e.target.files[0]); e.target.value = ''; } }} />
                        <UploadCloud size={16} className={dragOver ? 'text-orange-600' : 'text-orange-400'} />
                        <span className={`text-[11px] font-medium ${dragOver ? 'text-orange-700' : 'text-orange-500'}`}>Drop document for OCR</span>
                    </div>
                )}
            </div>
        );
    }

    // ── Contacts List View (Default) ────────────────────────────────
    return (
        <div className="flex flex-col bg-white rounded-2xl border border-violet-200 shadow-sm overflow-hidden h-full">
            {/* Header */}
            <div className="shrink-0 px-4 py-2.5 bg-gradient-to-r from-violet-50 to-white border-b border-violet-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-sm">
                        <MessageCircle size={16} />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-800 text-sm leading-tight">Messages</h3>
                        <p className="text-[10px] text-slate-400">WhatsApp • {WA_NUMBER}</p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => setView('addContact')}
                        className="p-1.5 rounded-lg text-violet-500 hover:bg-violet-50 transition-colors" title="New contact">
                        <Plus size={16} />
                    </button>
                    <button onClick={loadConversations}
                        className="p-1.5 rounded-lg text-slate-400 hover:bg-violet-50 hover:text-violet-600 transition-colors">
                        <RefreshCw size={13} />
                    </button>
                    <button onClick={() => setCollapsed(true)}
                        className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
                        <ChevronDown size={13} />
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="px-3 py-2 border-b border-slate-100">
                <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-2.5 py-1.5">
                    <Search size={13} className="text-slate-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search contacts..."
                        className="flex-1 bg-transparent outline-none text-xs text-slate-700 placeholder:text-slate-400"
                    />
                </div>
            </div>

            {/* Conversation List */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                {loading ? (
                    <div className="flex justify-center py-8"><Loader2 size={16} className="animate-spin text-violet-400" /></div>
                ) : filteredConversations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                        <MessageCircle size={28} className="mb-2 text-violet-300" />
                        <p className="text-xs">{searchQuery ? 'No contacts found' : 'No conversations yet'}</p>
                        {!searchQuery && (
                            <button onClick={() => setView('addContact')} className="mt-2 text-xs text-violet-600 hover:text-violet-700 font-medium">
                                + Add a contact
                            </button>
                        )}
                    </div>
                ) : filteredConversations.map(conv => (
                    <div
                        key={conv.id}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-violet-50/50 transition-colors border-b border-slate-50 text-left group"
                    >
                        <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0 shadow-sm cursor-pointer"
                            onClick={() => { setActiveConv(conv); setView('chat'); }}>
                            {getInitials(conv.contactName)}
                        </div>
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setActiveConv(conv); setView('chat'); }}>
                            <div className="flex items-center justify-between">
                                <span className="font-bold text-slate-800 text-sm truncate">{conv.contactName}</span>
                                <span className="text-[10px] text-slate-400 shrink-0 ml-2">{timeAgo(conv.lastMessageAt)}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                {conv.lastMessagePreview || conv.phoneNumber}
                            </p>
                        </div>
                        {(conv.unreadCount || 0) > 0 && (
                            <div className="w-5 h-5 bg-violet-500 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0">
                                {conv.unreadCount}
                            </div>
                        )}
                        <button
                            onClick={async (e) => {
                                e.stopPropagation();
                                if (!confirm(`Delete chat with ${conv.contactName}?`)) return;
                                await sb.from('wa_messages').delete().eq('conversationId', conv.id);
                                await sb.from('wa_conversations').delete().eq('id', conv.id);
                                setConversations(prev => prev.filter(c => c.id !== conv.id));
                            }}
                            className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                            title="Delete chat"
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                ))}
            </div>

        </div>
    );
};

export default WhatsAppChatWidget;
