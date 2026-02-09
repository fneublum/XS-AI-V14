import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
    FileSpreadsheet, FileText, X, CheckCircle2, AlertCircle, Loader2,
    Sparkles, Download, Upload, Edit3, Mail, Send, ChevronRight,
    ChevronLeft, Trash2, Plus, DollarSign, Percent, Package, Users,
    Save, Eye, Building
} from 'lucide-react';
import { Supplier, Customer, SupplierOffer, SupplierQuoteItem } from '../types';
import { analyzeDocument, generateSalesEmail } from '../services/geminiService';

interface ProposalEngineProps {
    suppliers: Supplier[];
    customers: Customer[];
    onAddSupplierOffer: (offer: Omit<SupplierOffer, 'id'>) => Promise<SupplierOffer | null>;
    currentCompanyId: string;
}

interface ExtractedItem {
    id: string;
    productName: string;
    grade: string;
    quantity: number;
    unitPrice: number;
    costTotal: number;
    markup: number;
    sellPrice: number;
    sellTotal: number;
    selected: boolean;
}

type WizardStep = 'UPLOAD' | 'EDIT' | 'EMAIL';
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
    currentCompanyId
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
    const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
    const [quoteNotes, setQuoteNotes] = useState<string>('');

    // Email State
    const [emailSubject, setEmailSubject] = useState<string>('');
    const [emailBody, setEmailBody] = useState<string>('');
    const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [savedOfferId, setSavedOfferId] = useState<string | null>(null);

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
                    // Auto-select SGT supplier
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

            // Skip first 4 rows (header)
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
            grade: entry.color, // Original color as grade
            quantity: entry.weight, // Weight in lbs as quantity
            unitPrice: 0, // User to fill in
            costTotal: 0,
            markup: 15,
            sellPrice: 0,
            sellTotal: 0,
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

            // Try to find header row (look for common patterns)
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

            // Parse data rows
            const startRow = headerRowIndex >= 0 ? headerRowIndex + 1 : 4; // Default skip 4 rows

            for (let i = startRow; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length < 3) continue;

                // Try to extract: ProductName, Quantity, Price
                const productName = String(row[0] || row[1] || '').trim();
                if (!productName || productName.length < 2) continue;

                // Find numeric values for quantity and price
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
                        costTotal: quantity * unitPrice,
                        markup: 15, // Default 15% markup
                        sellPrice: unitPrice * 1.15,
                        sellTotal: quantity * unitPrice * 1.15,
                        selected: true
                    });
                }
            }
        }

        return items;
    };

    const processPDF = async (file: File): Promise<ExtractedItem[]> => {
        // Convert to base64
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

        // Parse AI response
        try {
            // Clean response - find JSON array
            const jsonMatch = response.match(/\[[\s\S]*\]/);
            if (!jsonMatch) throw new Error('No items found in document');

            const parsed = JSON.parse(jsonMatch[0]);

            return parsed.map((item: any, idx: number) => ({
                id: `item-${Date.now()}-${idx}`,
                productName: item.productName || 'Unknown Product',
                grade: item.grade || '',
                quantity: item.quantity || 0,
                unitPrice: item.unitPrice || 0,
                costTotal: (item.quantity || 0) * (item.unitPrice || 0),
                markup: 15,
                sellPrice: (item.unitPrice || 0) * 1.15,
                sellTotal: (item.quantity || 0) * (item.unitPrice || 0) * 1.15,
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

            // Recalculate totals when relevant fields change
            if (['quantity', 'unitPrice', 'markup'].includes(field)) {
                updated.costTotal = updated.quantity * updated.unitPrice;
                updated.sellPrice = updated.unitPrice * (1 + updated.markup / 100);
                updated.sellTotal = updated.quantity * updated.sellPrice;
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
            costTotal: 0,
            markup: 15,
            sellPrice: 0,
            sellTotal: 0,
            selected: true
        }]);
    };

    const applyGlobalMarkup = (markup: number) => {
        setExtractedItems(prev => prev.map(item => ({
            ...item,
            markup,
            sellPrice: item.unitPrice * (1 + markup / 100),
            sellTotal: item.quantity * item.unitPrice * (1 + markup / 100)
        })));
    };

    // --- Calculations ---
    const selectedItems = extractedItems.filter(i => i.selected);
    const totalCost = selectedItems.reduce((sum, i) => sum + i.costTotal, 0);
    const totalSell = selectedItems.reduce((sum, i) => sum + i.sellTotal, 0);
    const totalProfit = totalSell - totalCost;
    const avgMargin = totalCost > 0 ? ((totalSell - totalCost) / totalCost) * 100 : 0;

    // --- Save to Supplier Offers ---
    const saveToSupplierOffers = async () => {
        if (!selectedSupplierId) {
            setProcessingError('Please select a supplier');
            return;
        }

        setIsSaving(true);

        try {
            const supplier = suppliers.find(s => s.id === selectedSupplierId);

            const offer: Omit<SupplierOffer, 'id'> = {
                offerNumber: `SQ-${Date.now()}`,
                companyId: currentCompanyId,
                supplierId: selectedSupplierId,
                supplierName: supplier?.name || 'Unknown',
                items: selectedItems.map(item => ({
                    productName: item.productName,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    total: item.costTotal
                })),
                totalAmount: totalCost,
                currency: 'USD',
                incoterm: 'FOB',
                validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                paymentTerms: 'Net 30',
                status: 'Received',
                notes: quoteNotes
            };

            const saved = await onAddSupplierOffer(offer);
            if (saved) {
                setSavedOfferId(saved.id);
            }
        } catch (err: any) {
            setProcessingError('Failed to save supplier offer');
        } finally {
            setIsSaving(false);
        }
    };

    // --- Email Generation ---
    const generateEmail = async () => {
        if (!selectedCustomerId) {
            setProcessingError('Please select a customer');
            return;
        }

        setIsGeneratingEmail(true);
        setProcessingError(null);

        try {
            const customer = customers.find(c => c.id === selectedCustomerId);
            const customerName = customer?.name || 'Valued Customer';

            // Create quote items for email
            const quoteItems = selectedItems.map(item => ({
                productId: item.id,
                productName: item.productName,
                grade: item.grade || 'Standard',
                quantityLBS: item.quantity,
                unitPriceUSD: item.sellPrice,
                totalUSD: item.sellTotal
            }));

            const email = await generateSalesEmail(customerName, quoteItems, totalSell);

            // Parse email response
            setEmailSubject(`Quote for ${customerName} - ${selectedItems.length} Products`);
            setEmailBody(email);
            setCurrentStep('EMAIL');

        } catch (err: any) {
            setProcessingError('Failed to generate email. Please try again.');
        } finally {
            setIsGeneratingEmail(false);
        }
    };

    // --- Reset ---
    const resetWizard = () => {
        setCurrentStep('UPLOAD');
        setUploadedFile(null);
        setExtractedItems([]);
        setSelectedSupplierId('');
        setSelectedCustomerId('');
        setQuoteNotes('');
        setEmailSubject('');
        setEmailBody('');
        setProcessingError(null);
        setSavedOfferId(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // --- Render Step Indicator ---
    const renderStepIndicator = () => (
        <div className="flex items-center justify-center gap-2 mb-8">
            {[
                { step: 'UPLOAD' as WizardStep, label: 'Upload', icon: Upload },
                { step: 'EDIT' as WizardStep, label: 'Edit & Price', icon: Edit3 },
                { step: 'EMAIL' as WizardStep, label: 'Generate Email', icon: Mail }
            ].map((s, idx) => {
                const isActive = currentStep === s.step;
                const isPast = (currentStep === 'EDIT' && s.step === 'UPLOAD') ||
                    (currentStep === 'EMAIL' && s.step !== 'EMAIL');
                const Icon = s.icon;

                return (
                    <React.Fragment key={s.step}>
                        {idx > 0 && (
                            <div className={`w-12 h-0.5 ${isPast ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                        )}
                        <div
                            className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all ${isActive
                                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg'
                                : isPast
                                    ? 'bg-emerald-100 text-emerald-700'
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
                <h3 className="text-xl font-bold text-slate-800">Upload Supplier Quote</h3>
                <p className="text-slate-500 text-sm mt-1">Upload a PDF or Excel file containing supplier pricing</p>
            </div>

            {/* Two Upload Options */}
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
                            <p className="text-slate-700 font-bold">Generic Quote Upload</p>
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
            {/* Header with supplier selection */}
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

                <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                        <Users size={12} className="inline mr-1" /> Customer
                    </label>
                    <select
                        value={selectedCustomerId}
                        onChange={(e) => setSelectedCustomerId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                        <option value="">Select Customer...</option>
                        {customers.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>

                <div className="flex gap-2">
                    <div className="flex items-center gap-2 bg-slate-100 px-3 py-2 rounded-lg">
                        <Percent size={14} className="text-slate-500" />
                        <input
                            type="number"
                            min="0"
                            max="100"
                            placeholder="Global %"
                            className="w-16 bg-transparent text-sm font-medium focus:outline-none"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    applyGlobalMarkup(parseFloat((e.target as HTMLInputElement).value) || 0);
                                }
                            }}
                        />
                        <button
                            onClick={() => {
                                const input = document.querySelector('input[placeholder="Global %"]') as HTMLInputElement;
                                applyGlobalMarkup(parseFloat(input?.value) || 0);
                            }}
                            className="text-indigo-600 hover:text-indigo-700 text-xs font-bold"
                        >
                            Apply
                        </button>
                    </div>
                    <button
                        onClick={addNewItem}
                        className="flex items-center gap-1 px-3 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors text-sm font-medium"
                    >
                        <Plus size={16} /> Add Item
                    </button>
                </div>
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
                                <th className="p-3 text-right font-bold text-slate-600">Qty</th>
                                <th className="p-3 text-right font-bold text-slate-600">Cost $</th>
                                <th className="p-3 text-right font-bold text-slate-600">Cost Total</th>
                                <th className="p-3 text-center font-bold text-indigo-600">Markup %</th>
                                <th className="p-3 text-right font-bold text-emerald-600">Sell $</th>
                                <th className="p-3 text-right font-bold text-emerald-600">Sell Total</th>
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
                                            className="w-20 bg-transparent text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-300 rounded px-1"
                                        />
                                    </td>
                                    <td className="p-3">
                                        <input
                                            type="number"
                                            value={item.quantity}
                                            onChange={(e) => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                                            className="w-20 text-right bg-transparent font-mono focus:outline-none focus:ring-1 focus:ring-indigo-300 rounded px-1"
                                        />
                                    </td>
                                    <td className="p-3">
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={item.unitPrice}
                                            onChange={(e) => updateItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                                            className="w-20 text-right bg-transparent font-mono focus:outline-none focus:ring-1 focus:ring-indigo-300 rounded px-1"
                                        />
                                    </td>
                                    <td className="p-3 text-right font-mono text-slate-600">
                                        ${item.costTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className="p-3">
                                        <div className="flex items-center justify-center">
                                            <input
                                                type="number"
                                                step="1"
                                                value={item.markup}
                                                onChange={(e) => updateItem(item.id, 'markup', parseFloat(e.target.value) || 0)}
                                                className="w-14 text-center bg-indigo-50 border border-indigo-200 rounded-lg py-1 font-mono text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                            />
                                        </div>
                                    </td>
                                    <td className="p-3 text-right font-mono font-medium text-emerald-600">
                                        ${item.sellPrice.toFixed(2)}
                                    </td>
                                    <td className="p-3 text-right font-mono font-bold text-emerald-600">
                                        ${item.sellTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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

            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-4">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                    <p className="text-xs text-slate-500 font-bold uppercase">Total Cost</p>
                    <p className="text-2xl font-bold text-slate-700">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-200">
                    <p className="text-xs text-emerald-600 font-bold uppercase">Total Sell</p>
                    <p className="text-2xl font-bold text-emerald-700">${totalSell.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-200">
                    <p className="text-xs text-indigo-600 font-bold uppercase">Total Profit</p>
                    <p className="text-2xl font-bold text-indigo-700">${totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="bg-purple-50 rounded-xl p-4 border border-purple-200">
                    <p className="text-xs text-purple-600 font-bold uppercase">Avg Margin</p>
                    <p className="text-2xl font-bold text-purple-700">{avgMargin.toFixed(1)}%</p>
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
                    disabled={!selectedSupplierId || isSaving}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all ${savedOfferId
                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                        : selectedSupplierId
                            ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        }`}
                >
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : savedOfferId ? <CheckCircle2 size={18} /> : <Save size={18} />}
                    {savedOfferId ? 'Saved to Offers' : 'Save to Supplier Offers'}
                </button>

                <button
                    onClick={generateEmail}
                    disabled={!selectedCustomerId || selectedItems.length === 0 || isGeneratingEmail}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold transition-all ${selectedCustomerId && selectedItems.length > 0
                        ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:from-indigo-700 hover:to-purple-700 shadow-md hover:shadow-lg'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                        }`}
                >
                    {isGeneratingEmail ? (
                        <><Loader2 size={18} className="animate-spin" /> Generating...</>
                    ) : (
                        <><Sparkles size={18} /> Generate Proposal Email <ChevronRight size={18} /></>
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

    // --- Step 3: Email ---
    const renderEmailStep = () => (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-xl font-bold text-slate-800">Preview & Send Proposal</h3>
                    <p className="text-slate-500 text-sm mt-1">Review the AI-generated email and send to customer</p>
                </div>
                <div className="text-right">
                    <p className="text-xs text-slate-400">Sending to</p>
                    <p className="font-bold text-slate-700">{customers.find(c => c.id === selectedCustomerId)?.name}</p>
                </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="p-4 border-b border-slate-100 bg-slate-50">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subject</label>
                    <input
                        type="text"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg font-medium focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                </div>
                <div className="p-4">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email Body</label>
                    <textarea
                        value={emailBody}
                        onChange={(e) => setEmailBody(e.target.value)}
                        rows={15}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                    />
                </div>
            </div>

            {/* Summary reminder */}
            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Package size={24} className="text-emerald-600" />
                    <div>
                        <p className="font-bold text-emerald-800">{selectedItems.length} Products</p>
                        <p className="text-sm text-emerald-600">Total Value: ${totalSell.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <DollarSign size={24} className="text-emerald-600" />
                    <div className="text-right">
                        <p className="font-bold text-emerald-800">${totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })} Profit</p>
                        <p className="text-sm text-emerald-600">{avgMargin.toFixed(1)}% Margin</p>
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4">
                <button
                    onClick={() => setCurrentStep('EDIT')}
                    className="px-4 py-2.5 border border-slate-300 rounded-lg text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                >
                    <ChevronLeft size={18} className="inline mr-1" /> Back to Edit
                </button>

                <button
                    onClick={() => {
                        // Copy to clipboard as a fallback
                        navigator.clipboard.writeText(`Subject: ${emailSubject}\n\n${emailBody}`);
                        alert('Email copied to clipboard! You can paste it into your email client.');
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors"
                >
                    <Eye size={18} /> Copy to Clipboard
                </button>

                <button
                    onClick={() => {
                        const customer = customers.find(c => c.id === selectedCustomerId);
                        const mailto = `mailto:${customer?.email || ''}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
                        window.open(mailto, '_blank');
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg font-bold hover:from-emerald-600 hover:to-teal-600 shadow-md hover:shadow-lg transition-all"
                >
                    <Send size={18} /> Open in Email Client
                </button>
            </div>
        </div>
    );

    return (
        <div className="p-6 max-w-6xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h2 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl text-white">
                        <Sparkles size={24} />
                    </div>
                    Proposal Engine
                </h2>
                <p className="text-slate-500 mt-1">Transform supplier quotes into customer proposals in minutes</p>
            </div>

            {/* Step Indicator */}
            {renderStepIndicator()}

            {/* Content Card */}
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
                {currentStep === 'UPLOAD' && renderUploadStep()}
                {currentStep === 'EDIT' && renderEditStep()}
                {currentStep === 'EMAIL' && renderEmailStep()}
            </div>
        </div>
    );
};

export default ProposalEngine;
