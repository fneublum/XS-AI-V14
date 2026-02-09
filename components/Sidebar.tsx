import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Bot, ShoppingBag, TrendingUp, Map, Database, PieChart, Settings, Layers, ChevronDown, Check, LogOut, Calculator, UserCheck } from 'lucide-react';
import { User, Company, Role } from '../types';
import { getSupabaseClient } from '../services/supabase';

interface SidebarProps {
  activeModule: string;
  setActiveModule: (module: string) => void;
  currentUser: User;
  onLogout: () => void;
  availableCompanies: Company[];
  currentCompanyId: string;
  onSwitchCompany: (id: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  activeModule, 
  setActiveModule, 
  currentUser, 
  onLogout,
  availableCompanies,
  currentCompanyId,
  onSwitchCompany
}) => {
  const [showCompanyMenu, setShowCompanyMenu] = useState(false);
  const [companyLogoSrc, setCompanyLogoSrc] = useState<string>("https://placehold.co/200x60/1e293b/ffffff?text=XSOLUTION&font=montserrat");

  useEffect(() => {
    const fetchLogo = async () => {
        const client = getSupabaseClient();
        if (client) {
            let targetId = currentCompanyId;
            if (targetId === 'ALL') targetId = 'SYSTEM'; // Fallback to system logo

            const { data } = await client.from('imagens').select('url').eq('companyId', targetId).eq('type', 'LOGO').single();
            if (data && data.url) {
                setCompanyLogoSrc(data.url);
            } else if (currentCompanyId !== 'ALL') {
                 // Try system logo if company specific not found
                 const { data: sysData } = await client.from('imagens').select('url').eq('companyId', 'SYSTEM').eq('type', 'LOGO').single();
                 if (sysData && sysData.url) setCompanyLogoSrc(sysData.url);
            }
        }
    };
    fetchLogo();
  }, [currentCompanyId]);

  const currentCompany = availableCompanies.find(c => c.id === currentCompanyId);

  // CEO removed from global view to restrict to assigned company scope
  const canViewAll = currentUser.role === Role.ADMIN;
  
  // Calculate companies the user can switch to
  const selectableCompanies = currentUser.role === Role.ADMIN 
    ? availableCompanies 
    : availableCompanies.filter(c => (currentUser.allowed_company_ids || []).includes(c.id));

  // Allow switching if there are ANY companies to select (even just 1, so they can see which one they are on)
  const canSwitchCompany = selectableCompanies.length > 0;

  // Auto-select if user is restricted to exactly one company and hasn't selected it yet (stuck on ALL)
  useEffect(() => {
    if (!canViewAll && selectableCompanies.length === 1 && (currentCompanyId === 'ALL' || !currentCompanyId)) {
        onSwitchCompany(selectableCompanies[0].id);
    }
  }, [canViewAll, selectableCompanies, currentCompanyId, onSwitchCompany]);

  // The Umbrella Modules
  const modules = [
      { id: 'DASHBOARD', label: 'DASHBOARD', icon: LayoutDashboard },
      { id: 'AI_UPLOAD', label: 'AUTOMATION', icon: Bot },
      { id: 'BUY', label: 'PURCHASE', icon: ShoppingBag },
      { id: 'CALCULATOR', label: 'CALCULATOR', icon: Calculator },
      { id: 'SELL', label: 'SALE', icon: TrendingUp },
      { id: 'LOGISTICS', label: 'LOGISTICS', icon: Map },
      { id: 'DATA', label: 'DATA', icon: Database },
      { id: 'FINANCE', label: 'FINANCE', icon: PieChart },
      { id: 'CUSTOMER_PORTAL', label: 'CLIENT PORTAL', icon: UserCheck },
      { id: 'SETTINGS', label: 'SETTINGS', icon: Settings },
  ];

  // Refactored: Filter modules based on current context and user role
  const visibleModules = modules.filter(mod => {
      const role = currentUser.role;
      const isGlobalView = currentCompanyId === 'ALL';
  
      // 1. Role-based absolute overrides for external users
      if (role === Role.CARGO_AGENT) return mod.id === 'LOGISTICS';
      if (role === Role.CUSTOMER) return mod.id === 'CUSTOMER_PORTAL';
      
      // 2. Module-based absolute restrictions for internal users
      if (mod.id === 'SETTINGS') return role === Role.ADMIN;
      if (mod.id === 'FINANCE') return role === Role.ADMIN; // CEO cannot see FINANCE
      if (mod.id === 'CUSTOMER_PORTAL') return role === Role.ADMIN; // CEO cannot see CLIENT PORTAL for oversight
  
      // 3. Global View ('ALL' companies) restrictions
      if (isGlobalView) {
          if (role === Role.ADMIN) return true; // Admin sees all in global view (that weren't restricted above)
          if (role === Role.CEO) return true; // CEO also sees all remaining modules in global view
          
          // Stricter view for Manager/User in global context
          return mod.id === 'DASHBOARD' || mod.id === 'LOGISTICS';
      }
  
      // 4. Specific Company View
      if (role === Role.ADMIN || role === Role.CEO) return true; // They see everything not restricted in step 2.
  
      // 5. Manager/User in specific company view
      // Check against their allowed modules list
      return currentUser.allowed_modules === undefined || 
             (currentUser.allowed_modules && currentUser.allowed_modules.includes(mod.id));
  });

  return (
    <div className="w-64 bg-slate-900 text-white flex flex-col h-screen fixed left-0 top-0 z-10 shadow-xl">
      <div className="p-6 border-b border-slate-700">
        {/* Top Position: Current Company Logo */}
        <div className="mb-6 flex justify-center h-16 items-center">
            <img 
                src={companyLogoSrc} 
                alt="Company Logo" 
                className="max-w-full max-h-full object-contain"
            />
        </div>
        
        {/* Company Switcher */}
        <div className="relative">
            <button 
                onClick={() => canSwitchCompany && setShowCompanyMenu(!showCompanyMenu)}
                disabled={!canSwitchCompany}
                className={`w-full bg-slate-800 border border-slate-700 rounded-lg p-2 flex items-center justify-between text-left transition-colors ${canSwitchCompany ? 'hover:bg-slate-700 cursor-pointer' : 'cursor-default opacity-90'}`}
            >
                <div className="flex flex-col overflow-hidden">
                    <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Current Company</span>
                    <span className="text-sm font-medium truncate text-white block w-full flex items-center gap-2">
                        {(currentCompanyId === 'ALL' || (canViewAll && !currentCompanyId)) && <Layers size={14} className="text-blue-400"/>}
                        {currentCompany?.name || 'Select Company'}
                    </span>
                </div>
                {canSwitchCompany && (
                    <ChevronDown size={14} className={`text-slate-400 transition-transform ${showCompanyMenu ? 'rotate-180' : ''}`} />
                )}
            </button>
            
            {showCompanyMenu && canSwitchCompany && (
                <>
                <div className="fixed inset-0 z-10" onClick={() => setShowCompanyMenu(false)}></div>
                <div className="absolute top-full left-0 w-full mt-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-20 overflow-hidden">
                    {/* All Companies option - Only for Admins */}
                    {canViewAll && (
                        <button
                            onClick={() => {
                                onSwitchCompany('ALL');
                                setActiveModule('DASHBOARD');
                                setShowCompanyMenu(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-700 flex items-center justify-between border-b border-slate-700"
                        >
                            <span className={currentCompanyId === 'ALL' ? 'text-white' : 'text-slate-400'}>All Companies</span>
                            {currentCompanyId === 'ALL' && <Check size={14} className="text-blue-400" />}
                        </button>
                    )}
                    
                    {selectableCompanies.length > 0 ? selectableCompanies.map(comp => (
                        <button
                            key={comp.id}
                            onClick={() => {
                                onSwitchCompany(comp.id);
                                setShowCompanyMenu(false);
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-700 flex items-center justify-between"
                        >
                            <span className={comp.id === currentCompanyId ? 'text-white' : 'text-slate-400'}>{comp.name}</span>
                            {comp.id === currentCompanyId && <Check size={14} className="text-blue-400" />}
                        </button>
                    )) : (
                        <div className="p-3 text-xs text-slate-500">No companies assigned</div>
                    )}
                </div>
                </>
            )}
        </div>
      </div>
      
      {/* High Level Modules Navigation */}
      <nav className="flex-1 overflow-y-auto py-6">
        <ul className="space-y-2 px-3">
          {visibleModules.map((mod) => {
            const Icon = mod.icon;
            return (
                <li key={mod.id}>
                <button
                    onClick={() => setActiveModule(mod.id)}
                    className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl text-lg font-bold transition-all duration-200 group ${
                    activeModule === mod.id 
                        ? 'bg-sky-500 text-white shadow-lg shadow-sky-900/40 translate-x-1' 
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                >
                    <Icon size={24} className={activeModule === mod.id ? 'text-white' : 'text-slate-500 group-hover:text-white'} />
                    {mod.label}
                </button>
                </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-4 border-t border-slate-700 bg-slate-800/50">
        {/* User Info & Logout */}
        <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-sky-600 flex items-center justify-center text-white font-bold text-sm">
                {currentUser.avatarInitials}
            </div>
            <div className="overflow-hidden">
                <p className="text-sm font-bold text-white truncate">{currentUser.name}</p>
                <p className="text-xs text-slate-400 truncate">{currentUser.role}</p>
            </div>
        </div>
        <button onClick={onLogout} className="w-full flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors p-2 rounded hover:bg-slate-700">
            <LogOut size={16} /> Sign Out
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
