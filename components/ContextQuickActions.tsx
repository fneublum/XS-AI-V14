/**
 * ContextQuickActions — Module-aware quick action chips for AiCopilotSidebar
 *
 * Shows different action buttons depending on which module the user is viewing.
 * Replaces the static MODULE_SUGGESTIONS with dynamic, icon-rich action cards.
 */

import React, { useMemo } from 'react';
import { Zap, ArrowRight } from 'lucide-react';
import { CONTEXT_QUICK_ACTIONS, QuickAction } from '../services/smartInsightsEngine';

interface ContextQuickActionsProps {
  activeModule: string;
  onAction: (command: string) => void;
  compact?: boolean;
}

const CATEGORY_COLORS: Record<string, string> = {
  sales: 'from-indigo-50 to-blue-50 border-indigo-200 hover:border-indigo-300',
  logistics: 'from-teal-50 to-cyan-50 border-teal-200 hover:border-teal-300',
  finance: 'from-amber-50 to-yellow-50 border-amber-200 hover:border-amber-300',
  inventory: 'from-emerald-50 to-green-50 border-emerald-200 hover:border-emerald-300',
  crm: 'from-purple-50 to-violet-50 border-purple-200 hover:border-purple-300',
  pipeline: 'from-slate-50 to-gray-50 border-slate-200 hover:border-slate-300',
};

const ContextQuickActions: React.FC<ContextQuickActionsProps> = ({ activeModule, onAction, compact = false }) => {
  const actions = useMemo(() => {
    return CONTEXT_QUICK_ACTIONS[activeModule] || CONTEXT_QUICK_ACTIONS['DASHBOARD'];
  }, [activeModule]);

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {actions.map((action, i) => (
          <button
            key={i}
            onClick={() => onAction(action.command)}
            className="flex items-center gap-1.5 text-xs bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 px-3 py-1.5 rounded-full transition-all shadow-sm"
          >
            <span>{action.icon}</span>
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Zap size={12} className="text-amber-500" />
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Quick Actions</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action, i) => {
          const colorClass = CATEGORY_COLORS[action.category] || CATEGORY_COLORS['pipeline'];
          return (
            <button
              key={i}
              onClick={() => onAction(action.command)}
              className={`group text-left bg-gradient-to-br ${colorClass} border rounded-xl p-2.5 transition-all hover:shadow-sm`}
            >
              <div className="flex items-start justify-between">
                <span className="text-lg leading-none">{action.icon}</span>
                <ArrowRight size={12} className="text-slate-300 group-hover:text-slate-500 transition-colors mt-0.5" />
              </div>
              <div className="mt-1.5">
                <div className="text-xs font-semibold text-slate-700">{action.label}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{action.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ContextQuickActions;
