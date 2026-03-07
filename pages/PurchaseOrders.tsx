
import React, { useState } from 'react';
import { PurchaseOrder, Product, Supplier, Company, CompanyImage } from '../types';
import { ShoppingCart, Plus, X, Save, Trash2, FileText, CheckCircle, Clock, Pencil, CheckCircle2, AlertCircle, LayoutGrid, List, Eye, Download, Mail, FilePlus } from 'lucide-react';
import { PAYMENT_TERM_OPTIONS } from '../constants';
import { QuantityInput, PriceInput } from '../components/UnitInputs';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { sendEmail } from '../services/emailService';
import { workflowEngine } from '../services/workflowEngine';

interface PurchaseOrdersProps {
    purchaseOrders: PurchaseOrder[];
    onAdd: (po: PurchaseOrder) => void;
    onUpdate: (po: PurchaseOrder) => void;
    onDelete: (id: string) => void;
    suppliers: Supplier[];
    products: Product[];
    onAddProduct: (p: Product) => void;
    onAddSupplier: (s: Supplier) => void;
    dbError?: string | null;
    currentCompanyId: string;
    availableCompanies: Company[];
    companyImages: CompanyImage[];
}

interface EmailDraft {
    to: string;
    subject: string;
    body: string;
}

const PurchaseOrders: React.FC<PurchaseOrdersProps> = ({ purchaseOrders, onAdd, onUpdate, onDelete, suppliers, products, onAddProduct, onAddSupplier, dbError, currentCompanyId, availableCompanies, companyImages }) => {
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
    const [searchTerm, setSearchTerm] = useState('');
    const [viewingPO, setViewingPO] = useState<PurchaseOrder | null>(null);

    // Email State
    const [emailingPO, setEmailingPO] = useState<PurchaseOrder | null>(null);
    const [emailDraft, setEmailDraft] = useState<EmailDraft>({ to: '', subject: '', body: '' });
    const [isSendingEmail, setIsSendingEmail] = useState(false);
    const [isHtmlView, setIsHtmlView] = useState(false); // Default to Preview mode

    // Quick Add State
    const [showQuickAddSupplier, setShowQuickAddSupplier] = useState(false);
    const [newSupplierName, setNewSupplierName] = useState('');
    const [showQuickAddProduct, setShowQuickAddProduct] = useState(false);
    const [newProductName, setNewProductName] = useState('');
    const [supplierAddedMessage, setSupplierAddedMessage] = useState('');
    const [productAddedMessage, setProductAddedMessage] = useState('');

    const initialFormState: Partial<PurchaseOrder> = {
        supplierId: '',
        supplierName: '',
        status: 'Draft',
        orderDate: new Date().toISOString().split('T')[0],
        expectedDeliveryDate: '',
        items: [],
        currency: 'USD',
        totalAmount: 0,
        paymentTerms: 'Net 30',
        companyId: currentCompanyId === 'ALL' ? '' : currentCompanyId
    };

    const [formData, setFormData] = useState<Partial<PurchaseOrder>>(initialFormState);
    const [currentItem, setCurrentItem] = useState({ productName: '', quantity: 0, unitPrice: 0 });

    const handleAddNew = () => {
        setFormData(initialFormState);
        setEditingId(null);
        setIsAdding(true);
    };

    const handleEdit = (po: PurchaseOrder, e: React.MouseEvent) => {
        e.stopPropagation();
        const formDataFromPO: Partial<PurchaseOrder> = {
            id: po.id,
            companyId: po.companyId,
            supplierId: po.supplierId || '',
            supplierName: po.supplierName || '',
            status: po.status || 'Draft',
            orderDate: po.orderDate || new Date().toISOString().split('T')[0],
            expectedDeliveryDate: po.expectedDeliveryDate || '',
            paymentTerms: po.paymentTerms || 'Net 30',
            items: po.items ? [...po.items] : [],
            totalAmount: po.totalAmount || 0,
            currency: po.currency || 'USD',
            notes: po.notes || ''
        };
        setFormData(formDataFromPO);
        setEditingId(po.id);
        setIsAdding(true);
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (window.confirm('Are you sure you want to delete this PO?')) {
            onDelete(id);
        }
    };

    const handleQuickAddSupplier = async () => {
        if (!newSupplierName.trim()) return;

        const companyIdForNewRecord = formData.companyId || (currentCompanyId === 'ALL' ? '' : currentCompanyId);
        if (!companyIdForNewRecord) {
            alert("Please select a company before adding a supplier.");
            return;
        }

        const newSupplier: Supplier = {
            id: `SUP${Date.now()}`,
            companyId: companyIdForNewRecord,
            name: newSupplierName.trim(),
            contactPerson: 'N/A',
            email: 'tbd@example.com',
            phone: 'N/A',
            country: 'Unknown',
            categories: [],
            rating: 3,
            paymentTerms: 'Net 30'
        };

        await onAddSupplier(newSupplier);

        setFormData(prev => ({
            ...prev,
            supplierId: newSupplier.id,
            supplierName: newSupplier.name
        }));

        setNewSupplierName('');
        setShowQuickAddSupplier(false);
        setSupplierAddedMessage('Supplier added!');
        setTimeout(() => setSupplierAddedMessage(''), 3000);
    };

    const handleQuickAddProduct = async () => {
        if (!newProductName.trim()) return;

        const companyIdForNewRecord = formData.companyId || (currentCompanyId === 'ALL' ? '' : currentCompanyId);
        if (!companyIdForNewRecord) {
            alert("Please select a company before adding a product.");
            return;
        }

        const newProduct: Product = {
            id: `P${Date.now()}`,
            companyId: companyIdForNewRecord,
            name: newProductName.trim(),
            category: 'Resin',
            grade: 'New',
            hsCode: '',
            supplier: formData.supplierName || 'New Supplier',
            price: 0,
            stockStatus: 'Available',
            specs: {
                origin: 'Unknown',
                type: 'N/A',
                color: 'N/A',
                reinforced: 'N/A',
                additives: 'N/A',
                form: 'Pellets'
            }
        };

        await onAddProduct(newProduct);

        setCurrentItem(prev => ({
            ...prev,
            productName: newProduct.name
        }));

        setNewProductName('');
        setShowQuickAddProduct(false);
        setProductAddedMessage('Product added!');
        setTimeout(() => setProductAddedMessage(''), 3000);
    };

    const handleAddItem = () => {
        if (!currentItem.productName || currentItem.quantity <= 0) return;
        const total = currentItem.quantity * currentItem.unitPrice;
        const newItem = { ...currentItem, total };

        setFormData(prev => ({
            ...prev,
            items: [...(prev.items || []), newItem],
            totalAmount: (prev.totalAmount || 0) + total
        }));
        setCurrentItem({ productName: '', quantity: 0, unitPrice: 0 });
    };

    const handleRemoveItem = (idx: number) => {
        setFormData(prev => {
            const newItems = [...(prev.items || [])];
            const removed = newItems.splice(idx, 1)[0];
            return {
                ...prev,
                items: newItems,
                totalAmount: (prev.totalAmount || 0) - removed.total
            };
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const companyIdForNewRecord = formData.companyId || (currentCompanyId === 'ALL' ? '' : currentCompanyId);
        if (!companyIdForNewRecord) {
            alert("Please select a company for the PO.");
            return;
        }

        let finalSupplierName = formData.supplierName || '';
        if (formData.supplierId) {
            const sup = suppliers.find(s => s.id === formData.supplierId);
            if (sup) finalSupplierName = sup.name;
        }

        const newPO: PurchaseOrder = {
            id: editingId || `PO${Date.now()}`,
            companyId: companyIdForNewRecord,
            supplierId: formData.supplierId,
            supplierName: finalSupplierName,
            status: formData.status as any,
            orderDate: formData.orderDate!,
            expectedDeliveryDate: formData.expectedDeliveryDate!,
            paymentTerms: formData.paymentTerms,
            items: formData.items || [],
            totalAmount: formData.totalAmount || 0,
            currency: formData.currency || 'USD',
            notes: formData.notes
        };

        if (editingId) {
            onUpdate(newPO);
            // Fire workflow event if status changed to Completed (received)
            if (newPO.status === 'Completed') {
                workflowEngine.emit({
                    type: 'PO_RECEIVED',
                    entityType: 'purchase_order',
                    entityId: newPO.id,
                    data: newPO as any,
                    companyId: newPO.companyId,
                    timestamp: new Date().toISOString(),
                });
            }
        } else {
            onAdd(newPO);
            // Fire workflow event for new PO
            workflowEngine.emit({
                type: 'PO_CREATED',
                entityType: 'purchase_order',
                entityId: newPO.id,
                data: newPO as any,
                companyId: newPO.companyId,
                timestamp: new Date().toISOString(),
            });
        }
        setIsAdding(false);
        setFormData(initialFormState);
    };

    const handleDownloadPDF = (po: PurchaseOrder) => {
        const doc = new jsPDF();
        const company = availableCompanies.find(c => c.id === po.companyId);
        // Find logo image for this company (if any)
        const logoImage = companyImages?.find(img => img.companyId === po.companyId && img.type === 'LOGO');

        // --- HEADER ---
        // If we have a logo, add it
        if (logoImage && logoImage.url) {
            try {
                // Add image at top-left. Dimensions: 40x15mm roughly.
                // NOTE: We'll guess extension if possible, or default to 'PNG'.
                const ext = logoImage.url.split('.').pop()?.toUpperCase() || 'PNG';
                const format = ext === 'JPG' ? 'JPEG' : ext;
                doc.addImage(logoImage.url, format, 14, 15, 30, 0); // width 30, height auto
            } catch (e) {
                console.warn('Could not add logo to PDF', e);
            }
        }

        doc.setFontSize(22);
        doc.setTextColor(44, 62, 80);
        doc.text('PURCHASE ORDER', 196, 25, { align: 'right' });

        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`PO Number: ${po.id}`, 196, 33, { align: 'right' });
        doc.text(`Date: ${po.orderDate}`, 196, 38, { align: 'right' });
        doc.text(`Status: ${po.status}`, 196, 43, { align: 'right' });



        // --- ADDRESSES ---
        let startY = 60;

        // VENDOR (Left)
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text('VENDOR', 14, startY);
        doc.setDrawColor(200);
        doc.line(14, startY + 2, 90, startY + 2);

        doc.setFontSize(11);
        doc.setTextColor(0);
        doc.text(po.supplierName, 14, startY + 8);

        const supplier = suppliers.find(s => s.id === po.supplierId);
        doc.setFontSize(10);
        doc.setTextColor(80);
        let vendorY = startY + 13;

        if (supplier) {
            // Full Vendor Address
            const vAddressParts = [
                supplier.location,
                supplier.city,
                [supplier.state, supplier.zip].filter(Boolean).join(' '),
                supplier.country
            ].filter(Boolean);

            vAddressParts.forEach(part => {
                doc.text(part as string, 14, vendorY);
                vendorY += 5;
            });

            vendorY += 2;
            if (supplier.contactPerson) { doc.text(supplier.contactPerson, 14, vendorY); vendorY += 5; }
            if (supplier.email) { doc.text(supplier.email, 14, vendorY); vendorY += 5; }
        }

        // SHIP TO (Right)
        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text('SHIP TO', 110, startY);
        doc.line(110, startY + 2, 196, startY + 2);

        let shipY = startY + 8;
        if (company) {
            doc.setFontSize(11);
            doc.setTextColor(0);
            doc.text(company.name, 110, shipY);
            shipY += 5;

            doc.setFontSize(10);
            doc.setTextColor(80);

            // Full Ship To Address
            const cAddressParts = [
                company.address,
                company.city,
                [company.state, company.zip].filter(Boolean).join(' '),
                company.country
            ].filter(Boolean);

            cAddressParts.forEach(part => {
                doc.text(part as string, 110, shipY);
                shipY += 5;
            });

            shipY += 2;
            if (company.email) { doc.text(company.email, 110, shipY); shipY += 5; }
        }

        // --- ITEMS TABLE ---
        // Start table below the lowest address block
        const tableStartY = Math.max(vendorY, shipY) + 10;

        // Items Table
        const tableColumn = ["Item Description", "Qty", "Unit Price", "Total"];
        const tableRows = po.items.map(item => [
            item.productName,
            item.quantity.toLocaleString(),
            `${po.currency} ${item.unitPrice.toLocaleString()}`,
            `${po.currency} ${item.total.toLocaleString()}`
        ]);

        (doc as any).autoTable({
            head: [tableColumn],
            body: tableRows,
            startY: tableStartY,
            theme: 'grid',
            headStyles: { fillColor: [44, 62, 80], textColor: 255 },
            styles: { fontSize: 10, cellPadding: 3 },
            columnStyles: {
                0: { cellWidth: 'auto' },
                1: { halign: 'right' },
                2: { halign: 'right' },
                3: { halign: 'right', fontStyle: 'bold' }
            }
        });

        // Totals
        const finalY = (doc as any).lastAutoTable.finalY + 10;
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text('Subtotal:', 140, finalY);
        doc.text(`${po.currency} ${po.totalAmount.toLocaleString()}`, 196, finalY, { align: 'right' });

        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.setFont(undefined, 'bold');
        doc.text('Total:', 140, finalY + 7);
        doc.text(`${po.currency} ${po.totalAmount.toLocaleString()}`, 196, finalY + 7, { align: 'right' });

        // Footer / Notes
        if (po.notes) {
            doc.setFontSize(10);
            doc.setTextColor(100);
            doc.setFont(undefined, 'normal');
            doc.text('Notes:', 14, finalY + 20);
            doc.text(po.notes, 14, finalY + 25);
        }

        doc.save(`PO-${po.id}.pdf`);
    };

    const handleInitiateEmail = (po: PurchaseOrder) => {
        const supplier = suppliers.find(s => s.id === po.supplierId);
        const supplierEmail = supplier?.email || '';

        let htmlBody = `
            <h3>Purchase Order PO-${po.id}</h3>
            <p><strong>Order Date:</strong> ${po.orderDate}</p>
            <p><strong>Status:</strong> ${po.status}</p>
            <br/>
            <table style="width: 100%; border-collapse: collapse; font-family: Arial, sans-serif;">
                <thead style="background-color: #f1f5f9;">
                    <tr>
                         <th style="text-align: left; padding: 8px; border-bottom: 2px solid #cbd5e1;">Product</th>
                         <th style="text-align: right; padding: 8px; border-bottom: 2px solid #cbd5e1;">Qty</th>
                         <th style="text-align: right; padding: 8px; border-bottom: 2px solid #cbd5e1;">Unit Price</th>
                         <th style="text-align: right; padding: 8px; border-bottom: 2px solid #cbd5e1;">Total</th>
                    </tr>
                </thead>
                <tbody>
        `;

        po.items.forEach(item => {
            htmlBody += `
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${item.productName}</td>
                    <td style="text-align: right; padding: 8px; border-bottom: 1px solid #e2e8f0;">${item.quantity.toLocaleString()}</td>
                    <td style="text-align: right; padding: 8px; border-bottom: 1px solid #e2e8f0;">${po.currency} ${item.unitPrice.toLocaleString()}</td>
                    <td style="text-align: right; padding: 8px; border-bottom: 1px solid #e2e8f0;">${po.currency} ${item.total.toLocaleString()}</td>
                </tr>
            `;
        });

        htmlBody += `
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="3" style="text-align: right; padding: 8px; font-weight: bold;">Total Amount:</td>
                        <td style="text-align: right; padding: 8px; font-weight: bold;">${po.currency} ${po.totalAmount.toLocaleString()}</td>
                    </tr>
                </tfoot>
            </table>
            <br/>
            <p>${po.notes ? `<strong>Notes:</strong> ${po.notes}` : ''}</p>
            <p>Please confirm receipt of this order.</p>
        `;

        setEmailDraft({
            to: supplierEmail,
            subject: `Purchase Order PO-${po.id} - ${po.supplierName}`,
            body: htmlBody
        });
        setEmailingPO(po);
    };

    const handleSendEmail = async () => {
        if (!emailingPO) return;
        setIsSendingEmail(true);

        try {
            const toList = emailDraft.to
                .split(/[;,]/)
                .map((e: string) => e.trim())
                .filter((e: string) => e.length > 0);

            await sendEmail({
                to: toList,
                subject: emailDraft.subject,
                htmlBody: emailDraft.body
            });
            alert('Email sent successfully!');
            setEmailingPO(null);
        } catch (e) {
            console.error(e);
            alert('Failed to send email.');
        } finally {
            setIsSendingEmail(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-4">
                    <div className="p-2 bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl text-white">
                        <ShoppingCart size={24} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Purchase Orders</h1>
                        <p className="text-slate-500 text-sm">Create and manage supplier orders.</p>
                    </div>
                </div>
                <button onClick={handleAddNew} className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all shadow-md font-medium">
                    <FilePlus size={18} /> New PO
                </button>
            </div>

            <div className="flex items-center gap-3 mb-4">
                <div className="bg-white border border-slate-200 rounded-lg p-1 flex gap-1">
                    <button
                        onClick={() => setViewMode('grid')}
                        className={`p-2 rounded transition-all ${viewMode === 'grid' ? 'bg-slate-100 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        title="Grid View"
                    >
                        <LayoutGrid size={18} />
                    </button>
                    <button
                        onClick={() => setViewMode('table')}
                        className={`p-2 rounded transition-all ${viewMode === 'table' ? 'bg-slate-100 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        title="Table View"
                    >
                        <List size={18} />
                    </button>
                </div>
            </div>

            {dbError && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-start gap-3 border border-red-100 animate-in fade-in">
                    <AlertCircle size={20} className="mt-0.5 shrink-0" />
                    <div>
                        <p className="font-bold text-sm">Database Error</p>
                        <p className="text-xs mt-1 opacity-90">{dbError}</p>
                    </div>
                </div>
            )}

            {/* View Modal */}
            {viewingPO && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <div>
                                <h3 className="font-bold text-xl text-slate-800 flex items-center gap-2">
                                    <ShoppingCart className="text-blue-600" /> Purchase Order
                                </h3>
                                <p className="text-sm text-slate-500">{viewingPO.id}</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleDownloadPDF(viewingPO)}
                                    className="bg-slate-900 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-black transition-colors"
                                >
                                    <Download size={18} /> Download PDF
                                </button>
                                <button onClick={() => setViewingPO(null)} className="text-slate-400 hover:text-slate-600 p-2"><X size={24} /></button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 bg-slate-50/50">
                            <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 max-w-3xl mx-auto">
                                {/* Header */}
                                <div className="flex justify-between items-start mb-8 border-b border-slate-100 pb-8">
                                    <div>
                                        <h1 className="text-2xl font-bold text-slate-800 mb-1">PURCHASE ORDER</h1>
                                        <div className="inline-block px-3 py-1 bg-slate-100 text-slate-600 rounded text-sm font-bold mt-2">{viewingPO.status}</div>
                                    </div>
                                    <div className="text-right text-sm text-slate-500">
                                        <p>Date: <span className="font-bold text-slate-800">{viewingPO.orderDate}</span></p>
                                        <p>PO #: <span className="font-bold text-slate-800">{viewingPO.id}</span></p>
                                    </div>
                                </div>

                                {/* Addresses */}
                                <div className="grid grid-cols-2 gap-12 mb-8">
                                    <div>
                                        <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Vendor</h4>
                                        <p className="font-bold text-slate-800">{viewingPO.supplierName}</p>
                                        {/* Additional supplier details could go here if available via lookup */}
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Ship To</h4>
                                        {(() => {
                                            const company = availableCompanies.find(c => c.id === viewingPO.companyId);
                                            return company ? (
                                                <>
                                                    <p className="font-bold text-slate-800">{company.name}</p>
                                                    <p className="text-sm text-slate-600 mt-1">{company.address}</p>
                                                </>
                                            ) : <p className="text-slate-400 italic">Company Info Unavailable</p>;
                                        })()}
                                    </div>
                                </div>

                                {/* Items */}
                                <table className="w-full text-sm mb-8">
                                    <thead className="bg-slate-50 border-y border-slate-200">
                                        <tr>
                                            <th className="py-3 px-4 text-left font-semibold text-slate-600">Item</th>
                                            <th className="py-3 px-4 text-right font-semibold text-slate-600">Qty</th>
                                            <th className="py-3 px-4 text-right font-semibold text-slate-600">Price</th>
                                            <th className="py-3 px-4 text-right font-semibold text-slate-600">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {viewingPO.items.map((item, idx) => (
                                            <tr key={idx}>
                                                <td className="py-3 px-4 text-slate-800">{item.productName}</td>
                                                <td className="py-3 px-4 text-right text-slate-600">{item.quantity.toLocaleString()}</td>
                                                <td className="py-3 px-4 text-right text-slate-600">{viewingPO.currency} {item.unitPrice.toLocaleString()}</td>
                                                <td className="py-3 px-4 text-right font-bold text-slate-800">{viewingPO.currency} {item.total.toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>

                                {/* Totals */}
                                <div className="flex justify-end border-t border-slate-200 pt-4">
                                    <div className="w-64 space-y-2">
                                        <div className="flex justify-between text-sm text-slate-600">
                                            <span>Subtotal:</span>
                                            <span>{viewingPO.currency} {viewingPO.totalAmount.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between text-lg font-bold text-slate-800 pt-2 border-t border-slate-100">
                                            <span>Total:</span>
                                            <span className="text-blue-600">{viewingPO.currency} {viewingPO.totalAmount.toLocaleString()}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Notes */}
                                {viewingPO.notes && (
                                    <div className="mt-8 p-4 bg-yellow-50 rounded-lg text-sm text-yellow-800 border border-yellow-100">
                                        <span className="font-bold block mb-1">Notes:</span>
                                        {viewingPO.notes}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Email Preview Modal */}
            {emailingPO && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full flex flex-col overflow-hidden animate-in zoom-in-95">
                        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                                <Mail className="text-indigo-600" /> Email Purchase Order
                            </h3>
                            <button onClick={() => setEmailingPO(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Recipient</label>
                                <input
                                    type="text"
                                    className="w-full border border-slate-300 rounded p-2 text-sm bg-slate-50"
                                    value={emailDraft.to}
                                    onChange={e => setEmailDraft({ ...emailDraft, to: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subject</label>
                                <input
                                    type="text"
                                    className="w-full border border-slate-300 rounded p-2 text-sm"
                                    value={emailDraft.subject}
                                    onChange={e => setEmailDraft({ ...emailDraft, subject: e.target.value })}
                                />
                            </div>
                            <div>
                                <div className="flex justify-between items-center mb-1">
                                    <label className="block text-xs font-bold text-slate-500 uppercase">Message Body</label>
                                    <div className="flex gap-2 text-xs">
                                        <button
                                            onClick={() => setIsHtmlView(false)}
                                            className={`px-2 py-1 rounded ${!isHtmlView ? 'bg-blue-100 text-blue-700 font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                                        >
                                            Preview
                                        </button>
                                        <button
                                            onClick={() => setIsHtmlView(true)}
                                            className={`px-2 py-1 rounded ${isHtmlView ? 'bg-blue-100 text-blue-700 font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                                        >
                                            HTML Source
                                        </button>
                                    </div>
                                </div>
                                {isHtmlView ? (
                                    <textarea
                                        className="w-full border border-slate-300 rounded p-2 text-sm font-mono h-64 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                        value={emailDraft.body}
                                        onChange={e => setEmailDraft({ ...emailDraft, body: e.target.value })}
                                    />
                                ) : (
                                    <div
                                        className="w-full border border-slate-300 rounded p-4 text-sm h-64 overflow-y-auto bg-white prose prose-sm max-w-none"
                                        dangerouslySetInnerHTML={{ __html: emailDraft.body }}
                                    />
                                )}
                            </div>
                        </div>
                        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
                            <button onClick={() => setEmailingPO(null)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded">Cancel</button>
                            <button
                                onClick={handleSendEmail}
                                disabled={isSendingEmail}
                                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-50"
                            >
                                {isSendingEmail ? 'Sending...' : <><Mail size={16} /> Send Email</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isAdding && (
                <div key={editingId || 'new'} className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 animate-in slide-in-from-top-4 relative">
                    {/* Quick Add Modals */}
                    {showQuickAddSupplier && (
                        <div className="absolute inset-0 bg-white/90 z-10 flex items-center justify-center rounded-xl backdrop-blur-sm animate-in fade-in">
                            <div className="bg-white p-6 rounded-lg shadow-xl border border-slate-200 w-80 space-y-4">
                                <h4 className="font-bold text-lg">Quick Add Supplier</h4>
                                <input
                                    type="text"
                                    value={newSupplierName}
                                    onChange={(e) => setNewSupplierName(e.target.value)}
                                    className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2"
                                    placeholder="Enter supplier name"
                                    autoFocus
                                />
                                <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setShowQuickAddSupplier(false)} className="px-3 py-1.5 bg-slate-100 rounded text-sm hover:bg-slate-200">Cancel</button>
                                    <button type="button" onClick={handleQuickAddSupplier} disabled={!newSupplierName.trim()} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">Add</button>
                                </div>
                            </div>
                        </div>
                    )}
                    {showQuickAddProduct && (
                        <div className="absolute inset-0 bg-white/90 z-10 flex items-center justify-center rounded-xl backdrop-blur-sm animate-in fade-in">
                            <div className="bg-white p-6 rounded-lg shadow-xl border border-slate-200 w-80 space-y-4">
                                <h4 className="font-bold text-lg">Quick Add Product</h4>
                                <input
                                    type="text"
                                    value={newProductName}
                                    onChange={(e) => setNewProductName(e.target.value)}
                                    className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2"
                                    placeholder="Enter product name"
                                    autoFocus
                                />
                                <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setShowQuickAddProduct(false)} className="px-3 py-1.5 bg-slate-100 rounded text-sm hover:bg-slate-200">Cancel</button>
                                    <button type="button" onClick={handleQuickAddProduct} disabled={!newProductName.trim()} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">Add</button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex justify-between items-center mb-6 pb-2 border-b border-slate-100">
                        <h3 className="font-bold text-slate-800">{editingId ? 'Edit Purchase Order' : 'New Purchase Order'}</h3>
                        <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
                        {currentCompanyId === 'ALL' && (
                            <div className="col-span-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
                                <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Assign to Company</label>
                                <select required name="companyId" value={formData.companyId || ''} onChange={e => setFormData({ ...formData, companyId: e.target.value })} className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm">
                                    <option value="">Select Company...</option>
                                    {[...availableCompanies].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                        )}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Supplier</label>
                            <select
                                className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm"
                                value={formData.supplierId || ''}
                                onChange={e => {
                                    if (e.target.value === '_ADD_NEW_') {
                                        setShowQuickAddSupplier(true);
                                    } else {
                                        const sup = suppliers.find(s => s.id === e.target.value);
                                        setFormData({ ...formData, supplierId: e.target.value, supplierName: sup?.name || '' });
                                    }
                                }}
                            >
                                <option value="">Select Supplier...</option>
                                <option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add New Supplier</option>
                                {[...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                            {supplierAddedMessage && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 size={10} /> {supplierAddedMessage}</p>}
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Order Date</label>
                            <input type="date" className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" style={{ colorScheme: 'dark' }} value={formData.orderDate} onChange={e => setFormData({ ...formData, orderDate: e.target.value })} />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Payment Terms</label>
                            <select className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" value={formData.paymentTerms} onChange={e => setFormData({ ...formData, paymentTerms: e.target.value })}>
                                {PAYMENT_TERM_OPTIONS.map(term => <option key={term} value={term}>{term}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Currency</label>
                            <select className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm" value={formData.currency} onChange={e => setFormData({ ...formData, currency: e.target.value })}>
                                <option>USD</option>
                                <option>EUR</option>
                                <option>CNY</option>
                            </select>
                        </div>
                    </div>

                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-100 mb-6">
                        <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">Add Items</h4>
                        <div className="grid grid-cols-12 gap-3 items-end">
                            <div className="col-span-4">
                                <label className="block text-[10px] text-slate-500 mb-1">Product</label>
                                <select
                                    className="w-full border border-slate-600 bg-slate-900 text-white rounded p-2 text-sm"
                                    value={currentItem.productName}
                                    onChange={e => {
                                        if (e.target.value === '_ADD_NEW_') {
                                            setShowQuickAddProduct(true);
                                        } else {
                                            setCurrentItem({ ...currentItem, productName: e.target.value });
                                        }
                                    }}
                                >
                                    <option value="">Select Product...</option>
                                    <option value="_ADD_NEW_" className="font-bold text-blue-600 bg-blue-50">+ Add New Product</option>
                                    {[...products].sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.name}>{p.name} ({p.grade})</option>)}
                                </select>
                                {productAddedMessage && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 size={10} /> {productAddedMessage}</p>}
                            </div>
                            <div className="col-span-3">
                                <QuantityInput
                                    value={currentItem.quantity || 0}
                                    onChange={(val) => setCurrentItem({ ...currentItem, quantity: val })}
                                    label="Qty"
                                />
                            </div>
                            <div className="col-span-3">
                                <PriceInput
                                    value={currentItem.unitPrice || 0}
                                    onChange={(val) => setCurrentItem({ ...currentItem, unitPrice: val })}
                                    label="Unit Price"
                                />
                            </div>
                            <div className="col-span-2">
                                <button onClick={handleAddItem} className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700 h-[38px] w-full flex items-center justify-center"><Plus size={18} /></button>
                            </div>
                        </div>
                    </div>

                    <div className="mb-6">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 text-slate-500">
                                <tr>
                                    <th className="p-2">Product</th>
                                    <th className="p-2 text-right">Qty</th>
                                    <th className="p-2 text-right">Price</th>
                                    <th className="p-2 text-right">Total</th>
                                    <th className="p-2 w-10"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {(formData.items || []).map((item, idx) => (
                                    <tr key={idx} className="border-b border-slate-100">
                                        <td className="p-2">{item.productName}</td>
                                        <td className="p-2 text-right">{item.quantity.toLocaleString()}</td>
                                        <td className="p-2 text-right">${item.unitPrice}</td>
                                        <td className="p-2 text-right font-bold">${item.total.toLocaleString()}</td>
                                        <td className="p-2"><button onClick={() => handleRemoveItem(idx)} className="text-red-400 hover:text-red-600"><Trash2 size={14} /></button></td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td colSpan={3} className="p-2 text-right font-bold uppercase text-slate-500">Total Amount</td>
                                    <td className="p-2 text-right font-bold text-lg text-blue-600">{formData.currency} {formData.totalAmount?.toLocaleString()}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <div className="flex justify-end gap-2">
                        <button onClick={() => setIsAdding(false)} className="px-4 py-2 border border-slate-300 rounded text-slate-600 hover:bg-slate-50">Cancel</button>
                        <button onClick={handleSubmit} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"><Save size={16} /> {editingId ? 'Update PO' : 'Create PO'}</button>
                    </div>
                </div>
            )}

            {/* Content View */}
            {viewMode === 'grid' ? (
                <div className="grid gap-4">
                    {purchaseOrders.map(po => (
                        <div key={po.id} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center justify-between group">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                                    <FileText size={24} />
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-800">{po.supplierName}</h4>
                                    <p className="text-sm text-slate-500 flex items-center gap-2">
                                        <span>PO: {po.id}</span>
                                        <span>•</span>
                                        <span>{po.orderDate}</span>
                                        {po.paymentTerms && <><span>•</span><span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{po.paymentTerms}</span></>}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-6">
                                <div className="text-right">
                                    <p className="text-sm text-slate-500">Total Value</p>
                                    <p className="font-bold text-slate-800">{po.currency} {po.totalAmount.toLocaleString()}</p>
                                </div>
                                <div className={`px-3 py-1 rounded-full text-xs font-bold ${po.status === 'Draft' ? 'bg-slate-100 text-slate-600' :
                                    po.status === 'Sent' ? 'bg-blue-100 text-blue-600' :
                                        po.status === 'Confirmed' ? 'bg-indigo-100 text-indigo-600' :
                                            'bg-emerald-100 text-emerald-600'
                                    }`}>
                                    {po.status}
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Actions</span>
                                    <div className="flex gap-2">
                                        <button onClick={() => handleInitiateEmail(po)} className="text-slate-400 hover:text-indigo-600" title="Email PO"><Mail size={18} /></button>
                                        <button onClick={() => setViewingPO(po)} className="text-slate-400 hover:text-blue-500" title="View & Download PDF"><Eye size={18} /></button>
                                        <button onClick={(e) => handleEdit(po, e)} className="text-slate-400 hover:text-amber-500"><Pencil size={18} /></button>
                                        <button onClick={(e) => handleDelete(po.id, e)} className="text-slate-400 hover:text-red-500"><Trash2 size={18} /></button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">PO #</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Supplier</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Order Date</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Items</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">Total Amount</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase">Status</th>
                                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {purchaseOrders.map(po => (
                                <tr key={po.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-6 py-4 text-sm font-mono text-slate-600">{po.id}</td>
                                    <td className="px-6 py-4 text-sm font-bold text-slate-800">{po.supplierName}</td>
                                    <td className="px-6 py-4 text-sm text-slate-600">{po.orderDate}</td>
                                    <td className="px-6 py-4 text-sm text-slate-600">
                                        <div className="flex flex-col">
                                            <span>{po.items.length} Item(s)</span>
                                            <span className="text-xs text-slate-400">{po.items[0]?.productName} {po.items.length > 1 ? '...' : ''}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right text-sm font-bold text-blue-600">{po.currency} {po.totalAmount.toLocaleString()}</td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${po.status === 'Draft' ? 'bg-slate-100 text-slate-600' :
                                            po.status === 'Sent' ? 'bg-blue-100 text-blue-600' :
                                                po.status === 'Confirmed' ? 'bg-indigo-100 text-indigo-600' :
                                                    'bg-emerald-100 text-emerald-600'
                                            }`}>
                                            {po.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button onClick={() => handleInitiateEmail(po)} className="text-slate-400 hover:text-indigo-600" title="Email PO"><Mail size={16} /></button>
                                            <button onClick={() => setViewingPO(po)} className="text-slate-400 hover:text-blue-500" title="View & Download PDF"><Eye size={16} /></button>
                                            <button onClick={(e) => handleEdit(po, e)} className="text-slate-400 hover:text-amber-500"><Pencil size={16} /></button>
                                            <button onClick={(e) => handleDelete(po.id, e)} className="text-slate-400 hover:text-red-500"><Trash2 size={16} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {purchaseOrders.length === 0 && !isAdding && (
                <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-dashed border-slate-200">
                    <ShoppingCart size={48} className="mx-auto mb-4 opacity-20" />
                    <p>No purchase orders found.</p>
                </div>
            )}
        </div>
    );
};

export default PurchaseOrders;
