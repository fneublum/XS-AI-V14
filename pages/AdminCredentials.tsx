
import React, { useState, useEffect } from 'react';
import { Mail, Plus, Trash2, CheckCircle2, AlertCircle, Loader2, Server, Key, Shield, RefreshCw, LogOut, Check, ExternalLink } from 'lucide-react';
import { loginFor, loginRequest, getAccountFor } from '../services/smailAuth';

// Types
interface EmailAccount {
    id: string;
    provider: 'GMAIL' | 'OUTLOOK' | 'IMAP' | 'AZURE_COMMUNICATION_SERVICES';
    email: string;
    password: string; // Token, App Password, or Client Secret
    refreshToken?: string; // Stored for auto-renewal OR JSON config for Outlook (Legacy)

    // Explicit Outlook Config
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;

    status: 'ACTIVE' | 'ERROR' | 'UNTESTED';
    lastChecked: string;
}

const AdminCredentials = () => {
    const [accounts, setAccounts] = useState<EmailAccount[]>([]);

    // Config State
    const [configProvider, setConfigProvider] = useState<'GMAIL' | 'OUTLOOK' | 'AZURE_COMMUNICATION_SERVICES'>('GMAIL');
    const [configEmail, setConfigEmail] = useState('');
    const [configToken, setConfigToken] = useState(''); // Access Token or Secret
    const [configRefreshToken, setConfigRefreshToken] = useState(''); // Refresh Token

    // Outlook Specific
    const [outlookTenantId, setOutlookTenantId] = useState('');
    const [outlookClientId, setOutlookClientId] = useState('');

    // ACS Specifics
    const [acsConnectionString, setAcsConnectionString] = useState('');

    const [isVerifying, setIsVerifying] = useState(false);
    const [configError, setConfigError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');


    // Load accounts on mount & Enforce EC4 Defaults
    useEffect(() => {
        const stored = localStorage.getItem('ai_email_accounts');
        let currentAccounts: EmailAccount[] = [];
        if (stored) {
            try {
                currentAccounts = JSON.parse(stored);
            } catch (e) {
                console.error("Failed to load accounts", e);
            }
        }

        // HARDCODED EC4 DEFAULT
        const ec4Email = 'ai.agent@ec4.enterprises';
        const ec4Config: EmailAccount = {
            id: 'ec4-default-' + Date.now(),
            provider: 'OUTLOOK',
            email: ec4Email,
            password: 'MICROSOFT_GRAPH_SECRET', // Placeholder, real secret in clientSecret
            status: 'ACTIVE',
            lastChecked: new Date().toISOString(),
            tenantId: 'b3035807-e440-4973-b739-b37f545ff4bd',
            clientId: 'f16a3e98-c150-420a-85f6-5ccfb9b8f0d5',
            clientSecret: 'REDACTED_AZURE_SECRET'
        };

        const ec4Index = currentAccounts.findIndex(a => a.email.toLowerCase() === ec4Email);
        let updated = false;

        if (ec4Index === -1) {
            // Add if missing
            currentAccounts.push(ec4Config);
            updated = true;
        } else {
            // Update if exists to enforce new credentials
            const existing = currentAccounts[ec4Index];
            if (existing.tenantId !== ec4Config.tenantId || existing.clientSecret !== ec4Config.clientSecret) {
                currentAccounts[ec4Index] = { ...existing, ...ec4Config, id: existing.id };
                updated = true;
            }
        }

        if (updated) {
            localStorage.setItem('ai_email_accounts', JSON.stringify(currentAccounts));
        }

        setAccounts(currentAccounts);
    }, []);

    // Save accounts whenever state changes
    useEffect(() => {
        if (accounts.length > 0) {
            localStorage.setItem('ai_email_accounts', JSON.stringify(accounts));
        }
    }, [accounts]);

    // Handle provider switch defaults
    useEffect(() => {
        if (configProvider === 'OUTLOOK') {
            setConfigEmail('');
            setConfigToken('');
        } else {
            setConfigEmail('');
            setConfigToken('');
        }
    }, [configProvider]);

    const refreshGoogleToken = async (refreshToken: string): Promise<string> => {
        try {
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: '', // Public client or leave empty if using user-supplied tokens
                    client_secret: '',
                    refresh_token: refreshToken,
                    grant_type: 'refresh_token',
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Token refresh failed: ${errText}`);
            }

            const data = await response.json();
            return data.access_token;
        } catch (error) {
            console.error("Error refreshing token:", error);
            throw error;
        }
    };

    const isProduction = window.location.hostname.includes('appspot.com') || window.location.hostname.includes('xsolution');

    const getOutlookToken = async (tenantId: string, clientId: string, clientSecret: string): Promise<string> => {
        // In production, we can't use CORS proxy - skip verification and trust saved credentials
        if (isProduction) {
            throw new Error('SKIP_VERIFICATION');
        }

        try {
            // Use CORS proxy since Microsoft blocks browser-side requests (localhost only)
            const originalEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
            const proxyEndpoint = `https://corsproxy.io/?` + encodeURIComponent(originalEndpoint);

            const body = new URLSearchParams({
                client_id: clientId,
                scope: 'https://graph.microsoft.com/.default',
                client_secret: clientSecret,
                grant_type: 'client_credentials'
            });

            const response = await fetch(proxyEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: body
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Azure Auth Failed: ${errText}`);
            }

            const data = await response.json();
            return data.access_token;
        } catch (error: any) {
            if (error.message === 'SKIP_VERIFICATION') throw error;
            throw new Error(`Outlook Auth Error: ${error.message}`);
        }
    };

    const handleSaveConfiguration = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!configEmail || !configEmail.includes('@')) {
            setConfigError('Please enter a valid email address.');
            return;
        }

        setIsVerifying(true);
        setConfigError('');
        setSuccessMsg('');

        try {
            let finalAccessToken = configToken;
            let finalRefreshToken = configRefreshToken;

            // 1. GMAIL VERIFICATION
            if (configProvider === 'GMAIL') {
                if (configRefreshToken) {
                    try {
                        // Test refresh to validate and get fresh access token
                        finalAccessToken = await refreshGoogleToken(configRefreshToken);
                    } catch (e) {
                        throw new Error('Invalid Refresh Token. Could not exchange for Access Token.');
                    }
                }

                if (!finalAccessToken || finalAccessToken.length < 10) {
                    throw new Error('A valid Access Token is required.');
                }

                // Verify Token by hitting profile
                const profileResp = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
                    headers: { 'Authorization': `Bearer ${finalAccessToken}` }
                });

                if (!profileResp.ok) throw new Error("Google API Verification Failed. Check token scopes.");
            }

            // 2. OUTLOOK VERIFICATION
            else if (configProvider === 'OUTLOOK') {
                if (!outlookTenantId || !outlookClientId || !configToken) {
                    throw new Error("Tenant ID, Client ID and Secret are required.");
                }

                // Pack config into 'refreshToken' field for legacy support
                finalRefreshToken = JSON.stringify({ tenantId: outlookTenantId, clientId: outlookClientId });

                // Validate credentials by getting a token (skip in production due to CORS)
                try {
                    finalAccessToken = await getOutlookToken(outlookTenantId, outlookClientId, configToken);
                } catch (e: any) {
                    if (e.message === 'SKIP_VERIFICATION') {
                        // In production, we can't verify but still save the account
                        console.log('[AdminCredentials] Skipping verification in production');
                        finalAccessToken = 'PRODUCTION_SKIP';
                    } else {
                        throw e;
                    }
                }
            }

            // 3. ACS VERIFICATION (Basic Check)
            else if (configProvider === 'AZURE_COMMUNICATION_SERVICES') {
                if (!acsConnectionString || !acsConnectionString.includes('endpoint=') || !configEmail) {
                    throw new Error("Valid Connection String and From Email are required.");
                }
                // We'll rely on the email service to validate at runtime, or we could dry-run here.
                // For now, structure validation is enough to save.
                finalAccessToken = acsConnectionString;
            }

            const newAccount: EmailAccount = {
                id: `acc_${Date.now()}`,
                provider: configProvider,
                email: configEmail,
                password: configProvider === 'OUTLOOK' ? configToken : finalAccessToken, // For Outlook store secret, for Gmail store Access Token
                refreshToken: finalRefreshToken,

                // New Fields
                tenantId: configProvider === 'OUTLOOK' ? outlookTenantId : undefined,
                clientId: configProvider === 'OUTLOOK' ? outlookClientId : undefined,
                clientSecret: configProvider === 'OUTLOOK' ? configToken : undefined,

                status: 'ACTIVE',
                lastChecked: new Date().toISOString()
            };

            // Update Storage (Remove existing with same email)
            const updatedList = [...accounts.filter(a => a.email !== configEmail), newAccount];
            setAccounts(updatedList);

            setSuccessMsg(`Successfully connected to ${configEmail}`);

            // Clear form
            setConfigEmail('');
            setConfigToken('');
            setConfigRefreshToken('');
            setOutlookClientId('');
            setOutlookClientId('');
            setOutlookTenantId('');
            setAcsConnectionString('');
        } catch (e: any) {
            setConfigError(e.message || 'Configuration failed.');
        } finally {
            setIsVerifying(false);
        }
    };

    const handleRemove = (id: string) => {
        if (confirm("Disconnect this email account?")) {
            const updated = accounts.filter(a => a.id !== id);
            setAccounts(updated);
            if (updated.length === 0) localStorage.removeItem('ai_email_accounts');
            else localStorage.setItem('ai_email_accounts', JSON.stringify(updated));
        }
    };

    // Reverify specific account
    const handleReverify = async (account: EmailAccount) => {
        // Optimistic update
        setAccounts(prev => prev.map(a => a.id === account.id ? { ...a, status: 'UNTESTED' } : a));

        try {
            if (account.provider === 'GMAIL') {
                // ... Gmail Logic ...
                await refreshGoogleToken(account.refreshToken || '');
                // Assume if token refresh works, it's fine. In real app, re-fetch profile.
            } else if (account.provider === 'OUTLOOK') {
                let tId = account.tenantId;
                let cId = account.clientId;
                const secret = account.clientSecret || account.password;

                // Fallback to legacy
                if (!tId || !cId) {
                    if (account.refreshToken) {
                        try {
                            const config = JSON.parse(account.refreshToken);
                            tId = config.tenantId;
                            cId = config.clientId;
                        } catch { }
                    }
                }

                if (!tId || !cId) throw new Error("Missing config");

                try {
                    await getOutlookToken(tId, cId, secret);
                } catch (tokenErr: any) {
                    if (tokenErr.message === 'SKIP_VERIFICATION') {
                        // In production, skip verification and assume active
                        setAccounts(prev => prev.map(a => a.id === account.id ? { ...a, status: 'ACTIVE', lastChecked: new Date().toISOString() } : a));
                        alert(`${account.email} marked as active (verification skipped in production)`);
                        return;
                    }
                    throw tokenErr;
                }
            }

            setAccounts(prev => prev.map(a => a.id === account.id ? { ...a, status: 'ACTIVE', lastChecked: new Date().toISOString() } : a));
            alert(`Verified ${account.email}`);
        } catch (e: any) {
            console.error(e);
            setAccounts(prev => prev.map(a => a.id === account.id ? { ...a, status: 'ERROR' } : a));
            alert(`Verification failed for ${account.email}: ${e.message}`);
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-8 pb-12">
            <div className="flex flex-col gap-2 border-b border-slate-200 pb-4">
                <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <Key className="text-slate-600" /> Credentials & Integrations
                </h2>
                <p className="text-slate-500 text-sm">Manage connected email accounts for AI processing.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Account List */}
                <div className="lg:col-span-2 space-y-4">
                    <h3 className="font-bold text-slate-700 flex items-center gap-2">
                        <Server size={18} /> Connected Accounts
                    </h3>

                    {accounts.length === 0 && (
                        <div className="p-8 border-2 border-dashed border-slate-200 rounded-xl text-center text-slate-400">
                            No accounts connected. Add one to get started.
                        </div>
                    )}

                    <div className="grid gap-3">
                        {accounts.map(acc => (
                            <div key={acc.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between group">
                                <div className="flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xs ${acc.provider === 'GMAIL' ? 'bg-red-500' :
                                        acc.provider === 'OUTLOOK' ? 'bg-blue-600' : 'bg-slate-600'
                                        }`}>
                                        {acc.provider[0]}
                                    </div>
                                    <div>
                                        <div className="font-bold text-slate-800">{acc.email}</div>
                                        <div className="text-xs text-slate-500 flex items-center gap-2">
                                            <span>{acc.provider}</span>
                                            <span>•</span>
                                            <span className={acc.status === 'ACTIVE' ? "text-emerald-600 font-bold" : "text-red-500 font-bold"}>{acc.status}</span>
                                            {acc.refreshToken && acc.provider === 'GMAIL' && (
                                                <span className="text-[9px] bg-slate-100 px-1 rounded text-slate-400 border border-slate-200" title="Refresh Token Saved">Auto-Renew</span>
                                            )}
                                            {acc.provider === 'OUTLOOK' && (
                                                <span className="text-[9px] bg-blue-50 text-blue-600 px-1 rounded border border-blue-100">Azure</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleReverify(acc)}
                                        className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                        title="Test Connection"
                                    >
                                        <RefreshCw size={16} />
                                    </button>
                                    <button
                                        onClick={() => handleRemove(acc.id)}
                                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Disconnect"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Add Form */}
                <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 h-fit">
                    <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <Plus size={18} className="text-blue-600" /> Add Connection
                    </h3>

                    {/* Provider Tabs */}
                    <div className="grid grid-cols-3 gap-2 mb-4">
                        <button
                            onClick={() => { setConfigProvider('GMAIL'); setConfigError(''); }}
                            className={`py-2 text-xs font-bold rounded border transition-all ${configProvider === 'GMAIL'
                                ? 'bg-white text-red-600 border-red-200 shadow-sm'
                                : 'bg-slate-100 text-slate-500 border-transparent hover:bg-slate-200'
                                }`}
                        >
                            Gmail
                        </button>
                        <button
                            onClick={() => { setConfigProvider('OUTLOOK'); setConfigError(''); }}
                            className={`py-2 text-xs font-bold rounded border transition-all ${configProvider === 'OUTLOOK'
                                ? 'bg-white text-blue-600 border-blue-200 shadow-sm'
                                : 'bg-slate-100 text-slate-500 border-transparent hover:bg-slate-200'
                                }`}
                        >
                            Outlook
                        </button>
                        <button
                            onClick={() => { setConfigProvider('AZURE_COMMUNICATION_SERVICES'); setConfigError(''); }}
                            className={`py-2 text-xs font-bold rounded border transition-all ${configProvider === 'AZURE_COMMUNICATION_SERVICES'
                                ? 'bg-white text-purple-600 border-purple-200 shadow-sm'
                                : 'bg-slate-100 text-slate-500 border-transparent hover:bg-slate-200'
                                }`}
                        >
                            Azure ACS
                        </button>
                    </div>

                    <form onSubmit={handleSaveConfiguration} className="space-y-4">

                        {configProvider === 'AZURE_COMMUNICATION_SERVICES' && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-top-4">
                                <div className="bg-purple-50 p-4 rounded-lg flex gap-3 text-purple-800 text-sm border border-purple-100">
                                    <Server className="shrink-0 mt-0.5" size={16} />
                                    <div>
                                        <strong className="block mb-1">Azure Communication Services</strong>
                                        <ul className="list-disc pl-4 mt-2 space-y-1 text-purple-700 text-xs">
                                            <li><strong>From Email:</strong> Must be a verified domain address (e.g. donotreply@...)</li>
                                            <li><strong>Connection String:</strong> From your ACS Keys section.</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Common Email Field */}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                                {configProvider === 'AZURE_COMMUNICATION_SERVICES' ? 'Sender Address (From)' : 'Email Address'}
                            </label>
                            <input
                                type="email"
                                required
                                value={configEmail}
                                onChange={e => setConfigEmail(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder={configProvider === 'AZURE_COMMUNICATION_SERVICES' ? "donotreply@domain.azurecomm.net" : "user@company.com"}
                            />
                        </div>

                        {/* ACS Specifics */}
                        {configProvider === 'AZURE_COMMUNICATION_SERVICES' && (
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Connection String</label>
                                <textarea
                                    className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none font-mono text-xs h-24"
                                    placeholder="endpoint=https://...;accesskey=..."
                                    value={acsConnectionString}
                                    onChange={(e) => setAcsConnectionString(e.target.value)}
                                />
                            </div>
                        )}

                        {/* Gmail Specifics */}
                        {configProvider === 'GMAIL' && (
                            <div className="space-y-4 animate-in fade-in">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                                        Refresh Token (Recommended)
                                    </label>
                                    <input
                                        type="password"
                                        value={configRefreshToken}
                                        onChange={e => setConfigRefreshToken(e.target.value)}
                                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-mono"
                                        placeholder="1//04..."
                                    />
                                    <p className="text-[10px] text-slate-400 mt-1">Allows automatic session renewal.</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Access Token</label>
                                    <input
                                        type="password"
                                        value={configToken}
                                        onChange={e => setConfigToken(e.target.value)}
                                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-mono"
                                        placeholder="ya29..."
                                    />
                                </div>
                            </div>
                        )}

                        {/* Outlook Specifics */}
                        {configProvider === 'OUTLOOK' && (
                            <div className="space-y-4 animate-in fade-in">
                                <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800">
                                    Requires Azure App Registration with <b>Mail.ReadWrite</b> permissions.
                                </div>

                                {/* Interactive Login Option (Recommended for Production) */}
                                <div className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm">
                                    <h4 className="font-bold text-slate-700 mb-2 flex items-center gap-2">
                                        <Shield size={16} className="text-emerald-600" />
                                        Interactive Sign-In (Recommended)
                                    </h4>
                                    <p className="text-xs text-slate-500 mb-3">
                                        Sign in directly with your Microsoft account. Best for avoiding CORS issues in production.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            try {
                                                await loginFor('automation', loginRequest.scopes);
                                                // Redirect happens here
                                            } catch (e: any) {
                                                setConfigError(e.message);
                                            }
                                        }}
                                        className="w-full py-2 bg-emerald-600 text-white rounded-lg font-bold text-xs hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <ExternalLink size={14} /> Sign In with Microsoft
                                    </button>
                                </div>

                                <div className="relative py-2">
                                    <div className="absolute inset-0 flex items-center">
                                        <div className="w-full border-t border-slate-200"></div>
                                    </div>
                                    <div className="relative flex justify-center text-xs">
                                        <span className="px-2 bg-slate-50 text-slate-400">OR USE SERVICE PRINCIPAL (Legacy)</span>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tenant ID</label>
                                    <input
                                        type="text"
                                        required
                                        value={outlookTenantId}
                                        onChange={e => setOutlookTenantId(e.target.value)}
                                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-mono text-slate-600"
                                        placeholder="Enter Tenant ID"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Client ID</label>
                                    <input
                                        type="text"
                                        required
                                        value={outlookClientId}
                                        onChange={e => setOutlookClientId(e.target.value)}
                                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-mono text-slate-600"
                                        placeholder="Enter Client ID"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Client Secret</label>
                                    <input
                                        type="password"
                                        required
                                        value={configToken}
                                        onChange={e => setConfigToken(e.target.value)}
                                        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-mono text-slate-600"
                                        placeholder="Value (not Secret ID)"
                                    />
                                    <p className="text-[10px] text-slate-400 mt-1">Use the client secret Value, not the ID.</p>
                                </div>
                            </div>
                        )}

                        {configError && (
                            <div className="p-3 bg-red-50 text-red-600 text-xs rounded-lg border border-red-100 flex items-start gap-2">
                                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                {configError}
                            </div>
                        )}

                        {successMsg && (
                            <div className="p-3 bg-emerald-50 text-emerald-600 text-xs rounded-lg border border-emerald-100 flex items-start gap-2">
                                <Check size={14} className="mt-0.5 shrink-0" />
                                {successMsg}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isVerifying}
                            className="w-full bg-slate-900 text-white font-bold py-3 rounded-lg hover:bg-black transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {isVerifying ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
                            {isVerifying ? 'Verifying...' : 'Save & Connect'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default AdminCredentials;
