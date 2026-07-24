'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, BellOff, X, AlertTriangle, Calendar, Info, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/utils';

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: 'critical' | 'warning' | 'info' | 'success';
  product_id: string | null;
  created_at: string;
  read_at: string | null;
};

const severityConfig: Record<string, { icon: React.ElementType; bg: string; border: string; text: string }> = {
  critical: { icon: AlertTriangle, bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400' },
  warning:  { icon: AlertTriangle, bg: 'bg-orange-500/10', border: 'border-orange-500/20', text: 'text-orange-400' },
  info:     { icon: Calendar,       bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-400' },
  success:  { icon: CheckCircle,    bg: 'bg-green-500/10',   border: 'border-green-500/20',   text: 'text-green-400' },
};

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/notifications/check-expiration');
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.total_active ?? 0);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  // Fetch al montar y cada 2 minutos
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 120_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const dismiss = async (id: string) => {
    setDismissing(id);
    try {
      await fetch('/api/notifications/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setNotifications(prev => prev.filter(n => n.id !== id));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
    finally { setDismissing(null); }
  };

  const dismissAll = async () => {
    try {
      await fetch('/api/notifications/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      setNotifications([]);
      setUnreadCount(0);
      setOpen(false);
    } catch { /* ignore */ }
  };

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        bellRef.current &&
        !bellRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const severityCounts = {
    critical: notifications.filter(n => n.severity === 'critical').length,
    warning: notifications.filter(n => n.severity === 'warning').length,
    info: notifications.filter(n => n.severity === 'info').length,
  };

  return (
    <div className="relative">
      <button
        ref={bellRef}
        onClick={() => setOpen(!open)}
        className={cn(
          'relative p-2 rounded-xl transition-all duration-200',
          open
            ? 'bg-brand-500/15 text-brand-400 border border-brand-500/30'
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] border border-transparent'
        )}
        title="Notificaciones"
      >
        {unreadCount > 0 ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4.5 h-4.5 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center ring-2 ring-[var(--bg-primary)] leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={dropdownRef}
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 max-h-[70vh] overflow-hidden rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-primary)] shadow-2xl shadow-black/30 z-50 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Notificaciones</h3>
              <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                {unreadCount > 0
                  ? `${unreadCount} sin leer${severityCounts.critical > 0 ? ` · ${severityCounts.critical} críticas` : ''}`
                  : 'Todo al día'}
              </p>
            </div>
            <div className="flex gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={dismissAll}
                  className="text-[10px] font-medium text-brand-400 hover:text-brand-300 px-2 py-1 rounded-lg hover:bg-brand-500/10 transition-colors"
                >
                  Leer todas
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {loading && notifications.length === 0 ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 bg-[var(--bg-muted)] rounded-lg animate-pulse" />
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-[var(--text-tertiary)]">
                <BellOff className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm font-medium">Sin notificaciones</p>
                <p className="text-xs mt-0.5">Las alertas de vencimiento aparecerán aquí</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-primary)]">
                {notifications.map(n => {
                  const cfg = severityConfig[n.severity] ?? severityConfig.info;
                  const Icon = cfg.icon;
                  return (
                    <div
                      key={n.id}
                      className={cn(
                        'flex gap-3 px-4 py-3 transition-colors hover:bg-[var(--bg-tertiary)] group',
                        n.severity === 'critical' && 'bg-red-500/[0.02]'
                      )}
                    >
                      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border', cfg.bg, cfg.border)}>
                        <Icon className={cn('w-4 h-4', cfg.text)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[var(--text-primary)] leading-snug">{n.title}</p>
                        <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5 leading-relaxed line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-[var(--text-tertiary)] mt-1 opacity-60">
                          {timeAgo(n.created_at)}
                        </p>
                      </div>
                      <button
                        onClick={() => dismiss(n.id)}
                        disabled={dismissing === n.id}
                        className="flex-shrink-0 p-1 rounded-lg text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-all disabled:opacity-30"
                        title="Descartar"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
              <p className="text-[10px] text-[var(--text-tertiary)] text-center">
                Las notificaciones se actualizan cada 2 minutos
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
