
import {
    LayoutDashboard, Bot, ShoppingBag, TrendingUp, Map, Database, PieChart, Settings,
    Calculator, UserCheck, Building, Tag, ShoppingCart, Target, Users, ClipboardList,
    List, Globe, Plane, Truck, History, FileText, Warehouse, Ship,
    MapPin, Anchor, Package, Mail, Sparkles, Receipt, DollarSign, PenTool, FileSpreadsheet,
    FileStack, CircuitBoard, ScanText, FileQuestion, Sliders, Phone, Brain, Table,
    ArrowDownRight, ArrowUpRight, // Finance submenu icons
    Briefcase // Sales Hub icon
} from 'lucide-react';

export const navigationConfig = {
    DASHBOARD: {
        label: 'Dashboard',
        icon: LayoutDashboard,
        items: []
    },
    CONNECTIONS: {
        label: 'Agent log',
        icon: Mail,
        items: []
    },
    BUY: {
        label: 'Purchase',
        icon: ShoppingBag,
        items: [
            { id: 'SUPPLIERS', label: 'Suppliers', icon: Building },
            { id: 'OFFERS', label: 'Supplier Quotes', icon: Tag },
            { id: 'PO', label: 'Purchase Orders', icon: ShoppingCart },
            { id: 'STOCK', label: 'Inventory', icon: Warehouse },
            { id: 'COST', label: 'Cost', icon: Calculator },
            { id: 'HISTORY', label: 'Saved Costs', icon: History }
        ]
    },
    COST_PROFIT_AI: {
        label: 'Order-Sale',
        icon: Sparkles,
        items: [
            { id: 'ORDER_SALE', label: 'Order-Sale Engine', icon: Sparkles },
            { id: 'ICRM', label: 'iCRM', icon: Target, color: 'blue', separatorBefore: true },
            { id: 'CUSTOMERS', label: 'Customers', icon: Users },
            { id: 'PIPELINE', label: 'Pipeline', icon: TrendingUp },
            { id: 'STATUS', label: 'Customer 360', icon: PieChart },
            { id: 'PRICELIST', label: 'Price List', icon: List },
            { id: 'ORDERS', label: 'Sales Orders', icon: ClipboardList },
            { id: 'SALE_BRAZIL', label: 'Sale Brazil', icon: Globe, color: 'green', separatorBefore: true }
        ]
    },
    PAPERWORK: {
        label: 'Paperwork',
        icon: FileStack,
        items: [
            { id: 'PL_INVOICE_ENGINE', label: 'PL & Invoice Engine', icon: FileStack }
        ]
    },
    SALES_HUB: {
        label: 'Sales Hub',
        icon: Briefcase,
        items: []
    },
    SALES_FORCE: {
        label: 'Sales Force',
        icon: Users,
        items: [
            { id: 'ICRM', label: 'iCRM', icon: Target },
            { id: 'CUSTOMERS', label: 'Customers', icon: Users },
            { id: 'PIPELINE', label: 'Pipeline', icon: TrendingUp },
            { id: 'PRICELIST', label: 'Price List', icon: List },
            { id: 'ORDERS', label: 'Sales Orders', icon: ClipboardList }
        ]
    },
    COMMISSIONS: {
        label: 'Commissions',
        icon: DollarSign,
        items: []
    },
    LOGISTICS: {
        label: 'Logistics',
        icon: Map,
        items: [
            { id: 'LOGISTICS_AI', label: 'Logistics AI', icon: CircuitBoard, color: 'blue', separatorAfter: true },
            { id: 'BL', label: 'Bill of Ladings', icon: FileText },
            { id: 'BOOKINGS', label: 'Bookings', icon: ClipboardList },
            { id: 'AGENTS', label: 'Cargo Agents', icon: Truck },
            { id: 'FREIGHT', label: 'Freight Quotes', icon: Ship }
        ]
    },
    FINANCE: {
        label: 'Finance',
        icon: PieChart,
        items: [
            { id: 'PAYABLES', label: 'Payables', icon: ArrowDownRight },
            { id: 'RECEIVABLES', label: 'Receivables', icon: ArrowUpRight }
        ]
    },
    DATA: {
        label: 'Data',
        icon: Database,
        items: [
            { id: 'BANKS', label: 'Banks', icon: Building },
            { id: 'AGENTS', label: 'Cargo Agents', icon: Truck },
            { id: 'CARRIERS', label: 'Carriers', icon: Ship },
            { id: 'CUSTOMERS', label: 'Customers', icon: Users },
            { id: 'DOC_VIEWER', label: 'Doc Viewer', icon: FileText },
            { id: 'LOCATIONS', label: 'Locations', icon: MapPin },
            { id: 'PORTS', label: 'Ports', icon: Anchor },
            { id: 'PRODUCTS', label: 'Products', icon: Package },
            { id: 'SUPPLIERS', label: 'Suppliers', icon: Building },
            { id: 'INVOICE', label: 'Doc OCR', icon: ScanText, color: 'blue', separatorBefore: true }
        ]
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
            { id: 'BRAIN', label: 'Brain Diagnostics', icon: Brain }
        ]
    }
};
