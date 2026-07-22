'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatDateTime, cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import { Shield, Search, Filter } from 'lucide-react';
import SearchableSelect from '@/components/ui/SearchableSelect';

type R = Record<string, unknown>;

const entityLabels: Record<string, string> = {
  expense: 'Gasto',
  product: 'Producto',
  sale: 'Venta',
  customer: 'Cliente',
  supplier: 'Proveedor',
  stock_movement: 'Ajuste de stock',
};

const entityColors: Record<string, string> = {
  expense: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  product: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  sale: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  customer: 'text-green-400 bg-green-500/10 border-green-500/20',
  supplier: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  stock_movement: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
};

const actionLabels: Record<string, string> = {
  delete: 'Eliminación',
  cancel: 'Cancelación',
  adjust: 'Ajuste',
  adjust_increase: 'Ajuste (+)',
  adjust_decrease: 'Ajuste (-)',
};

const actionColors: Record<string, string> = {
  delete: 'badge-danger',
  cancel: 'badge-warning',
  adjust: 'badge-info',
  adjust_increase: 'badge-success',
  adjust_decrease: 'badge-warning',
};

export default function AuditoriaPage() {
  const [logs, setLogs] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (entityFilter) params.set('entity_type', entityFilter);
      if (actionFilter) params.set('action', actionFilter);
      params.set('limit', '500');
      const data = await api.getAuditLogs(params.toString());
      setLogs(data);
    } catch (e) {
      console.error('Error al cargar logs de auditoría', e);
    } finally {
      setLoading(false);
    }
  }, [entityFilter, actionFilter]);

  useEffect(() => { load(); }, [load]);

  const paginated = pageSize === 0 ? logs : logs.slice(0, page * pageSize).slice((page - 1) * pageSize);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [entityFilter, actionFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-1 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />
            <div className="w-40">
              <SearchableSelect
                options={[
                  { value: '', label: 'Todos los tipos' },
                  ...Object.entries(entityLabels).map(([k, v]) => ({ value: k, label: v }))
                ]}
                value={entityFilter}
                onChange={v => setEntityFilter(v)}
                placeholder="Todos los tipos"
                noResultsMessage="Sin tipos"
              />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" />
            <div className="w-40">
              <SearchableSelect
                options={[
                  { value: '', label: 'Todas las acciones' },
                  ...Object.entries(actionLabels).map(([k, v]) => ({ value: k, label: v }))
                ]}
                value={actionFilter}
                onChange={v => setActionFilter(v)}
                placeholder="Todas las acciones"
                noResultsMessage="Sin acciones"
              />
            </div>
          </div>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">{logs.length} registro(s)</p>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : paginated.length === 0 ? (
          <EmptyState icon={Shield} title="Sin registros de auditoría" description="Aún no hay eliminaciones registradas" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-primary)]">
                  {['Fecha', 'Usuario', 'Acción', 'Tipo', 'Entidad', 'Detalles'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((log) => {
                  let detailsText = '';
                  let details: R | null = null;
                  try {
                    details = log.details ? (typeof log.details === 'string' ? JSON.parse(log.details as string) : log.details) as R : null;
                  } catch { details = null; }
                  if (details) {
                    if (details.old_stock !== undefined) detailsText = `Stock: ${details.old_stock} → ${details.new_stock} (Δ ${details.diff})`;
                    else if (details.quantity !== undefined) detailsText = `Cantidad: ${details.quantity}` + (details.reason ? ` · ${details.reason}` : '');
                    else if (details.amount) detailsText = `Monto: ${details.amount}`;
                    else if (details.balance !== undefined) detailsText = `Saldo: ${details.balance}`;
                    else if (details.total !== undefined) detailsText = `Total: $${Number(details.total).toFixed(2)}`;
                  }
                  return (
                    <tr key={String(log.id)} className="border-b border-[var(--border-primary)] last:border-0 table-row-hover">
                      <td className="px-4 py-3 text-[var(--text-secondary)] text-xs whitespace-nowrap">
                        {log.created_at ? formatDateTime(String(log.created_at)) : '—'}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-primary)] font-medium">{String(log.user_name ?? '—')}</td>
                      <td className="px-4 py-3">
                        <span className={cn('badge', actionColors[String(log.action)] ?? 'badge-info')}>
                          {actionLabels[String(log.action)] ?? String(log.action)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border', entityColors[String(log.entity_type)] ?? 'text-[var(--text-secondary)]')}>
                          {entityLabels[String(log.entity_type)] ?? String(log.entity_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--text-primary)]">{String(log.entity_name ?? '—')}</td>
                      <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{detailsText || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination currentPage={page} totalItems={logs.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>
    </div>
  );
}
