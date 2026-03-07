import React, { useState, useEffect, useRef } from 'react';
import { Layers, ChevronDown, Check, LogOut } from 'lucide-react';
import { navigationConfig } from '../config/navigation';
import { User, Company, Role } from '../types';
import { getSupabaseClient } from '../services/supabase';
import { AVAILABLE_TASKS } from './Dock';
import NotificationCenter from './NotificationCenter';

interface TopNavigationProps {
    activeModule: string;
    setActiveModule: (module: string) => void;
    subModule?: string;
    setSubModule?: (subModule: string) => void;
    currentUser: User;
    onLogout: () => void;
    availableCompanies: Company[];
    currentCompanyId: string;
    onSwitchCompany: (id: string) => void;
    onToggleAiSidebar?: () => void;
}

// Color palette per module for quick visual recognition
const MODULE_COLORS: Record<string, { bg: string; text: string; activeBg: string; activeText: string; iconBg: string }> = {
    DASHBOARD: { bg: 'hover:bg-slate-50', text: 'text-slate-600', activeBg: 'bg-slate-800', activeText: 'text-white', iconBg: 'bg-slate-100 text-slate-600' },
    AI_UPLOAD: { bg: 'hover:bg-rose-50', text: 'text-slate-600', activeBg: 'bg-rose-600', activeText: 'text-white', iconBg: 'bg-rose-50 text-rose-600' },
    BUY: { bg: 'hover:bg-blue-50', text: 'text-slate-600', activeBg: 'bg-blue-600', activeText: 'text-white', iconBg: 'bg-blue-50 text-blue-600' },
    PAPERWORK: { bg: 'hover:bg-teal-50', text: 'text-slate-600', activeBg: 'bg-teal-600', activeText: 'text-white', iconBg: 'bg-teal-50 text-teal-600' },
    COMMISSIONS: { bg: 'hover:bg-amber-50', text: 'text-slate-600', activeBg: 'bg-amber-600', activeText: 'text-white', iconBg: 'bg-amber-50 text-amber-600' },
    LOGISTICS: { bg: 'hover:bg-orange-50', text: 'text-slate-600', activeBg: 'bg-orange-600', activeText: 'text-white', iconBg: 'bg-orange-50 text-orange-600' },
    DATA: { bg: 'hover:bg-cyan-50', text: 'text-slate-600', activeBg: 'bg-cyan-600', activeText: 'text-white', iconBg: 'bg-cyan-50 text-cyan-600' },
    FINANCE: { bg: 'hover:bg-amber-50', text: 'text-slate-600', activeBg: 'bg-amber-600', activeText: 'text-white', iconBg: 'bg-amber-50 text-amber-600' },
    SALES_HUB: { bg: 'hover:bg-rose-50', text: 'text-slate-600', activeBg: 'bg-rose-600', activeText: 'text-white', iconBg: 'bg-rose-50 text-rose-600' },
    SALES_FORCE: { bg: 'hover:bg-violet-50', text: 'text-slate-600', activeBg: 'bg-violet-600', activeText: 'text-white', iconBg: 'bg-violet-50 text-violet-600' },
    CUSTOMER_PORTAL: { bg: 'hover:bg-indigo-50', text: 'text-slate-600', activeBg: 'bg-indigo-600', activeText: 'text-white', iconBg: 'bg-indigo-50 text-indigo-600' },
    SETTINGS: { bg: 'hover:bg-slate-50', text: 'text-slate-600', activeBg: 'bg-slate-700', activeText: 'text-white', iconBg: 'bg-slate-100 text-slate-500' },
};

const getColors = (id: string) => MODULE_COLORS[id] || MODULE_COLORS.DASHBOARD;

