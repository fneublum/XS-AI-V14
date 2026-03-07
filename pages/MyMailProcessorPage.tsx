
import React, { useEffect, useState } from 'react';
import { BillOfLading, Booking, Estimate, ProformaInvoice, PurchaseOrderExtract, Invoice, PackingList, SupplierInvoice } from '../types';
import EmailAgent from './EmailAgent';
import { initializeMsal } from '../services/smailAuth';

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
    const [isMsalInitialized, setIsMsalInitialized] = useState(false);

    useEffect(() => {
        let isMounted = true;
        initializeMsal().then(() => {
            if (isMounted) setIsMsalInitialized(true);
        }).catch(err => console.error("MSAL Init Failed", err));
        return () => { isMounted = false; };
    }, []);

    if (!isMsalInitialized) {
        return (
            <div className="flex items-center justify-center h-full text-slate-400">
                Loading Authentication...
            </div>
        );
    }

    return <EmailAgent processorKey="automation" saveCallbacks={props} currentCompanyId={props.currentCompanyId} />;
};

export default MyMailProcessorPage;
