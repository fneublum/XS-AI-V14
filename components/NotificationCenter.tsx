import React, { useState, useEffect, useRef } from 'react';
import {
  Bell, X, Check, CheckCheck, Trash2,
  AlertTriangle, Info, CheckCircle, XCircle,
  Zap, TrendingUp, Package, DollarSign, Truck, Settings, Brain,
} from 'lucide-react';
import { notificationService, Notification, NotificationCategory, NotificationType } from '../services/notificationService';

interface NotificationCenterProps {
  companyId: string;
}

const CATEGORY_ICONS: Record<NotificationCategory, React.ElementType> = {
  sales: TrendingUp,
  procurement: Package,
  logistics: Truck,
  finance: DollarSign,
  inventory: Package,
  system: Settings,
  ai: Brain,
  general: Info,
};

const CATEGORY_COLORS: Record<NotificationCategory, string> = {
  sales: 'bg-violet-50 text-violet-600',
  procurement: 'bg-blue-50 text-blue-600',
  logistics: 'bg-orange-50 text-orange-600',
  finance: 'bg-amber-50 text-amber-600',
  inventory: 'bg-cyan-50 text-cyan-600',
  system: 'bg-slate-50 text-slate-600',
  ai: 'bg-rose-50 text-rose-600',
  general: 'bg-gray-50 text-gray-600',
};

const TYPE_ICONS: Record<NotificationType, React.ElementType> = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
  action: Zap,
  workflow: Zap,
};

const TYPE_COLORS: Record<NotificationType, string> = {
  info: 'text-blue-500',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  error: 'text-red-500',
  action: 'text-violet-500',
  workflow: 'text-indigo-500',
};

const NotificationCenter: React.FC<NotificationCenterProps> = ({ companyId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [filter, setFilter] = useState<NotificationCategory | 'all'>('all');
  const panelRef = useRef<HTMLDivElement>(null);

  // Subscribe to notification updates
  useEffect(() => {
    // Load from storage on mount
    notificationService.loadFromStorage();

    const unsubscribe = notificationService.subscribe((notifs) => {
      setNotifications(notifs);
    });

    // Initial load
    setNotifications(notificationService.getVisible(companyId));

    // Start alert checks
    if (companyId && companyId !== 'ALL') {
      notificationService.startAlertChecks(companyId);
    }

    return () => {
      unsubscribe();
      notificationService.stopAlertChecks();
    };
  }, [companyId]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const unreadCount = notifications.filter(n => !n.read).length;
  const filteredNotifications = filter === 'all'
    ? notifications
    : notifications.filter(n => n.category === filter);

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  };

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        title="Notifications"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center min-w-[18px] h-[18px] px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-96 max-h-[70vh] bg-white border border-slate-200 rounded-xl shadow-2xl shadow-slate-300/30 z-[100] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell size={16} className="text-slate-600" />
              <span className="text-sm font-bold text-slate-800">Notifications</span>
              {unreadCount > 0 && (
                <span className="bg-red-100 text-red-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => notificationService.markAllRead(companyId)}
                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="Mark all as read"
              >
                <CheckCheck size={14} />
              </button>
              <button
                onClick={() => notificationService.dismissAll(companyId)}
                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                title="Clear all"
              >
                <Trash2 size={14} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Category Filter */}
          <div className="px-3 py-2 bg-white border-b border-slate-100 flex gap-1 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors ${
                filter === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              All
            </button>
            {(['sales', 'logistics', 'finance', 'inventory', 'procurement', 'system', 'ai'] as NotificationCategory[]).map(cat => {
              const count = notifications.filter(n => n.category === cat && !n.read).length;
              return (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors flex items-center gap-1 ${
                    filter === cat ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  {count > 0 && (
                    <span className={`text-[9px] ${filter === cat ? 'text-slate-300' : 'text-slate-400'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Notification List */}
          <div className="flex-1 overflow-y-auto">
            {filteredNotifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={32} className="text-slate-200 mx-auto mb-2" />
                <p className="text-sm text-slate-400">No notifications</p>
                <p className="text-xs text-slate-300 mt-1">Automations will appear here</p>
              </div>
            ) : (
              filteredNotifications.map(notif => {
                const TypeIcon = TYPE_ICONS[notif.type] || Info;
                const CatIcon = CATEGORY_ICONS[notif.category] || Info;
                const typeColor = TYPE_COLORS[notif.type] || 'text-slate-500';
                const catColor = CATEGORY_COLORS[notif.category] || 'bg-slate-50 text-slate-600';

                return (
                  <div
                    key={notif.id}
                    className={`px-4 py-3 border-b border-slate-50 hover:bg-slate-50/50 transition-colors cursor-pointer ${
                      !notif.read ? 'bg-blue-50/30' : ''
                    }`}
                    onClick={() => {
                      notificationService.markRead(notif.id);
                      if (notif.actionUrl) {
                        // Navigation would be handled by parent
                      }
                    }}
                  >
                    <div className="flex items-start gap-3">
                      {/* Type Icon */}
                      <div className={`mt-0.5 ${typeColor}`}>
                        <TypeIcon size={16} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-bold text-slate-800 truncate">{notif.title}</span>
                          {!notif.read && (
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">
                          {notif.message}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold ${catColor}`}>
                            <CatIcon size={9} />
                            {notif.category.toUpperCase()}
                          </span>
                          <span className="text-[10px] text-slate-300">{timeAgo(notif.createdAt)}</span>
                        </div>
                      </div>

                      {/* Dismiss */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          notificationService.dismiss(notif.id);
                        }}
                        className="p-1 text-slate-300 hover:text-red-400 rounded transition-colors shrink-0"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          {filteredNotifications.length > 0 && (
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-center">
              <span className="text-[10px] text-slate-400">
                {filteredNotifications.length} notification{filteredNotifications.length !== 1 ? 's' : ''}
                {unreadCount > 0 ? ` (${unreadCount} unread)` : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationCenter;
