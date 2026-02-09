
import React, { useState, useEffect } from 'react';
import { Mail, RefreshCw, Loader2, AlertCircle, CheckCircle2, Play, PauseCircle, Trash2, FileText, XCircle, Inbox } from 'lucide-react';
import { analyzeDocument } from '../services/geminiService';

interface EmailMessage {
    id: string;
    subject: string;
    from: string;
    receivedDateTime: string;
    hasAttachments: boolean;
    provider: 'GMAIL' | 'OUTLOOK' | 'IMAP';
    accountEmail: string;
    attachmentId?: string;
    attachmentName?: string;
    attachmentType?: string;
    status: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'ERROR';
    analysisResult?: string;
}

const getOutlookToken = async (tenantId: string, clientId: string, clientSecret: string): Promise<string> => {
    try {
        const originalEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

        const body = new URLSearchParams({
            client_id: clientId,
            scope: 'https://graph.microsoft.com/.default',
            client_secret: clientSecret,
            grant_type: 'client_credentials'
        });

        // Try direct call first, fall back to CORS proxy
        let response;
        try {
            response = await fetch(originalEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body
            });
        } catch {
            const proxyEndpoint = `https://api.allorigins.win/raw?url=${encodeURIComponent(originalEndpoint)}`;
            response = await fetch(proxyEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body
            });
        }

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Azure Auth Failed: ${errText}`);
        }

        const data = await response.json();
        return data.access_token;
    } catch (error: any) {
        throw new Error(`Outlook Auth Error: ${error.message}`);
    }
};

const AiEmailAssistant: React.FC = () => {
    const [emails, setEmails] = useState<EmailMessage[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [currentBox, setCurrentBox] = useState<'INBOX' | 'DELETED'>('INBOX');

    const scanEmails = async (boxOverride?: 'INBOX' | 'DELETED') => {
        const targetBox = boxOverride || currentBox;
        setIsScanning(true);
        setScanError(null);
        setEmails([]);

        const stored = localStorage.getItem('ai_email_accounts');
        const accounts = stored ? JSON.parse(stored) : [];

        if (accounts.length === 0) {
            setScanError("No email accounts configured. Go to Settings > Integrations.");
            setIsScanning(false);
            return;
        }

        const newEmails: EmailMessage[] = [];

        for (const acc of accounts) {
            if (acc.provider === 'OUTLOOK') {
                try {
                    const config = JSON.parse(acc.refreshToken || '{}');
                    const token = await getOutlookToken(config.tenantId, config.clientId, acc.password);

                    const folderId = targetBox === 'DELETED' ? 'deleteditems' : 'inbox';
                    // For Inbox, we only want unread to process new stuff. For Deleted, we show recent items regardless of read status.
                    const filterQuery = targetBox === 'INBOX' ? '$filter=isRead eq false&' : '';

                    const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${acc.email}/mailFolders/${folderId}/messages?${filterQuery}$orderby=receivedDateTime DESC&$top=50&$select=id,subject,from,receivedDateTime,hasAttachments`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });

                    if (resp.ok) {
                        const data = await resp.json();
                        const messages = data.value || [];

                        for (const msg of messages) {
                            if (msg.hasAttachments) {
                                const attachResp = await fetch(`https://graph.microsoft.com/v1.0/users/${acc.email}/messages/${msg.id}/attachments?$select=id,name,contentType,size`, {
                                    headers: { 'Authorization': `Bearer ${token}` }
                                });

                                if (attachResp.ok) {
                                    const attachData = await attachResp.json();
                                    const firstAtt = attachData.value?.find((a: any) => !a.isInline) || attachData.value?.[0];

                                    if (firstAtt) {
                                        newEmails.push({
                                            id: msg.id,
                                            subject: msg.subject || '(No Subject)',
                                            from: msg.from?.emailAddress?.address || 'Unknown',
                                            receivedDateTime: msg.receivedDateTime,
                                            hasAttachments: true,
                                            provider: 'OUTLOOK',
                                            accountEmail: acc.email,
                                            attachmentId: firstAtt.id,
                                            attachmentName: firstAtt.name,
                                            attachmentType: firstAtt.contentType,
                                            status: 'PENDING'
                                        });
                                    }
                                }
                            }
                        }
                    } else {
                        console.error(`Error fetching emails for ${acc.email}: ${resp.status}`);
                    }
                } catch (e) {
                    console.error(`Failed to scan outlook account ${acc.email}`, e);
                }
            }
            // GMAIL implementation omitted
        }

        setEmails(newEmails);
        setIsScanning(false);
    };

    const processEmail = async (email: EmailMessage) => {
        setEmails(prev => prev.map(e => e.id === email.id ? { ...e, status: 'PROCESSING' } : e));

        try {
            const stored = localStorage.getItem('ai_email_accounts');
            const accounts = stored ? JSON.parse(stored) : [];
            const acc = accounts.find((a: any) => a.email === email.accountEmail);

            let token = '';
            if (acc) {
                token = acc.password;
                if (acc.provider === 'OUTLOOK') {
                    const config = JSON.parse(acc.refreshToken || '{}');
                    token = await getOutlookToken(config.tenantId, config.clientId, acc.password);
                }
            }

            if (!token) throw new Error("Could not retrieve access token");

            // 1. Mark as Read immediately (Outlook)
            if (email.provider === 'OUTLOOK') {
                await fetch(`https://graph.microsoft.com/v1.0/users/${email.accountEmail}/messages/${email.id}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ isRead: true })
                });
            }

            // 2. Download Attachment
            let base64Content = '';
            if (email.provider === 'OUTLOOK' && email.attachmentId) {
                const url = `https://graph.microsoft.com/v1.0/users/${email.accountEmail}/messages/${email.id}/attachments/${email.attachmentId}/$value`;
                const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
                const blob = await resp.blob();

                base64Content = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const res = reader.result as string;
                        resolve(res.split(',')[1]);
                    }
                    reader.readAsDataURL(blob);
                });
            }

            if (!base64Content) throw new Error("Failed to download attachment");

            // 3. Analyze with Gemini
            const prompt = `Extract structured data from this document. Identify document type (Invoice, PO, BL, etc.) and key fields. Return JSON.`;

            const rawAnalysis: any = await analyzeDocument(base64Content, email.attachmentType || 'application/pdf', prompt);
            const analysis = typeof rawAnalysis === 'string' ? rawAnalysis : String(rawAnalysis);

            // 4. Move to Deleted Items (Outlook) - Only if currently in Inbox
            if (email.provider === 'OUTLOOK' && currentBox === 'INBOX') {
                await fetch(`https://graph.microsoft.com/v1.0/users/${email.accountEmail}/messages/${email.id}/move`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ destinationId: "deleteditems" })
                });
            }

            setEmails(prev => prev.map(e => e.id === email.id ? { ...e, status: 'PROCESSED', analysisResult: analysis } : e));

        } catch (e) {
            console.error("Processing failed", e);
            setEmails(prev => prev.map(e => e.id === email.id ? { ...e, status: 'ERROR' } : e));
        }
    };

    const handleClear = () => {
        setEmails([]);
    };

    const toggleBox = (box: 'INBOX' | 'DELETED') => {
        if (box !== currentBox) {
            setCurrentBox(box);
            scanEmails(box);
        }
    };

    return (
        <div className="h-full flex flex-col p-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Mail className="text-red-600" /> AI Email Assistant
                    </h2>
                    <p className="text-slate-500 text-sm">Automated inbox scanning and document extraction.</p>
                </div>
                <div className="flex gap-2">
                    {emails.length > 0 && (
                        <button onClick={handleClear} className="bg-white border border-slate-300 text-slate-600 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors">
                            <Trash2 size={16} /> Clear
                        </button>
                    )}
                    <button onClick={() => scanEmails()} disabled={isScanning} className="bg-red-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-red-700 transition-colors disabled:opacity-50">
                        {isScanning ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        Scan {currentBox === 'INBOX' ? 'Inbox' : 'Deleted'}
                    </button>
                </div>
            </div>

            {scanError && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-center gap-3">
                    <AlertCircle size={20} />
                    {scanError}
                </div>
            )}

            <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <div className="flex gap-2">
                        <button
                            onClick={() => toggleBox('INBOX')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${currentBox === 'INBOX' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <Inbox size={14} /> Inbox
                        </button>
                        <button
                            onClick={() => toggleBox('DELETED')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${currentBox === 'DELETED' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <XCircle size={14} /> Deleted Items
                        </button>
                    </div>
                    <span className="text-xs text-slate-500">{emails.length} emails found</span>
                </div>

                <div className="flex-1 overflow-y-auto p-0">
                    {emails.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                            <Mail size={48} className="mb-4 opacity-20" />
                            <p>No emails with attachments found in {currentBox === 'INBOX' ? 'Inbox' : 'Deleted Items'}.</p>
                        </div>
                    ) : (
                        <table className="w-full text-left">
                            <thead className="bg-slate-50 text-xs font-bold text-slate-500 uppercase sticky top-0">
                                <tr>
                                    <th className="p-4">Status</th>
                                    <th className="p-4">From</th>
                                    <th className="p-4">Subject</th>
                                    <th className="p-4">Attachment</th>
                                    <th className="p-4 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-sm">
                                {emails.map(email => (
                                    <tr key={email.id} className="hover:bg-slate-50">
                                        <td className="p-4">
                                            {email.status === 'PENDING' && <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold">Pending</span>}
                                            {email.status === 'PROCESSING' && <span className="bg-blue-100 text-blue-600 px-2 py-1 rounded text-xs font-bold flex items-center gap-1 w-fit"><Loader2 size={12} className="animate-spin" /> Processing</span>}
                                            {email.status === 'PROCESSED' && <span className="bg-emerald-100 text-emerald-600 px-2 py-1 rounded text-xs font-bold flex items-center gap-1 w-fit"><CheckCircle2 size={12} /> Done</span>}
                                            {email.status === 'ERROR' && <span className="bg-red-100 text-red-600 px-2 py-1 rounded text-xs font-bold flex items-center gap-1 w-fit"><AlertCircle size={12} /> Error</span>}
                                        </td>
                                        <td className="p-4 font-medium text-slate-700 truncate max-w-[200px]" title={email.from}>{email.from}</td>
                                        <td className="p-4 text-slate-600 truncate max-w-[300px]" title={email.subject}>{email.subject}</td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-2 text-slate-500">
                                                <FileText size={14} />
                                                <span className="truncate max-w-[200px]" title={email.attachmentName}>{email.attachmentName}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-right">
                                            {email.status === 'PENDING' && (
                                                <button onClick={() => processEmail(email)} className="text-blue-600 hover:text-blue-800 font-bold text-xs flex items-center gap-1 justify-end ml-auto">
                                                    <Play size={14} /> {currentBox === 'INBOX' ? 'Process' : 'Reprocess'}
                                                </button>
                                            )}
                                            {email.status === 'PROCESSED' && email.analysisResult && (
                                                <div className="text-xs text-slate-500 max-w-[200px] truncate">{email.analysisResult.substring(0, 50)}...</div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AiEmailAssistant;
