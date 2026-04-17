
import React, { useState, useEffect, useMemo } from 'react';
import { loginFor, logoutFor, getAccountFor, loginRequest, initializeMsal } from "../services/smailAuth";
import { getUserProfile, getEmails, sendReply, markEmailAsRead } from "../services/smailGraph";
import { generateEmailSummary, generateEmailReply } from "../services/geminiService";
import { Mail, User, LogOut, RefreshCw, Send, Sparkles, Loader2, CheckCircle2, Copy, ArrowDownUp, Inbox, Archive, Upload, X, FileText, Search, Eye } from 'lucide-react';
import DOMPurify from 'dompurify';

/** Sanitize Outlook HTML for safe, clean display */
const sanitizeEmailHtml = (html: string): string => {
    if (!html) return '';
    // Remove cid: image references (embedded images we can't display)
    let cleaned = html.replace(/<img[^>]*src=["']cid:[^"']*["'][^>]*>/gi, '');
    // Strip <style> blocks that break our layout
    cleaned = cleaned.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    // Strip <meta>, <link>, <title>, <head> tags
    cleaned = cleaned.replace(/<(meta|link|title|head)[^>]*>([\s\S]*?<\/\1>)?/gi, '');
    // Remove Word/Outlook conditional comments
    cleaned = cleaned.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '');
    // Sanitize with DOMPurify
    return DOMPurify.sanitize(cleaned, {
        ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'span', 'blockquote', 'pre', 'code', 'hr', 'img', 'sub', 'sup'],
        ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target', 'rel', 'colspan', 'rowspan', 'width', 'height', 'align', 'valign'],
        ALLOW_DATA_ATTR: false,
    });
};

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
    const [userPrompt, setUserPrompt] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [showPreview, setShowPreview] = useState(false);
    const [previewDraft, setPreviewDraft] = useState('');

    const [redirectUri] = useState(`${window.location.origin}`); // Updated for Auth File
    const [copied, setCopied] = useState(false);
    const [sortOrder, setSortOrder] = useState<'DESC' | 'ASC'>('DESC');
    const [activeFolder, setActiveFolder] = useState<'inbox' | 'deleteditems'>('inbox');

    // Context files & AI lookup
    const [contextFiles, setContextFiles] = useState<{ name: string; content: string }[]>([]);
    const [aiLookupResult, setAiLookupResult] = useState('');
    const [isLookingUp, setIsLookingUp] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

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
        } catch (e: any) {
            console.error("Failed to load data", e);
            // If the error is auth-related (user cancelled consent, token expired, etc.), reset to login
            if (e.name === 'InteractionRequiredAuthError' || e.name === 'BrowserAuthError' ||
                e.errorCode === 'user_cancelled' || e.errorCode === 'invalid_grant' ||
                e.errorCode === 'interaction_required' || e.errorCode === 'consent_required' ||
                e.message?.includes('user_cancelled') || e.message?.includes('No account selected')) {
                await logoutFor('my');
                setIsAuthenticated(false);
                setUserProfile(null);
            }
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
        // Reset context on new email
        setContextFiles([]);
        setAiLookupResult('');
    };

    const handleFileDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files) as File[];
        await processFiles(files);
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        const files = Array.from(e.target.files) as File[];
        await processFiles(files);
        e.target.value = '';
    };

    const processFiles = async (files: File[]) => {
        const newFiles: { name: string; content: string }[] = [];
        for (const file of files) {
            if (file.size > 2_000_000) continue; // Skip files > 2MB
            try {
                if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                    // Use Gemini to extract text from PDF
                    const base64 = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const res = reader.result as string;
                            resolve(res.split(',')[1]);
                        };
                        reader.readAsDataURL(file);
                    });
                    const { GoogleGenAI } = await import('../services/geminiClient');
                    const ai = new GoogleGenAI();
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.0-flash',
                        contents: [
                            {
                                role: 'user',
                                parts: [
                                    { inlineData: { mimeType: 'application/pdf', data: base64 } },
                                    { text: 'Extract ALL text content from this PDF document. Include every detail: names, dates, numbers, addresses, items, quantities, prices, terms, and any other data. Output the raw extracted text only, no commentary.' }
                                ]
                            }
                        ]
                    });
                    const extracted = response.text || '';
                    newFiles.push({ name: file.name, content: extracted.substring(0, 8000) });
                } else {
                    // Text-based files
                    const text = await file.text();
                    newFiles.push({ name: file.name, content: text.substring(0, 5000) });
                }
            } catch (err) {
                console.error('File processing error:', err);
            }
        }
        setContextFiles(prev => [...prev, ...newFiles]);
    };

    const removeContextFile = (index: number) => {
        setContextFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleAiLookup = async () => {
        if (!selectedEmail) return;
        setIsLookingUp(true);
        try {
            const bodyText = selectedEmail.bodyPreview || selectedEmail.body?.content || '';
            const prompt = `Based on this email from ${selectedEmail.from?.emailAddress?.name || 'Unknown'} about "${selectedEmail.subject}", extract the key business terms, product names, quantities, prices, and any relevant data points that would be useful for drafting a reply. Be concise. Email: ${bodyText.substring(0, 2000)}`;
            const { GoogleGenAI } = await import('../services/geminiClient');
            const ai = new GoogleGenAI();
            const response = await ai.models.generateContent({ model: 'gemini-2.0-flash', contents: prompt });
            setAiLookupResult(response.text || 'No relevant data found.');
        } catch {
            setAiLookupResult('Lookup failed. Please try again.');
        }
        setIsLookingUp(false);
    };

    const handleGenerateReply = async () => {
        if (!selectedEmail) return;
        setIsDrafting(true);
        const bodyText = selectedEmail.bodyPreview || selectedEmail.body?.content || '';
        const senderName = selectedEmail.from?.emailAddress?.name || 'Sender';
        // Build additional context from uploaded files and AI lookup
        let extraContext = '';
        if (contextFiles.length > 0) {
            extraContext += '\n\nReference Documents:\n' + contextFiles.map(f => `--- ${f.name} ---\n${f.content}`).join('\n\n');
        }
        if (aiLookupResult) {
            extraContext += '\n\nAI Lookup Data:\n' + aiLookupResult;
        }
        if (userPrompt.trim()) {
            extraContext += '\n\nUser Instructions:\n' + userPrompt.trim();
        }
        const draft = await generateEmailReply(senderName, bodyText + extraContext, replyTone);
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
                            {/* Email Body + Summary */}
                            <div className="flex-1 flex flex-col overflow-hidden">
                                <div className="flex-1 overflow-hidden bg-white">
                                    <iframe
                                        srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#334155;line-height:1.6;padding:24px;margin:0;word-wrap:break-word;}a{color:#3b82f6;}img{max-width:100%;height:auto;}table{border-collapse:collapse;max-width:100%;}td,th{padding:4px 8px;}</style></head><body>${selectedEmail.body?.content || selectedEmail.bodyPreview || ''}</body></html>`}
                                        sandbox="allow-same-origin"
                                        className="w-full h-full border-0"
                                        title="Email body"
                                    />
                                </div>
                                {/* Summary below email */}
                                <div className="shrink-0 border-t border-slate-200 bg-slate-50 p-4 max-h-64 overflow-y-auto custom-scrollbar">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Summary</h4>
                                    {isSummarizing ? (
                                        <div className="flex items-center gap-2 text-xs text-slate-400 animate-pulse">
                                            <Loader2 size={12} className="animate-spin" /> Analyzing email...
                                        </div>
                                    ) : aiSummary ? (
                                        <ul className="list-disc list-inside space-y-1">
                                            {aiSummary.split('\n').filter((l: string) => l.trim()).map((line: string, i: number) => (
                                                <li key={i} className="text-sm text-slate-700">{line.replace(/^[-•*]\s*/, '')}</li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-xs text-slate-400 italic">No summary available.</p>
                                    )}
                                </div>
                            </div>

                            {/* AI Sidebar */}
                            <div className="w-[350px] bg-slate-50 border-l border-slate-200 flex flex-col shrink-0 shadow-inner">
                                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-6">

                                    {/* Context Documents */}
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-bold text-slate-500 uppercase">Context Documents</h4>
                                        <div
                                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                                            onDragLeave={() => setIsDragging(false)}
                                            onDrop={handleFileDrop}
                                            className={`relative border-2 border-dashed rounded-xl p-3 text-center transition-all cursor-pointer ${isDragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                                        >
                                            <input
                                                type="file"
                                                multiple
                                                accept=".txt,.csv,.json,.md,.xml,.html,.pdf"
                                                onChange={handleFileSelect}
                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                            />
                                            <Upload size={16} className={`mx-auto mb-1 ${isDragging ? 'text-indigo-500' : 'text-slate-300'}`} />
                                            <p className="text-[10px] text-slate-400">Drop files or click to upload</p>
                                        </div>
                                        {contextFiles.length > 0 && (
                                            <div className="space-y-1">
                                                {contextFiles.map((f, i) => (
                                                    <div key={i} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                                                        <FileText size={12} className="text-indigo-500 shrink-0" />
                                                        <span className="text-[11px] text-slate-600 truncate flex-1">{f.name}</span>
                                                        <button onClick={() => removeContextFile(i)} className="text-slate-300 hover:text-red-500 transition-colors shrink-0"><X size={12} /></button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                    </div>

                                    {/* User Reply Instructions */}
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-bold text-slate-500 uppercase">Reply Instructions</h4>
                                        <textarea
                                            className="w-full h-20 p-2.5 text-xs border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none bg-white shadow-sm placeholder:text-slate-400"
                                            placeholder="Tell the AI how to reply, e.g. 'Confirm the shipment dates and ask about pricing...'"
                                            value={userPrompt}
                                            onChange={(e) => setUserPrompt(e.target.value)}
                                        />
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
                                                onClick={() => { setPreviewDraft(replyDraft); setShowPreview(true); }}
                                                disabled={!replyDraft}
                                                className="flex-[2] py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <Eye size={14} /> Preview Email
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

            {/* Preview Modal */}
            {showPreview && selectedEmail && (
                <PreviewModal
                    selectedEmail={selectedEmail}
                    draft={previewDraft}
                    onDraftChange={setPreviewDraft}
                    onSend={async () => {
                        setIsSending(true);
                        try {
                            await sendReply('my', selectedEmail.id, previewDraft);
                            setSuccessMsg('Reply sent successfully!');
                            setTimeout(() => setSuccessMsg(''), 3000);
                            setReplyDraft('');
                            setPreviewDraft('');
                            setShowPreview(false);
                        } catch {
                            setSuccessMsg('Failed to send reply.');
                            setTimeout(() => setSuccessMsg(''), 3000);
                        } finally {
                            setIsSending(false);
                        }
                    }}
                    onClose={() => setShowPreview(false)}
                    isSending={isSending}
                />
            )}
        </div>
    );
};

// ─── Preview Modal ─────────────────────────────────────────────────
function PreviewModal({ selectedEmail, draft, onDraftChange, onSend, onClose, isSending }: {
    selectedEmail: any;
    draft: string;
    onDraftChange: (v: string) => void;
    onSend: () => void;
    onClose: () => void;
    isSending: boolean;
}) {
    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Send size={18} className="text-indigo-500" /> Preview Reply
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors"><X size={20} /></button>
                </div>

                {/* Email meta */}
                <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 shrink-0 space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                        <span className="text-slate-400 font-medium w-10">To:</span>
                        <span className="text-slate-700 font-semibold">{selectedEmail?.from?.emailAddress?.name || selectedEmail?.from?.emailAddress?.address || 'Unknown'}</span>
                        <span className="text-slate-400 text-xs">&lt;{selectedEmail?.from?.emailAddress?.address}&gt;</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <span className="text-slate-400 font-medium w-10">Re:</span>
                        <span className="text-slate-600">{selectedEmail?.subject || '(No Subject)'}</span>
                    </div>
                </div>

                {/* Editable body */}
                <div className="flex-1 overflow-hidden p-6">
                    <textarea
                        className="w-full h-full min-h-[300px] p-4 text-sm text-slate-700 leading-relaxed border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none bg-white"
                        value={draft}
                        onChange={(e) => onDraftChange(e.target.value)}
                        autoFocus
                    />
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3 shrink-0">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onSend}
                        disabled={!draft.trim() || isSending}
                        className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-all shadow-md active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        {isSending ? 'Sending...' : 'Send Reply'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default SmailApp;
