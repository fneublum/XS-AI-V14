import React from 'react';
import { LucideIcon } from 'lucide-react';

interface NavItemProps {
  item: {
    id: string;
    label: string;
    icon: LucideIcon;
    color?: string;
  };
  isActive: boolean;
  onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ item, isActive, onClick }) => {
  const Icon = item.icon;
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive 
            ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' 
            : `${item.color || 'text-slate-400'} hover:text-white hover:bg-slate-800`
        }`}
      >
        <Icon size={18} />
        {item.label}
      </button>
    </li>
  );
};

export default NavItem;
