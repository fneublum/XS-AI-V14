import React, { useState, useEffect, useRef } from 'react';
import { Layers, ChevronDown, Check, LogOut, Bot } from 'lucide-react';
import { navigationConfig } from '../config/navigation';
import { User, Company, Role } from '../types';
import { getSupabaseClient } from '../services/supabase';

interface TopNavigationProps {
    activeModule: string;
    setActiveModule: (module: string) => void;
    subModule?: string; // Added for active state checking
    setSubModule?: (subModule: string) => void;
    currentUser: User;
    onLogout: () => void;
    availableCompanies: Company[];
    currentCompanyId: string;
    onSwitchCompany: (id: string) => void;
    onToggleAiSidebar?: () => void;
}

const TopNavigation: React.FC<TopNavigationProps> = ({
    activeModule,
    setActiveModule,
    subModule, // Destructure new prop
    setSubModule,
    currentUser,
    onLogout,
    availableCompanies,
    currentCompanyId,
    onSwitchCompany,
    onToggleAiSidebar
}) => {
    const [showCompanyMenu, setShowCompanyMenu] = useState(false);
    const [companyLogoSrc, setCompanyLogoSrc] = useState<string>("https://placehold.co/200x60/1e293b/ffffff?text=XSOLUTION&font=montserrat");
    const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
    const dropdownTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const fetchLogo = async () => {
            const client = getSupabaseClient();
            if (client) {
                let targetId = currentCompanyId;
                if (targetId === 'ALL') targetId = 'SYSTEM';

                const { data } = await client.from('imagens').select('url').eq('companyId', targetId).eq('type', 'LOGO').single();
                if (data && data.url) {
                    setCompanyLogoSrc(data.url);
                } else if (currentCompanyId !== 'ALL') {
                    const { data: sysData } = await client.from('imagens').select('url').eq('companyId', 'SYSTEM').eq('type', 'LOGO').single();
                    if (sysData && sysData.url) setCompanyLogoSrc(sysData.url);
                }
            }
        };
        fetchLogo();
    }, [currentCompanyId]);

    const currentCompany = availableCompanies.find(c => c.id === currentCompanyId);
    const canViewAll = currentUser.role === Role.ADMIN;

    // Filter companies
    const selectableCompanies = currentUser.role === Role.ADMIN
        ? availableCompanies
        : availableCompanies.filter(c => (currentUser.allowed_company_ids || []).includes(c.id));

    const canSwitchCompany = selectableCompanies.length > 0;

    useEffect(() => {
        if (!canViewAll && selectableCompanies.length === 1 && (currentCompanyId === 'ALL' || !currentCompanyId)) {
            onSwitchCompany(selectableCompanies[0].id);
        }
    }, [canViewAll, selectableCompanies, currentCompanyId, onSwitchCompany]);

    // Use config for modules
    let visibleModules: any[] = [];

    if (currentUser.role === Role.CARGO_AGENT) {
        // FLAT MENU FOR CARGO AGENT
        // Replaces standard LOGISTICS dropdown with top-level buttons
        // Implicitly hides Settings and Inventory by not including them

        // Import icons dynamically or assume they are available from Lucide imports at top
        // Needed: Ship (Freight), ClipboardList (Bookings), FileText (BL) - already imported

        visibleModules = [
            // Option 1: Dashboard (Assumed standard)


            // Custom Flat Items
            { id: 'CA_FREIGHT', label: 'Freight Quotes', icon: (navigationConfig.LOGISTICS.items.find(i => i.id === 'FREIGHT')?.icon || navigationConfig.LOGISTICS.icon), items: [] },
            { id: 'CA_BOOKINGS', label: 'Bookings', icon: (navigationConfig.LOGISTICS.items.find(i => i.id === 'BOOKINGS')?.icon || navigationConfig.LOGISTICS.icon), items: [] },
            { id: 'CA_BL', label: 'Bill of Ladings', icon: (navigationConfig.LOGISTICS.items.find(i => i.id === 'BL')?.icon || navigationConfig.LOGISTICS.icon), items: [] }
        ];

    } else {
        // STANDARD LOGIC
        visibleModules = Object.entries(navigationConfig).map(([key, config]) => ({ id: key, ...config })).filter(mod => {
            const role = currentUser.role;
            const isGlobalView = currentCompanyId === 'ALL';

            if (role === Role.CUSTOMER) return mod.id === 'CUSTOMER_PORTAL';

            // Strict: Customer Portal ONLY for CUSTOMER role
            if (mod.id === 'CUSTOMER_PORTAL') return role === Role.CUSTOMER;

            if (mod.id === 'SETTINGS') return role !== Role.USER; // Hide Settings for USER role
            if (mod.id === 'FINANCE') return role === Role.ADMIN;

            if (isGlobalView) {
                if (role === Role.ADMIN) return true;
                if (role === Role.CEO) return true;
                return mod.id === 'DASHBOARD' || mod.id === 'LOGISTICS';
            }

            if (role === Role.ADMIN || role === Role.CEO) return true;
            if (mod.id === 'DASHBOARD') return true; // Always allow Dashboard

            // Check if user has access to ANY sub-item within this module
            if (currentUser.allowed_modules && currentUser.allowed_modules.length > 0) {
                // Special check for Customer Portal - already handled above

                // Valid sub-items for this module (mod spreads config, so it has items)
                const subItemIds = (mod.items || []).map(i => i.id).filter(id => id !== '');

                // If the module itself has an ID (though usually config keys are the IDs), check it
                // But mainly check if allowed_modules contains any of the subItemIds
                const hasAccessToSubItem = subItemIds.some(id => currentUser.allowed_modules?.includes(id));

                return hasAccessToSubItem;
            }

            // Fallback: If allowed_modules is undefined/empty, what is the default?
            // Assuming strict mode from requirements: if allowed_modules is empty, show nothing?
            // Or if undefined, show all? 
            // Previous code: allowed_modules === undefined || includes(mod.id)
            // If allowed_modules is undefined, we assume full access (legacy users)
            return currentUser.allowed_modules === undefined;
        });
    }

    const handleModuleClick = (moduleId: string) => {
        // SPECIAL HANDLING FOR CARGO AGENT FLAT MENU
        if (currentUser.role === Role.CARGO_AGENT) {
            if (moduleId === 'CA_FREIGHT') {
                setActiveModule('LOGISTICS');
                if (setSubModule) setSubModule('FREIGHT');
            } else if (moduleId === 'CA_BOOKINGS') {
                setActiveModule('LOGISTICS');
                if (setSubModule) setSubModule('BOOKINGS');
            } else if (moduleId === 'CA_BL') {
                setActiveModule('LOGISTICS');
                if (setSubModule) setSubModule('BL');
            }
            setActiveDropdown(null);
            return;
        }

        // STANDARD HANDLING
        setActiveModule(moduleId);

        let targetSubModule = '';

        // SMART NAV: For USER role, defaulting to '' (Control Tower/Dashboard) might show unauthorized content.
        // Instead, find the FIRST sub-item they are actually allowed to see and default to that.
        if ((currentUser.role === Role.USER || currentUser.role === 'USER') && currentUser.allowed_modules && currentUser.allowed_modules.length > 0) {
            const moduleConfig = visibleModules.find(m => m.id === moduleId);
            if (moduleConfig && moduleConfig.items) {
                // Check if the "Default" view (usually the first item) is allowed
                const firstItem = moduleConfig.items[0];
                const isDefaultAllowed = firstItem && currentUser.allowed_modules.includes(firstItem.id);

                if (!isDefaultAllowed) {
                    // If default is NOT allowed, find the first one that IS
                    const firstAllowed = moduleConfig.items.find(item => currentUser.allowed_modules!.includes(item.id));
                    if (firstAllowed) {
                        targetSubModule = firstAllowed.id;
                    }
                }
            }
        }

        if (setSubModule) setSubModule(targetSubModule);
        setActiveDropdown(activeDropdown === moduleId ? null : moduleId);
    };

    const handleSubModuleClick = (moduleId: string, subId: string) => {
        console.log('[TopNavigation] handleSubModuleClick called:', { moduleId, subId });
        setActiveModule(moduleId);
        console.log('[TopNavigation] setActiveModule called with:', moduleId);
        if (setSubModule) {
            setSubModule(subId);
            console.log('[TopNavigation] setSubModule called with:', subId);
        }
        setActiveDropdown(null);
    };

    const handleMouseEnter = (moduleId: string) => {
        if (dropdownTimeoutRef.current) clearTimeout(dropdownTimeoutRef.current);
        const mod = visibleModules.find(m => m.id === moduleId);
        // We need to check the FILTERED items here, but since we filter in render, 
        // let's rely on the render logic or duplicate the check briefly if needed.
        // For simplicity, we'll let the render loop handle the dropdown display conditionally.
        setActiveDropdown(moduleId);
    };

    const handleMouseLeave = () => {
        dropdownTimeoutRef.current = setTimeout(() => {
            setActiveDropdown(null);
        }, 150); // slight delay to prevent flickering
    };

    return (
        <header className="h-20 bg-white/80 border-b border-slate-200 fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 shadow-sm backdrop-blur-md">

            {/* LEFT: Company Logo */}
            <div className="flex items-center gap-6 shrink-0 pr-6 border-r border-slate-200">
                <div className="h-16 w-auto flex items-center justify-start">
                    <img
                        src={companyLogoSrc}
                        alt="Company Logo"
                        className="max-h-full max-w-[200px] object-contain"
                    />
                </div>
            </div>

            {/* CENTER: Module Navigation */}
            <nav className="flex-1 flex justify-center border-l border-r border-slate-200 h-10 items-center px-4">
                <ul className="flex items-center gap-1">
                    {visibleModules.map((mod) => {
                        const Icon = mod.icon;

                        let isActive = activeModule === mod.id;

                        if (currentUser.role === Role.CARGO_AGENT && activeModule === 'LOGISTICS') {
                            if (mod.id === 'CA_FREIGHT') isActive = (subModule === 'FREIGHT');
                            else if (mod.id === 'CA_BOOKINGS') isActive = (subModule === 'BOOKINGS');
                            else if (mod.id === 'CA_BL') isActive = (subModule === 'BL');
                        }

                        let displayItems = mod.items || [];
                        if (mod.id === 'SETTINGS' && currentUser.role !== Role.ADMIN) {
                            displayItems = displayItems.filter(item => item.id === 'INTEGRATIONS');
                        }

                        if ((currentUser.role === Role.USER || currentUser.role === 'USER') && currentUser.allowed_modules && currentUser.allowed_modules.length > 0) {
                            displayItems = displayItems.filter(item => currentUser.allowed_modules!.includes(item.id));
                        }

                        const hasItems = displayItems.length > 0;
                        const isDropdownOpen = activeDropdown === mod.id;

                        return (
                            <li
                                key={mod.id}
                                className="relative group"
                                onMouseEnter={() => handleMouseEnter(mod.id)}
                                onMouseLeave={handleMouseLeave}
                            >
                                <button
                                    onClick={() => handleModuleClick(mod.id)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 ${isActive
                                        ? 'bg-slate-900 text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                                        }`}
                                >
                                    <Icon size={16} className={isActive ? 'text-white' : 'text-slate-400'} />
                                    <span className={isActive ? 'opacity-100' : 'hidden xl:inline opacity-90'}>{mod.label}</span>
                                    {hasItems && <ChevronDown size={12} className={`ml-1 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />}
                                </button>

                                {hasItems && isDropdownOpen && (
                                    <div
                                        className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-64 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
                                        onMouseEnter={() => {
                                            if (dropdownTimeoutRef.current) clearTimeout(dropdownTimeoutRef.current);
                                        }}
                                        onMouseLeave={handleMouseLeave}
                                    >
                                        <div className="py-1">
                                            {displayItems.map(subItem => {
                                                const SubIcon = subItem.icon;
                                                return (
                                                    <button
                                                        key={subItem.id}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleSubModuleClick(mod.id, subItem.id);
                                                        }}
                                                        className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-start gap-3 group transition-colors border-b border-slate-50 last:border-0"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            {SubIcon ? (
                                                                <div className={`p-1.5 rounded-md ${subItem.color === 'red' ? 'bg-red-50 text-red-600' : subItem.color === 'blue' ? 'bg-blue-50 text-blue-600' : subItem.color === 'green' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                                                                    <SubIcon size={16} />
                                                                </div>
                                                            ) : (
                                                                <div className="w-1.5 h-1.5 rounded-full bg-slate-300 ml-2"></div>
                                                            )}
                                                        </div>
                                                        <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">{subItem.label}</span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </nav>

            {/* AI Copilot Trigger - Hide for Customer Portal */}
            {activeModule !== 'CUSTOMER_PORTAL' && (
                <button
                    onClick={onToggleAiSidebar}
                    className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition-colors group border border-rose-100 shadow-sm mr-6"
                >
                    <Bot size={18} className="group-hover:scale-110 transition-transform" />
                    <span className="font-bold text-sm">Bob</span>
                </button>
            )}

            {/* RIGHT: User Profile & Company Switcher */}
            <div className="flex items-center gap-4 shrink-0 ml-6 pl-6 border-l border-slate-200">
                {/* Company Switcher - Circle Icon */}
                <div className="relative">
                    <div
                        onMouseEnter={() => canSwitchCompany && setShowCompanyMenu(true)}
                        onMouseLeave={() => setShowCompanyMenu(false)}
                    >
                        <button
                            disabled={!canSwitchCompany}
                            className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${canSwitchCompany
                                ? 'bg-white border-blue-100 text-blue-600 hover:border-blue-300 hover:shadow-md cursor-pointer'
                                : 'bg-slate-50 border-slate-200 text-slate-400 cursor-default'
                                }`}
                            title={currentCompany?.name || 'Select Company'}
                        >
                            <span className="text-xs font-bold leading-none">
                                {currentCompany?.name ? currentCompany.name.substring(0, 2).toUpperCase() : 'ALL'}
                            </span>
                        </button>

                        {/* Company Menu Dropdown */}
                        {showCompanyMenu && canSwitchCompany && (
                            <div className="absolute top-full right-0 mt-2 w-64 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                                <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-bold text-slate-500 flex justify-between items-center">
                                    <span>Switch Workspace</span>
                                    <Layers size={12} />
                                </div>

                                {canViewAll && (
                                    <button
                                        onClick={() => {
                                            onSwitchCompany('ALL');
                                            setActiveModule('DASHBOARD');
                                            setShowCompanyMenu(false);
                                        }}
                                        className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 flex items-center justify-between border-b border-slate-100"
                                    >
                                        <span className={currentCompanyId === 'ALL' ? 'text-blue-600 font-bold' : 'text-slate-700'}>All Companies</span>
                                        {currentCompanyId === 'ALL' && <Check size={16} className="text-blue-600" />}
                                    </button>
                                )}

                                <div className="max-h-80 overflow-y-auto">
                                    {selectableCompanies.length > 0 ? selectableCompanies.map(comp => (
                                        <button
                                            key={comp.id}
                                            onClick={() => {
                                                onSwitchCompany(comp.id);
                                                setShowCompanyMenu(false);
                                            }}
                                            className="w-full text-left px-4 py-3 text-sm hover:bg-slate-50 flex items-center justify-between transition-colors border-b border-slate-50 last:border-0"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
                                                    {comp.name[0]}
                                                </div>
                                                <span className={comp.id === currentCompanyId ? 'text-blue-600 font-bold' : 'text-slate-700'}>{comp.name}</span>
                                            </div>
                                            {comp.id === currentCompanyId && <Check size={16} className="text-blue-600" />}
                                        </button>
                                    )) : (
                                        <div className="p-4 text-xs text-slate-500 text-center">No companies assigned</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* User Profile */}
                <div className="flex items-center gap-3">
                    <div className="text-right hidden md:block">
                        <p className="text-sm font-bold text-slate-800 leading-tight">{currentUser.name}</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wide">{currentUser.role}</p>
                    </div>
                </div>

                <button
                    onClick={onLogout}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Sign Out"
                >
                    <LogOut size={18} />
                </button>
            </div>
        </header>
    );
};

export default TopNavigation;
