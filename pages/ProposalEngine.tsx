import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
    FileSpreadsheet, FileText, X, CheckCircle2, AlertCircle, Loader2,
    Sparkles, Download, Upload, Edit3, Mail, Send, ChevronRight,
    ChevronLeft, Trash2, Plus, DollarSign, Percent, Package, Users,
    Save, Eye, Building, ArrowRight, ShoppingCart, FileCheck
} from 'lucide-react';
import { Supplier, Customer, SupplierOffer, SupplierQuoteItem } from '../types';
import { analyzeDocument } from '../services/geminiService';

interface ProposalEngineProps {
    suppliers: Supplier[];
    customers: Customer[];
    onAddSupplierOffer: (offer: Omit<SupplierOffer, 'id'>) => Promise<SupplierOffer | null>;
    currentCompanyId: string;
    onGoToSource?: () => void;
}

interface ExtractedItem {
    id: string;
    productName: string;
    grade: string;
    quantity: number;
    unitPrice: number;
    total: number;
    selected: boolean;
}

type WizardStep = 'UPLOAD' | 'EDIT' | 'SAVED';
type UploadMode = 'GENERIC' | 'SGT';

// SGT ENTERPRISES specific color mapping
const SGT_FIXED_COLORS = new Set([
    "beige cotton", "beige fleece", "bleached cotton", "bleached fleece",
    "bleached milky cotton", "bleached milky fleece", "bleached milky overlock",
    "bleached overlock", "bleached pc", "bleached pc yarn", "chocolate cotton",
    "chocolate fleece", "cocoa cotton", "cocoa fleece", "daisy cotton",
    "daisy fleece", "daisy pc", "electric green cotton", "electric green pc",
    "forest cotton", "forest fleece", "forest pc", "gold cotton", "gold fleece",
    "gold pc", "haze cotton", "haze fleece", "heliconia cotton", "heliconia fleece",
    "heliconia pc", "honey cotton", "irish green cotton", "irish green fleece",
    "irish green pc", "light blue cotton", "light blue fleece", "light blue pc",
    "light pink cotton", "light pink fleece", "light pink pc", "lime cotton",
    "lime pc", "milky overlock", "milky pc", "mustard yellow fleece",
    "natural cotton", "natural fleece", "natural pc", "neon green pc",
    "old gold cotton", "old gold fleece", "orange cotton", "orange fleece",
    "orange pc", "purple cotton", "purple fleece", "purple pc", "red cotton",
    "red fleece", "red pc", "royal cotton", "royal fleece", "royal caribe fleece",
    "royal pc", "safety green fleece", "safety green overlock", "safety green pc",
    "safety orange fleece", "safety orange overlock", "safety orange pc",
    "safety pink fleece", "safety pink overlock", "safety pink pc",
    "sand cotton", "sand fleece", "sand pc", "sapphire cotton", "sapphire fleece",
    "sapphire pc", "unbleached cotton yarn", "unbleached pc yarn", "milky cotton",
    "black cotton", "black pc", "black fleece", "navy cotton", "navy pc", "navy fleece",
    "ash gray cotton", "ash gray pc", "sport gray cotton", "sport gray pc",
    "sport gray 100% polyester", "charcoal cotton", "charcoal pc", "charcoal 100% polyester",
    "black cotton mp- ind", "dk heather fleece", "heather charcoal fleece", "gravel gray fleece",
    "sport gray fleece", "ash gray fleece", "charcoal fleece", "dk royal fleece", "heather navy fleece",
    "heather royal fleece", "heather blue fleece", "antique sapphire fleece"
]);

