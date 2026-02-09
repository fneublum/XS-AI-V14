
import {
    LayoutDashboard, Bot, ShoppingBag, TrendingUp, Map, Database, PieChart, Settings,
    Calculator, UserCheck, Building, Tag, ShoppingCart, Target, Users, ClipboardList,
    List, Globe, Plane, Truck, History, Table, FileText, Warehouse, Ship,
    MapPin, Anchor, Package, Mail, Sparkles, Receipt, DollarSign, PenTool, FileSpreadsheet,
    FileStack, CircuitBoard, ScanText, FileQuestion, Sliders // Added imports
} from 'lucide-react';

export const navigationConfig = {
    DASHBOARD: {
        label: 'Dashboard',
        icon: LayoutDashboard,
        items: []
    },
    AI_UPLOAD: { // Automation
        label: 'Automation',
        icon: Bot,
        items: [
            { id: 'INVOICE', label: 'Doc OCR', icon: ScanText, color: 'blue' },
            { id: 'INBOX_SCANNER', label: 'Inbox Scanner', icon: Mail, color: 'red' },
            { id: 'PROPOSAL_ENGINE', label: 'Proposal Engine', icon: FileQuestion, color: 'purple' },
            { id: 'PL_ENGINE', label: 'PL/Invoice Engine', icon: FileStack, color: 'green' },
            { id: 'LOGISTICS_AI', label: 'Logistics AI', icon: CircuitBoard, color: 'blue' },
            { id: 'COMMISSIONS', label: 'Commissions', icon: DollarSign, color: 'orange' }
        ]
    },
    BUY: {
        label: 'Purchase',
        icon: ShoppingBag,
        items: [
            { id: 'SUPPLIERS', label: 'Suppliers', icon: Building },
            { id: 'OFFERS', label: 'Supplier Quotes', icon: Tag },
            { id: 'PO', label: 'Purchase Orders', icon: ShoppingCart },
            { id: 'STOCK', label: 'Inventory', icon: Warehouse }
        ]
    },
    CALCULATOR: {
        label: 'Calculator',
        icon: Calculator,
        items: [
            { id: '', label: 'Cost Calculation', icon: Calculator },
            { id: 'HISTORY', label: 'Saved Costs', icon: History },
            { id: 'SHEET', label: 'Cost Sheet', icon: Table },
            { id: 'PRICE_LIST', label: 'Price List', icon: FileText }
        ]
    },
    SELL: {
        label: 'Sale',
        icon: TrendingUp,
        items: [
            { id: 'ICRM', label: 'iCRM', icon: Target, color: 'blue' },
            { id: 'SMAIL', label: 'SMAIL Assistant', icon: Sparkles, color: 'blue' }, // Moved from Automation
            { id: 'CUSTOMERS', label: 'Customers', icon: Users },
            { id: 'PIPELINE', label: 'Pipeline', icon: TrendingUp },
            { id: 'STATUS', label: 'Customer 360', icon: PieChart },
            { id: 'PRICELIST', label: 'Price List', icon: List },
            { id: 'ORDERS', label: 'Sales Orders', icon: ClipboardList },
            { id: 'SALE_BRAZIL', label: 'Sale Brazil', icon: Globe, color: 'green' }
        ]
    },
    LOGISTICS: {
        label: 'Logistics',
        icon: Map,
        items: [
            { id: 'LOGISTICS_MANAGE', label: 'Logistic Manager', icon: Sliders },
            { id: 'BL', label: 'Bill of Ladings', icon: FileText },
            { id: 'BOOKINGS', label: 'Bookings', icon: ClipboardList },
            { id: 'FREIGHT', label: 'Freight Quotes', icon: Ship }
        ]
    },
    DATA: {
        label: 'Data',
        icon: Database,
        items: [
            { id: 'AGENTS', label: 'Cargo Agents', icon: Truck },
            { id: 'BANKS', label: 'Banks', icon: Building },
            { id: 'CARRIERS', label: 'Carriers', icon: Ship },
            { id: 'CUSTOMERS', label: 'Customers', icon: Users },
            { id: 'DOC_VIEWER', label: 'Doc Viewer', icon: FileText },
            { id: 'LOCATIONS', label: 'Locations', icon: MapPin },
            { id: 'PORTS', label: 'Ports', icon: Anchor },
            { id: 'PRODUCTS', label: 'Products', icon: Package },
            { id: 'SUPPLIERS', label: 'Suppliers', icon: Building }
        ]
    },
    FINANCE: {
        label: 'Finance',
        icon: PieChart,
        items: []
    },
    CUSTOMER_PORTAL: {
        label: 'Client Portal',
        icon: UserCheck,
        items: []
    },
    SETTINGS: {
        label: 'Settings',
        icon: Settings,
        items: [
            { id: 'USERS', label: 'Users' },
            { id: 'COMPANIES', label: 'Companies' },
            { id: 'DB', label: 'Database Config' },
            { id: 'BRANDING', label: 'Branding & Logo' },
            { id: 'INTEGRATIONS', label: 'Email Integration' },
            { id: 'FORMS', label: 'Form Builder', icon: PenTool }
        ]
    }
};
