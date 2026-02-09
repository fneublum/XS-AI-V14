
import React, { useState, useEffect, useRef } from 'react';
import { Product, Company, Supplier, User, Role, CompanyImage } from '../types';
import { Search, Plus, FileText, Pencil, Trash2, X, Save, Package, AlertCircle, Download, Upload, Building, Beaker, Layers, LayoutGrid, List, CheckCircle2, Building2, Filter, Share2, Image as ImageIcon, Loader2, FilePlus } from 'lucide-react';
import { PriceInput } from '../components/UnitInputs';

interface ProductsProps {
    products: Product[];
    suppliers?: Supplier[];
    onAdd: (p: Product) => void;
    onUpdate: (p: Product) => void;
    onDelete: (id: string) => void;
    onAddSupplier?: (s: Supplier) => void;
    currentCompanyId: string;
    availableCompanies: Company[];
    dbError?: string | null;
    initialViewMode?: 'grid' | 'table';
    currentUser?: User;
    productImages?: CompanyImage[];
    onAddImage?: (img: CompanyImage) => void;
    onDeleteImage?: (id: string) => void;
}

// Helper to extract unique values for filtering
const getUniqueValues = (data: any[], key: string) => {
    const values = data.map(item => {
        const val = item[key];
        return val;
    }).filter(v => v !== undefined && v !== null && v !== '');
    return Array.from(new Set(values)).sort();
};

// Image Compression Helper (same as in AdminBranding, duplicated for isolation or could be moved to utils)
const compressImage = (file: File, maxWidth: number, quality: number = 0.7): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new globalThis.Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const elem = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
                elem.width = width;
                elem.height = height;
                const ctx = elem.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);
                resolve(elem.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality));
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (error) => reject(error);
    });
};