const SGT_TRANSLATION_MAP: Record<string, string> = {
    "beige cotton": "Beige 100%", "beige fleece": "Beige Fleece",
    "bleached cotton": "Optical White 100% Cotton", "bleached fleece": "Optical White Fleece",
    "bleached milky cotton": "Bleached White 100% Cotton", "bleached milky fleece": "Bleached White Fleece",
    "bleached milky overlock": "Bleached White Milky Overlock", "bleached overlock": "Optical White Overlock",
    "bleached pc": "Bleached White PC", "bleached pc yarn": "Bleached White PC Yarn",
    "chocolate cotton": "Brown 100%", "chocolate fleece": "Brown Fleece",
    "cocoa cotton": "Cocoa 100%", "cocoa fleece": "Cocoa Fleece",
    "daisy cotton": "Daisy Yellow 100%", "daisy fleece": "Daisy Yellow Fleece", "daisy pc": "Daisy Yellow PC",
    "electric green cotton": "Electric Green 100%", "electric green pc": "Electric Green PC",
    "forest cotton": "Forest Green 100%", "forest fleece": "Forest Green Fleece", "forest pc": "Forest Green PC",
    "gold cotton": "Gold Yellow 100%", "gold fleece": "Gold Yellow Fleece", "gold pc": "Gold Yellow PC",
    "haze cotton": "Honey 100%", "haze fleece": "Honey Fleece",
    "heliconia cotton": "Heliconia Pink 100%", "heliconia fleece": "Hot Pink Fleece", "heliconia pc": "Heliconia Pink PC",
    "honey cotton": "Honey 100%", "irish green cotton": "Green 100%", "irish green fleece": "Irish Green Fleece", "irish green pc": "Green PC",
    "light blue cotton": "Light Blue 100%", "light blue fleece": "Light Blue Fleece", "light blue pc": "Light Blue PC",
    "light pink cotton": "Pink 100%", "light pink fleece": "Light Pink Fleece", "light pink pc": "Pink 100%",
    "lime cotton": "Lime Green 100%", "lime pc": "Lime Green PC", "milky overlock": "Bleached White Overlock",
    "mustard yellow fleece": "Mustard Yellow Fleece", "natural cotton": "Natural Cotton",
    "natural fleece": "Natural Fleece", "natural pc": "Natural Cotton PC", "neon green pc": "Neon Green PC",
    "old gold cotton": "Mustard Yellow 100%", "old gold fleece": "Dark Yellow Fleece",
    "orange cotton": "Orange 100%", "orange fleece": "Orange Fleece", "orange pc": "Orange PC",
    "purple cotton": "Purple 100%", "purple fleece": "Purple Fleece", "purple pc": "Purple PC",
    "red cotton": "Red 100%", "red fleece": "Red Fleece", "red pc": "Red PC",
    "royal cotton": "Royal Blue 100%", "royal fleece": "Royal Blue Fleece", "royal caribe fleece": "Caribe Royal Blue Fleece", "royal pc": "Royal Blue PC",
    "safety green fleece": "Neon Green Fleece", "safety green overlock": "Neon Green Overlock", "safety green pc": "Neon Green PC",
    "safety orange fleece": "Neon Orange Fleece", "safety orange overlock": "Neon Orange Overlock", "safety orange pc": "Neon Orange PC",
    "safety pink fleece": "Neon Pink Fleece", "safety pink overlock": "Neon Pink Overlock", "safety pink pc": "Neon Pink PC",
    "sand cotton": "Sand 100%", "sand fleece": "Sand Fleece", "sand pc": "Sand PC",
    "sapphire cotton": "Sapphire Blue 100%", "sapphire fleece": "Sapphire Blue Fleece", "sapphire pc": "Sapphire Blue PC",
    "unbleached cotton yarn": "Unbleached Cotton Yarn", "unbleached pc yarn": "Unbleached PC Yarn",
    "milky pc": "Bleached White PC", "milky cotton": "Bleached White 100% Cotton",
    "black cotton": "Black 100%", "black pc": "Black PC", "black fleece": "Black Fleece",
    "navy cotton": "Navy Blue 100%", "navy pc": "Navy Blue PC", "navy fleece": "Navy Blue Fleece",
    "ash gray cotton": "Ash Gray 100%", "ash gray pc": "Ash Gray PC",
    "sport gray cotton": "Sport Gray 100%", "sport gray pc": "Sport Gray PC", "sport gray 100% polyester": "Sport Gray 100% Polyester",
    "charcoal cotton": "Charcoal 100%", "charcoal pc": "Charcoal PC", "charcoal 100% polyester": "Charcoal 100% Polyester",
    "black cotton mp- ind": "Black MP-IND 100%", "dk heather fleece": "Dark Heather Fleece",
    "heather charcoal fleece": "Heather Charcoal Fleece", "gravel gray fleece": "Gravel Gray Fleece",
    "sport gray fleece": "Sport Gray Fleece", "ash gray fleece": "Ash Gray Fleece", "charcoal fleece": "Charcoal Fleece",
    "dk royal fleece": "Dark Royal Fleece", "heather navy fleece": "Heather Navy Fleece",
    "heather royal fleece": "Heather Royal Fleece", "heather blue fleece": "Heather Blue Fleece", "antique sapphire fleece": "Antique Sapphire Fleece"
};

