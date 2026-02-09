
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
    initialMode?: 'SCANNER' | 'SMAIL';
}

const MyMailProcessorPage: React.FC<PageProps> = (props) => {
    const { initialMode = 'SMAIL' } = props;
    const [mode, setMode] = useState<'SCANNER' | 'SMAIL'>(initialMode);
    const [isMsalInitialized, setIsMsalInitialized] = useState(false);

    useEffect(() => {
        let isMounted = true;
        initializeMsal().then(() => {
            if (isMounted) setIsMsalInitialized(true);
        }).catch(err => console.error("MSAL Init Failed", err));
        return () => { isMounted = false; };
    }, []);

    // Update mode if prop changes
    useEffect(() => {
        setMode(initialMode);
    }, [initialMode]);

    return (
        <div className="h-full flex flex-col">
            {/* Mode Switcher Header - Relative (Natural Flow) */}
            <div className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center shrink-0 z-20 shadow-sm">
                <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${mode === 'SMAIL' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        {mode === 'SMAIL' ? <Mail size={20} /> : <FileText size={20} />}
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">{mode === 'SMAIL' ? 'SMAIL Assistant' : 'Inbox Scanner'}</h2>
                        <p className="text-xs text-slate-500">{mode === 'SMAIL' ? 'Intelligent Outlook Assistant' : 'Automated Document Extraction'}</p>
                    </div>
                </div>

            </div>

            {/* Content Area - Flex-1 to fill remaining space */}
            <div className="flex-1 overflow-hidden relative">
                {mode === 'SCANNER' ? (
                    <div className="h-full w-full">
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
