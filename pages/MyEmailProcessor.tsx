import React, { useState, useEffect } from 'react';
import { BillOfLading, Booking, Estimate, ProformaInvoice, PurchaseOrderExtract, Invoice, PackingList, SupplierInvoice } from '../types';
import AiEmailProcessor from './AiEmailProcessor';
import SmailApp from './SmailApp';
import EmailAgent from './EmailAgent';
import { Mail, FileText, Sparkles, Brain } from 'lucide-react';
import { MsalProvider } from "@azure/msal-react";
import { msalInstance, initializeMsal } from '../services/smailAuth';

interface PageProps {
    onSaveBL?: (data: BillOfLading) => void;
    onSaveBooking?: (data: Booking) => void;
    onSaveEstimate?: (data: Estimate) => void;
    onSaveProforma?: (data: ProformaInvoice) => void;
    onSavePO?: (data: PurchaseOrderExtract) => void;
    onSaveInvoice?: (data: Invoice) => void;
    onSaveSupplierInvoice?: (data: SupplierInvoice) => void;
    onSavePackingList?: (data: PackingList) => void;
    currentCompanyId?: string;
}

const MODE_CONFIG = {
    SMAIL: { label: 'SMAIL', icon: Sparkles, color: 'text-blue-600', title: 'SMAIL Assistant', subtitle: 'Intelligent Outlook Assistant' },
    AGENT: { label: 'AI Agent', icon: Brain, color: 'text-violet-600', title: 'AI Email Agent', subtitle: 'Autonomous Reply & Follow-up Engine' },
    SCANNER: { label: 'Scanner', icon: FileText, color: 'text-purple-600', title: 'Inbox Scanner', subtitle: 'Automated Document Extraction' },
} as const;

type Mode = keyof typeof MODE_CONFIG;

const MyMailProcessorPage: React.FC<PageProps> = (props) => {
    const [mode, setMode] = useState<Mode>('AGENT');
    const [isMsalInitialized, setIsMsalInitialized] = useState(false);

    useEffect(() => {
        let isMounted = true;
        initializeMsal().then(() => {
            if (isMounted) setIsMsalInitialized(true);
        }).catch(err => console.error("MSAL Init Failed", err));
        return () => { isMounted = false; };
    }, []);

    const cfg = MODE_CONFIG[mode];
    const Icon = cfg.icon;

    return (
        <div className="h-full flex flex-col">
            {/* Mode Switcher Header */}
            <div className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-gradient-to-r from-violet-500 to-indigo-600 rounded-xl text-white">
                        <Icon size={24} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">{cfg.title}</h1>
                        <p className="text-slate-500 text-sm mt-1">{cfg.subtitle}</p>
                    </div>
                </div>

                <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                    {(Object.keys(MODE_CONFIG) as Mode[]).map(m => {
                        const mc = MODE_CONFIG[m];
                        const MIcon = mc.icon;
                        return (
                            <button
                                key={m}
                                onClick={() => setMode(m)}
                                className={`px-4 py-1.5 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${
                                    mode === m
                                        ? `bg-white ${mc.color} shadow-sm`
                                        : 'text-slate-500 hover:text-slate-700'
                                }`}
                            >
                                <MIcon size={14} /> {mc.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative">
                {mode === 'SCANNER' ? (
                    <div className="h-full p-6 overflow-y-auto">
                        <AiEmailProcessor {...props} processorKey="automation" />
                    </div>
                ) : mode === 'AGENT' ? (
                    isMsalInitialized ? (
                        <EmailAgent processorKey="automation" />
                    ) : (
                        <div className="flex items-center justify-center h-full text-slate-400">
                            Loading Authentication...
                        </div>
                    )
                ) : (
                    isMsalInitialized ? (
                        <MsalProvider instance={msalInstance}>
                            <SmailApp />
                        </MsalProvider>
                    ) : (
                        <div className="flex items-center justify-center h-full text-slate-400">
                            Loading Authentication...
                        </div>
                    )
                )}
            </div>
        </div>
    );
};

export default MyMailProcessorPage;