const ProposalEngine: React.FC<ProposalEngineProps> = ({
    suppliers,
    customers,
    onAddSupplierOffer,
    currentCompanyId,
    onGoToSource
}) => {
    // Wizard State
    const [currentStep, setCurrentStep] = useState<WizardStep>('UPLOAD');
    const [uploadMode, setUploadMode] = useState<UploadMode>('GENERIC');

    // Upload State
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingError, setProcessingError] = useState<string | null>(null);
    const [dragActive, setDragActive] = useState(false);
    const [sgtDragActive, setSgtDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const sgtFileInputRef = useRef<HTMLInputElement>(null);

    // Extracted Data State
    const [extractedItems, setExtractedItems] = useState<ExtractedItem[]>([]);
    const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
    const [quoteNotes, setQuoteNotes] = useState<string>('');
    const [currency, setCurrency] = useState<string>('USD');
    const [incoterm, setIncoterm] = useState<string>('FOB');
    const [paymentTerms, setPaymentTerms] = useState<string>('Net 30');

    // Save State
    const [isSaving, setIsSaving] = useState(false);
    const [savedOfferId, setSavedOfferId] = useState<string | null>(null);
    const [savedOfferNumber, setSavedOfferNumber] = useState<string>('');

    // --- File Processing ---
    const handleFileSelect = async (file: File, mode: UploadMode = 'GENERIC') => {
        setUploadedFile(file);
        setUploadMode(mode);
        setProcessingError(null);
        setIsProcessing(true);

        try {
            let items: ExtractedItem[] = [];

            if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                if (mode === 'SGT') {
                    items = await processSGTQuote(file);
                    const sgtSupplier = suppliers.find(s => s.name.toLowerCase().includes('sgt'));
                    if (sgtSupplier) setSelectedSupplierId(sgtSupplier.id);
                } else {
                    items = await processXLSX(file);
                }
            } else if (file.name.endsWith('.pdf')) {
                items = await processPDF(file);
            } else {
                throw new Error('Unsupported file type. Please upload PDF or XLSX files.');
            }

            if (items.length === 0) {
                throw new Error('No items could be extracted from the file.');
            }

            setExtractedItems(items);
            setCurrentStep('EDIT');

        } catch (err: any) {
            setProcessingError(err.message || 'Failed to process file');
        } finally {
            setIsProcessing(false);
        }
    };

    // --- SGT Quote XLSX Processing ---
    const processSGTQuote = async (file: File): Promise<ExtractedItem[]> => {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const aggregated: Record<string, { color: string, translated: string, bales: number, weight: number }> = {};

        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            for (let i = 4; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length < 4) continue;

                const rawColor = String(row[1] || '').trim().toLowerCase();
                if (!SGT_FIXED_COLORS.has(rawColor)) continue;

                const bales = parseInt(String(row[2] || '0'), 10);
                const weight = parseInt(String(row[3] || '0'), 10);
                if (bales === 0 || isNaN(bales)) continue;

                if (aggregated[rawColor]) {
                    aggregated[rawColor].bales += bales;
                    aggregated[rawColor].weight += weight;
                } else {
                    aggregated[rawColor] = {
                        color: String(row[1] || '').trim(),
                        translated: SGT_TRANSLATION_MAP[rawColor] || 'Not Translated',
                        bales,
                        weight
                    };
                }
            }
        }

        const entries = Object.values(aggregated).filter(r => r.bales > 0).sort((a, b) => a.color.localeCompare(b.color));

        return entries.map((entry, idx) => ({
            id: `sgt-${Date.now()}-${idx}`,
            productName: entry.translated,
            grade: entry.color,
            quantity: entry.weight,
            unitPrice: 0,
            total: 0,
            selected: true
        }));
    };

    const processXLSX = async (file: File): Promise<ExtractedItem[]> => {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const items: ExtractedItem[] = [];

        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            let headerRowIndex = -1;
            for (let i = 0; i < Math.min(10, rows.length); i++) {
                const row = rows[i];
                if (!row) continue;
                const rowStr = row.join(' ').toLowerCase();
                if (rowStr.includes('product') || rowStr.includes('item') || rowStr.includes('description') || rowStr.includes('color')) {
                    headerRowIndex = i;
                    break;
                }
            }

            const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 4;

            for (let i = startRow; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length < 3) continue;

                const productName = String(row[0] || row[1] || '').trim();
                if (!productName || productName.length < 2) continue;

                let quantity = 0;
                let unitPrice = 0;

                for (let j = 1; j < row.length; j++) {
                    const val = parseFloat(String(row[j]));
                    if (!isNaN(val) && val > 0) {
                        if (quantity === 0) quantity = val;
                        else if (unitPrice === 0) unitPrice = val;
                    }
                }

                if (quantity > 0) {
                    items.push({
                        id: `item-${Date.now()}-${i}`,
                        productName,
                        grade: '',
                        quantity,
                        unitPrice: unitPrice || 0,
                        total: quantity * unitPrice,
                        selected: true
                    });
                }
            }
        }

        return items;
    };

    const processPDF = async (file: File): Promise<ExtractedItem[]> => {
        const buffer = await file.arrayBuffer();
        const base64 = btoa(
            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        const prompt = `
Extract all line items from this supplier quote/offer document.
For each item, extract: Product Name, Grade/Quality (if available), Quantity, Unit Price.

Return a JSON array with this structure:
[
  { "productName": "string", "grade": "string or empty", "quantity": number, "unitPrice": number }
]

If prices are not clearly visible, estimate based on context or use 0.
Return ONLY the JSON array, no other text.
`;

        const response = await analyzeDocument(base64, 'application/pdf', prompt);

        try {
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (!jsonMatch) throw new Error('No items found in document');

            const parsed = JSON.parse(jsonMatch[0]);

            return parsed.map((item: any, idx: number) => ({
                id: `item-${Date.now()}-${idx}`,
                productName: item.productName || 'Unknown Product',
                grade: item.grade || '',
                quantity: item.quantity || 0,
                unitPrice: item.unitPrice || 0,
                total: (item.quantity || 0) * (item.unitPrice || 0),
                selected: true
            }));
        } catch (e) {
            console.error('Failed to parse PDF extraction:', e);
            throw new Error('Could not extract items from PDF. Please try a different file or XLSX format.');
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            handleFileSelect(e.target.files[0]);
        }
    };

    // --- Item Editing ---
    const updateItem = (id: string, field: keyof ExtractedItem, value: any) => {
        setExtractedItems(prev => prev.map(item => {
            if (item.id !== id) return item;

            const updated = { ...item, [field]: value };

            if (['quantity', 'unitPrice'].includes(field)) {
                updated.total = updated.quantity * updated.unitPrice;
            }

            return updated;
        }));
    };

    const deleteItem = (id: string) => {
        setExtractedItems(prev => prev.filter(item => item.id !== id));
    };

    const addNewItem = () => {
        setExtractedItems(prev => [...prev, {
            id: `item-${Date.now()}`,
            productName: 'New Product',
            grade: '',
            quantity: 0,
            unitPrice: 0,
            total: 0,
            selected: true
        }]);
    };

    // --- Calculations ---
    const selectedItems = extractedItems.filter(i => i.selected);
    const totalAmount = selectedItems.reduce((sum, i) => sum + i.total, 0);

    // --- Save to Supplier Offers ---
    const saveToSupplierOffers = async () => {
        if (!selectedSupplierId) {
            setProcessingError('Please select a supplier');
            return;
        }

        setIsSaving(true);
        setProcessingError(null);

        try {
            const supplier = suppliers.find(s => s.id === selectedSupplierId);
            const offerNumber = `SQ-${Date.now()}`;

            const offer: Omit<SupplierOffer, 'id'> = {
                offerNumber,
                companyId: currentCompanyId,
                supplierId: selectedSupplierId,
                supplierName: supplier?.name || 'Unknown',
                items: selectedItems.map(item => ({
                    productName: item.productName,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    total: item.total
                })),
                totalAmount,
                currency: currency as SupplierOffer['currency'],
                incoterm: incoterm as SupplierOffer['incoterm'],
                validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                paymentTerms,
                status: 'Received',
                notes: quoteNotes
            };

            const saved = await onAddSupplierOffer(offer);
            if (saved) {
                setSavedOfferId(saved.id);
                setSavedOfferNumber(offerNumber);
                setCurrentStep('SAVED');
            }
        } catch (err: any) {
            setProcessingError('Failed to save supplier offer');
        } finally {
            setIsSaving(false);
        }
    };

    // --- Reset ---
    const resetWizard = () => {
        setCurrentStep('UPLOAD');
        setUploadedFile(null);
        setExtractedItems([]);
        setSelectedSupplierId('');
        setQuoteNotes('');
        setCurrency('USD');
        setIncoterm('FOB');
        setPaymentTerms('Net 30');
        setProcessingError(null);
        setSavedOfferId(null);
        setSavedOfferNumber('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // --- Render Step Indicator ---
    const handleStepIndicatorClick = (targetStep: WizardStep) => {
        if (targetStep === 'EDIT' && currentStep === 'UPLOAD') {
            // Manual entry: go to Edit with a blank item
            setExtractedItems([{
                id: `item-${Date.now()}`,
                productName: '',
                grade: '',
                quantity: 0,
                unitPrice: 0,
                total: 0,
                selected: true
            }]);
            setCurrentStep('EDIT');
        } else if (targetStep === 'UPLOAD') {
            resetWizard();
        }
    };

    const renderStepIndicator = () => (
        <div className="flex items-center justify-center gap-2 mb-8">
            {[
                { step: 'UPLOAD' as WizardStep, label: 'Upload Offer', icon: Upload },
                { step: 'EDIT' as WizardStep, label: 'Edit', icon: Edit3 },
                { step: 'SAVED' as WizardStep, label: 'Save', icon: Save }
            ].map((s, idx) => {
                const stepOrder = ['UPLOAD', 'EDIT', 'SAVED'];
                const currentIdx = stepOrder.indexOf(currentStep);
                const sIdx = stepOrder.indexOf(s.step);
                const isActive = currentStep === s.step;
                const isPast = sIdx < currentIdx;
                const Icon = s.icon;
                const canClick = (s.step === 'EDIT' && currentStep === 'UPLOAD') || (s.step === 'UPLOAD' && currentStep !== 'UPLOAD');

                return (
                    <React.Fragment key={s.step}>
                        {idx > 0 && (
                            <div className={`w-12 h-0.5 ${isPast ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                        )}
                        <div
                            onClick={() => canClick && handleStepIndicatorClick(s.step)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all ${canClick ? 'cursor-pointer' : ''} ${isActive
                                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg'
                                : isPast
                                    ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                    : canClick
                                        ? 'bg-slate-100 text-slate-500 hover:bg-indigo-100 hover:text-indigo-600'
                                        : 'bg-slate-100 text-slate-400'
                                }`}
                        >
                            <Icon size={18} />
                            <span className="text-sm font-bold">{s.label}</span>
                        </div>
                    </React.Fragment>
                );
            })}
        </div>
    );

    // --- Step 1: Upload ---
    const renderUploadStep = () => (
        <div className="space-y-6">
            <div className="text-center mb-6">
                <h3 className="text-xl font-bold text-slate-800">Upload Supplier Offer</h3>
                <p className="text-slate-500 text-sm mt-1">Upload a PDF or Excel file, or click <strong>Edit</strong> above for manual entry</p>
            </div>

            {/* Upload Options */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Generic Upload */}
                <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
                    onDrop={handleDrop}
                    className={`p-8 border-2 border-dashed rounded-2xl text-center cursor-pointer transition-all ${dragActive
                        ? 'border-indigo-500 bg-indigo-50 scale-[1.02]'
                        : 'border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/50'
                        }`}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.xlsx,.xls"
                        onChange={handleInputChange}
                        className="hidden"
                    />

                    {isProcessing && uploadMode === 'GENERIC' ? (
                        <div className="space-y-3">
                            <Loader2 size={40} className="mx-auto text-indigo-500 animate-spin" />
                            <p className="text-indigo-600 font-medium">Processing...</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex justify-center gap-4">
                                <div className="p-3 bg-red-100 rounded-xl">
                                    <FileText size={32} className="text-red-500" />
                                </div>
                                <div className="p-3 bg-green-100 rounded-xl">
                                    <FileSpreadsheet size={32} className="text-green-600" />
                                </div>
                            </div>
                            <p className="text-slate-700 font-bold">Generic Offer Upload</p>
                            <p className="text-xs text-slate-400">
                                PDF or Excel with any format
                            </p>
                        </div>
                    )}
                </div>

                {/* SGT Quote Upload */}
                <div
                    onClick={() => sgtFileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setSgtDragActive(true); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setSgtDragActive(false); }}
                    onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSgtDragActive(false);
                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                            const file = e.dataTransfer.files[0];
                            if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                                handleFileSelect(file, 'SGT');
                            } else {
                                setProcessingError('SGT Quote requires an Excel file (.xlsx or .xls)');
                            }
                        }
                    }}
                    className={`p-8 border-2 border-dashed rounded-2xl text-center cursor-pointer transition-all bg-gradient-to-br from-emerald-50 to-teal-50 ${sgtDragActive
                        ? 'border-emerald-500 bg-emerald-100 scale-[1.02]'
                        : 'border-emerald-300 hover:border-emerald-500 hover:bg-emerald-50/50'
                        }`}
                >
                    <input
                        ref={sgtFileInputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                                handleFileSelect(e.target.files[0], 'SGT');
                            }
                        }}
                        className="hidden"
                    />

                    {isProcessing && uploadMode === 'SGT' ? (
                        <div className="space-y-3">
                            <Loader2 size={40} className="mx-auto text-emerald-500 animate-spin" />
                            <p className="text-emerald-600 font-medium">Processing SGT Quote...</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="mx-auto w-fit p-3 bg-emerald-100 rounded-xl">
                                <FileSpreadsheet size={32} className="text-emerald-600" />
                            </div>
                            <p className="text-emerald-700 font-bold">SGT Quote</p>
                            <p className="text-xs text-emerald-600">
                                SGT Enterprises Inventory XLSX
                            </p>
                            <span className="inline-block px-2 py-0.5 bg-emerald-200 text-emerald-800 text-[10px] font-bold rounded-full uppercase">
                                Auto Color Mapping
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {processingError && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-3">
                    <AlertCircle size={20} />
                    <span>{processingError}</span>
                </div>
            )}
        </div>
    );

    // --- Step 2: Edit ---
    const renderEditStep = () => (
        <div className="space-y-6">
            {/* Header with supplier selection and offer details */}
            <div className="flex flex-wrap gap-4 items-end justify-between">
                <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                        <Building size={12} className="inline mr-1" /> Supplier
                    </label>
                    <select
                        value={selectedSupplierId}
                        onChange={(e) => setSelectedSupplierId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                        <option value="">Select Supplier...</option>
                        {suppliers.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                </div>

                <div className="min-w-[120px]">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Currency</label>
                    <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="BRL">BRL</option>
                        <option value="GTQ">GTQ</option>
                    </select>
                </div>

                <div className="min-w-[120px]">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Incoterm</label>
                    <select
                        value={incoterm}
                        onChange={(e) => setIncoterm(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                        <option value="FOB">FOB</option>
                        <option value="CIF">CIF</option>
                        <option value="CFR">CFR</option>
                        <option value="EXW">EXW</option>
                        <option value="DDP">DDP</option>
                    </select>
                </div>

                <div className="min-w-[140px]">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Payment Terms</label>
                    <select
                        value={paymentTerms}
                        onChange={(e) => setPaymentTerms(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                        <option value="Net 30">Net 30</option>
                        <option value="Net 60">Net 60</option>
                        <option value="Net 90">Net 90</option>
                        <option value="Cash in Advance">Cash in Advance</option>
                        <option value="Letter of Credit">Letter of Credit</option>
                    </select>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={addNewItem}
                        className="flex items-center gap-1 px-3 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors text-sm font-medium"
                    >
                        <Plus size={16} /> Add Item
                    </button>
                </div>
            </div>

            {/* Notes */}
            <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notes</label>
                <input
                    type="text"
                    value={quoteNotes}
                    onChange={(e) => setQuoteNotes(e.target.value)}
                    placeholder="Optional notes about this offer..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
            </div>

            {/* Items Table */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gradient-to-r from-slate-50 to-slate-100 border-b border-slate-200">
                            <tr>
                                <th className="p-3 text-left font-bold text-slate-600 w-8"></th>
                                <th className="p-3 text-left font-bold text-slate-600">Product</th>
                                <th className="p-3 text-left font-bold text-slate-600">Grade</th>
                                <th className="p-3 text-right font-bold text-slate-600">Quantity</th>
                                <th className="p-3 text-right font-bold text-slate-600">Unit Price</th>
                                <th className="p-3 text-right font-bold text-slate-600">Total</th>
                                <th className="p-3 w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {extractedItems.map((item) => (
                                <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${!item.selected ? 'opacity-40' : ''}`}>
                                    <td className="p-3">
                                        <input
                                            type="checkbox"
                                            checked={item.selected}
                                            onChange={(e) => updateItem(item.id, 'selected', e.target.checked)}
                                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                    </td>
                                    <td className="p-3">
                                        <input
                                            type="text"
                                            value={item.productName}
                                            onChange={(e) => updateItem(item.id, 'productName', e.target.value)}
                                            className="w-full bg-transparent font-medium focus:outline-none focus:ring-1 focus:ring-indigo-300 rounded px-1"
                                        />
                                    </td>
                                    <td className="p-3">
                                        <input
                                            type="text"
                                            value={item.grade}
                                            onChange={(e) => updateItem(item.id, 'grade', e.target.value)}
                                            placeholder="—"
                                            className="w-24 bg-transparent text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-300 rounded px-1"
                                        />
                                    </td>
                                    <td className="p-3">
                                        <input
                                            type="number"
                                            value={item.quantity}
                                            onChange={(e) => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                                            className="w-24 text-right bg-transparent font-mono focus:outline-none focus:ring-1 focus:ring-indigo-300 rounded px-1"
                                        />
                                    </td>
                                    <td className="p-3">
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={item.unitPrice}
                                            onChange={(e) => updateItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                                            className="w-24 text-right bg-transparent font-mono focus:outline-none focus:ring-1 focus:ring-indigo-300 rounded px-1"
                                        />
                                    </td>
                                    <td className="p-3 text-right font-mono font-medium text-slate-700">
                                        ${item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="p-3">
                                        <button
                                            onClick={() => deleteItem(item.id)}
                                            className="text-red-400 hover:text-red-600 transition-colors"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                    <p className="text-xs text-slate-500 font-bold uppercase">Selected Items</p>
                    <p className="text-2xl font-bold text-slate-700">{selectedItems.length}</p>
                </div>
                <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-200">
                    <p className="text-xs text-indigo-600 font-bold uppercase">Total Amount</p>
                    <p className="text-2xl font-bold text-indigo-700">${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-purple-50 rounded-xl p-4 border border-purple-200">
                    <p className="text-xs text-purple-600 font-bold uppercase">Currency / Terms</p>
                    <p className="text-lg font-bold text-purple-700">{currency} · {incoterm}</p>
                    <p className="text-xs text-purple-500">{paymentTerms}</p>
                </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
                <button
                    onClick={resetWizard}
                    className="px-4 py-2.5 border border-slate-300 rounded-lg text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                >
                    <ChevronLeft size={18} className="inline mr-1" /> Start Over
                </button>

                <button
                    onClick={saveToSupplierOffers}
                    disabled={!selectedSupplierId || isSaving || selectedItems.length === 0}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold transition-all ${selectedSupplierId && selectedItems.length > 0
                        ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-700 hover:to-purple-700 shadow-md hover:shadow-lg'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                        }`}
                >
                    {isSaving ? (
                        <><Loader2 size={18} className="animate-spin" /> Saving...</>
                    ) : (
                        <><Save size={18} /> Save Supplier Offer <ChevronRight size={18} /></>
                    )}
                </button>
            </div>

            {processingError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                    <AlertCircle size={16} /> {processingError}
                </div>
            )}
        </div>
    );

    // --- Step 3: Saved ---
    const renderSavedStep = () => {
        const supplier = suppliers.find(s => s.id === selectedSupplierId);

        return (
            <div className="space-y-8 py-4">
                {/* Success Banner */}
                <div className="text-center space-y-4">
                    <div className="mx-auto w-20 h-20 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-200">
                        <CheckCircle2 size={40} className="text-white" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold text-slate-800">Offer Saved Successfully!</h3>
                        <p className="text-slate-500 mt-1">
                            Offer <span className="font-mono font-bold text-indigo-600">{savedOfferNumber}</span> from{' '}
                            <span className="font-bold text-slate-700">{supplier?.name}</span> has been saved
                        </p>
                    </div>
                </div>

                {/* Offer Summary */}
                <div className="bg-gradient-to-r from-slate-50 to-indigo-50 border border-slate-200 rounded-xl p-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                        <div>
                            <p className="text-xs text-slate-500 font-bold uppercase">Items</p>
                            <p className="text-xl font-bold text-slate-800">{selectedItems.length}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 font-bold uppercase">Total Amount</p>
                            <p className="text-xl font-bold text-indigo-700">${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 font-bold uppercase">Currency</p>
                            <p className="text-xl font-bold text-slate-800">{currency}</p>
                        </div>
                        <div>
                            <p className="text-xs text-slate-500 font-bold uppercase">Terms</p>
                            <p className="text-xl font-bold text-slate-800">{incoterm} · {paymentTerms}</p>
                        </div>
                    </div>
                </div>

                {/* What's Next */}
                <div className="space-y-3">
                    <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider">What's Next?</h4>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Generate Source */}
                        <button
                            onClick={() => {
                                if (onGoToSource) onGoToSource();
                            }}
                            className="group p-6 bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-2xl text-left hover:border-indigo-400 hover:shadow-lg transition-all"
                        >
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-xl text-white group-hover:scale-110 transition-transform">
                                    <ArrowRight size={24} />
                                </div>
                                <div>
                                    <p className="font-bold text-slate-800 text-lg">Generate Source</p>
                                    <p className="text-sm text-slate-500 mt-1">
                                        Continue the Order-Sale flow. Go to the Source step to select this offer and calculate costs.
                                    </p>
                                </div>
                            </div>
                        </button>

                        {/* Upload Another Offer */}
                        <button
                            onClick={resetWizard}
                            className="group p-6 bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-200 rounded-2xl text-left hover:border-emerald-400 hover:shadow-lg transition-all"
                        >
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl text-white group-hover:scale-110 transition-transform">
                                    <Upload size={24} />
                                </div>
                                <div>
                                    <p className="font-bold text-slate-800 text-lg">Upload New Offer</p>
                                    <p className="text-sm text-slate-500 mt-1">
                                        Upload another supplier offer to save and compare.
                                    </p>
                                </div>
                            </div>
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="p-6 max-w-6xl mx-auto">
            {/* Header */}
            <div className="mb-6 flex items-start justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-xl text-white"><Upload size={24} /></div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Supplier Offer</h1>
                        <p className="text-slate-500 text-sm mt-1">Upload, edit and save supplier offers</p>
                    </div>
                </div>
            </div>

            {/* Step Indicator */}
            {renderStepIndicator()}

            {/* Content Card */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
                {currentStep === 'UPLOAD' && renderUploadStep()}
                {currentStep === 'EDIT' && renderEditStep()}
                {currentStep === 'SAVED' && renderSavedStep()}
            </div>
        </div>
    );
};

export default ProposalEngine;
