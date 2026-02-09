import React, { useState, useEffect, useRef } from 'react';
import {
    LayoutDashboard, FileText, Container, ClipboardList, Mail, MessageCircleQuestion,
    Database, Wifi, Package, Anchor, Truck, Ship, MapPin, Building, ShoppingCart,
    Tag, FileQuestion, Users, TrendingUp, PieChart, Bot, List, Calculator, Globe,
    Plane, Table, History, User, Sparkles, Receipt, Warehouse, PenTool, LayoutTemplate,
    Target, DollarSign, FileSpreadsheet, Plus, X, Search, Minus,
    Factory, Building2, ScanText, FileSearch, CalendarCheck, UserCog, Brain,
    CircuitBoard, FileStack, BookOpen, GraduationCap, Gavel, Scan, Sliders
} from 'lucide-react';

const BRFlag = ({ size = 16, className = "" }: { size?: number | string, className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
        <rect width="24" height="24" rx="2" fill="#009C3B" />
        <path d="M12 4L20 12L12 20L4 12L12 4Z" fill="#FFDF00" />
        <circle cx="12" cy="12" r="3.5" fill="#002776" />
        <path d="M10.5 13.5C10.5 13.5 11.5 11.5 14 11.5" stroke="white" strokeWidth="0.5" strokeLinecap="round" />
    </svg>
);

// Define the Task interface
export interface Task {
    id: string;
    label: string;
    icon: React.ElementType;
    module: string;
    subModule: string;
    color?: string;
    isSpacer?: boolean;
}

// Full list of available tasks
// Mapped from App.tsx structures
export const AVAILABLE_TASKS: Task[] = [
    // BUY
    { id: 'BUY_AI', label: 'Buy - AI', icon: Brain, module: 'BUY', subModule: 'AI', color: 'red' },
    { id: 'SUPPLIERS', label: 'Suppliers', icon: Factory, module: 'BUY', subModule: '' },
    { id: 'OFFERS', label: 'Supplier Quotes', icon: Tag, module: 'BUY', subModule: 'OFFERS' },
    { id: 'PO', label: 'Purchase Orders', icon: ShoppingCart, module: 'BUY', subModule: 'PO' },

    // SELL
    { id: 'SELL_AI', label: 'Sell - AI', icon: Brain, module: 'SELL', subModule: 'AI', color: 'red' },
    { id: 'SMAIL', label: 'SMAIL Assistant', icon: Sparkles, module: 'SELL', subModule: 'SMAIL', color: 'blue' },
    { id: 'ICRM', label: 'iCRM', icon: Target, module: 'SELL', subModule: 'ICRM', color: 'blue' },
    { id: 'CUSTOMERS', label: 'Customers', icon: Users, module: 'SELL', subModule: '' },
    { id: 'PIPELINE', label: 'Pipeline', icon: TrendingUp, module: 'SELL', subModule: 'PIPELINE' },
    { id: 'CUST_STATUS', label: 'Customer 360', icon: PieChart, module: 'SELL', subModule: 'STATUS' },
    { id: 'PRICELIST', label: 'Price List', icon: List, module: 'SELL', subModule: 'PRICELIST' },
    { id: 'SALES_ORDERS', label: 'Sales Orders', icon: ClipboardList, module: 'SELL', subModule: 'ORDERS' },
    { id: 'SALE_BRAZIL', label: 'Sale Brazil', icon: BRFlag, module: 'SELL', subModule: 'SALE_BRAZIL', color: 'green' },

    // CALCULATOR
    { id: 'CALC_AI', label: 'Calc - AI', icon: Brain, module: 'CALCULATOR', subModule: 'AI', color: 'red' },
    { id: 'IMPORT', label: 'Import Calc', icon: Globe, module: 'CALCULATOR', subModule: '' },
    { id: 'EXPORT', label: 'Export Calc', icon: Plane, module: 'CALCULATOR', subModule: 'EXPORT' },
    { id: 'LOCAL', label: 'Local Freight', icon: Truck, module: 'CALCULATOR', subModule: 'LOCAL' },
    { id: 'SAVED_COSTS', label: 'Saved Costs', icon: History, module: 'CALCULATOR', subModule: 'HISTORY' },
    { id: 'COST_SHEET', label: 'Cost Sheet', icon: Table, module: 'CALCULATOR', subModule: 'SHEET' },

    // LOGISTICS
    { id: 'LOG_AI', label: 'Logistics - AI', icon: Brain, module: 'LOGISTICS', subModule: 'AI', color: 'red' },
    { id: 'LOGISTICS_MANAGER', label: 'Logistic Manager', icon: Sliders, module: 'LOGISTICS', subModule: 'LOGISTICS_MANAGE' },
    { id: 'INVENTORY', label: 'Inventory', icon: Warehouse, module: 'LOGISTICS', subModule: 'STOCK' },
    { id: 'BL', label: 'Bill of Ladings', icon: FileText, module: 'LOGISTICS', subModule: 'BL' },
    { id: 'BOOKINGS', label: 'Bookings', icon: CalendarCheck, module: 'LOGISTICS', subModule: 'BOOKINGS' },
    { id: 'FREIGHT_QUOTES', label: 'Freight Quotes', icon: Ship, module: 'LOGISTICS', subModule: 'FREIGHT' },

    // DATA
    { id: 'DATA_AI', label: 'Data - AI', icon: Brain, module: 'DATA', subModule: 'AI', color: 'red' },
    { id: 'AGENTS', label: 'Cargo Agents', icon: UserCog, module: 'DATA', subModule: 'AGENTS' },
    { id: 'CARRIERS', label: 'Carriers', icon: Ship, module: 'DATA', subModule: 'CARRIERS' },
    { id: 'DATA_CUSTOMERS', label: 'Data - Customers', icon: Users, module: 'DATA', subModule: 'CUSTOMERS' },
    { id: 'DOC_VIEWER', label: 'Doc Viewer', icon: FileSearch, module: 'DATA', subModule: 'DOC_VIEWER' },
    { id: 'LOCATIONS', label: 'Locations', icon: MapPin, module: 'DATA', subModule: 'LOCATIONS' },
    { id: 'PORTS', label: 'Ports', icon: Anchor, module: 'DATA', subModule: 'PORTS' },
    { id: 'PRODUCTS', label: 'Products', icon: Package, module: 'DATA', subModule: 'PRODUCTS' },
    { id: 'DATA_SUPPLIERS', label: 'Data - Suppliers', icon: Building, module: 'DATA', subModule: 'SUPPLIERS' },

    // AUTOMATION (AI_UPLOAD)
    { id: 'DOC_OCR', label: 'Doc OCR', icon: ScanText, module: 'AI_UPLOAD', subModule: 'DOCS' },
    { id: 'INBOX_SCANNER', label: 'Inbox Scanner', icon: Mail, module: 'AI_UPLOAD', subModule: 'SCANNER', color: 'red' },
    { id: 'LOGISTICS_AI', label: 'Logistics AI', icon: CircuitBoard, module: 'AI_UPLOAD', subModule: 'LOGISTICS_AI', color: 'blue' },
    { id: 'PL_INVOICE_ENGINE', label: 'PL/Invoice Engine', icon: FileStack, module: 'AI_UPLOAD', subModule: 'PL_ENGINE', color: 'green' },
    { id: 'COMMISSIONS', label: 'Commissions', icon: DollarSign, module: 'AI_UPLOAD', subModule: 'COMMISSIONS', color: 'orange' },

    // SETTINGS
    { id: 'COMPANIES', label: 'Companies', icon: Building2, module: 'SETTINGS', subModule: 'COMPANIES' },
    { id: 'FORM_BUILDER', label: 'Form Builder', icon: PenTool, module: 'SETTINGS', subModule: 'FORMS' },
];

const SPACER_TASK: Task = {
    id: 'SPACER',
    label: 'Spacer',
    icon: Minus,
    module: '',
    subModule: '',
    isSpacer: true
};

interface DockProps {
    activeModule: string;
    subModule: string;
    setActiveModule: (mod: string) => void;
    setSubModule: (sub: string) => void;
    currentUser: any; // User type
    onUpdateUser: (user: any) => void;
    onToggleHelp: () => void;
}

const Dock: React.FC<DockProps> = ({ activeModule, subModule, setActiveModule, setSubModule, currentUser, onUpdateUser, onToggleHelp }) => {
    // Default items
    const DEFAULT_DOCK_IDS = ['LOGISTICS_AI', 'PORTS', 'COST_SHEET'];

    const [dockItems, setDockItems] = useState<Task[]>([]);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    // Drag and Drop state
    const [draggedItem, setDraggedItem] = useState<Task | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    // Helpers to reconstruct tasks from IDs
    const reconstructTasks = (ids: string[]) => {
        return ids.map((id, index) => {
            if (id.startsWith('SPACER')) return { ...SPACER_TASK, id: `SPACER_${index}_${Date.now()}` };

            // Migration for old consolidated icons
            if (id === 'PL_ENGINE' || id === 'INVOICE_ENGINE') {
                return AVAILABLE_TASKS.find(t => t.id === 'PL_INVOICE_ENGINE');
            }

            return AVAILABLE_TASKS.find(t => t.id === id);
        }).filter(Boolean) as Task[];
    };

    useEffect(() => {
        // Hydration Logic: User Profile > Local Storage > Default
        let itemsToLoad: Task[] = [];

        if (currentUser && currentUser.role === 'Cargo Agent') {
            // FIXED DOCK FOR CARGO AGENT
            itemsToLoad = reconstructTasks(['FREIGHT_QUOTES', 'SPACER', 'BOOKINGS', 'SPACER', 'BL']);
        } else if (currentUser && currentUser.dock_config && currentUser.dock_config.length > 0) {
            // Load from User Profile
            itemsToLoad = reconstructTasks(currentUser.dock_config);
        } else {
            // Fallback to Local Storage
            const savedIds = localStorage.getItem(`xs_dock_items_${currentUser?.id || 'guest'}`);
            // If not found for user-specific key, try generic key (migration path)
            const legacyIds = !savedIds ? localStorage.getItem('xs_dock_items') : null;

            const finalIds = savedIds || legacyIds;

            if (finalIds) {
                try {
                    const parsedIds: string[] = JSON.parse(finalIds);
                    itemsToLoad = reconstructTasks(parsedIds);
                } catch (e) {
                    console.error("Failed to parse dock items", e);
                    itemsToLoad = AVAILABLE_TASKS.filter(t => DEFAULT_DOCK_IDS.includes(t.id));
                }
            } else {
                // If no saved dock config found...
                if ((currentUser?.role === 'USER' || currentUser?.role === 'User') && currentUser?.allowed_modules && currentUser.allowed_modules.length > 0) {
                    // For USER role, default to showing ALL authorized modules
                    itemsToLoad = AVAILABLE_TASKS.filter(t => currentUser.allowed_modules.includes(t.id));
                } else {
                    // For others, fall back to system default
                    itemsToLoad = AVAILABLE_TASKS.filter(t => DEFAULT_DOCK_IDS.includes(t.id));
                }
            }
        }

        // ENFORCE MODULE RESTRICTIONS FOR 'USER' ROLE (Handle both 'User' and 'USER')
        if (currentUser && (currentUser.role === 'USER' || currentUser.role === 'User') && currentUser.allowed_modules && currentUser.allowed_modules.length > 0) {
            // Verify if items are allowed. Spacer is always allowed.
            itemsToLoad = itemsToLoad.filter(item => {
                if (item.isSpacer) return true;
                // Double check to ensure SETTINGS module items are never allowed for USER role via Dock
                if (item.module === 'SETTINGS') return false;

                // @ts-ignore
                return currentUser.allowed_modules.includes(item.id);
            });
        }

        setDockItems(itemsToLoad);
    }, [currentUser?.id, currentUser?.role, currentUser?.allowed_modules]); // Re-run if user/role changes

    const saveDock = (items: Task[]) => {
        setDockItems(items);
        // Persist only IDs (or 'SPACER' for spacers)
        const idsToSave = items.map(t => t.isSpacer ? 'SPACER' : t.id);

        // 1. Save to Local Storage (Immediate / Offline)
        localStorage.setItem(`xs_dock_items_${currentUser?.id || 'guest'}`, JSON.stringify(idsToSave));

        // 2. Save to User Profile (Database)
        if (currentUser && onUpdateUser) {
            // Only update if changed to avoid loops/excessive calls - basic check done by simply calling update
            // Debouncing handled by upstream or just infrequent updates here (only on user action)
            onUpdateUser({
                ...currentUser,
                dock_config: idsToSave
            });
        }
    };

    const addToDock = (task: Task) => {
        let newTask = task;
        if (task.isSpacer) {
            // Create unique ID for this spacer instance
            newTask = { ...task, id: `SPACER_${Date.now()}` };
            saveDock([...dockItems, newTask]);
        } else {
            if (!dockItems.find(t => t.id === task.id)) {
                saveDock([...dockItems, task]);
            }
        }
        setIsMenuOpen(false);
    };

    const removeFromDock = (e: React.MouseEvent, taskId: string) => {
        e.stopPropagation(); // Prevent navigation
        saveDock(dockItems.filter(t => t.id !== taskId));
    };

    const handleTaskClick = (task: Task) => {
        if (task.isSpacer) return;
        setActiveModule(task.module);
        setSubModule(task.subModule);
    };

    // --- Drag and Drop Handlers ---
    const handleDragStart = (e: React.DragEvent, item: Task) => {
        setDraggedItem(item);
        e.dataTransfer.effectAllowed = 'move';
        // Add a ghost image or styling
        e.currentTarget.classList.add('opacity-50');
    };

    const handleDragEnd = (e: React.DragEvent) => {
        e.currentTarget.classList.remove('opacity-50');
        setDraggedItem(null);
        setDragOverIndex(null);
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault(); // Necessary to allow dropping
        if (draggedItem === null) return;

        // Optimistic UI update or just set indicator
        // If we want real-time reorder we can do it here, but it might be jittery without a library
        // Let's stick to 'drop' for actual move to keep it stable
        setDragOverIndex(index);
    };

    const handleDrop = (e: React.DragEvent, index: number) => {
        e.preventDefault();

        if (!draggedItem) return;

        const currentItems = [...dockItems];
        const draggedIndex = currentItems.findIndex(i => i.id === draggedItem.id);

        if (draggedIndex === -1) return;

        // Remove from old pos
        currentItems.splice(draggedIndex, 1);
        // Insert at new pos
        // Adjust index if we removed an item before the drop target
        // Actually, if we remove first, indices shift.
        // Let's use array move logic

        // Simpler: 
        // 1. Remove dragged item
        // 2. Insert at index (careful with index shift)

        // Re-calculate insertion index based on original list
        // If simply moving:
        // item A is at 0, B at 1, C at 2.
        // Drag A to C (index 2).
        // Remove A -> [B, C]. Index 2 is now after C. Insert A there -> [B, C, A].

        // Logic:
        // If dragging from 0 to 2: 
        // Remove 0. New 2 is actually old 2 (shifted down to 1) + 1? No.
        // It helps to just target the item we are dropping ON or NEAR.

        // Robust way:
        const itemsWithoutDragged = dockItems.filter(i => i.id !== draggedItem.id);
        let insertIndex = index;

        // If we drop on an item that was AFTER the dragged item, the index in the filtered array matches the visual index (roughly)
        // If we drag from high to low, index is respected.
        // If we drag from low to high in original list, the target index in the filtered list effectively shifts by 1?
        // Let's correct: index argument is the index of the item we DROPPED ON.

        if (draggedIndex < index) {
            // Moving down. The target index in the shortened array should be index - 1 ? 
            // Example: [A, B, C]. Drag A (0) to C (2).
            // Filtered: [B, C]. Target C is at index 1 in filtered. 
            // We want A after C? Or before C?
            // Usually insert BEFORE target.
            // If dropping on C, we want [B, A, C].
            // Filtered C is at 1. Insert at 1. Result [B, A, C].
            // Correct.
            insertIndex = index - 1;
        }

        // Wait, if I drop ON C (index 2 originally), I want it to be [B, A, C] or [B, C, A]?
        // Standard D&D usually inserts BEFORE the target.
        // If [A, B, C]. Drag A to C. Drop on C.
        // Filtered: [B, C]. C is at 1. Insert at 1 -> [B, A, C].

        // If [A, B, C]. Drag C to A. Drop on A (0).
        // Filtered [A, B]. A is at 0. Insert at 0 -> [C, A, B]. 
        // Correct.

        // Correct logic for "Insert Before":
        // But since we removed the item from the array FIRST calculate index relative to that new array.

        const newItems = [...dockItems];
        const [removed] = newItems.splice(draggedIndex, 1);
        newItems.splice(index, 0, removed);

        saveDock(newItems);

        setDraggedItem(null);
        setDragOverIndex(null);
    };


    const filteredTasks = AVAILABLE_TASKS.filter(task =>
        task.label.toLowerCase().includes(searchTerm.toLowerCase()) &&
        task.label.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !dockItems.some(item => item.id === task.id) &&
        // Filtering for USER role
        (currentUser?.role !== 'USER' && currentUser?.role !== 'User' || !currentUser?.allowed_modules || currentUser.allowed_modules.length === 0 || currentUser.allowed_modules.includes(task.id))
    );

    return (
        <div className="flex items-center gap-1 bg-slate-100/50 backdrop-blur-sm px-3 py-1 rounded-2xl border border-slate-200/60 shadow-sm relative group/dock transition-all hover:bg-white hover:shadow-md hover:scale-105 duration-300">
            {dockItems.map((item, index) => {
                const isActive = activeModule === item.module && subModule === item.subModule && !item.isSpacer;
                const Icon = item.icon;

                return (
                    <div
                        key={item.id}
                        className={`relative group flex flex-col items-center 
                            ${item.isSpacer ? 'w-4' : 'w-auto'} 
                            ${draggedItem?.id === item.id ? 'opacity-20' : 'opacity-100'}
                            transition-all duration-200
                        `}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={(e) => handleDrop(e, index)}
                        onDragEnd={handleDragEnd}
                    >
                        {item.isSpacer ? (
                            // Spacer render
                            <div className="w-full h-8 flex items-center justify-center cursor-move">
                                <div className="w-1 h-1 bg-slate-300 rounded-full opacity-50 group-hover:opacity-100"></div>
                            </div>
                        ) : (
                            // Normal App render
                            <button
                                onClick={() => handleTaskClick(item)}
                                className={`
                                    p-2 rounded-xl transition-all duration-200 ease-out cursor-pointer select-none
                                    ${isActive
                                        ? 'bg-blue-100 text-blue-600 shadow-sm scale-110'
                                        : 'text-slate-500 hover:text-blue-600 hover:bg-slate-50 hover:scale-125'
                                    }
                                `}
                                title={item.label}
                            >
                                <Icon size={18} />

                                {isActive && (
                                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-blue-500 rounded-full"></span>
                                )}
                            </button>
                        )}

                        {currentUser?.role !== 'Cargo Agent' && (
                            <button
                                onClick={(e) => removeFromDock(e, item.id)}
                                className="absolute -top-3 -right-1 bg-slate-200 text-slate-500 rounded-full p-0.5 opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-500 transition-opacity scale-75 z-10"
                                title="Remove from Dock"
                            >
                                <X size={10} />
                            </button>
                        )}
                    </div>
                );
            })}

            {/* Separator */}
            {dockItems.length > 0 && <div className="w-px h-6 bg-slate-300 mx-1"></div>}

            {/* Add Button - Hidden for Cargo Agent */}
            {currentUser?.role !== 'Cargo Agent' && (
                <div className="relative">
                    <button
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/50 transition-all hover:scale-110"
                        title="Add App"
                    >
                        <Plus size={18} />
                    </button>

                    {/* Popover Menu */}
                    {isMenuOpen && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 w-72 bg-white rounded-xl shadow-2xl border border-slate-100 p-3 z-50 animate-in fade-in slide-in-from-bottom-5 duration-200">
                            {/* Search */}
                            <div className="relative mb-3">
                                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Search apps..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    autoFocus
                                />
                            </div>

                            {/* Grid */}
                            <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto custom-scrollbar p-1">
                                {/* Spacer Option */}
                                <button
                                    onClick={() => addToDock(SPACER_TASK)}
                                    className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors group/item"
                                    title="Add Space"
                                >
                                    <div className="p-1.5 rounded-md bg-slate-100 text-slate-600 border border-dashed border-slate-300">
                                        <Minus size={16} />
                                    </div>
                                    <span className="text-[9px] text-slate-500 text-center leading-tight w-full group-hover/item:text-slate-800">
                                        Space
                                    </span>
                                </button>

                                {filteredTasks.map(task => {
                                    const TIcon = task.icon;
                                    return (
                                        <button
                                            key={task.id}
                                            onClick={() => addToDock(task)}
                                            className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors group/item"
                                            title={task.label}
                                        >
                                            <div className={`p-1.5 rounded-md ${task.color === 'red' ? 'bg-red-50 text-red-600' : task.color === 'blue' ? 'bg-blue-50 text-blue-600' : task.color === 'green' ? 'bg-emerald-50 text-emerald-600' : task.color === 'orange' ? 'bg-orange-50 text-orange-600' : 'bg-slate-100 text-slate-600'}`}>
                                                <TIcon size={16} />
                                            </div>
                                            <span className="text-[9px] text-slate-500 text-center leading-tight line-clamp-2 w-full group-hover/item:text-slate-800">
                                                {task.label}
                                            </span>
                                        </button>
                                    );
                                })}

                                {filteredTasks.length === 0 && (
                                    <div className="col-span-4 text-center py-4 text-xs text-slate-400">
                                        No apps found
                                    </div>
                                )}
                            </div>

                            {/* Pointer Arrow */}
                            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-b border-r border-slate-100 transform rotate-45 shadow-sm"></div>
                        </div>
                    )}
                </div>
            )}

            {/* Separator */}
            <div className="w-px h-6 bg-slate-300 mx-1"></div>

            {/* Help Button */}
            <button
                onClick={onToggleHelp}
                className="p-2 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-slate-200/50 transition-all hover:scale-110"
                title="Help Center"
            >
                <MessageCircleQuestion size={18} />
            </button>

            {/* Close menu backdrop */}
            {isMenuOpen && (
                <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setIsMenuOpen(false)}></div>
            )}
        </div>
    );
};

export default Dock;