const Products: React.FC<ProductsProps> = ({ products, suppliers = [], onAdd, onUpdate, onDelete, onAddSupplier, currentCompanyId, availableCompanies, dbError, initialViewMode = 'table', currentUser, productImages = [], onAddImage, onDeleteImage }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'table'>(initialViewMode);

    // Quick Add Supplier State
    const [showQuickAddSupplier, setShowQuickAddSupplier] = useState(false);
    const [newSupplierName, setNewSupplierName] = useState('');
    const [supplierAddedMessage, setSupplierAddedMessage] = useState('');

    // Image Upload State
    const [uploadingImage, setUploadingImage] = useState(false);
    const [isSavingFile, setIsSavingFile] = useState(false);

    // Filtering State
    const [activeFilterColumn, setActiveFilterColumn] = useState<string | null>(null);
    const [filters, setFilters] = useState<Record<string, string[]>>({});
    const [filterSearch, setFilterSearch] = useState('');
    const filterMenuRef = useRef<HTMLDivElement>(null);

    // Column Widths
    const [colWidths, setColWidths] = useState({
        name: 250,
        sku: 150,
        grade: 300,
        supplier: 150,
        price: 120,
        stockStatus: 130,
        actions: 100
    });

    // Sync viewMode if prop changes
    useEffect(() => {
        setViewMode(initialViewMode);
    }, [initialViewMode]);

    // Handle click outside to close filter menu
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
                setActiveFilterColumn(null);
                setFilterSearch('');
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const isSystemView = currentCompanyId === 'ALL';
    const isAdmin = currentUser?.role === Role.ADMIN || currentUser?.role === Role.CEO;

    const initialFormState: Partial<Product> = {
        sku: '',
        hsCode: '',
        name: '',
        category: 'Resin',
        grade: '',
        supplier: '',
        price: 0,
        stockStatus: 'Available',
        tdsFile: '',
        tdsUrl: '',
        specs: {
            origin: '',
            form: 'Pellets',
            type: '',
            color: '',
            reinforced: '',
            additives: '',
            rv: '',
            process: '',
            packages: ''
        },
        companyId: currentCompanyId === 'ALL' && availableCompanies.length > 0 ? availableCompanies[0].id : currentCompanyId,
        sharedWith: [],
        imageIds: []
    };

    const [formData, setFormData] = useState<Partial<Product>>(initialFormState);

    const displayProducts = products.filter(product => {
        // Safe access with optional chaining and fallback
        const pName = product.name || '';
        const pGrade = product.grade || '';
        const pSku = product.sku || '';

        const matchesSearch = pName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            pGrade.toLowerCase().includes(searchTerm.toLowerCase()) ||
            pSku.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = categoryFilter === 'All' || product.category === categoryFilter;

        if (!matchesSearch || !matchesCategory) return false;

        // Apply Column Filters
        for (const [key, selectedValues] of Object.entries(filters)) {
            const values = selectedValues as string[];
            if (values.length > 0) {
                let cellValue = (product as any)[key];
                cellValue = String(cellValue || '');
                if (!values.includes(cellValue)) return false;
            }
        }

        return true;
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    const toggleFilter = (column: string, value: string) => {
        setFilters(prev => {
            const current = prev[column] || [];
            if (current.includes(value)) {
                const updated = current.filter(v => v !== value);
                return updated.length === 0 ? { ...prev, [column]: [] } : { ...prev, [column]: updated };
            } else {
                return { ...prev, [column]: [...current, value] };
            }
        });
    };

    const clearColumnFilter = (column: string) => {
        setFilters(prev => {
            const next = { ...prev };
            delete next[column];
            return next;
        });
    };

    const startResize = (e: React.MouseEvent, colKey: keyof typeof colWidths) => {
        e.preventDefault();
        const startX = e.pageX;
        const startWidth = colWidths[colKey];

        const onMouseMove = (moveEvent: MouseEvent) => {
            const newWidth = Math.max(50, startWidth + (moveEvent.pageX - startX));
            setColWidths(prev => ({ ...prev, [colKey]: newWidth }));
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    const handleAddNew = () => {
        setFormData({
            ...initialFormState,
            companyId: currentCompanyId === 'ALL' && availableCompanies.length > 0 ? availableCompanies[0].id : currentCompanyId,
            sharedWith: [],
            imageIds: []
        });
        setEditingId(null);
        setShowForm(true);
    };

    const handleEdit = (product: Product, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setFormData({
            ...product,
            sharedWith: product.sharedWith || [],
            imageIds: product.imageIds || []
        });
        setEditingId(product.id);
        setShowForm(true);
    };

    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onDelete(id);
    };

    const handleView = (product: Product, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setViewingProduct(product);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleShareToggle = (companyId: string) => {
        setFormData(prev => {
            const current = prev.sharedWith || [];
            if (current.includes(companyId)) {
                return { ...prev, sharedWith: current.filter(id => id !== companyId) };
            } else {
                return { ...prev, sharedWith: [...current, companyId] };
            }
        });
    };

    const handleSpecChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            specs: {
                ...(prev.specs || {} as any),
                [name]: value
            }
        }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];

            // Limit file size to 5MB to avoid database bloat and performance issues
            if (file.size > 5 * 1024 * 1024) {
                alert("TDS File is too large. Maximum size is 5MB.");
                return;
            }

            setIsSavingFile(true);
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64Data = reader.result as string;
                setFormData(prev => ({ ...prev, tdsFile: file.name, tdsUrl: base64Data }));
                setIsSavingFile(false);
            };
            reader.onerror = () => {
                alert("Error reading file. Please try again.");
                setIsSavingFile(false);
            };
            reader.readAsDataURL(file);
        }
    };

    const triggerTdsDownload = (url: string, filename: string) => {
        if (!url) return;
        const link = document.createElement('a');
        link.href = url;
        link.download = filename || 'Technical_Data_Sheet.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // --- Image Upload Logic ---
    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];

            if ((formData.imageIds?.length || 0) >= 3) {
                alert("Maximum 3 images per product.");
                return;
            }

            setUploadingImage(true);
            try {
                // COMPRESS IMAGE before upload (max 600px width is plenty for product thumbnails)
                const compressedBase64 = await compressImage(file, 600, 0.7);

                if (onAddImage) {
                    const newImageId = `IMG${Date.now()}`;
                    // Create image record
                    const newImage: CompanyImage = {
                        id: newImageId,
                        companyId: formData.companyId || 'ALL',
                        url: compressedBase64,
                        name: file.name,
                        createdAt: new Date().toISOString(),
                        type: 'PRODUCT' // EXPLICITLY SET TYPE TO PRODUCT
                    };

                    // Optimistic update local form state
                    setFormData(prev => ({
                        ...prev,
                        imageIds: [...(prev.imageIds || []), newImageId]
                    }));

                    // Save to DB
                    await onAddImage(newImage);
                }
            } catch (err) {
                console.error("Image upload failed:", err);
                alert("Failed to process image.");
            } finally {
                setUploadingImage(false);
            }
        }
    };

    const handleRemoveImage = (imgId: string) => {
        if (confirm("Remove this image?")) {
            setFormData(prev => ({
                ...prev,
                imageIds: (prev.imageIds || []).filter(id => id !== imgId)
            }));
            if (onDeleteImage) onDeleteImage(imgId);
        }
    };

    const handleQuickAddSupplier = async () => {
        if (!newSupplierName.trim() || !onAddSupplier) return;

        const companyIdForNewRecord = formData.companyId || (currentCompanyId === 'ALL' ? (availableCompanies[0]?.id || '') : currentCompanyId);

        const newSupplier: Supplier = {
            id: `SUP${Date.now()}`,
            companyId: companyIdForNewRecord,
            name: newSupplierName.trim(),
            contactPerson: 'TBD',
            email: 'tbd@example.com',
            phone: '',
            country: 'Unknown',
            categories: [],
            rating: 3,
            paymentTerms: 'Net 30'
        };

        await onAddSupplier(newSupplier);

        setFormData(prev => ({
            ...prev,
            supplier: newSupplier.name
        }));

        setNewSupplierName('');
        setShowQuickAddSupplier(false);
        setSupplierAddedMessage('Supplier added!');
        setTimeout(() => setSupplierAddedMessage(''), 3000);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const productData = {
            ...formData,
            sharedWith: formData.sharedWith || [],
            imageIds: formData.imageIds || []
        };

        if (editingId) {
            onUpdate({ ...productData, id: editingId } as Product);
        } else {
            const newProduct = {
                ...productData,
                id: `P${Date.now()}`,
                companyId: formData.companyId || currentCompanyId
            } as Product;
            onAdd(newProduct);
        }

        setShowForm(false);
        setEditingId(null);
        setFormData(initialFormState);
    };

    const getImageUrl = (imgId: string) => {
        const img = productImages.find(i => i.id === imgId);
        return img ? img.url : null;
    };

    const renderColumnHeader = (id: keyof Product | null, label: string, widthKey: keyof typeof colWidths) => {
        const uniqueValues = id ? getUniqueValues(products, id as string) : [];
        const activeValues = id ? (filters[id as string] || []) : [];
        const isFilterActive = activeValues.length > 0;

        return (
            <th
                className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase relative group"
                style={{ width: colWidths[widthKey] }}
            >
                <div className="flex items-center justify-between">
                    <span>{label}</span>
                    {id && (
                        <button
                            onClick={(e) => { e.stopPropagation(); setActiveFilterColumn(activeFilterColumn === id ? null : id as string); setFilterSearch(''); }}
                            className={`p-1 rounded hover:bg-slate-200 transition-colors ${isFilterActive ? 'text-blue-600 bg-blue-50' : 'text-slate-400 opacity-0 group-hover:opacity-100'}`}
                        >
                            <Filter size={14} fill={isFilterActive ? "currentColor" : "none"} />
                        </button>
                    )}
                </div>

                {id && activeFilterColumn === id && (
                    <div ref={filterMenuRef} className="absolute top-full right-0 mt-1 w-64 bg-white rounded-lg shadow-xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 text-left font-sans normal-case">
                        <div className="p-2 border-b border-slate-100">
                            <div className="relative">
                                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    className="w-full pl-8 pr-2 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder="Search..."
                                    value={filterSearch}
                                    onChange={e => setFilterSearch(e.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="max-h-48 overflow-y-auto p-1 custom-scrollbar">
                            <button
                                onClick={() => clearColumnFilter(id as string)}
                                className="w-full text-left px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded flex items-center gap-2"
                            >
                                <X size={12} /> Clear Filter
                            </button>
                            {uniqueValues.filter(v => String(v).toLowerCase().includes(filterSearch.toLowerCase())).map(val => (
                                <button
                                    key={String(val)}
                                    onClick={() => toggleFilter(id as string, String(val))}
                                    className="w-full text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded flex items-center gap-2"
                                >
                                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${activeValues.includes(String(val)) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white'}`}>
                                        {activeValues.includes(String(val)) && <CheckCircle2 size={10} className="text-white" />}
                                    </div>
                                    <span className="truncate">{String(val)}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div
                    onMouseDown={(e) => startResize(e, widthKey)}
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400 group-hover:bg-slate-300 z-10"
                />
            </th>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Products</h2>
                    <p className="text-slate-500 text-sm">Manage resin grades and fiber specifications</p>
                </div>

                <div className="flex gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input type="text" placeholder="Search SKU, grade, name..." className="w-full pl-10 pr-4 py-2 border border-slate-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-slate-900 text-white placeholder-slate-400" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                    </div>
                    <select className="px-4 py-2 border border-slate-600 rounded-lg bg-slate-900 text-white focus:ring-2 focus:ring-blue-500 outline-none" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                        <option value="All">All Categories</option>
                        <option value="Resin">Resins</option>
                        <option value="Fiber Textile">Fiber Textile</option>
                        <option value="Cotton Waste">Cotton Waste</option>
                        <option value="Plastic Scrap">Plastic Scrap</option>
                    </select>
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
                    {(!isSystemView || isAdmin) && (
                        <button type="button" onClick={handleAddNew} className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm" title="Add Product">
                            <FilePlus size={20} />
                        </button>
                    )}
                </div>
            </div>

            {/* DB Error Alert */}
            {dbError && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-start gap-3 border border-red-100 animate-in fade-in slide-in-from-top-2">
                    <AlertCircle size={20} className="mt-0.5 shrink-0" />
                    <div>
                        <p className="font-bold text-sm">Database Sync Error</p>
                        <p className="text-xs mt-1 opacity-90">{dbError}</p>
                    </div>
                </div>
            )}

            {/* Product List Content */}
            <div className="w-full">
                {viewMode === 'grid' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {displayProducts.map(product => {
                            const firstImage = product.imageIds && product.imageIds.length > 0 ? getImageUrl(product.imageIds[0]) : null;
                            return (
                                <div key={product.id} onClick={(e) => handleView(product, e)} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow cursor-pointer group flex flex-col justify-between overflow-hidden">
                                    <div>
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <h4 className="font-bold text-slate-800 text-lg truncate max-w-[150px]" title={product.name}>{product.name}</h4>
                                                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{product.grade}</span>
                                            </div>
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase ${product.stockStatus === 'Available' ? 'bg-emerald-100 text-emerald-800' :
                                                product.stockStatus === 'Low Stock' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
                                                }`}>{product.stockStatus}</span>
                                        </div>

                                        {/* Product Image Thumbnail */}
                                        <div className="w-full h-32 bg-slate-50 rounded-lg mb-3 flex items-center justify-center border border-slate-100 overflow-hidden">
                                            {firstImage ? (
                                                <img src={firstImage} alt={product.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <Package size={32} className="text-slate-300 opacity-50" />
                                            )}
                                        </div>

                                        <div className="text-xs text-slate-500 mb-4 space-y-1">
                                            <p><span className="font-semibold text-slate-400">Supplier:</span> {product.supplier}</p>
                                            {product.sku && <p><span className="font-semibold text-slate-400">SKU:</span> {product.sku}</p>}
                                            {product.sharedWith && product.sharedWith.length > 0 && (
                                                <div className="flex items-center gap-1 mt-2 text-indigo-600 bg-indigo-50 px-2 py-1 rounded w-fit">
                                                    <Share2 size={10} /> Shared with {product.sharedWith.length} companies
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex justify-between items-end pt-3 border-t border-slate-100">
                                        <div>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase">Base Price</p>
                                            <p className="text-lg font-bold text-slate-800">${product.price}/LB</p>
                                        </div>
                                        {(!isSystemView || isAdmin) && (
                                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={(e) => handleEdit(product, e)} className="text-slate-400 hover:text-amber-500"><Pencil size={14} /></button>
                                                {currentUser?.role !== Role.USER && (
                                                    <button onClick={(e) => handleDelete(product.id, e)} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse table-fixed">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200">
                                        {renderColumnHeader('name', 'Product', 'name')}
                                        {renderColumnHeader('sku', 'SKU / HS Code', 'sku')}
                                        {renderColumnHeader('grade', 'Grade & Specs', 'grade')}
                                        {renderColumnHeader('stockStatus', 'Status', 'stockStatus')}
                                        {renderColumnHeader(null, 'Actions', 'actions')}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {displayProducts.map((product) => {
                                        const firstImage = product.imageIds && product.imageIds.length > 0 ? getImageUrl(product.imageIds[0]) : null;
                                        return (
                                            <tr key={product.id} className="hover:bg-slate-50 transition-colors group">
                                                <td className="px-2 py-1 truncate">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-6 h-6 rounded bg-slate-100 shrink-0 overflow-hidden flex items-center justify-center border border-slate-200">
                                                            {firstImage ? (
                                                                <img src={firstImage} alt="Thumb" className="w-full h-full object-cover" />
                                                            ) : (
                                                                <Package size={10} className="text-slate-400" />
                                                            )}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-1">
                                                                <p className="font-medium text-slate-800 text-xs truncate" title={product.name}>{product.name}</p>
                                                                {product.sharedWith && product.sharedWith.length > 0 && (
                                                                    <span title={`Shared with ${product.sharedWith.length} companies`}>
                                                                        <Share2 size={10} className="text-indigo-400 shrink-0" />
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <span className="text-[10px] text-slate-400 truncate">{product.category}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-2 py-1 text-xs font-mono text-slate-600">
                                                    <div className="truncate" title={product.sku}>{product.sku || <span className="text-slate-300 italic">-</span>}</div>
                                                    <div className="text-[10px] text-blue-600 truncate">{product.hsCode || ''}</div>
                                                </td>
                                                <td className="px-2 py-1">
                                                    <div className="flex flex-wrap items-center gap-1">
                                                        <span className="inline-block bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0.5 rounded font-medium">{product.grade}</span>
                                                        {product.specs?.type && <span className="text-[10px] text-slate-500">{product.specs.type}</span>}
                                                        {product.specs?.color && <span className="text-[10px] text-slate-500">{product.specs.color}</span>}
                                                        {product.specs?.reinforced && product.specs.reinforced !== 'Unfilled' && <span className="text-[10px] font-medium text-slate-600">{product.specs.reinforced}</span>}
                                                    </div>
                                                </td>
                                                <td className="px-2 py-1">
                                                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${product.stockStatus === 'Available' ? 'bg-emerald-100 text-emerald-800' : product.stockStatus === 'Low Stock' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>{product.stockStatus}</span>
                                                </td>
                                                <td className="px-2 py-1 text-xs text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button type="button" onClick={(e) => handleView(product, e)} title="View Details" className="text-slate-400 hover:text-blue-600 transition-colors"><FileText size={16} /></button>
                                                        {isAdmin && <button type="button" onClick={(e) => handleEdit(product, e)} title="Edit" className="text-slate-400 hover:text-amber-600 transition-colors"><Pencil size={16} /></button>}
                                                        {(!isSystemView || isAdmin) && currentUser?.role !== Role.USER && (
                                                            <button type="button" onClick={(e) => handleDelete(product.id, e)} title="Delete" className="text-slate-400 hover:text-red-600 transition-colors"><Trash2 size={16} /></button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                            {displayProducts.length === 0 && (
                                <div className="p-10 text-center text-slate-500 flex flex-col items-center"><AlertCircle size={32} className="mb-2 text-slate-300" /><p>No products found matching your criteria.</p></div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Modal Form for Add/Edit Product */}
            {showForm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    {/* Quick Add Supplier Modal */}
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

                    <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto custom-scrollbar">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100">
                            <h3 className="font-bold text-slate-800 flex items-center gap-2 text-lg">
                                {editingId ? <Pencil size={20} className="text-blue-600" /> : <Plus size={20} className="text-blue-600" />}
                                {editingId ? 'Edit Product' : 'New Product'}
                            </h3>
                            <button type="button" onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-all"><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-5">
                            {currentCompanyId === 'ALL' && (
                                <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                                    <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Assign to Company</label>
                                    <select required name="companyId" value={formData.companyId} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500">
                                        {availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            )}

                            {/* Cross-Company Visibility Section (ADMIN ONLY) */}
                            {isAdmin && availableCompanies.length > 1 && (
                                <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100 space-y-2">
                                    <h4 className="text-xs font-bold text-indigo-800 uppercase flex items-center gap-2">
                                        <Share2 size={12} /> Cross-Company Visibility
                                    </h4>
                                    <p className="text-xs text-indigo-600 mb-2">Select companies that can view and use this product in their own lists.</p>
                                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                                        {availableCompanies.filter(c => c.id !== formData.companyId).map(company => (
                                            <label key={company.id} className="flex items-center gap-2 text-sm bg-white border border-indigo-200 px-3 py-1.5 rounded cursor-pointer hover:bg-indigo-50 transition-colors">
                                                <input
                                                    type="checkbox"
                                                    checked={(formData.sharedWith || []).includes(company.id)}
                                                    onChange={() => handleShareToggle(company.id)}
                                                    className="rounded text-indigo-600 focus:ring-indigo-500"
                                                />
                                                <span className="text-slate-700">{company.name}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Image Upload Section */}
                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                                <div className="flex justify-between items-center">
                                    <h4 className="text-xs font-bold text-slate-600 uppercase flex items-center gap-2"><ImageIcon size={14} /> Product Images</h4>
                                    <span className="text-xs text-slate-400">{(formData.imageIds?.length || 0)} / 3</span>
                                </div>

                                <div className="flex gap-3 overflow-x-auto pb-2">
                                    {/* Existing Images */}
                                    {(formData.imageIds || []).map((imgId) => {
                                        const url = getImageUrl(imgId);
                                        if (!url) return null;
                                        return (
                                            <div key={imgId} className="w-20 h-20 rounded-lg border border-slate-200 bg-white relative group shrink-0">
                                                <img src={url} alt="Product" className="w-full h-full object-cover rounded-lg" />
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveImage(imgId)}
                                                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 shadow-sm"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        );
                                    })}

                                    {/* Upload Button */}
                                    {(formData.imageIds?.length || 0) < 3 && (
                                        <label className={`w-20 h-20 rounded-lg border-2 border-dashed border-slate-300 bg-slate-100 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-200 transition-colors shrink-0 ${uploadingImage ? 'opacity-50 pointer-events-none' : ''}`}>
                                            {uploadingImage ? <Loader2 size={20} className="animate-spin text-slate-400" /> : <Plus size={20} className="text-slate-400" />}
                                            <span className="text-[10px] text-slate-500 mt-1">{uploadingImage ? 'Saving...' : 'Add'}</span>
                                            <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploadingImage} />
                                        </label>
                                    )}
                                </div>
                            </div>

                            {/* Core Info */}
                            <div className="grid grid-cols-1 gap-4">
                                <div className="col-span-1">
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Product Name *</label>
                                    <input required name="name" value={formData.name || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="e.g. PP Homopolymer" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">SKU</label>
                                        <input name="sku" value={formData.sku || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="OPT-123" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1">HS Code</label>
                                        <input name="hsCode" value={formData.hsCode || ''} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="e.g. 3908.10" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Supplier *</label>
                                    <div className="relative">
                                        <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <select
                                            required
                                            name="supplier"
                                            value={formData.supplier || ''}
                                            onChange={(e) => {
                                                if (e.target.value === '_ADD_NEW_') {
                                                    setShowQuickAddSupplier(true);
                                                } else {
                                                    handleInputChange(e);
                                                }
                                            }}
                                            className="w-full pl-9 pr-3 py-2 border border-slate-600 bg-slate-900 text-white placeholder-slate-400 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm appearance-none"
                                        >
                                            <option value="">Select Supplier...</option>
                                            <option value="_ADD_NEW_" className="font-bold text-blue-400 bg-slate-800">+ Add New Supplier</option>
                                            {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                        </select>
                                    </div>
                                    {supplierAddedMessage && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 size={10} /> {supplierAddedMessage}</p>}
                                </div>
                            </div>

                            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2"><Package size={14} /> Technical Specs</h4>
                                <div className="space-y-3">
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="col-span-2">
                                            <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                                            <select name="category" value={formData.category || 'Resin'} onChange={handleInputChange} className="w-full border border-slate-600 rounded-md px-2 py-1.5 text-sm bg-slate-900 text-white">
                                                <option value="Resin">Resin</option>
                                                <option value="Fiber Textile">Fiber Textile</option>
                                                <option value="Cotton Waste">Cotton Waste</option>
                                                <option value="Plastic Scrap">Plastic Scrap</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
                                            <input name="type" value={formData.specs?.type || ''} onChange={handleSpecChange} className="w-full border border-slate-600 rounded-md px-2 py-1.5 text-sm bg-slate-900 text-white" placeholder="PA66" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-slate-700 mb-1">Grade *</label>
                                            <input required name="grade" value={formData.grade || ''} onChange={handleInputChange} className="w-full border border-slate-600 rounded-md px-2 py-1.5 focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-slate-900 text-white" placeholder="H-3500" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-700 mb-1">Color</label>
                                            <input name="color" value={formData.specs?.color || ''} onChange={handleSpecChange} className="w-full border border-slate-600 rounded-md px-2 py-1.5 text-sm bg-slate-900 text-white" placeholder="Natural" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="col-span-2">
                                            <label className="block text-xs font-medium text-slate-700 mb-1">Form</label>
                                            <select name="form" value={formData.specs?.form || 'Pellets'} onChange={handleSpecChange} className="w-full border border-slate-600 rounded-md px-2 py-1.5 text-sm bg-slate-900 text-white"><option value="Pellets">Pellets</option><option value="Powder">Powder</option><option value="Bale">Bale</option><option value="Spool">Spool</option><option value="Regrind">Regrind</option></select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-700 mb-1">RV</label>
                                            <input name="rv" value={formData.specs?.rv || ''} onChange={handleSpecChange} className="w-full border border-slate-600 rounded-md px-2 py-1.5 text-sm bg-slate-900 text-white" placeholder="2.7" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-slate-700 mb-1">Reinforced</label>
                                            <input name="reinforced" value={formData.specs?.reinforced || ''} onChange={handleSpecChange} className="w-full border border-slate-600 rounded-md px-2 py-1.5 text-sm bg-slate-900 text-white" placeholder="30% GF" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-700 mb-1">Additives</label>
                                            <input name="additives" value={formData.specs?.additives || ''} onChange={handleSpecChange} className="w-full border border-slate-600 rounded-md px-2 py-1.5 text-sm bg-slate-900 text-white" placeholder="UV Stabilizer" />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-slate-700 mb-1">Process</label>
                                        <input name="process" value={formData.specs?.process || ''} onChange={handleSpecChange} className="w-full border border-slate-600 rounded-md px-2 py-1.5 text-sm bg-slate-900 text-white" placeholder="Injection, Extrusion..." />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-slate-700 mb-1">Packages</label>
                                            <input name="packages" value={formData.specs?.packages || ''} onChange={handleSpecChange} className="w-full border border-slate-600 rounded-md px-2 py-1.5 text-sm bg-slate-900 text-white" placeholder="25kg Bag" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-slate-700 mb-1">Origin</label>
                                            <input name="origin" value={formData.specs?.origin || ''} onChange={handleSpecChange} className="w-full border border-slate-600 rounded-md px-2 py-1.5 text-sm bg-slate-900 text-white" placeholder="Country" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4">
                                <PriceInput
                                    label="Base Price"
                                    value={formData.price || 0}
                                    onChange={(val) => setFormData(prev => ({ ...prev, price: val }))}
                                />
                                <div><label className="block text-sm font-medium text-slate-700 mb-1">Stock Status</label><select name="stockStatus" value={formData.stockStatus || 'Available'} onChange={handleInputChange} className="w-full border border-slate-600 bg-slate-900 text-white rounded-lg px-3 py-2 text-sm"><option value="Available">Available</option><option value="Low Stock">Low Stock</option><option value="Backorder">Backorder</option></select></div>
                            </div>

                            <div className="border border-dashed border-slate-300 rounded-lg p-4 bg-slate-50">
                                <label className="block text-sm font-medium text-slate-700 mb-2">Technical Data Sheet (PDF)</label>
                                <div className="flex items-center gap-2">
                                    <label className={`cursor-pointer bg-white border border-slate-300 text-slate-700 px-3 py-2 rounded-lg text-sm hover:bg-slate-100 transition-colors flex items-center gap-2 shadow-sm ${isSavingFile ? 'opacity-50 pointer-events-none' : ''}`}>
                                        {isSavingFile ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                        <span>{formData.tdsFile ? 'Change File' : 'Upload TDS'}</span>
                                        <input type="file" accept=".pdf" className="hidden" onChange={handleFileChange} disabled={isSavingFile} />
                                    </label>
                                    {formData.tdsFile ? <span className="text-xs text-blue-600 truncate max-w-[150px] font-medium">{formData.tdsFile}</span> : <span className="text-xs text-slate-400">No file selected</span>}
                                </div>
                            </div>

                            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm"><Save size={18} />{editingId ? 'Update Product' : 'Save Product'}</button>
                        </form>
                    </div>
                </div>
            )}

            {/* View Modal */}
            {viewingProduct && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto custom-scrollbar">
                        <div className="flex justify-between items-center p-6 border-b border-slate-100">
                            <div>
                                <h3 className="text-xl font-bold text-slate-800">{viewingProduct.name}</h3>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-bold">{viewingProduct.grade}</span>
                                    {viewingProduct.specs?.type && <span className="text-xs text-slate-500">{viewingProduct.specs.type}</span>}
                                </div>
                            </div>
                            <button onClick={() => setViewingProduct(null)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-full transition-all"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-6">
                            {/* Image Gallery */}
                            {(viewingProduct.imageIds && viewingProduct.imageIds.length > 0) && (
                                <div className="grid grid-cols-3 gap-2">
                                    {viewingProduct.imageIds.map(imgId => {
                                        const url = getImageUrl(imgId);
                                        if (!url) return null;
                                        return (
                                            <div key={imgId} className="aspect-square bg-slate-50 rounded-lg overflow-hidden border border-slate-200">
                                                <img src={url} alt={viewingProduct.name} className="w-full h-full object-cover" />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {viewingProduct.sharedWith && viewingProduct.sharedWith.length > 0 && (
                                <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-700 flex items-center gap-2">
                                    <Share2 size={14} />
                                    <span>Visible to {viewingProduct.sharedWith.length} other companies</span>
                                </div>
                            )}
                            <div className="grid grid-cols-3 gap-4">
                                {isAdmin && (
                                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                        <p className="text-xs font-bold text-slate-400 uppercase mb-1">Supplier</p>
                                        <p className="font-semibold text-slate-800 flex items-center gap-2"><Building size={14} className="text-slate-400" /> {viewingProduct.supplier}</p>
                                    </div>
                                )}
                                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Origin</p>
                                    <p className="font-semibold text-slate-800">{viewingProduct.specs?.origin}</p>
                                </div>
                                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">HS Code</p>
                                    <p className="font-semibold text-slate-800 font-mono">{viewingProduct.hsCode || 'N/A'}</p>
                                </div>
                            </div>

                            <div>
                                <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><Beaker size={18} className="text-blue-500" /> Technical Properties</h4>
                                <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 text-sm">
                                    <div className="grid grid-cols-2 p-3 hover:bg-slate-50">
                                        <span className="text-slate-500">Color</span>
                                        <span className="font-medium text-slate-800 text-right">{viewingProduct.specs?.color || '-'}</span>
                                    </div>
                                    <div className="grid grid-cols-2 p-3 hover:bg-slate-50">
                                        <span className="text-slate-500">Reinforced</span>
                                        <span className="font-medium text-slate-800 text-right">{viewingProduct.specs?.reinforced || '-'}</span>
                                    </div>
                                    <div className="grid grid-cols-2 p-3 hover:bg-slate-50">
                                        <span className="text-slate-500">Additives</span>
                                        <span className="font-medium text-slate-800 text-right">{viewingProduct.specs?.additives || '-'}</span>
                                    </div>
                                    <div className="grid grid-cols-2 p-3 hover:bg-slate-50">
                                        <span className="text-slate-500">Relative Viscosity (RV)</span>
                                        <span className="font-medium text-slate-800 text-right">{viewingProduct.specs?.rv || '-'}</span>
                                    </div>
                                    <div className="grid grid-cols-2 p-3 hover:bg-slate-50">
                                        <span className="text-slate-500">Melt Flow Rate</span>
                                        <span className="font-medium text-slate-800 text-right">{viewingProduct.specs?.mfr || '-'}</span>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><Layers size={18} className="text-purple-500" /> Process & Form</h4>
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-center">
                                        <p className="text-xs text-slate-500 uppercase mb-1">Form</p>
                                        <p className="font-bold text-slate-800">{viewingProduct.specs?.form}</p>
                                    </div>
                                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-center">
                                        <p className="text-xs text-slate-500 uppercase mb-1">Process</p>
                                        <p className="font-bold text-slate-800 text-xs">{viewingProduct.specs?.process || '-'}</p>
                                    </div>
                                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-center">
                                        <p className="text-xs text-slate-500 uppercase mb-1">Package</p>
                                        <p className="font-bold text-slate-800 text-xs">{viewingProduct.specs?.packages || '-'}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start gap-3">
                                <FileText className="text-blue-600 shrink-0 mt-1" size={20} />
                                <div>
                                    <h5 className="font-semibold text-blue-900 text-sm">Technical Data Sheet (TDS)</h5>
                                    <p className="text-xs text-blue-700 mt-1 mb-3">Official specification document for {viewingProduct.grade}.</p>
                                    {viewingProduct.tdsUrl ? (
                                        <button
                                            onClick={() => triggerTdsDownload(viewingProduct.tdsUrl!, viewingProduct.tdsFile || 'datasheet.pdf')}
                                            className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 transition-colors shadow-sm flex items-center gap-2 w-max"
                                        >
                                            <Download size={14} /> Download PDF
                                        </button>
                                    ) : (
                                        <button disabled className="text-xs bg-slate-300 text-white px-3 py-1.5 rounded cursor-not-allowed shadow-sm flex items-center gap-2">
                                            <Download size={14} /> No PDF Available
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end"><button onClick={() => setViewingProduct(null)} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium shadow-sm">Close</button></div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Products;
