
import React, { useState, useEffect } from 'react';
import { Mail, CheckCircle2, AlertCircle, Loader2, Key, Shield, LogOut, ExternalLink, RefreshCw } from 'lucide-react';
import {
    initializeMsal,
    loginFor,
    logoutFor,
    getAccountFor,
    getTokenFor,
    loginRequest,
    loginForGoogle,
    getGoogleAccount,
    getTokenForGoogle,
    logoutGoogle,
    type ProcessorKey,
} from '../services/smailAuth';

interface ConnectedAccount {
    provider: 'OUTLOOK' | 'GMAIL';
    email: string;
    status: 'ACTIVE' | 'EXPIRED';
}

const MSAL_KEY: ProcessorKey = 'automation';

const AdminCredentials: React.FC = () => {
    const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [actionError, setActionError] = useState('');
    const [isConnecting, setIsConnecting] = useState<'OUTLOOK' | 'GMAIL' | null>(null);
    const [verifyResult, setVerifyResult] = useState<{ email: string; ok: boolean; msg: string } | null>(null);

    // Refresh account list from auth state
    const refreshAccounts = async () => {
        await initializeMsal();
        const list: ConnectedAccount[] = [];

        // Check MSAL (Outlook)
        const msalAccount = getAccountFor(MSAL_KEY);
        if (msalAccount) {
            list.push({
                provider: 'OUTLOOK',
                email: msalAccount.username || msalAccount.name || 'Outlook Account',
                status: 'ACTIVE',
            });
        }

        // Check Google
        const googleAccount = getGoogleAccount();
        if (googleAccount) {
            // Check if token is still valid
            let status: 'ACTIVE' | 'EXPIRED' = 'ACTIVE';
            try {
                const expiry = localStorage.getItem('smail.google.expiry');
                if (expiry && Date.now() > parseInt(expiry)) {
                    status = 'EXPIRED';
                }
            } catch { /* ignore */ }

            list.push({
                provider: 'GMAIL',
                email: googleAccount.email,
                status,
            });
        }

        setAccounts(list);
        setIsLoading(false);
    };

    useEffect(() => {
        refreshAccounts();
    }, []);

    // ─── Outlook Sign-In ────────────────────────────────────────────────
    const handleOutlookSignIn = async () => {
        setIsConnecting('OUTLOOK');
        setActionError('');
        try {
            await loginFor(MSAL_KEY, loginRequest.scopes);
        } catch (e: any) {
            if (!e.message?.includes('Redirecting')) {
                setActionError('Microsoft sign-in failed. Please try again.');
                setIsConnecting(null);
            }
        }
    };

    const handleOutlookDisconnect = async () => {
        await logoutFor(MSAL_KEY);
        setVerifyResult(null);
        refreshAccounts();
    };

    // ─── Gmail Sign-In ──────────────────────────────────────────────────
    const handleGmailSignIn = async () => {
        setIsConnecting('GMAIL');
        setActionError('');
        try {
            const result = await loginForGoogle();
            setIsConnecting(null);
            refreshAccounts();
        } catch (e: any) {
            setActionError(e.message || 'Google sign-in failed. Please try again.');
            setIsConnecting(null);
        }
    };

    const handleGmailDisconnect = () => {
        logoutGoogle();
        setVerifyResult(null);
        refreshAccounts();
    };

    // ─── Verify Connection ──────────────────────────────────────────────
    const handleVerify = async (account: ConnectedAccount) => {
        setVerifyResult(null);
        try {
            if (account.provider === 'OUTLOOK') {
                const token = await getTokenFor(MSAL_KEY, loginRequest.scopes);
                const resp = await fetch('https://graph.microsoft.com/v1.0/me', {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (resp.ok) {
                    setVerifyResult({ email: account.email, ok: true, msg: 'Microsoft Graph API — connection verified.' });
                } else {
                    setVerifyResult({ email: account.email, ok: false, msg: `Graph API returned ${resp.status}` });
                }
            } else if (account.provider === 'GMAIL') {
                const token = await getTokenForGoogle();
                const resp = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (resp.ok) {
                    setVerifyResult({ email: account.email, ok: true, msg: 'Gmail API — connection verified.' });
                } else {
                    setVerifyResult({ email: account.email, ok: false, msg: `Gmail API returned ${resp.status}` });
                }
            }
            refreshAccounts();
        } catch (e: any) {
            setVerifyResult({ email: account.email, ok: false, msg: e.message || 'Verification failed.' });
        }
    };

    // ─── Render ─────────────────────────────────────────────────────────
    return (
        <div className="max-w-3xl mx-auto space-y-8 pb-12">

            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-r from-slate-600 to-slate-700 rounded-xl text-white"><Key size={24} /></div>
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Email Integration</h1>
                    <p className="text-slate-500 text-sm mt-1">Sign in with your email provider to enable sending, scanning, and AI processing.</p>
                </div>
            </div>

            {/* Error Banner */}
            {actionError && (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-center gap-3">
                    <AlertCircle size={18} /> {actionError}
                </div>
            )}

            {/* Verification Result */}
            {verifyResult && (
                <div className={`p-4 rounded-xl text-sm flex items-center gap-3 border ${verifyResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                    {verifyResult.ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                    <div>
                        <span className="font-bold">{verifyResult.email}</span> — {verifyResult.msg}
                    </div>
                </div>
            )}

            {/* Connected Accounts */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <Shield size={18} className="text-emerald-600" /> Connected Accounts
                    </h3>
                </div>
                <div className="p-4">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8 text-slate-400">
                            <Loader2 size={20} className="animate-spin mr-2" /> Loading...
                        </div>
                    ) : accounts.length === 0 ? (
                        <div className="text-center py-8 text-slate-400">
                            <Mail size={32} className="mx-auto mb-3 opacity-30" />
                            <p className="text-sm">No accounts connected yet.</p>
                            <p className="text-xs mt-1">Use the sign-in buttons below to connect your email.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {accounts.map(acc => (
                                <div key={acc.email} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${acc.provider === 'OUTLOOK' ? 'bg-blue-600' : 'bg-red-500'}`}>
                                            {acc.provider === 'OUTLOOK' ? 'O' : 'G'}
                                        </div>
                                        <div>
                                            <div className="font-bold text-slate-800 text-sm">{acc.email}</div>
                                            <div className="text-xs text-slate-500 flex items-center gap-2">
                                                <span>{acc.provider === 'OUTLOOK' ? 'Microsoft Outlook' : 'Google Gmail'}</span>
                                                <span>•</span>
                                                <span className={acc.status === 'ACTIVE' ? 'text-emerald-600 font-bold' : 'text-amber-500 font-bold'}>
                                                    {acc.status === 'ACTIVE' ? 'Active' : 'Token Expired'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleVerify(acc)}
                                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                            title="Test Connection"
                                        >
                                            <RefreshCw size={16} />
                                        </button>
                                        <button
                                            onClick={() => acc.provider === 'OUTLOOK' ? handleOutlookDisconnect() : handleGmailDisconnect()}
                                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                            title="Disconnect"
                                        >
                                            <LogOut size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Sign-In Buttons */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* Outlook */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col items-center text-center space-y-4">
                    <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center">
                        <Mail size={28} className="text-blue-600" />
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-800">Microsoft Outlook</h4>
                        <p className="text-xs text-slate-500 mt-1">Send and scan emails via Microsoft 365</p>
                    </div>
                    {accounts.some(a => a.provider === 'OUTLOOK') ? (
                        <div className="flex items-center gap-2 text-xs text-emerald-600 font-bold">
                            <CheckCircle2 size={14} /> Connected
                        </div>
                    ) : (
                        <button
                            onClick={handleOutlookSignIn}
                            disabled={isConnecting === 'OUTLOOK'}
                            className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-md shadow-blue-200"
                        >
                            {isConnecting === 'OUTLOOK' ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
                            Sign in with Microsoft
                        </button>
                    )}
                </div>

                {/* Gmail */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col items-center text-center space-y-4">
                    <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center">
                        <Mail size={28} className="text-red-500" />
                    </div>
                    <div>
                        <h4 className="font-bold text-slate-800">Google Gmail</h4>
                        <p className="text-xs text-slate-500 mt-1">Send and scan emails via Google Workspace</p>
                    </div>
                    {accounts.some(a => a.provider === 'GMAIL') ? (
                        <div className="flex items-center gap-2 text-xs text-emerald-600 font-bold">
                            <CheckCircle2 size={14} /> Connected
                        </div>
                    ) : (
                        <button
                            onClick={handleGmailSignIn}
                            disabled={isConnecting === 'GMAIL'}
                            className="w-full py-3 bg-red-500 text-white rounded-xl font-bold text-sm hover:bg-red-600 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-md shadow-red-200"
                        >
                            {isConnecting === 'GMAIL' ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
                            Sign in with Google
                        </button>
                    )}
                </div>
            </div>

            {/* Info */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 space-y-2">
                <p><strong>How it works:</strong> Your browser authenticates directly with Microsoft or Google. No passwords or secrets are stored — tokens are managed securely by the identity provider.</p>
                <p><strong>Permissions requested:</strong> Read and send email on your behalf. You can revoke access at any time from your Microsoft or Google account security settings.</p>
            </div>
        </div>
    );
};

export default AdminCredentials;
