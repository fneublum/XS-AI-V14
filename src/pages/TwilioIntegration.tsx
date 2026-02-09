import React, { useState, useEffect } from 'react';
import { Phone, Save, Check, Loader2, AlertTriangle, RefreshCw, TestTube2, Key, Settings } from 'lucide-react';
import { getSupabaseClient } from '../services/supabase';

const TwilioIntegration: React.FC = () => {
    console.log('[TwilioIntegration] Component mounting...');
    const [accountSid, setAccountSid] = useState('');
    const [authToken, setAuthToken] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isSaved, setIsSaved] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [renderError, setRenderError] = useState<string | null>(null);

    useEffect(() => {
        loadCredentials();
    }, []);

    const loadCredentials = async () => {
        console.log('[TwilioIntegration] loadCredentials starting...');
        setIsLoading(true);
        try {
            const supabase = getSupabaseClient();
            console.log('[TwilioIntegration] supabase client:', supabase ? 'available' : 'NOT AVAILABLE');
            if (!supabase) {
                console.log('[TwilioIntegration] No supabase client, finishing load');
                setIsLoading(false);
                return;
            }

            console.log('[TwilioIntegration] Querying system_settings...');
            const { data, error } = await supabase
                .from('system_settings')
                .select('value')
                .eq('key', 'twilio_credentials')
                .single();

            console.log('[TwilioIntegration] Query result:', { data, error });

            if (data?.value) {
                const creds = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
                setAccountSid(creds.accountSid || '');
                setAuthToken(creds.authToken || '');
                setPhoneNumber(creds.phoneNumber || '');
            }
        } catch (error) {
            console.error('[TwilioIntegration] Error loading credentials:', error);
        } finally {
            console.log('[TwilioIntegration] loadCredentials complete');
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        setIsSaved(false);
        try {
            const supabase = getSupabaseClient();
            if (!supabase) throw new Error('No Supabase client');

            const credentials = {
                accountSid,
                authToken,
                phoneNumber
            };

            // Upsert the credentials
            const { error } = await supabase
                .from('system_settings')
                .upsert({
                    key: 'twilio_credentials',
                    value: credentials,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'key'
                });

            if (error) throw error;

            setIsSaved(true);
            setTimeout(() => setIsSaved(false), 3000);
        } catch (error) {
            console.error('Error saving Twilio credentials:', error);
            alert('Failed to save credentials. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleTestConnection = async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
            // Basic validation
            if (!accountSid || !authToken || !phoneNumber) {
                setTestResult({
                    success: false,
                    message: 'Please fill in all fields before testing.'
                });
                return;
            }

            // Validate SID format
            if (!accountSid.startsWith('AC') || accountSid.length !== 34) {
                setTestResult({
                    success: false,
                    message: 'Invalid Account SID format. It should start with "AC" and be 34 characters long.'
                });
                return;
            }

            // Validate phone number format (basic E.164 check)
            if (!phoneNumber.startsWith('+') || phoneNumber.length < 10) {
                setTestResult({
                    success: false,
                    message: 'Invalid phone number format. Use E.164 format (e.g., +1234567890).'
                });
                return;
            }

            // If we have a backend endpoint, we could test the actual connection here
            // For now, we'll just validate the format
            setTestResult({
                success: true,
                message: 'Credentials format validated successfully. Connection will be verified when making calls/SMS.'
            });
        } catch (error) {
            setTestResult({
                success: false,
                message: 'Failed to test connection. Please verify your credentials.'
            });
        } finally {
            setIsTesting(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="animate-spin text-slate-400" size={32} />
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto p-6">
            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <div className="w-14 h-14 bg-gradient-to-br from-red-500 to-rose-600 rounded-xl flex items-center justify-center shadow-lg">
                    <Phone className="text-white" size={28} />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Twilio Integration</h1>
                    <p className="text-slate-500 text-sm">Configure your Twilio credentials for SMS and voice capabilities</p>
                </div>
            </div>

            {/* Info Banner */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex items-start gap-3">
                <AlertTriangle className="text-blue-500 shrink-0 mt-0.5" size={20} />
                <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">Before you begin</p>
                    <p>You'll need a Twilio account to get your API credentials. Visit <a href="https://www.twilio.com/console" target="_blank" rel="noopener noreferrer" className="underline font-medium">Twilio Console</a> to find your Account SID, Auth Token, and purchase a phone number.</p>
                </div>
            </div>

            {/* Credentials Form */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                    <Key size={18} className="text-slate-500" />
                    <h2 className="font-semibold text-slate-700">API Credentials</h2>
                </div>

                <div className="p-6 space-y-5">
                    {/* Account SID */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            Account SID
                        </label>
                        <input
                            type="text"
                            value={accountSid}
                            onChange={(e) => setAccountSid(e.target.value)}
                            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                            className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono text-sm"
                        />
                        <p className="text-xs text-slate-400 mt-1">Found on your Twilio Console dashboard</p>
                    </div>

                    {/* Auth Token */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            Auth Token
                        </label>
                        <input
                            type="password"
                            value={authToken}
                            onChange={(e) => setAuthToken(e.target.value)}
                            placeholder="••••••••••••••••••••••••••••••••"
                            className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono text-sm"
                        />
                        <p className="text-xs text-slate-400 mt-1">Keep this secret and secure</p>
                    </div>

                    {/* Phone Number */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            Twilio Phone Number
                        </label>
                        <input
                            type="tel"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            placeholder="+1234567890"
                            className="w-full px-4 py-3 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all font-mono text-sm"
                        />
                        <p className="text-xs text-slate-400 mt-1">Your Twilio phone number in E.164 format</p>
                    </div>

                    {/* Test Result */}
                    {testResult && (
                        <div className={`p-4 rounded-lg flex items-start gap-3 ${testResult.success ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                            {testResult.success ? (
                                <Check className="text-emerald-500 shrink-0" size={18} />
                            ) : (
                                <AlertTriangle className="text-red-500 shrink-0" size={18} />
                            )}
                            <p className={`text-sm ${testResult.success ? 'text-emerald-700' : 'text-red-700'}`}>
                                {testResult.message}
                            </p>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                    <button
                        onClick={handleTestConnection}
                        disabled={isTesting}
                        className="flex items-center gap-2 px-4 py-2 text-slate-600 hover:text-slate-800 hover:bg-white border border-slate-200 rounded-lg transition-all disabled:opacity-50"
                    >
                        {isTesting ? (
                            <Loader2 className="animate-spin" size={16} />
                        ) : (
                            <TestTube2 size={16} />
                        )}
                        Test Connection
                    </button>

                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all ${isSaved
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-900 hover:bg-slate-800 text-white'
                            }`}
                    >
                        {isSaving ? (
                            <Loader2 className="animate-spin" size={16} />
                        ) : isSaved ? (
                            <Check size={16} />
                        ) : (
                            <Save size={16} />
                        )}
                        {isSaved ? 'Saved!' : 'Save Credentials'}
                    </button>
                </div>
            </div>

            {/* Usage Information */}
            <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Settings size={18} className="text-slate-500" />
                    <h3 className="font-semibold text-slate-700">Integration Capabilities</h3>
                </div>
                <ul className="space-y-2 text-sm text-slate-600">
                    <li className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                        Send SMS notifications to customers and team members
                    </li>
                    <li className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                        Receive inbound SMS messages for automated processing
                    </li>
                    <li className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                        Voice call capabilities for alerts and notifications
                    </li>
                    <li className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                        Two-factor authentication via SMS
                    </li>
                </ul>
            </div>
        </div>
    );
};

export default TwilioIntegration;
