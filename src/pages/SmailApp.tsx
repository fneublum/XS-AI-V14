
import React, { useState, useEffect } from 'react';
import { loginFor, logoutFor, getAccountFor, loginRequest, initializeMsal } from "../services/smailAuth";
import { getUserProfile, getEmails, sendReply, markEmailAsRead } from "../services/smailGraph";
import { generateEmailSummary, generateEmailReply } from "../services/geminiService";
import { Mail, User, LogOut, RefreshCw, Send, Sparkles, Loader2, CheckCircle2, Copy, ArrowDownUp, Inbox, Archive } from 'lucide-react';

const SmailApp: React.FC = () => {
    // Local auth state instead of useMsal hook
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [userProfile, setUserProfile] = useState<any>(null);
    const [emails, setEmails] = useState<any[]>([]);
    const [selectedEmail, setSelectedEmail] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSending, setIsSending] = useState(false);

    // AI State
    const [aiSummary, setAiSummary] = useState('');
    const [isSummarizing, setIsSummarizing] = useState(false);
    const [replyDraft, setReplyDraft] = useState('');
    const [isDrafting, setIsDrafting] = useState(false);
    const [replyTone, setReplyTone] = useState<'Professional' | 'Friendly' | 'Brief'>('Professional');
    const [successMsg, setSuccessMsg] = useState('');

    const [redirectUri] = useState(`${window.location.origin}`); // Updated for Auth File
    const [copied, setCopied] = useState(false);
    const [sortOrder, setSortOrder] = useState<'DESC' | 'ASC'>('DESC');
    const [activeFolder, setActiveFolder] = useState<'inbox' | 'deleteditems'>('inbox');

    useEffect(() => {
        let isMounted = true;
        const init = async () => {
            // Ensure MSAL is initialized (handles redirect processing if coming back from Azure)
            await initializeMsal();
            if (!isMounted) return;

            // Check if we have an account for "my" processor on initial mount
            const account = getAccountFor('my');
            if (account) {
                setIsAuthenticated(true);
            }
        };
        init();
        return () => { isMounted = false; };
    }, []);

    useEffect(() => {
        // Load data when authenticated or when sort order/folder changes
        if (isAuthenticated) {
            loadData();
        }
    }, [isAuthenticated, sortOrder, activeFolder]);

    const handleLogin = async () => {
        try {
            await loginFor('my', loginRequest.scopes);
            setIsAuthenticated(true);
        } catch (e: any) {
            // Handle Safari Redirect Signal
            if (e.message?.includes("Redirecting")) {
                return;
            }
            if (e.errorCode === "user_cancelled" || e.message?.includes("user_cancelled")) {
                return; // Gracefully ignore user cancellation
            }
            if (e.errorCode === "interaction_in_progress" || e.message?.includes("interaction_in_progress")) {
                if (window.confirm("Authentication is already in progress. This can happen if you have another login popup open. Reload the page to clear the state?")) {
                    window.location.reload();
                }
                return;
            }
            console.error("Login failed", e);
            alert(`Login failed: ${e.message}`);
        }
    };

    const handleLogout = async () => {
        try {
            await logoutFor('my');
            setIsAuthenticated(false);
            setUserProfile(null);
            setEmails([]);
            setSelectedEmail(null);
        } catch (e) {
            console.error("Logout failed", e);
        }
    };

    const loadData = async () => {
        setIsLoading(true);
        try {
            const profile = await getUserProfile('my');
            setUserProfile(profile);
            const mailData = await getEmails('my', 20, sortOrder, activeFolder);
            if (mailData && mailData.value) {
                setEmails(mailData.value);
            } else {
                setEmails([]);
            }
        } catch (e) {
            console.error("Failed to load data", e);
            setEmails([]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelectEmail = async (email: any) => {
        setSelectedEmail(email);
        setAiSummary('');
        setReplyDraft('');
        setSuccessMsg('');

        // Mark as read immediately
        try {
            await markEmailAsRead('my', email.id);
        } catch (e) {
            console.error("Failed to mark email as read", e);
            // Don't block UI for this, but log it.
        }

        // Auto-summarize
        setIsSummarizing(true);
        const bodyText = email.bodyPreview || email.body?.content || "";
        const summary = await generateEmailSummary(email.subject, email.from?.emailAddress?.name || "Unknown", bodyText);
        setAiSummary(summary);
        setIsSummarizing(false);
    };

    const handleGenerateReply = async () => {
        if (!selectedEmail) return;
        setIsDrafting(true);
        const bodyText = selectedEmail.bodyPreview || selectedEmail.body?.content || "";
        const senderName = selectedEmail.from?.emailAddress?.name || "Sender";
        const draft = await generateEmailReply(senderName, bodyText, replyTone);
        setReplyDraft(draft);
        setIsDrafting(false);
    };

    const handleSendReply = async () => {
        if (!selectedEmail || !replyDraft) return;
        setIsSending(true);
        try {
            await sendReply('my', selectedEmail.id, replyDraft);
            setSuccessMsg("Reply sent successfully!");
            setTimeout(() => setSuccessMsg(''), 3000);
            setReplyDraft(''); // Clear draft
        } catch (e) {
            alert("Failed to send reply. Please try again.");
        } finally {
            setIsSending(false);
        }
    };

    const handleCopyUri = () => {
        navigator.clipboard.writeText(redirectUri);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!isAuthenticated) {
        return (
            <div className="h-full flex flex-col items-center justify-center bg-slate-50 p-6">
                <div className="bg-white p-10 rounded-2xl shadow-xl text-center max-w-md border border-slate-200">
                    <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-200">
                        <Mail size={40} className="text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-slate-800 mb-2">SMAIL</h1>
                    <p className="text-slate-500 mb-8">Intelligent Outlook Assistant powered by Microsoft Graph & Gemini AI.</p>
                    <button
                        onClick={handleLogin}
                        className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl hover:bg-black transition-all flex items-center justify-center gap-3 shadow-lg hover:shadow-xl active:scale-[0.98]"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 23 23"><path fill="#f35325" d="M1 1h10v10H1z" /><path fill="#81bc06" d="M12 1h10v10H12z" /><path fill="#05a6f0" d="M1 12h10v10H1z" /><path fill="#ffba08" d="M12 12h10v10H12z" /></svg>
                        Connect with Outlook
                    </button>
                    <p className="text-xs text-slate-400 mt-4">Secure OAuth2 Authorization</p>

                    <div className="mt-8 p-4 bg-blue-50 border border-blue-100 rounded-xl text-left">
                        <p className="text-[10px] font-bold text-blue-800 uppercase mb-2">Azure Configuration: Redirect URI</p>
                        <p className="text-[11px] text-blue-600/80 mb-2 leading-tight">
                            Copy this URL and add it to your Azure App Registration under <strong>Authentication &gt; Single-page application &gt; Redirect URIs</strong>.
                        </p>
                        <div
                            onClick={handleCopyUri}
                            className="flex items-center justify-between bg-white border border-blue-200 rounded px-3 py-2 cursor-pointer hover:border-blue-400 transition-colors group"
                            title="Click to Copy"
                        >
                            <code className="text-xs text-slate-600 font-mono truncate mr-2">{redirectUri}</code>
                            {copied ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} className="text-slate-400 group-hover:text-blue-500" />}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full bg-white relative">
            {/* Sidebar List */}
            <div className="w-1/3 border-r border-slate-200 flex flex-col min-w-[320px]">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                            {userProfile?.displayName?.charAt(0) || <User size={16} />}
                        </div>
                        <div className="overflow-hidden">
                            <h3 className="font-bold text-sm text-slate-800 truncate w-32">{userProfile?.displayName || 'User'}</h3>
                            <p className="text-xs text-slate-500 truncate w-32">{userProfile?.mail || ''}</p>
                        </div>
                    </div>
                    <div className="flex gap-1 items-center">
                        <div className="flex bg-white border border-slate-200 rounded-lg p-0.5 mr-2">
                            <button onClick={() => setActiveFolder('inbox')} className={`p-1.5 rounded-md transition-colors ${activeFolder === 'inbox' ? 'bg-blue-100 text-blue-600' : 'text-slate-400 hover:text-slate-600'}`} title="Inbox"><Inbox size={14} /></button>
                            <button onClick={() => setActiveFolder('deleteditems')} className={`p-1.5 rounded-md transition-colors ${activeFolder === 'deleteditems' ? 'bg-red-100 text-red-600' : 'text-slate-400 hover:text-slate-600'}`} title="Deleted Items"><Archive size={14} /></button>
                        </div>
                        <button
                            onClick={() => setSortOrder(prev => prev === 'DESC' ? 'ASC' : 'DESC')}
                            className="p-2 text-slate-500 hover:text-blue-600 hover:bg-white rounded-lg transition-colors"
                            title={`Sort by ${sortOrder === 'DESC' ? 'Oldest' : 'Newest'}`}
                        >
                            <ArrowDownUp size={16} />
                        </button>
                        <button onClick={loadData} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-white rounded-lg transition-colors" title="Refresh">
                            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                        <button onClick={handleLogout} className="p-2 text-slate-500 hover:text-red-600 hover:bg-white rounded-lg transition-colors" title="Sign Out">
                            <LogOut size={16} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {emails.length === 0 && !isLoading ? (
                        <div className="p-8 text-center text-slate-400 flex flex-col items-center">
                            <Inbox size={32} className="mb-2 opacity-50" />
                            <p className="text-xs">No emails found in {activeFolder}.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {emails.map((email: any) => (
                                <button
                                    key={email.id}
                                    onClick={() => handleSelectEmail(email)}
                                    className={`w-full text-left p-4 hover:bg-slate-50 transition-colors flex flex-col gap-1 ${selectedEmail?.id === email.id ? 'bg-blue-50/50 border-l-4 border-blue-500' : 'border-l-4 border-transparent'}`}
                                >
                                    <div className="flex justify-between items-baseline w-full">
                                        <span className={`text-sm font-bold truncate pr-2 ${selectedEmail?.id === email.id ? 'text-blue-700' : 'text-slate-800'}`}>
                                            {email.from?.emailAddress?.name || email.from?.emailAddress?.address}
                                        </span>
                                        <span className="text-[10px] text-slate-400 shrink-0">
                                            {new Date(email.receivedDateTime).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <span className="text-xs font-medium text-slate-600 truncate w-full block">
                                        {email.subject || '(No Subject)'}
                                    </span>
                                    <p className="text-[10px] text-slate-400 line-clamp-2 leading-relaxed">
                                        {email.bodyPreview}
                                    </p>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Reading Pane */}
            <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-hidden">
                {selectedEmail ? (
                    <div className="flex flex-col h-full">
                        {/* Email Header */}
                        <div className="bg-white p-6 border-b border-slate-200 shadow-sm shrink-0">
                            <h2 className="text-xl font-bold text-slate-800 mb-2">{selectedEmail.subject}</h2>
                            <div className="flex justify-between items-end">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                                        <User size={20} />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-slate-700">
                                            {selectedEmail.from?.emailAddress?.name}
                                            <span className="font-normal text-slate-400 ml-2">&lt;{selectedEmail.from?.emailAddress?.address}&gt;</span>
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            {new Date(selectedEmail.receivedDateTime).toLocaleString()}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 flex overflow-hidden">
                            {/* Email Body */}
                            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-white">
                                <div
                                    className="prose prose-sm max-w-none text-slate-800"
                                    dangerouslySetInnerHTML={{ __html: selectedEmail.body?.content || selectedEmail.bodyPreview }}
                                />
                            </div>

                            {/* AI Sidebar */}
                            <div className="w-[350px] bg-slate-50 border-l border-slate-200 flex flex-col shrink-0 shadow-inner">
                                <div className="p-4 border-b border-slate-200 flex items-center gap-2 text-indigo-700 bg-indigo-50/50">
                                    <Sparkles size={16} />
                                    <span className="font-bold text-xs uppercase tracking-wider">AI Intelligence</span>
                                </div>

                                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-6">
                                    {/* Summary Section */}
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-bold text-slate-500 uppercase">Summary</h4>
                                        {isSummarizing ? (
                                            <div className="flex items-center gap-2 text-xs text-slate-400 animate-pulse">
                                                <Loader2 size={12} className="animate-spin" /> Analyzing email...
                                            </div>
                                        ) : aiSummary ? (
                                            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm text-sm text-slate-700 leading-relaxed">
                                                {aiSummary}
                                            </div>
                                        ) : (
                                            <p className="text-xs text-slate-400 italic">No summary available.</p>
                                        )}
                                    </div>

                                    {/* Reply Section */}
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center">
                                            <h4 className="text-xs font-bold text-slate-500 uppercase">Draft Reply</h4>
                                            <div className="flex bg-white rounded-lg p-0.5 border border-slate-200 shadow-sm">
                                                {(['Professional', 'Friendly', 'Brief'] as const).map(tone => (
                                                    <button
                                                        key={tone}
                                                        onClick={() => setReplyTone(tone)}
                                                        className={`px-2 py-1 text-[10px] font-bold rounded ${replyTone === tone ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                                                    >
                                                        {tone}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="relative">
                                            <textarea
                                                className="w-full h-64 p-3 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none bg-white shadow-sm"
                                                placeholder="AI generated draft will appear here..."
                                                value={replyDraft}
                                                onChange={(e) => setReplyDraft(e.target.value)}
                                            />
                                            {!replyDraft && !isDrafting && (
                                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                    <button className="bg-indigo-50 text-indigo-600 px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 pointer-events-auto hover:bg-indigo-100 transition-colors shadow-sm border border-indigo-100" onClick={handleGenerateReply}>
                                                        <Sparkles size={14} /> Generate Draft
                                                    </button>
                                                </div>
                                            )}
                                            {isDrafting && (
                                                <div className="absolute inset-0 flex items-center justify-center bg-white/50 backdrop-blur-[1px] rounded-xl">
                                                    <Loader2 size={24} className="animate-spin text-indigo-600" />
                                                </div>
                                            )}
                                        </div>

                                        {successMsg && (
                                            <div className="p-2 bg-emerald-50 text-emerald-700 text-xs rounded-lg flex items-center justify-center gap-2 animate-in fade-in">
                                                <CheckCircle2 size={14} /> {successMsg}
                                            </div>
                                        )}

                                        <div className="flex gap-2 pt-2">
                                            <button
                                                onClick={handleGenerateReply}
                                                disabled={isDrafting}
                                                className="flex-1 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-xs font-bold hover:bg-white hover:border-slate-400 transition-all flex items-center justify-center gap-2"
                                            >
                                                <RefreshCw size={14} className={isDrafting ? 'animate-spin' : ''} /> Regenerate
                                            </button>
                                            <button
                                                onClick={handleSendReply}
                                                disabled={!replyDraft || isSending}
                                                className="flex-[2] py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                                {isSending ? 'Sending...' : 'Send Reply'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-slate-50/50">
                        <Mail size={64} className="mb-4 opacity-10" />
                        <p className="text-sm font-medium">Select an email to view details.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SmailApp;
