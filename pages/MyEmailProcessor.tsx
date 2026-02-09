import React, { useState, useEffect } from 'react';
import { BillOfLading, Booking, Estimate, ProformaInvoice, PurchaseOrderExtract, Invoice, PackingList, SupplierInvoice } from '../types';
import AiEmailProcessor from './AiEmailProcessor'; 
import SmailApp from './SmailApp';
import { Mail, FileText, Sparkles } from 'lucide-react';
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

const MyMailProcessorPage: React.FC<PageProps> = (props) => {
    const [mode, setMode] = useState<'SCANNER' | 'SMAIL'>('SMAIL');
    const [isMsalInitialized, setIsMsalInitialized] = useState(false);

    useEffect(() => {
        let isMounted = true;
        initializeMsal().then(() => {
            if (isMounted) setIsMsalInitialized(true);
        }).catch(err => console.error("MSAL Init Failed", err));
        return () => { isMounted = false; };
    }, []);

    return (
        <div className="h-full flex flex-col">
            {/* Mode Switcher Header */}
            <div className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${mode === 'SMAIL' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        {mode === 'SMAIL' ? <Mail size={20} /> : <FileText size={20} />}
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">{mode === 'SMAIL' ? 'SMAIL Assistant' : 'Inbox Scanner'}</h2>
                        <p className="text-xs text-slate-500">{mode === 'SMAIL' ? 'Intelligent Outlook Assistant' : 'Automated Document Extraction'}</p>
                    </div>
                </div>
                
                <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                    <button
                        onClick={() => setMode('SMAIL')}
                        className={`px-4 py-1.5 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${
                            mode === 'SMAIL' 
                            ? 'bg-white text-blue-600 shadow-sm' 
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <Sparkles size={14} /> SMAIL
                    </button>
                    <button
                        onClick={() => setMode('SCANNER')}
                        className={`px-4 py-1.5 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${
                            mode === 'SCANNER' 
                            ? 'bg-white text-purple-600 shadow-sm' 
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        <FileText size={14}/> Scanner
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative">
                {mode === 'SCANNER' ? (
                    <div className="h-full p-6 overflow-y-auto">
                        <AiEmailProcessor {...props} processorKey="automation" />
                    </div>
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
