
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Sparkles, Loader2, RefreshCw, Mail, Users, Clock, ChevronRight,
    CheckCircle2, AlertCircle, ListChecks, MessageSquareText, Lightbulb,
    Inbox, ArrowRight
} from 'lucide-react';
import { initializeMsal, getAccountFor, getTokenFor, loginRequest, type ProcessorKey } from '../services/smailAuth';
import { getGeminiInsight } from '../services/geminiService';

const MSAL_KEY: ProcessorKey = 'automation';

// ─── Interfaces ─────────────────────────────────────────────────────
interface EmailMessage {
    id: string;
    subject: string;
    from: string;
    fromName: string;
    receivedDateTime: string;
    bodyPreview: string;
    isRead: boolean;
    body?: string;
}

interface EmailThread {
    normalizedSubject: string;
    emails: EmailMessage[];
    participants: string[];
    latestDate: string;
    earliestDate: string;
}

interface BriefingResult {
    summary: string;
    actionItems: string[];
    keyDecisions: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────
const normalizeSubject = (subject: string): string => {
    return subject
        .replace(/^(RE:|FW:|FWD:|RES:|ENC:)\s*/gi, '')
        .replace(/^(RE:|FW:|FWD:|RES:|ENC:)\s*/gi, '')
        .replace(/^(RE:|FW:|FWD:|RES:|ENC:)\s*/gi, '')
        .trim();
};

const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const AVATAR_COLORS = [
    'from-blue-500 to-indigo-500', 'from-emerald-500 to-teal-500',
    'from-rose-500 to-pink-500', 'from-amber-500 to-orange-500',
    'from-violet-500 to-purple-500', 'from-cyan-500 to-blue-500',
];

const getColor = (name: string): string => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

// ─── Component ─────────────────────────────────────────────────────
const EmailBriefing: React.FC = () => {
    const [isConnected, setIsConnected] = useState<boolean | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [threads, setThreads] = useState<EmailThread[]>([]);
    const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null);
    const [briefing, setBriefing] = useState<BriefingResult | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [threadBodies, setThreadBodies] = useState<Record<string, string>>({});
    const [loadingBodies, setLoadingBodies] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const autoSelectedRef = useRef(false);
    const threadBodiesRef = useRef<Record<string, string>>({});

    // ─── Auth ─────────────────────────────────────────────────
    useEffect(() => {
        const init = async () => {
            try {
                await initializeMsal();
                const account = getAccountFor(MSAL_KEY);
                setIsConnected(!!account);
            } catch {
                setIsConnected(false);
            }
        };
        init();
    }, []);

    // Auto-load when connected
    useEffect(() => {
        if (isConnected) loadEmails();
    }, [isConnected]);

    const acquireToken = async (): Promise<string> => {
        const token = await getTokenFor(MSAL_KEY, loginRequest.scopes);
        if (token) return token;
        throw new Error('No valid access token.');
    };

