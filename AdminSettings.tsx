
import React, { useState, useEffect } from 'react';
import { Settings, Database, Check, Save, Shield, AlertTriangle, Download, HardDrive, Loader2, Clock, Mail, Server } from 'lucide-react';
import { getSupabaseConfig } from '../services/supabase';
import { backupAllData, LS_AUTO_BACKUP, LS_LAST_BACKUP } from '../services/backupService';

const AdminSettings: React.FC = () => {
    const [supabaseUrl, setSupabaseUrl] = useState('');
    const [supabaseKey, setSupabaseKey] = useState('');
    
    // Email Settings
    const [emailProvider, setEmailProvider] = useState('GMAIL');
    const [emailUser, setEmailUser] = useState('');
    const [emailPass, setEmailPass] = useState('');

    const [isSaved, setIsSaved] = useState(false);
    
    // Backup State
    const [isBackingUp, setIsBackingUp] = useState(false);
    const [backupStatus, setBackupStatus] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
    const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
    const [lastBackupTime, setLastBackupTime] = useState<string>('');

    useEffect(() => {
        const config = getSupabaseConfig();
        setSupabaseUrl(config.url);
        setSupabaseKey(config.key);

        // Load Auto Backup Settings
        const autoEnabled = localStorage.getItem(LS_AUTO_BACKUP) === 'true';
        const lastRun = localStorage.getItem(LS_LAST_BACKUP);
        setAutoBackupEnabled(autoEnabled);
        if (lastRun) {
            setLastBackupTime(new Date(parseInt(lastRun)).toLocaleString());
        }

        // Load Email Settings
        setEmailProvider(localStorage.getItem('email_provider') || 'GMAIL');
        setEmailUser(localStorage.getItem('email_user') || '');
        setEmailPass(localStorage.getItem('email_pass') || '');
    }, []);

    const handleSave = () => {
        localStorage.setItem('supabase_url', supabaseUrl);
        localStorage.setItem('supabase_key', supabaseKey);
        
        localStorage.setItem('email_provider', emailProvider);
        localStorage.setItem('email_user', emailUser);
        localStorage.setItem('email_pass', emailPass);

        setIsSaved(true);
        
        // Reload to apply changes
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    };

    const toggleAutoBackup = () => {
        const newValue = !autoBackupEnabled;
        setAutoBackupEnabled(newValue);
        localStorage.setItem(LS_AUTO_BACKUP, String(newValue));
    };

    const handleBackup = async () => {
        setIsBackingUp(true);
        setBackupStatus(null);
        
        const result = await backupAllData();
        
        // Update last backup time if successful
        if (result.success) {
            const now = Date.now();
            localStorage.setItem(LS_LAST_BACKUP, now.toString());
            setLastBackupTime(new Date(now).toLocaleString());
        }
        
        setIsBackingUp(false);
        setBackupStatus({
            msg: result.message,
            type: result.success ? 'success' : 'error'
        });

        if (result.success) {
            setTimeout(() => setBackupStatus(null), 5000);
        }
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto pb-12">
            <div className="flex flex-col gap-2 border-b border-slate-200 pb-4">
                <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <Settings className="text-slate-600" /> Database & System Settings
                </h2>
                <p className="text-slate-500 text-sm">Configure database connection, email integration, and backups.</p>
            </div>

            <div className="grid grid-cols-1 gap-8">
                
                {/* Database Configuration */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-fit">
                    <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <Database className="text-purple-500" size={20} /> 
                            Supabase Database
                        </h3>
                    </div>
                    
                    <div className="p-6 space-y-6">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Project URL</label>
                                <input 
                                    type="text"
                                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-mono text-slate-600 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-purple-500 outline-none transition-all"
                                    value={supabaseUrl}
                                    onChange={e => setSupabaseUrl(e.target.value)}
                                    placeholder="https://xyz.supabase.co"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Anon Key</label>
                                <input 
                                    type="password"
                                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-mono text-slate-600 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-purple-500 outline-none transition-all"
                                    value={supabaseKey}
                                    onChange={e => setSupabaseKey(e.target.value)}
                                    placeholder="eyJh..."
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Email Integration */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-fit">
                    <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <Mail className="text-indigo-500" size={20} /> 
                            Email Integration (AI Processor)
                        </h3>
                    </div>
                    <div className="p-6 space-y-6">
                        <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 flex gap-3">
                            <Server className="text-indigo-600 shrink-0" size={20} />
                            <div>
                                <p className="text-sm text-indigo-800 mb-1 font-bold">IMAP / API Configuration</p>
                                <p className="text-xs text-indigo-700">
                                    Configure the email account for the AI Processor to monitor. Use an App Password for Gmail/Workspace accounts.
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Provider</label>
                                <select 
                                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                    value={emailProvider}
                                    onChange={e => setEmailProvider(e.target.value)}
                                >
                                    <option value="GMAIL">Google Workspace / Gmail</option>
                                    <option value="OUTLOOK">Outlook 365</option>
                                    <option value="IMAP">Custom IMAP</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email Address</label>
                                <input 
                                    type="email"
                                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-mono text-slate-600 focus:ring-2 focus:ring-indigo-500 outline-none"
                                    value={emailUser}
                                    onChange={e => setEmailUser(e.target.value)}
                                    placeholder="ai.test@xsolution.com"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">App Password / API Key</label>
                                <input 
                                    type="password"
                                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-mono text-slate-600 focus:ring-2 focus:ring-indigo-500 outline-none"
                                    value={emailPass}
                                    onChange={e => setEmailPass(e.target.value)}
                                    placeholder="xxxx-xxxx-xxxx-xxxx"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Data Backup Section */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden h-fit">
                    <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <HardDrive className="text-blue-500" size={20} /> 
                            Data Backup
                        </h3>
                    </div>
                    <div className="p-6">
                        <div className="flex items-start gap-4 mb-6">
                            <div className="p-3 bg-blue-50 rounded-lg text-blue-600">
                                <Download size={24} />
                            </div>
                            <div className="flex-1">
                                <h4 className="font-bold text-slate-800 mb-1">Manual Backup</h4>
                                <p className="text-sm text-slate-500 mb-4">
                                    Export all database tables into a ZIP archive immediately.
                                </p>
                                
                                {backupStatus && (
                                    <div className={`mb-4 p-3 rounded-lg text-sm flex items-center gap-2 ${backupStatus.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                                        {backupStatus.type === 'success' ? <Check size={16}/> : <AlertTriangle size={16}/>}
                                        {backupStatus.msg}
                                    </div>
                                )}

                                <button 
                                    onClick={handleBackup}
                                    disabled={isBackingUp}
                                    className="bg-slate-800 hover:bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all disabled:opacity-70 disabled:cursor-not-allowed shadow-md"
                                >
                                    {isBackingUp ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                                    {isBackingUp ? 'Generating Archive...' : 'Download Backup (.zip)'}
                                </button>
                            </div>
                        </div>

                        <div className="border-t border-slate-100 pt-6 flex items-start gap-4">
                            <div className={`p-3 rounded-lg ${autoBackupEnabled ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}>
                                <Clock size={24} />
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h4 className="font-bold text-slate-800 mb-1">Automated Hourly Backup</h4>
                                        <p className="text-sm text-slate-500 mb-2">
                                            Automatically download a backup every hour while the application is open.
                                        </p>
                                        {lastBackupTime && (
                                            <p className="text-xs text-slate-400">Last Backup: {lastBackupTime}</p>
                                        )}
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input 
                                            type="checkbox" 
                                            checked={autoBackupEnabled} 
                                            onChange={toggleAutoBackup} 
                                            className="sr-only peer" 
                                        />
                                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <button 
                    onClick={handleSave}
                    className="fixed bottom-6 right-24 bg-slate-900 text-white font-bold py-3 px-8 rounded-full shadow-xl hover:bg-slate-800 flex items-center justify-center gap-2 transition-all z-40"
                >
                    {isSaved ? <Check size={18} /> : <Save size={18} />} 
                    {isSaved ? 'Settings Saved' : 'Save All Settings'}
                </button>

            </div>
        </div>
    );
};

export default AdminSettings;
