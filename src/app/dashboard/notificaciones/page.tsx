'use client';
import { useEffect, useState, useCallback } from 'react';
import { cn, timeAgo } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/toaster';
import {
  Bell, BellOff, AlertTriangle, Calendar, Info, CheckCircle,
  X, Filter, RefreshCw, Trash2, EyeOff, Trash
} from 'lucide-react';
import SearchableSelect from '@/components/ui/SearchableSelect';

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

const severityConfig: Record<string, { icon: React.ElementType; bg: string; border: string; text: string; label: string }> = {
  critical: { icon: AlertTriangle, bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400', label: 'Crítica' },
  warning:  { icon: AlertTriangle, bg: 'bg-orange-500/10', border: 'border-orange-500/20', text: 'text-orange-400', label: 'Advertencia' },
  info:     { icon: Calendar,       bg: 'bg-blue-500/10',    border: 'border-blue-500/20',    text: 'text-blue-400', label: 'Información' },
  success:  { icon: CheckCircle,    bg: 'bg-green-500/10',   border: 'border-green-500/20',   text: 'text-green-400', label: 'Éxito' },
};

const typeLabels: Record<string, string> = {
  expiration_5d: 'Vence en 5 días',
  expiration_5d_lowstock: 'Vence en 5 días + Stock bajo',
  expiration_15d: 'Vence en 15 días',
  expiration_15d_lowstock: 'Vence en 15 días + Stock bajo',
  expiration_30d: 'Vence en 30 días',
  expiration_30d_lowstock: 'Vence en 30 días + Stock bajo',
  expired: 'Vencido',
  expired_instock: 'Vencido en stock',
  low_stock: 'Stock bajo',
  out_of_stock: 'Agotado',
};

export default function NotificacionesPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [dismissingAll, setDismissingAll] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);

  // Confirmation dialogs
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  // Filters
  const [dismissedFilter, setDismissedFilter] = useState('0');
  const [severityFilter, setSeverityFilter] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('dismissed', dismissedFilter);
      if (severityFilter) params.set('severity', severityFilter);
      params.set('limit', String(pageSize));
      params.set('offset', String((page - 1) * pageSize));

      const res = await fetch(`/api/notifications?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setTotal(data.total ?? 0);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [dismissedFilter, severityFilter, page, pageSize]);

  useEffect(() => { fetchNotifications(); }, [fetchNotifications]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [dismissedFilter, severityFilter]);

  const dismiss = async (id: string) => {
    setDismissing(id);
    try {
      const res = await fetch('/api/notifications/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('Error al descartar');
      setNotifications(prev => prev.filter(n => n.id !== id));
      setTotal(prev => Math.max(0, prev - 1));
      toast.success('Notificación descartada');
    } catch { toast.error('Error al descartar'); }
    finally { setDismissing(null); }
  };

  const dismissAll = async () => {
    if (dismissedFilter === '1') return;
    setDismissingAll(true);
    try {
      const res = await fetch('/api/notifications/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error('Error');
      setNotifications([]);
      setTotal(0);
      toast.success('Todas las notificaciones fueron descartadas');
    } catch { toast.error('Error al descartar todas'); }
    finally { setDismissingAll(false); }
  };

  // ── Delete permanently ──────────────────────────────────────────

  const deleteNotification = async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch('/api/notifications/dismiss', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('Error al eliminar');
      setNotifications(prev => prev.filter(n => n.id !== id));
      setTotal(prev => Math.max(0, prev - 1));
      toast.success('Notificación eliminada permanentemente');
    } catch { toast.error('Error al eliminar'); }
    finally { setDeleting(null); }
  };

  const deleteAllDismissed = async () => {
    setDeletingAll(true);
    setConfirmDeleteAll(false);
    try {
      const res = await fetch('/api/notifications/dismiss', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error('Error');
      setNotifications([]);
      setTotal(0);
      toast.success('Historial limpiado permanentemente');
    } catch { toast.error('Error al limpiar historial'); }
    finally { setDeletingAll(false); }
  };

  const severityCounts = {
    critical: notifications.filter(n => n.severity === 'critical').length,
    warning: notifications.filter(n => n.severity === 'warning').length,
    info: notifications.filter(n => n.severity === 'info').length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-500/15 border border-brand-500/30 flex items-center justify-center">
            <Bell className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Notificaciones</h2>
            <p className="text-xs text-[var(--text-tertiary)]">
              {dismissedFilter === '1'
                ? `${total} notificaciones en el historial`
                : `${total} activa(s)${severityCounts.critical > 0 ? ` · ${severityCounts.critical} crítica(s)` : ''}${severityCounts.warning > 0 ? ` · ${severityCounts.warning} advertencia(s)` : ''}`
              }
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {dismissedFilter !== '1' && total > 0 && (
            <button
              onClick={dismissAll}
              disabled={dismissingAll}
              className="btn-secondary flex items-center gap-2 text-xs"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {dismissingAll ? 'Descartando...' : 'Descartar todas'}
            </button>
          )}
          {dismissedFilter === '1' && total > 0 && (
            <button
              onClick={() => setConfirmDeleteAll(true)}
              disabled={deletingAll}
              className="btn-secondary flex items-center gap-2 text-xs text-red-400 border-red-500/20 hover:bg-red-500/10"
            >
              <Trash className="w-3.5 h-3.5" />
              {deletingAll ? 'Eliminando...' : 'Limpiar historial'}
            </button>
          )}
          <button
            onClick={fetchNotifications}
            disabled={loading}
            className="btn-secondary flex items-center gap-2 text-xs"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-1.5">
          <Filter className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />
          <div className="w-36">
            <SearchableSelect
              options={[
                { value: '0', label: 'Activas' },
                { value: '1', label: 'Historial' },
                { value: 'all', label: 'Todas' },
              ]}
              value={dismissedFilter}
              onChange={v => setDismissedFilter(v)}
              placeholder="Estado"
              noResultsMessage="Sin opciones"
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />
          <div className="w-44">
            <SearchableSelect
              options={[
                { value: '', label: 'Todas las severidades' },
                { value: 'critical', label: 'Crítica' },
                { value: 'warning', label: 'Advertencia' },
                { value: 'info', label: 'Información' },
                { value: 'success', label: 'Éxito' },
              ]}
              value={severityFilter}
              onChange={v => setSeverityFilter(v)}
              placeholder="Todas las severidades"
              noResultsMessage="Sin opciones"
            />
          </div>
        </div>
      </div>

      {/* Notifications List */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title={dismissedFilter === '1' ? 'Sin historial' : 'Sin notificaciones activas'}
            description={
              dismissedFilter === '1'
                ? 'No hay notificaciones descartadas en el historial'
                : 'Todas las notificaciones están al día. Las alertas de vencimiento y stock bajo aparecerán aquí.'
            }
          />
        ) : (
          <div className="divide-y divide-[var(--border-primary)]">
            {notifications.map(n => {
              const cfg = severityConfig[n.severity] ?? severityConfig.info;
              const Icon = cfg.icon;
              return (
                <div
                  key={n.id}
                  className={cn(
                    'flex gap-4 px-5 py-4 transition-colors hover:bg-[var(--bg-tertiary)] group',
                    n.severity === 'critical' && 'bg-red-500/[0.02]',
                    n.read_at && 'opacity-60'
                  )}
                >
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border', cfg.bg, cfg.border)}>
                    <Icon className={cn('w-5 h-5', cfg.text)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {n.product_id ? (
                          <a
                            href={`/dashboard/productos/${n.product_id}`}
                            className="text-sm font-medium text-[var(--text-primary)] leading-snug hover:text-brand-400 transition-colors"
                          >
                            {n.title}
                          </a>
                        ) : (
                          <p className="text-sm font-medium text-[var(--text-primary)] leading-snug">{n.title}</p>
                        )}
                        <p className="text-xs text-[var(--text-tertiary)] mt-1 leading-relaxed">{n.message}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {n.read_at ? (
                          <>
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--bg-muted)] text-[10px] text-[var(--text-tertiary)] border border-[var(--border-secondary)]">
                              <EyeOff className="w-3 h-3" />
                              Leída
                            </span>
                            <button
                              onClick={() => setConfirmDeleteId(n.id)}
                              disabled={deleting === n.id}
                              className="p-1.5 rounded-lg text-red-400/60 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-30"
                              title="Eliminar permanentemente"
                            >
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : dismissedFilter !== '1' && (
                          <button
                            onClick={() => dismiss(n.id)}
                            disabled={dismissing === n.id}
                            className="p-1.5 rounded-lg text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-all disabled:opacity-30"
                            title="Descartar"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border',
                        cfg.bg, cfg.border, cfg.text
                      )}>
                        <Icon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                      {n.type && typeLabels[n.type] && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[var(--bg-muted)] text-[10px] text-[var(--text-tertiary)] border border-[var(--border-secondary)]">
                          {typeLabels[n.type]}
                        </span>
                      )}
                      <span className="text-[10px] text-[var(--text-tertiary)] opacity-60 ml-auto">
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <Pagination
          currentPage={page}
          totalItems={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {/* Confirm delete individual */}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) deleteNotification(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        title="Eliminar notificación"
        message="¿Estás seguro de eliminar esta notificación permanentemente? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        loading={deleting !== null}
      />

      {/* Confirm delete all history */}
      <ConfirmDialog
        open={confirmDeleteAll}
        onClose={() => setConfirmDeleteAll(false)}
        onConfirm={deleteAllDismissed}
        title="Limpiar historial"
        message="¿Estás seguro de eliminar permanentemente todas las notificaciones descartadas? Esta acción no se puede deshacer."
        confirmLabel="Limpiar todo"
        loading={deletingAll}
      />
    </div>
  );
}