    // ─── Fetch emails and group into threads ──────────────────
    const loadEmails = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const token = await acquireToken();
            const resp = await fetch(
                'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$orderby=receivedDateTime DESC&$top=100&$select=id,subject,from,receivedDateTime,bodyPreview,isRead',
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            if (!resp.ok) throw new Error(`Graph API Error (${resp.status})`);
            const data = await resp.json();
            const messages: EmailMessage[] = (data.value || []).map((msg: any) => ({
                id: msg.id,
                subject: msg.subject || '(No Subject)',
                from: msg.from?.emailAddress?.address || 'Unknown',
                fromName: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || 'Unknown',
                receivedDateTime: msg.receivedDateTime,
                bodyPreview: msg.bodyPreview || '',
                isRead: !!msg.isRead,
            }));

            // Group by normalized subject
            const threadMap = new Map<string, EmailMessage[]>();
            for (const msg of messages) {
                const key = normalizeSubject(msg.subject).toLowerCase();
                if (!threadMap.has(key)) threadMap.set(key, []);
                threadMap.get(key)!.push(msg);
            }

            // Convert to threads, sort by email count (loops first), then by date
            const threadList: EmailThread[] = Array.from(threadMap.entries())
                .map(([_, emails]) => {
                    const sorted = emails.sort((a, b) =>
                        new Date(a.receivedDateTime).getTime() - new Date(b.receivedDateTime).getTime()
                    );
                    const participants = [...new Set(emails.map(e => e.fromName))];
                    return {
                        normalizedSubject: normalizeSubject(sorted[0].subject),
                        emails: sorted,
                        participants,
                        latestDate: sorted[sorted.length - 1].receivedDateTime,
                        earliestDate: sorted[0].receivedDateTime,
                    };
                })
                .sort((a, b) => {
                    // Multi-email threads first, then by latest date
                    if (a.emails.length > 1 && b.emails.length <= 1) return -1;
                    if (b.emails.length > 1 && a.emails.length <= 1) return 1;
                    return new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime();
                });

            setThreads(threadList);
            setIsConnected(true);
        } catch (e: any) {
            setError(e.message || 'Failed to load emails.');
            if (e.message?.includes('No account') || e.message?.includes('No valid')) {
                setIsConnected(false);
            }
        } finally {
            setIsLoading(false);
        }
    };

    // ─── Select thread, fetch bodies, then auto-brief ────────
    const selectThread = async (thread: EmailThread) => {
        setSelectedThread(thread);
        setBriefing(null);

        // Fetch full bodies for emails we don't have yet
        const missingIds = thread.emails.filter(e => !threadBodiesRef.current[e.id]).map(e => e.id);
        let allBodies = { ...threadBodiesRef.current };

        if (missingIds.length > 0) {
            setLoadingBodies(true);
            try {
                const token = await acquireToken();
                const newBodies: Record<string, string> = {};
                for (let i = 0; i < missingIds.length; i += 5) {
                    const batch = missingIds.slice(i, i + 5);
                    await Promise.all(batch.map(async (id) => {
                        try {
                            const resp = await fetch(
                                `https://graph.microsoft.com/v1.0/me/messages/${id}?$select=body`,
                                { headers: { 'Authorization': `Bearer ${token}` } }
                            );
                            if (resp.ok) {
                                const data = await resp.json();
                                let content = data.body?.content || '';
                                const div = document.createElement('div');
                                div.innerHTML = content;
                                div.querySelectorAll('style, script, head, link, meta').forEach(el => el.remove());
                                const rawText = (div.textContent || div.innerText || '').trim();
                                newBodies[id] = rawText.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
                            }
                        } catch { /* skip */ }
                    }));
                }
                allBodies = { ...allBodies, ...newBodies };
                threadBodiesRef.current = allBodies;
                setThreadBodies(allBodies);
            } catch (e: any) {
                console.error('Failed to fetch email bodies:', e);
            } finally {
                setLoadingBodies(false);
            }
        }

        // Auto-generate briefing
        runBriefing(thread, allBodies);
    };

    // ─── Generate AI Briefing (with explicit params) ─────────
    const runBriefing = async (thread: EmailThread, bodies: Record<string, string>) => {
        setIsGenerating(true);
        setBriefing(null);

        try {
            // Build conversation text from thread
            const conversationText = thread.emails.map(email => {
                const body = bodies[email.id] || email.bodyPreview;
                const date = new Date(email.receivedDateTime).toLocaleString();
                return `--- Email from ${email.fromName} (${email.from}) on ${date} ---\n${body}\n`;
            }).join('\n');

            const prompt = `You are an executive briefing assistant. Analyze this email thread and provide a structured briefing.

EMAIL THREAD: "${thread.normalizedSubject}"
Participants: ${thread.participants.join(', ')}
Number of emails: ${thread.emails.length}

${conversationText}

Respond in EXACTLY this JSON format (no markdown, just raw JSON):
{
    "summary": "A concise 2-4 sentence summary of what this email thread is about and its current status.",
    "actionItems": ["Action item 1", "Action item 2"],
    "keyDecisions": ["Decision 1", "Decision 2"]
}

Rules:
- summary: Be concise and focus on what matters
- actionItems: Extract specific to-dos, requests, or follow-ups needed. If none, use empty array.
- keyDecisions: Highlight any important decisions, agreements, or conclusions made. If none, use empty array.
- IMPORTANT: Write the briefing in the SAME LANGUAGE as the original emails. If emails are in Portuguese, respond in Portuguese. If in Spanish, respond in Spanish. Match the language of the conversation.
- Focus on what's actionable and important`;

            const result = await getGeminiInsight(prompt);

            try {
                // Parse JSON from response
                const jsonMatch = result.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    setBriefing({
                        summary: parsed.summary || 'No summary generated.',
                        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
                        keyDecisions: Array.isArray(parsed.keyDecisions) ? parsed.keyDecisions : [],
                    });
                } else {
                    setBriefing({ summary: result, actionItems: [], keyDecisions: [] });
                }
            } catch {
                setBriefing({ summary: result, actionItems: [], keyDecisions: [] });
            }
        } catch (e: any) {
            console.error('Briefing generation failed:', e);
            setBriefing({ summary: `Failed to generate briefing: ${e.message}`, actionItems: [], keyDecisions: [] });
        } finally {
            setIsGenerating(false);
        }
    };

    // ─── Auto-select first conversation on load ─────────────
    useEffect(() => {
        if (autoSelectedRef.current || threads.length === 0) return;
        const firstMulti = threads.find(t => t.emails.length > 1);
        if (firstMulti) {
            autoSelectedRef.current = true;
            selectThread(firstMulti);
        }
    }, [threads]);

    // ─── Not connected state ─────────────────────────────────
    if (isConnected === false) {
        return (
            <div className="h-full flex items-center justify-center bg-slate-50">
                <div className="text-center max-w-sm">
                    <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-indigo-100 flex items-center justify-center">
                        <Sparkles size={36} className="text-indigo-600" />
                    </div>
                    <h2 className="text-lg font-semibold text-slate-800 mb-2">Email Not Connected</h2>
                    <p className="text-sm text-slate-500">
                        Connect your email account in the <strong>Email</strong> tab first, then come back here for AI-powered briefings.
                    </p>
                </div>
            </div>
        );
    }

    // ─── Main Render ─────────────────────────────────────────
    const multiEmailThreads = threads.filter(t => t.emails.length > 1);
    const singleEmailThreads = threads.filter(t => t.emails.length === 1);

    return (
        <div className="h-full flex overflow-hidden">

            {/* ── Left Panel: Thread List ── */}
            <div className="w-[380px] shrink-0 flex flex-col border-r border-slate-200 bg-white">

                {/* Header */}
                <div className="shrink-0 px-4 py-3 border-b border-slate-200">
                    <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 flex items-center justify-center">
                                <Sparkles size={16} className="text-white" />
                            </div>
                            <div>
                                <h2 className="text-sm font-semibold text-slate-800">Email Briefing</h2>
                                <p className="text-[10px] text-slate-400">
                                    {multiEmailThreads.length} conversation threads • {threads.length} total
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={loadEmails}
                            disabled={isLoading}
                            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50"
                            title="Refresh"
                        >
                            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>

                {/* Thread List */}
                <div className="flex-1 overflow-y-auto min-h-0">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 size={20} className="text-indigo-500 animate-spin" />
                        </div>
                    ) : error ? (
                        <div className="p-4 text-center">
                            <AlertCircle size={24} className="mx-auto text-red-400 mb-2" />
                            <p className="text-sm text-red-600">{error}</p>
                        </div>
                    ) : threads.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-center px-4">
                            <Inbox size={24} className="text-slate-300 mb-2" />
                            <p className="text-xs text-slate-400">No emails found</p>
                        </div>
                    ) : (
                        <>
                            {/* Multi-email threads (conversations) */}
                            {multiEmailThreads.length > 0 && (
                                <div>
                                    <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100">
                                        <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
                                            Conversations ({multiEmailThreads.length})
                                        </span>
                                    </div>
                                    {multiEmailThreads.map((thread, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => selectThread(thread)}
                                            className={`flex items-start gap-3 px-4 py-3 cursor-pointer border-b border-slate-100 transition-colors ${selectedThread?.normalizedSubject === thread.normalizedSubject
                                                ? 'bg-indigo-50 border-l-2 border-l-indigo-500'
                                                : 'hover:bg-slate-50'
                                                }`}
                                        >
                                            <div className="shrink-0 mt-0.5">
                                                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                                                    <span className="text-xs font-bold text-indigo-600">{thread.emails.length}</span>
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-slate-800 truncate">{thread.normalizedSubject}</p>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="flex items-center gap-1 text-[10px] text-slate-400">
                                                        <Users size={10} /> {thread.participants.length}
                                                    </span>
                                                    <span className="flex items-center gap-1 text-[10px] text-slate-400">
                                                        <Mail size={10} /> {thread.emails.length}
                                                    </span>
                                                    <span className="flex items-center gap-1 text-[10px] text-slate-400">
                                                        <Clock size={10} /> {formatDate(thread.latestDate)}
                                                    </span>
                                                </div>
                                                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                                    {thread.participants.join(', ')}
                                                </p>
                                            </div>
                                            <ChevronRight size={14} className="text-slate-300 shrink-0 mt-2" />
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Single-email threads */}
                            {singleEmailThreads.length > 0 && (
                                <div>
                                    <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
                                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                            Single Emails ({singleEmailThreads.length})
                                        </span>
                                    </div>
                                    {singleEmailThreads.map((thread, idx) => (
                                        <div
                                            key={`s-${idx}`}
                                            onClick={() => selectThread(thread)}
                                            className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer border-b border-slate-100 transition-colors ${selectedThread?.normalizedSubject === thread.normalizedSubject
                                                ? 'bg-indigo-50 border-l-2 border-l-indigo-500'
                                                : 'hover:bg-slate-50'
                                                }`}
                                        >
                                            <div className="shrink-0 mt-0.5">
                                                <div className={`w-7 h-7 rounded-full bg-gradient-to-r ${getColor(thread.emails[0].fromName)} flex items-center justify-center`}>
                                                    <span className="text-[10px] font-semibold text-white">
                                                        {thread.emails[0].fromName?.charAt(0)?.toUpperCase() || '?'}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-medium text-slate-700 truncate">{thread.normalizedSubject}</p>
                                                <p className="text-[10px] text-slate-400 truncate">{thread.emails[0].fromName} • {formatDate(thread.latestDate)}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* ── Right Panel: Briefing ── */}
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
                {selectedThread ? (
                    <>
                        {/* Thread Header */}
                        <div className="shrink-0 px-6 py-4 bg-white border-b border-slate-200">
                            <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0 mr-4">
                                    <h3 className="text-base font-semibold text-slate-800 truncate">{selectedThread.normalizedSubject}</h3>
                                    <p className="text-xs text-slate-400 mt-1">
                                        {selectedThread.emails.length} email{selectedThread.emails.length !== 1 ? 's' : ''} • {selectedThread.participants.length} participant{selectedThread.participants.length !== 1 ? 's' : ''} • {formatDate(selectedThread.earliestDate)} → {formatDate(selectedThread.latestDate)}
                                    </p>
                                </div>
                                <button
                                    onClick={() => runBriefing(selectedThread, threadBodiesRef.current)}
                                    disabled={isGenerating || loadingBodies}
                                    className="shrink-0 flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg hover:from-indigo-700 hover:to-purple-700 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
                                >
                                    {isGenerating ? (
                                        <><Loader2 size={14} className="animate-spin" /> Analyzing...</>
                                    ) : loadingBodies ? (
                                        <><Loader2 size={14} className="animate-spin" /> Loading emails...</>
                                    ) : (
                                        <><Sparkles size={14} /> Generate Briefing</>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Content Area */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-4">

                            {/* AI Briefing Result */}
                            {briefing && (
                                <div className="space-y-4 animate-in fade-in duration-300">
                                    {/* Summary */}
                                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                        <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-indigo-100 flex items-center gap-2">
                                            <MessageSquareText size={16} className="text-indigo-600" />
                                            <h4 className="text-sm font-bold text-indigo-800">Summary</h4>
                                        </div>
                                        <div className="p-4">
                                            <p className="text-sm text-slate-700 leading-relaxed">{briefing.summary}</p>
                                        </div>
                                    </div>

                                    {/* Action Items */}
                                    {briefing.actionItems.length > 0 && (
                                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                            <div className="px-4 py-3 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100 flex items-center gap-2">
                                                <ListChecks size={16} className="text-amber-600" />
                                                <h4 className="text-sm font-bold text-amber-800">Action Items ({briefing.actionItems.length})</h4>
                                            </div>
                                            <div className="p-4 space-y-2">
                                                {briefing.actionItems.map((item, i) => (
                                                    <div key={i} className="flex items-start gap-3 p-2 rounded-lg hover:bg-amber-50 transition-colors">
                                                        <ArrowRight size={14} className="text-amber-500 shrink-0 mt-0.5" />
                                                        <p className="text-sm text-slate-700">{item}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Key Decisions */}
                                    {briefing.keyDecisions.length > 0 && (
                                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                            <div className="px-4 py-3 bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100 flex items-center gap-2">
                                                <Lightbulb size={16} className="text-emerald-600" />
                                                <h4 className="text-sm font-bold text-emerald-800">Key Decisions ({briefing.keyDecisions.length})</h4>
                                            </div>
                                            <div className="p-4 space-y-2">
                                                {briefing.keyDecisions.map((item, i) => (
                                                    <div key={i} className="flex items-start gap-3 p-2 rounded-lg hover:bg-emerald-50 transition-colors">
                                                        <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                                                        <p className="text-sm text-slate-700">{item}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Email Timeline */}
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
                                    <Mail size={16} className="text-slate-500" />
                                    <h4 className="text-sm font-bold text-slate-700">Thread Timeline ({selectedThread.emails.length})</h4>
                                </div>
                                <div className="divide-y divide-slate-100">
                                    {selectedThread.emails.map((email, idx) => (
                                        <div key={email.id} className="p-4 hover:bg-slate-50 transition-colors">
                                            <div className="flex items-start gap-3">
                                                <div className="shrink-0">
                                                    <div className={`w-8 h-8 rounded-full bg-gradient-to-r ${getColor(email.fromName)} flex items-center justify-center`}>
                                                        <span className="text-[10px] font-semibold text-white">
                                                            {email.fromName?.charAt(0)?.toUpperCase() || '?'}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="text-sm font-medium text-slate-800">{email.fromName}</span>
                                                        <span className="text-[10px] text-slate-400">{formatDate(email.receivedDateTime)}</span>
                                                    </div>
                                                    <p className="text-xs text-slate-400 mb-1.5">{email.from}</p>
                                                    <p className="text-xs text-slate-600 leading-relaxed">
                                                        {threadBodies[email.id]
                                                            ? (threadBodies[email.id].length > 500
                                                                ? threadBodies[email.id].substring(0, 500) + '...'
                                                                : threadBodies[email.id])
                                                            : email.bodyPreview || '(No preview available)'}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-center bg-slate-50">
                        <div className="w-24 h-24 rounded-full bg-indigo-100/60 flex items-center justify-center mb-4">
                            <Sparkles size={40} className="text-indigo-400" />
                        </div>
                        <h3 className="text-lg font-medium text-slate-600 mb-1">AI Email Briefing</h3>
                        <p className="text-sm text-slate-400 max-w-xs">
                            Select a conversation thread to view its timeline and generate an AI-powered briefing with summary, action items, and key decisions.
                        </p>
                        {multiEmailThreads.length > 0 && (
                            <p className="text-xs text-indigo-500 mt-3 font-medium">
                                {multiEmailThreads.length} conversation thread{multiEmailThreads.length !== 1 ? 's' : ''} detected
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default EmailBriefing;
