import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    Brain, RefreshCw, Send, X, Check, ChevronDown, ChevronUp,
    Mail, MailWarning, Clock, Loader2, Sparkles, Eye, Edit3,
    Inbox, ArrowUpRight, AlertTriangle, CheckCircle2, Trash2,
    Filter, RotateCcw, FileText, Save, Download, FileCheck,
    ShoppingCart, Package, UserPlus, Box
} from 'lucide-react';
import { emailAgentService, EmailAgentItem, AgentStats, SaveCallbacks } from '../services/emailAgentService';
import { getAccountFor, ProcessorKey, loginFor, loginRequest } from '../services/smailAuth';

interface Props {
    processorKey?: ProcessorKey;
    saveCallbacks?: SaveCallbacks;
    currentCompanyId?: string;
}

const PRIORITY_COLORS = {
    high: 'bg-red-100 text-red-700 border-red-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    low: 'bg-slate-100 text-slate-600 border-slate-200',
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
    queued: <Loader2 size={14} className="text-violet-500 animate-spin" />,
    pending: <Clock size={14} className="text-amber-500" />,
    approved: <Check size={14} className="text-blue-500" />,
    sending: <Loader2 size={14} className="text-blue-500 animate-spin" />,
    sent: <CheckCircle2 size={14} className="text-emerald-500" />,
    dismissed: <X size={14} className="text-slate-400" />,
    error: <AlertTriangle size={14} className="text-red-500" />,
};

