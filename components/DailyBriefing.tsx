/**
 * DailyBriefing — Morning intelligence card for XS Agent Dashboard
 *
 * Auto-shows on first login of the day. Displays:
 *  - Greeting + date
 *  - Key metrics (orders, AR, shipments, pipeline)
 *  - Overnight changes
 *  - Actionable highlights
 */

import React, { useState, useEffect } from 'react';
import { Sun, Moon, Sunrise, X, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, Clock, Zap, AlertTriangle, CheckCircle2, Info, ArrowRight } from 'lucide-react';
import { smartInsightsEngine, DailyBriefingData, InsightSeverity } from '../services/smartInsightsEngine';

interface DailyBriefingProps {
  companyId: string;
  userName: string;
  onActionCommand?: (command: string) => void;
  onDismiss?: () => void;
}

const SEVERITY_STYLES: Record<InsightSeverity, { bg: string; border: string; icon: React.ReactNode; text: string }> = {
  critical: { bg: 'bg-red-50', border: 'border-red-200', icon: <AlertTriangle size={14} className="text-red-500" />, text: 'text-red-700' },
  warning: { bg: 'bg-amber-50', border: 'border-amber-200', icon: <Clock size={14} className="text-amber-500" />, text: 'text-amber-700' },
  info: { bg: 'bg-blue-50', border: 'border-blue-200', icon: <Info size={14} className="text-blue-500" />, text: 'text-blue-700' },
  success: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: <CheckCircle2 size={14} className="text-emerald-500" />, text: 'text-emerald-700' },
};

const BRIEFING_STORAGE_KEY = 'xs_daily_briefing_date';

const DailyBriefing: React.FC<DailyBriefingProps> = ({ companyId, userName, onActionCommand, onDismiss }) => {
  const [briefing, setBriefing] = useState<DailyBriefingData | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if briefing was already shown today
    const today = new Date().toISOString().split('T')[0];
    const lastShown = sessionStorage.getItem(BRIEFING_STORAGE_KEY);
    if (lastShown === today) {
      setLoading(false);
      return;
    }

    const loadBriefing = async () => {
      try {
        const data = await smartInsightsEngine.generateDailyBriefing(companyId, userName);
        setBriefing(data);
        setIsVisible(true);
        sessionStorage.setItem(BRIEFING_STORAGE_KEY, today);
      } catch (err) {
        console.warn('[DailyBriefing] Error:', err);
      } finally {
        setLoading(false);
      }
    };

    loadBriefing();
  }, [companyId, userName]);

  const handleDismiss = () => {
    setIsVisible(false);
    onDismiss?.();
  };

  const handleAction = (command: string) => {
    onActionCommand?.(command);
  };

  const getGreetingIcon = () => {
    const hour = new Date().getHours();
    if (hour < 6) return <Moon size={18} className="text-indigo-400" />;
    if (hour < 12) return <Sunrise size={18} className="text-amber-400" />;
    if (hour < 18) return <Sun size={18} className="text-amber-500" />;
    return <Moon size={18} className="text-indigo-400" />;
  };

  const formatTimeAgo = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'just now';
    if (hours === 1) return '1h ago';
    return `${hours}h ago`;
  };

  if (loading || !isVisible || !briefing) return null;

  return (
    <div className="mb-3 animate-in slide-in-from-top duration-500">
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 rounded-2xl overflow-hidden shadow-xl border border-slate-700/50">

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getGreetingIcon()}
            <div>
              <h2 className="text-white font-bold text-base">{briefing.greeting}</h2>
              <p className="text-slate-400 text-xs">{briefing.date}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors"
            >
              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            <button
              onClick={handleDismiss}
              className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {isExpanded && (
          <>
            {/* Metrics Row */}
            <div className="px-5 pb-3 grid grid-cols-4 gap-3">
              {briefing.metrics.map((metric, i) => (
                <div key={i} className="bg-white/5 backdrop-blur rounded-xl p-3 border border-white/10">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">{metric.label}</span>
                    <span className="text-sm">{metric.icon}</span>
                  </div>
                  <div className="text-white font-bold text-sm">{metric.value}</div>
                  {metric.change !== undefined && (
                    <div className={`flex items-center gap-0.5 mt-0.5 text-[10px] ${
                      metric.trend === 'up' ? 'text-emerald-400' : metric.trend === 'down' ? 'text-red-400' : 'text-slate-400'
                    }`}>
                      {metric.trend === 'up' ? <TrendingUp size={10} /> : metric.trend === 'down' ? <TrendingDown size={10} /> : <Minus size={10} />}
                      <span>{Math.abs(metric.change)}%</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Overnight Changes */}
            {briefing.overnightChanges.length > 0 && (
              <div className="px-5 pb-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Clock size={12} className="text-indigo-400" />
                  <span className="text-[10px] font-semibold text-indigo-300 uppercase tracking-wider">While you were away</span>
                </div>
                <div className="space-y-1.5">
                  {briefing.overnightChanges.map((change, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-slate-300 bg-white/5 rounded-lg px-3 py-2">
                      <span className="text-slate-500">{formatTimeAgo(change.timestamp)}</span>
                      <span className="text-slate-600">|</span>
                      <span>{change.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Highlights / Action Items */}
            <div className="px-5 pb-4">
              <div className="flex items-center gap-1.5 mb-2">
                <Zap size={12} className="text-amber-400" />
                <span className="text-[10px] font-semibold text-amber-300 uppercase tracking-wider">Needs Attention</span>
              </div>
              <div className="space-y-2">
                {briefing.highlights.slice(0, 4).map((insight) => {
                  const style = SEVERITY_STYLES[insight.severity];
                  return (
                    <div key={insight.id} className={`flex items-start gap-2.5 ${style.bg} ${style.border} border rounded-xl px-3 py-2.5`}>
                      <div className="mt-0.5 shrink-0">{style.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-semibold ${style.text}`}>{insight.title}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5 truncate">{insight.description}</div>
                      </div>
                      {insight.actionCommand && (
                        <button
                          onClick={() => handleAction(insight.actionCommand!)}
                          className="shrink-0 text-[10px] font-medium text-indigo-600 hover:text-indigo-800 bg-white/80 hover:bg-white px-2 py-1 rounded-lg flex items-center gap-1 transition-colors"
                        >
                          {insight.actionLabel || 'Act'}
                          <ArrowRight size={10} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DailyBriefing;