const TopNavigation: React.FC<TopNavigationProps> = ({
    activeModule,
    setActiveModule,
    subModule,
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
    const navRef = useRef<HTMLElement>(null);

    // Close dropdown when clicking outside the nav
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (navRef.current && !navRef.current.contains(e.target as Node)) {
                setActiveDropdown(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

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

    const selectableCompanies = currentUser.role === Role.ADMIN
        ? availableCompanies
        : availableCompanies.filter(c => (currentUser.allowed_company_ids || []).includes(c.id));

    const canSwitchCompany = selectableCompanies.length > 0;

    useEffect(() => {
        if (!canViewAll && selectableCompanies.length === 1 && (currentCompanyId === 'ALL' || !currentCompanyId)) {
            onSwitchCompany(selectableCompanies[0].id);
        }
    }, [canViewAll, selectableCompanies, currentCompanyId, onSwitchCompany]);

    let visibleModules: any[] = [];

    if (currentUser.role === Role.CARGO_AGENT) {
        visibleModules = [
            { id: 'CA_FREIGHT', label: 'Freight Quotes', icon: (navigationConfig.LOGISTICS.items.find(i => i.id === 'FREIGHT')?.icon || navigationConfig.LOGISTICS.icon), items: [] },
            { id: 'CA_BOOKINGS', label: 'Bookings', icon: (navigationConfig.LOGISTICS.items.find(i => i.id === 'BOOKINGS')?.icon || navigationConfig.LOGISTICS.icon), items: [] },
            { id: 'CA_BL', label: 'Bill of Ladings', icon: (navigationConfig.LOGISTICS.items.find(i => i.id === 'BL')?.icon || navigationConfig.LOGISTICS.icon), items: [] }
        ];
    } else {
        visibleModules = Object.entries(navigationConfig).map(([key, config]) => ({ id: key, ...config })).filter(mod => {
            const role = currentUser.role as string;
            const isGlobalView = currentCompanyId === 'ALL';

            if (role === Role.CUSTOMER) return mod.id === 'CUSTOMER_PORTAL';
            if (role === Role.SALES) {
                const salesAllowed = ['SALES_HUB', 'COMMISSIONS', 'SALES_FORCE'];
                return salesAllowed.includes(mod.id);
            }
            if (mod.id === 'CUSTOMER_PORTAL') return role === Role.CUSTOMER;
            if (mod.id === 'SALES_HUB') return role === Role.SALES;
            if (mod.id === 'SALES_FORCE') return role === Role.SALES;
            if (mod.id === 'SETTINGS') return role !== Role.USER;


            if (isGlobalView) {
                if (role === Role.ADMIN) return true;
                if (role === Role.CEO) return true;
                return mod.id === 'LOGISTICS';
            }

            if (role === Role.ADMIN || role === Role.CEO) return true;
            if (mod.id === 'DASHBOARD') return false;

            if (currentUser.allowed_modules && currentUser.allowed_modules.length > 0) {
                const subItemIds = (mod.items || []).map(i => i.id).filter(id => id !== '');
                const hasAccessViaNavId = subItemIds.some(id => currentUser.allowed_modules?.includes(id));
                if (hasAccessViaNavId) return true;

                const dockTasksForModule = AVAILABLE_TASKS.filter(t => t.module === mod.id);
                const hasAccessViaDockId = dockTasksForModule.some(t => currentUser.allowed_modules?.includes(t.id));
                return hasAccessViaDockId;
            }

            return currentUser.allowed_modules === undefined;
        });
    }

    const handleModuleClick = (moduleId: string) => {
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

        // Check if this module has sub-items to show
        const moduleConfig = visibleModules.find(m => m.id === moduleId);
        const hasSubItems = moduleConfig && moduleConfig.items && moduleConfig.items.length > 0;

        if (hasSubItems) {
            // Toggle dropdown: if already open for this module, close it; otherwise open it
            setActiveDropdown(prev => prev === moduleId ? null : moduleId);

            // Navigate to this module if it's different from the active one
            if (activeModule !== moduleId) {
                setActiveModule(moduleId);
                let targetSubModule = '';
                if (((currentUser.role as string) === Role.USER || (currentUser.role as string) === 'USER') && currentUser.allowed_modules && currentUser.allowed_modules.length > 0) {
                    const firstItem = moduleConfig.items[0];
                    const isDefaultAllowed = firstItem && currentUser.allowed_modules.includes(firstItem.id);
                    if (!isDefaultAllowed) {
                        const firstAllowed = moduleConfig.items.find(item => currentUser.allowed_modules!.includes(item.id));
                        if (firstAllowed) targetSubModule = firstAllowed.id;
                    }
                }
                if (setSubModule) setSubModule(targetSubModule);
            }
            return;
        }

        // Module without sub-items: just navigate
        setActiveModule(moduleId);
        if (setSubModule) setSubModule('');
        setActiveDropdown(null);
    };

    const handleSubModuleClick = (moduleId: string, subId: string) => {
        setActiveModule(moduleId);
        if (setSubModule) setSubModule(subId);
        setActiveDropdown(null);
    };

    return (
        <header className="h-14 bg-white border-b border-slate-200/80 fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4">

            {/* LEFT: Company Logo */}
            <div className="flex items-center shrink-0 pr-4 border-r border-slate-100">
                <div className="h-9 w-auto flex items-center">
                    <img src={companyLogoSrc} alt="Logo" className="max-h-full max-w-[150px] object-contain" />
                </div>
            </div>

            {/* CENTER: Module Navigation */}
            <nav ref={navRef} className="flex-1 flex justify-center h-full items-center px-2">
                <ul className="flex items-center gap-0.5">
                    {visibleModules.map((mod) => {
                        const Icon = mod.icon;
                        const colors = getColors(mod.id);

                        let isActive = activeModule === mod.id;

                        if (currentUser.role === Role.CARGO_AGENT && activeModule === 'LOGISTICS') {
                            if (mod.id === 'CA_FREIGHT') isActive = (subModule === 'FREIGHT');
                            else if (mod.id === 'CA_BOOKINGS') isActive = (subModule === 'BOOKINGS');
                            else if (mod.id === 'CA_BL') isActive = (subModule === 'BL');
                        }

                        let displayItems = mod.items || [];
                        if (mod.id === 'SETTINGS' && currentUser.role !== Role.ADMIN && currentUser.role !== Role.CEO) {
                            displayItems = displayItems.filter(item => item.id === 'INTEGRATIONS');
                        }

                        if (((currentUser.role as string) === Role.USER || (currentUser.role as string) === 'USER') && currentUser.allowed_modules && currentUser.allowed_modules.length > 0) {
                            displayItems = displayItems.filter(item => {
                                if (currentUser.allowed_modules!.includes(item.id)) return true;
                                const matchingDockTask = AVAILABLE_TASKS.find(t => t.subModule === item.id && t.module === mod.id);
                                if (matchingDockTask && currentUser.allowed_modules!.includes(matchingDockTask.id)) return true;
                                return false;
                            });
                        }

                        // SALES role: hide Order-Sale Engine and Sale Brazil from Order-Sale dropdown
                        if (currentUser.role === Role.SALES && mod.id === 'COST_PROFIT_AI') {
                            displayItems = displayItems.filter(item => item.id !== 'ORDER_SALE' && item.id !== 'SALE_BRAZIL');
                        }

                        const hasItems = displayItems.length > 0;
                        const isDropdownOpen = activeDropdown === mod.id;

                        return (
                            <li
                                key={mod.id}
                                className="relative"
                            >
                                <button
                                    onClick={() => handleModuleClick(mod.id)}
                                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${isActive
                                        ? `${colors.activeBg} ${colors.activeText} shadow-sm`
                                        : `${colors.text} ${colors.bg}`
                                        }`}
                                >
                                    <Icon size={15} />
                                    <span className={isActive ? '' : 'hidden xl:inline'}>{mod.label}</span>
                                    {hasItems && <ChevronDown size={11} className={`transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />}
                                </button>

                                {hasItems && isDropdownOpen && (
                                    <div
                                        className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-56 bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-200/50 z-50 overflow-hidden"
                                    >
                                        <div className="py-1">
                                            {displayItems.map(subItem => {
                                                const SubIcon = subItem.icon;
                                                const isSubActive = subModule === subItem.id && activeModule === mod.id;
                                                return (
                                                    <React.Fragment key={subItem.id}>
                                                        {subItem.separatorBefore && (
                                                            <div className="my-1 border-t border-slate-200"></div>
                                                        )}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleSubModuleClick(mod.id, subItem.id);
                                                            }}
                                                            className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${isSubActive ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                                                        >
                                                            {SubIcon ? (
                                                                <div className={`p-1.5 rounded-lg ${colors.iconBg}`}>
                                                                    <SubIcon size={14} />
                                                                </div>
                                                            ) : (
                                                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${colors.iconBg}`}>
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-current"></div>
                                                                </div>
                                                            )}
                                                            <span className={`text-sm ${isSubActive ? 'font-semibold text-slate-900' : 'font-medium text-slate-600'}`}>{subItem.label}</span>
                                                        </button>
                                                        {subItem.separatorAfter && (
                                                            <div className="my-1 border-t border-slate-200"></div>
                                                        )}
                                                    </React.Fragment>
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




            {/* RIGHT: Notifications, User & Company */}
            <div className="flex items-center gap-3 shrink-0 pl-3 border-l border-slate-100">
                {/* Notification Center */}
                <NotificationCenter companyId={currentCompanyId} />

                {/* Company Switcher */}
                <div className="relative">
                    <div
                        onMouseEnter={() => canSwitchCompany && setShowCompanyMenu(true)}
                        onMouseLeave={() => setShowCompanyMenu(false)}
                    >
                        <button
                            disabled={!canSwitchCompany}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center border text-[10px] font-bold transition-all ${canSwitchCompany
                                ? 'bg-white border-slate-200 text-indigo-600 hover:border-indigo-300 hover:shadow-sm cursor-pointer'
                                : 'bg-slate-50 border-slate-200 text-slate-400 cursor-default'
                                }`}
                            title={currentCompany?.name || 'Select Company'}
                        >
                            {currentCompany?.name ? currentCompany.name.substring(0, 2).toUpperCase() : 'ALL'}
                        </button>

                        {showCompanyMenu && canSwitchCompany && (
                            <div className="absolute top-full right-0 mt-1.5 w-56 bg-white border border-slate-200 rounded-xl shadow-xl shadow-slate-200/50 z-50 overflow-hidden">
                                <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-bold text-slate-500 flex justify-between items-center">
                                    <span>Switch Workspace</span>
                                    <Layers size={11} />
                                </div>

                                {canViewAll && (
                                    <button
                                        onClick={() => {
                                            onSwitchCompany('ALL');
                                            setActiveModule('DASHBOARD');
                                            setShowCompanyMenu(false);
                                        }}
                                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50 flex items-center justify-between border-b border-slate-100"
                                    >
                                        <span className={currentCompanyId === 'ALL' ? 'text-indigo-600 font-bold' : 'text-slate-700'}>All Companies</span>
                                        {currentCompanyId === 'ALL' && <Check size={14} className="text-indigo-600" />}
                                    </button>
                                )}

                                <div className="max-h-72 overflow-y-auto">
                                    {selectableCompanies.length > 0 ? selectableCompanies.map(comp => (
                                        <button
                                            key={comp.id}
                                            onClick={() => {
                                                onSwitchCompany(comp.id);
                                                setShowCompanyMenu(false);
                                            }}
                                            className="w-full text-left px-3 py-2.5 text-sm hover:bg-slate-50 flex items-center justify-between transition-colors border-b border-slate-50 last:border-0"
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-6 h-6 rounded-md bg-indigo-50 flex items-center justify-center text-[10px] font-bold text-indigo-600">
                                                    {comp.name[0]}
                                                </div>
                                                <span className={comp.id === currentCompanyId ? 'text-indigo-600 font-semibold' : 'text-slate-700'}>{comp.name}</span>
                                            </div>
                                            {comp.id === currentCompanyId && <Check size={14} className="text-indigo-600" />}
                                        </button>
                                    )) : (
                                        <div className="p-3 text-xs text-slate-500 text-center">No companies assigned</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* User Profile */}
                <div className="text-right hidden md:block">
                    <p className="text-xs font-semibold text-slate-800 leading-tight">{currentUser.name}</p>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider">{currentUser.role}</p>
                </div>

                <button
                    onClick={onLogout}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title="Sign Out"
                >
                    <LogOut size={15} />
                </button>
            </div>
        </header>
    );
};

export default TopNavigation;