const EmailAgent: React.FC<Props> = ({ processorKey = 'automation', saveCallbacks, currentCompanyId }) => {
    const [items, setItems] = useState<EmailAgentItem[]>([]);
    const [stats, setStats] = useState<AgentStats>({ pending: 0, sent: 0, dismissed: 0, followups: 0, documents: 0, purchaseOrders: 0, processing: false });
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editDraft, setEditDraft] = useState('');
    const [filter, setFilter] = useState<'all' | 'pending' | 'inbound' | 'followup' | 'document' | 'purchase_order'>('pending');
    const [savingDoc, setSavingDoc] = useState<string | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [userEmail, setUserEmail] = useState('');
    const [scanning, setScanning] = useState(false);
    const [autoScan, setAutoScan] = useState(false);
    const autoScanRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const editRef = useRef<HTMLTextAreaElement>(null);

    // Wire up save callbacks
    useEffect(() => {
        if (saveCallbacks) emailAgentService.setSaveCallbacks(saveCallbacks);
    }, [saveCallbacks]);

    // Subscribe to service updates
    useEffect(() => {
        const unsub = emailAgentService.subscribe((newItems, newStats) => {
            setItems(newItems);
            setStats(newStats);
        });
        return unsub;
    }, []);

    // Check auth on mount
    useEffect(() => {
        const account = getAccountFor(processorKey);
        if (account) {
            setIsAuthenticated(true);
            setUserEmail(account.username || '');
        }
    }, [processorKey]);

    // Auto-scan interval
    useEffect(() => {
        if (autoScan && isAuthenticated && userEmail) {
            autoScanRef.current = setInterval(() => {
                handleScan();
            }, 5 * 60 * 1000); // every 5 minutes
        }
        return () => {
            if (autoScanRef.current) clearInterval(autoScanRef.current);
        };
    }, [autoScan, isAuthenticated, userEmail]);

    const handleLogin = async () => {
        try {
            await loginFor(processorKey, loginRequest.scopes);
            const account = getAccountFor(processorKey);
            if (account) {
                setIsAuthenticated(true);
                setUserEmail(account.username || '');
            }
        } catch (err) {
            console.error('Login failed:', err);
        }
    };

    const handleScan = useCallback(async () => {
        if (scanning || !userEmail) return;
        setScanning(true);
        try {
            const result = await emailAgentService.fullScan(processorKey, userEmail, currentCompanyId);
            if (result.inbound > 0 || result.followups > 0) {
                console.log(`Scan complete: ${result.inbound} replies drafted, ${result.followups} follow-ups needed`);
            }
        } catch (err) {
            console.error('Scan error:', err);
        } finally {
            setScanning(false);
        }
    }, [processorKey, userEmail, scanning, currentCompanyId]);

    const handleApprove = async (itemId: string) => {
        const item = items.find(i => i.id === itemId);
        if (!item) return;
        const reply = isEditing && selectedId === itemId ? editDraft : item.draftReply;
        setIsEditing(false);
        await emailAgentService.approveAndSend(itemId, processorKey, reply);
    };

    const handleDismiss = (itemId: string) => {
        emailAgentService.dismiss(itemId);
        if (selectedId === itemId) setSelectedId(null);
    };

    const handleEdit = (item: EmailAgentItem) => {
        setIsEditing(true);
        setEditDraft(item.draftReply);
        setSelectedId(item.id);
        setTimeout(() => editRef.current?.focus(), 100);
    };

    const handleSaveDraft = (itemId: string) => {
        emailAgentService.updateDraft(itemId, editDraft);
        setIsEditing(false);
    };

    const handleSaveDoc = async (itemId: string, docIndex: number) => {
        setSavingDoc(`${itemId}_${docIndex}`);
        await emailAgentService.saveDocument(itemId, docIndex);
        setSavingDoc(null);
    };

    const handleSaveAllDocs = async (itemId: string) => {
        setSavingDoc(`${itemId}_all`);
        await emailAgentService.saveAllDocuments(itemId);
        setSavingDoc(null);
    };

    const selected = items.find(i => i.id === selectedId);

    const filteredItems = items.filter(i => {
        if (filter === 'pending') return i.status === 'pending' || i.status === 'queued';
        if (filter === 'inbound') return i.type === 'inbound';
        if (filter === 'followup') return i.type === 'followup';
        if (filter === 'document') return i.type === 'document' || (i.documents && i.documents.length > 0);
        if (filter === 'purchase_order') return i.type === 'purchase_order';
        return true;
    });

    // ── Login Screen ─────────────────────────────────────────────────────────

    if (!isAuthenticated) {
        return (
            <div className="h-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
                <div className="text-center space-y-4">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                        <Brain size={32} className="text-white" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-800">AI Email Agent</h2>
                    <p className="text-slate-500 max-w-sm">
                        Connect your Outlook account to enable autonomous email analysis and AI-powered reply drafting.
                    </p>
                    <button
                        onClick={handleLogin}
                        className="px-6 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl font-semibold hover:shadow-lg transition-all"
                    >
                        <Mail size={18} className="inline mr-2" />
                        Connect Outlook
                    </button>
                </div>
            </div>
        );
    }

    // ── Main UI ──────────────────────────────────────────────────────────────

    return (
        <div className="h-full flex flex-col bg-slate-50">
            {/* Header Bar */}
            <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                        <Mail size={14} /> {userEmail}
                    </div>
                    <div className="flex gap-1.5">
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                            {stats.pending} pending
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                            {stats.sent} sent
                        </span>
                        {stats.followups > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                                {stats.followups} follow-ups
                            </span>
                        )}
                        {stats.documents > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700">
                                {stats.documents} docs
                            </span>
                        )}
                        {stats.purchaseOrders > 0 && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-violet-100 text-violet-700">
                                {stats.purchaseOrders} POs
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setAutoScan(!autoScan)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            autoScan
                                ? 'bg-violet-100 text-violet-700 border border-violet-200'
                                : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}
                    >
                        {autoScan ? '⚡ Auto ON' : 'Auto OFF'}
                    </button>
                    <button
                        onClick={handleScan}
                        disabled={scanning || stats.processing}
                        className="px-4 py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg text-sm font-bold flex items-center gap-2 hover:shadow-md transition-all disabled:opacity-50"
                    >
                        {scanning || stats.processing ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <RefreshCw size={14} />
                        )}
                        {scanning ? 'Scanning...' : 'Scan Now'}
                    </button>
                    <button
                        onClick={() => emailAgentService.clearCompleted()}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        title="Clear completed"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            </div>

            {/* Filter Tabs */}
            <div className="bg-white border-b border-slate-200 px-5 py-2 flex gap-1 shrink-0">
                {(['pending', 'all', 'inbound', 'followup', 'document', 'purchase_order'] as const).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${
                            filter === f
                                ? 'bg-violet-100 text-violet-700'
                                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                        {f === 'pending' && <Clock size={12} className="inline mr-1" />}
                        {f === 'inbound' && <Inbox size={12} className="inline mr-1" />}
                        {f === 'followup' && <MailWarning size={12} className="inline mr-1" />}
                        {f === 'document' && <FileText size={12} className="inline mr-1" />}
                        {f === 'purchase_order' && <ShoppingCart size={12} className="inline mr-1" />}
                        {f === 'all' && <Filter size={12} className="inline mr-1" />}
                        {f === 'document' ? 'Documents' : f === 'purchase_order' ? 'POs' : f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                ))}
            </div>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left: Email Queue */}
                <div className="w-[380px] border-r border-slate-200 overflow-y-auto bg-white">
                    {filteredItems.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8">
                            <Brain size={48} className="mb-4 opacity-30" />
                            <p className="text-sm font-medium">No emails in queue</p>
                            <p className="text-xs mt-1 text-center">Click "Scan Now" to analyze your inbox and draft AI replies</p>
                        </div>
                    ) : (
                        filteredItems.map(item => (
                            <div
                                key={item.id}
                                onClick={() => { setSelectedId(item.id); setIsEditing(false); }}
                                className={`px-4 py-3 border-b border-slate-100 cursor-pointer transition-colors ${
                                    selectedId === item.id ? 'bg-violet-50 border-l-2 border-l-violet-500' : 'hover:bg-slate-50'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            {item.type === 'purchase_order' ? (
                                                <ShoppingCart size={14} className="text-violet-500 shrink-0" />
                                            ) : item.type === 'document' ? (
                                                <FileText size={14} className="text-indigo-500 shrink-0" />
                                            ) : item.type === 'followup' ? (
                                                <MailWarning size={14} className="text-orange-500 shrink-0" />
                                            ) : (
                                                <Inbox size={14} className="text-blue-500 shrink-0" />
                                            )}
                                            <span className="text-sm font-semibold text-slate-800 truncate">
                                                {item.type === 'followup' ? item.recipientEmail : item.senderName}
                                            </span>
                                            {STATUS_ICONS[item.status]}
                                        </div>
                                        <p className="text-xs font-medium text-slate-600 truncate">{item.subject}</p>
                                        <p className="text-xs text-slate-400 truncate mt-0.5">
                                            {item.status === 'queued'
                                                ? <span className="text-violet-500 font-medium flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Analyzing with AI...</span>
                                                : item.type === 'purchase_order'
                                                    ? `PO · ${item.poResult?.extractedPO?.items?.length || '?'} item(s) · $${item.poResult?.extractedPO?.totalAmount || '...'}`
                                                    : item.type === 'document'
                                                        ? `${item.documents?.length || 0} doc(s): ${item.documents?.map(d => d.docType.replace(/_/g, ' ')).join(', ')}`
                                                        : item.type === 'followup'
                                                            ? `No reply in ${item.daysSinceSent}d`
                                                            : item.threadPreview
                                            }
                                        </p>
                                        {item.documents && item.documents.length > 0 && item.type !== 'document' && (
                                            <p className="text-[10px] text-indigo-500 mt-0.5 flex items-center gap-1">
                                                <FileText size={10} /> +{item.documents.length} attachment(s)
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex flex-col items-end gap-1 shrink-0">
                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${PRIORITY_COLORS[item.priority]}`}>
                                            {item.priority.toUpperCase()}
                                        </span>
                                        <span className="text-[10px] text-slate-400">
                                            {new Date(item.receivedAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Right: Detail Panel */}
                <div className="flex-1 overflow-y-auto">
                    {selected ? (
                        <div className="p-6 space-y-5">
                            {/* Queued / Analyzing State */}
                            {selected.status === 'queued' ? (
                                <div className="flex flex-col items-center justify-center py-16 text-center">
                                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-100 flex items-center justify-center mb-4">
                                        <Loader2 size={32} className="text-violet-500 animate-spin" />
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-800 mb-1">{selected.subject}</h3>
                                    <p className="text-sm text-slate-500 mb-1">From: {selected.senderName} ({selected.senderEmail})</p>
                                    <p className="text-sm text-violet-600 font-medium mt-3">
                                        <Sparkles size={14} className="inline mr-1" />
                                        AI is analyzing this email...
                                    </p>
                                    <p className="text-xs text-slate-400 mt-1">Draft reply, category, and priority will appear once analysis completes</p>
                                    {selected.threadPreview && (
                                        <div className="mt-6 bg-slate-50 rounded-xl p-4 border border-slate-200 text-left max-w-lg w-full">
                                            <p className="text-xs font-bold text-slate-500 mb-2 uppercase">Email Preview</p>
                                            <p className="text-sm text-slate-700 whitespace-pre-wrap">{selected.threadPreview}</p>
                                        </div>
                                    )}
                                </div>
                            ) : (
                            <>
                            {/* Header */}
                            <div className="flex items-start justify-between">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        {selected.type === 'purchase_order' ? (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-violet-100 text-violet-700">
                                                PURCHASE ORDER
                                            </span>
                                        ) : selected.type === 'document' ? (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-700">
                                                DOCUMENT
                                            </span>
                                        ) : selected.type === 'followup' ? (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700">
                                                FOLLOW-UP
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700">
                                                INBOUND REPLY
                                            </span>
                                        )}
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${PRIORITY_COLORS[selected.priority]}`}>
                                            {selected.priority.toUpperCase()}
                                        </span>
                                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600">
                                            {selected.category}
                                        </span>
                                    </div>
                                    <h2 className="text-lg font-bold text-slate-800">{selected.subject}</h2>
                                    <p className="text-sm text-slate-500">
                                        {selected.type === 'followup'
                                            ? `To: ${selected.recipientEmail} · No reply in ${selected.daysSinceSent} days`
                                            : `From: ${selected.senderName} (${selected.senderEmail})`
                                        }
                                    </p>
                                </div>
                                {selected.status === 'sent' && (
                                    <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700">
                                        <CheckCircle2 size={16} />
                                        <span className="text-sm font-bold">{selected.type === 'document' ? 'Saved' : 'Sent'}</span>
                                    </div>
                                )}
                            </div>

                            {/* AI Reasoning */}
                            <div className="bg-violet-50 rounded-xl p-4 border border-violet-100">
                                <div className="flex items-center gap-2 mb-2">
                                    <Sparkles size={16} className="text-violet-600" />
                                    <span className="text-sm font-bold text-violet-700">AI Reasoning</span>
                                </div>
                                <p className="text-sm text-violet-800">{selected.reasoning}</p>
                            </div>

                            {/* Thread Preview */}
                            {selected.threadPreview && (
                                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                                    <p className="text-xs font-bold text-slate-500 mb-2 uppercase">Last Message in Thread</p>
                                    <p className="text-sm text-slate-700 whitespace-pre-wrap">{selected.threadPreview}</p>
                                </div>
                            )}

                            {/* PO Processing Result */}
                            {selected.type === 'purchase_order' && selected.poResult && (
                                <div className="bg-white rounded-xl border border-violet-200 overflow-hidden">
                                    <div className="px-4 py-3 bg-violet-50 border-b border-violet-200 flex items-center justify-between">
                                        <span className="text-sm font-bold text-violet-700 flex items-center gap-2">
                                            <ShoppingCart size={14} /> PO Processing
                                            {selected.poResult.status === 'processing' && (
                                                <Loader2 size={14} className="animate-spin text-violet-500" />
                                            )}
                                        </span>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                            selected.poResult.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                                            selected.poResult.status === 'failed' ? 'bg-red-100 text-red-700' :
                                            'bg-amber-100 text-amber-700'
                                        }`}>
                                            {selected.poResult.status.toUpperCase()}
                                        </span>
                                    </div>
                                    <div className="p-4 space-y-3">
                                        {/* Actions summary */}
                                        <div className="flex flex-wrap gap-2">
                                            {selected.poResult.customerId && (
                                                <span className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 ${
                                                    selected.poResult.customerCreated ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-50 text-slate-600 border border-slate-200'
                                                }`}>
                                                    <UserPlus size={12} />
                                                    Customer {selected.poResult.customerCreated ? 'Created' : 'Found'}
                                                </span>
                                            )}
                                            {selected.poResult.productIds.length > 0 && (
                                                <span className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 ${
                                                    selected.poResult.productsCreated.length > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-50 text-slate-600 border border-slate-200'
                                                }`}>
                                                    <Box size={12} />
                                                    {selected.poResult.productIds.length} Product(s)
                                                    {selected.poResult.productsCreated.length > 0 && ` (${selected.poResult.productsCreated.length} new)`}
                                                </span>
                                            )}
                                            {selected.poResult.salesOrderNumber && (
                                                <span className="px-2 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                                                    <Package size={12} />
                                                    {selected.poResult.salesOrderNumber}
                                                </span>
                                            )}
                                            {selected.poResult.bookingNumber && (
                                                <span className="px-2 py-1 rounded-lg text-xs font-bold bg-orange-50 text-orange-700 border border-orange-200 flex items-center gap-1">
                                                    <ShoppingCart size={12} />
                                                    {selected.poResult.bookingNumber}
                                                </span>
                                            )}
                                        </div>

                                        {/* Items table */}
                                        {selected.poResult.extractedPO.items.length > 0 && (
                                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                                                <table className="w-full text-xs">
                                                    <thead className="bg-slate-50">
                                                        <tr>
                                                            <th className="text-left p-2 font-bold text-slate-600">Product</th>
                                                            <th className="text-right p-2 font-bold text-slate-600">Qty</th>
                                                            <th className="text-right p-2 font-bold text-slate-600">Price</th>
                                                            <th className="text-right p-2 font-bold text-slate-600">Total</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {selected.poResult.extractedPO.items.map((it, idx) => (
                                                            <tr key={idx} className="border-t border-slate-100">
                                                                <td className="p-2 text-slate-700">{it.productName}</td>
                                                                <td className="p-2 text-right text-slate-600">{it.quantity} {it.unit}</td>
                                                                <td className="p-2 text-right text-slate-600">${it.unitPrice}</td>
                                                                <td className="p-2 text-right font-bold text-slate-700">${it.total}</td>
                                                            </tr>
                                                        ))}
                                                        <tr className="border-t-2 border-slate-200 bg-slate-50">
                                                            <td colSpan={3} className="p-2 text-right font-bold text-slate-700">Total:</td>
                                                            <td className="p-2 text-right font-bold text-violet-700">
                                                                ${selected.poResult.extractedPO.totalAmount} {selected.poResult.extractedPO.currency}
                                                            </td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}

                                        {/* Actions log */}
                                        <div className="bg-slate-50 rounded-lg p-3">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Processing Log</p>
                                            {selected.poResult.actionsLog.map((logLine, idx) => (
                                                <p key={idx} className={`text-xs ${logLine.startsWith('ERROR') ? 'text-red-600' : 'text-slate-600'}`}>
                                                    {logLine}
                                                </p>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Extracted Documents */}
                            {selected.documents && selected.documents.length > 0 && (
                                <div className="bg-white rounded-xl border border-indigo-200 overflow-hidden">
                                    <div className="px-4 py-3 bg-indigo-50 border-b border-indigo-200 flex items-center justify-between">
                                        <span className="text-sm font-bold text-indigo-700 flex items-center gap-2">
                                            <FileText size={14} /> Extracted Documents ({selected.documents.length})
                                        </span>
                                        {selected.documents.some(d => !d.saved) && (
                                            <button
                                                onClick={() => handleSaveAllDocs(selected.id)}
                                                disabled={savingDoc === `${selected.id}_all`}
                                                className="px-3 py-1 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-1 disabled:opacity-50"
                                            >
                                                {savingDoc === `${selected.id}_all` ? (
                                                    <Loader2 size={12} className="animate-spin" />
                                                ) : (
                                                    <Save size={12} />
                                                )}
                                                Save All to DB
                                            </button>
                                        )}
                                    </div>
                                    <div className="divide-y divide-indigo-100">
                                        {selected.documents.map((doc, idx) => (
                                            <div key={idx} className="p-4">
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="flex items-center gap-2">
                                                        {doc.saved ? (
                                                            <FileCheck size={16} className="text-emerald-500" />
                                                        ) : (
                                                            <FileText size={16} className="text-indigo-500" />
                                                        )}
                                                        <span className="text-sm font-bold text-slate-700">{doc.fileName}</span>
                                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                                                            {doc.docType.replace(/_/g, ' ')}
                                                        </span>
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                                            doc.confidence >= 0.9 ? 'bg-emerald-100 text-emerald-700' :
                                                            doc.confidence >= 0.7 ? 'bg-amber-100 text-amber-700' :
                                                            'bg-red-100 text-red-700'
                                                        }`}>
                                                            {Math.round(doc.confidence * 100)}%
                                                        </span>
                                                    </div>
                                                    {doc.saved ? (
                                                        <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                                                            <CheckCircle2 size={12} /> Saved
                                                        </span>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleSaveDoc(selected.id, idx)}
                                                            disabled={savingDoc === `${selected.id}_${idx}`}
                                                            className="px-3 py-1 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 flex items-center gap-1 disabled:opacity-50"
                                                        >
                                                            {savingDoc === `${selected.id}_${idx}` ? (
                                                                <Loader2 size={12} className="animate-spin" />
                                                            ) : (
                                                                <Save size={12} />
                                                            )}
                                                            Save to DB
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 font-mono overflow-x-auto max-h-40 overflow-y-auto">
                                                    {Object.entries(doc.data).filter(([k]) => k !== 'EXTRACTION_CONFIDENCE').map(([key, val]) => (
                                                        <div key={key} className="flex gap-2 py-0.5">
                                                            <span className="text-slate-400 shrink-0">{key}:</span>
                                                            <span className="text-slate-700">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Draft Reply (only for non-document items that have a draft) */}
                            {selected.draftReply && (
                                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                                        <span className="text-sm font-bold text-slate-700">
                                            {selected.type === 'followup' ? 'Draft Follow-up' : 'Draft Reply'}
                                        </span>
                                        {selected.status === 'pending' && !isEditing && (
                                            <button
                                                onClick={() => handleEdit(selected)}
                                                className="px-2 py-1 rounded text-xs font-bold text-slate-500 hover:bg-slate-100 flex items-center gap-1"
                                            >
                                                <Edit3 size={12} /> Edit
                                            </button>
                                        )}
                                        {isEditing && selectedId === selected.id && (
                                            <button
                                                onClick={() => handleSaveDraft(selected.id)}
                                                className="px-2 py-1 rounded text-xs font-bold text-violet-600 hover:bg-violet-50 flex items-center gap-1"
                                            >
                                                <Check size={12} /> Save
                                            </button>
                                        )}
                                    </div>
                                    <div className="p-4">
                                        {isEditing && selectedId === selected.id ? (
                                            <textarea
                                                ref={editRef}
                                                value={editDraft}
                                                onChange={e => setEditDraft(e.target.value)}
                                                className="w-full h-64 p-3 text-sm border border-violet-200 rounded-lg focus:ring-2 focus:ring-violet-300 focus:border-violet-400 resize-y outline-none"
                                            />
                                        ) : (
                                            <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                                {selected.draftReply}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Error */}
                            {selected.error && (
                                <div className="bg-red-50 rounded-xl p-4 border border-red-200">
                                    <p className="text-sm text-red-700 flex items-center gap-2">
                                        <AlertTriangle size={16} />
                                        Error: {selected.error}
                                    </p>
                                </div>
                            )}

                            {/* Action Buttons */}
                            {selected.status === 'pending' && selected.type !== 'document' && selected.draftReply && (
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => handleApprove(selected.id)}
                                        className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-green-500 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:shadow-lg transition-all"
                                    >
                                        <Send size={16} /> Approve & Send
                                    </button>
                                    <button
                                        onClick={() => handleDismiss(selected.id)}
                                        className="px-6 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-200 transition-all"
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            )}

                            {/* Document-only dismiss button */}
                            {selected.status === 'pending' && selected.type === 'document' && (
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => handleDismiss(selected.id)}
                                        className="px-6 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-200 transition-all"
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            )}
                            </>
                            )}
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                            <Eye size={48} className="mb-4 opacity-30" />
                            <p className="text-sm font-medium">Select an email to review</p>
                            <p className="text-xs mt-1">AI-drafted replies appear here for your approval</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EmailAgent;
