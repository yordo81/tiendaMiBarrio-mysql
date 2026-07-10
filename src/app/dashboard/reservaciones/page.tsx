'use client';

import { useEffect, useState, useCallback } from 'react';
import { formatDateTime, cn } from '@/lib/utils';
import { toast } from '@/components/ui/toaster';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import { CalendarCheck, X, Check, Search, Package } from 'lucide-react';
import type { Reservation } from '@/types';

const statusLabels: Record<string, { label: string; color: string }> = {
  pending:   { label: 'Pendiente', color: 'badge-warning' },
  confirmed: { label: 'Confirmada', color: 'badge-success' },
  cancelled: { label: 'Cancelada',  color: 'badge-danger' },
};

export default function ReservacionesPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQuantity, setEditQuantity] = useState(1);
  const [savingQty, setSavingQty] = useState(false);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString();
      const res = await fetch(`/api/reservations${qs ? '?' + qs : ''}`);
      const data = await res.json();
      setReservations(Array.isArray(data) ? data : []);
    } catch { toast.error('Error al cargar reservaciones'); setReservations([]); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(id: string, status: string) {
    try {
      const res = await fetch('/api/reservations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error('Error al actualizar');
      toast.success(status === 'confirmed' ? 'Reservación confirmada' : 'Reservación cancelada');
      setEditingId(null);
      setEditingNotesId(null);
      load();
    } catch { toast.error('Error al actualizar reservación'); }
  }

  function startEdit(r: Reservation) {
    setEditingId(r.id);
    setEditQuantity(Number(r.quantity));
    setEditingNotesId(null);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function startEditNotes(r: Reservation) {
    setEditingNotesId(r.id);
    setEditNotes(r.notes ?? '');
    setEditingId(null);
  }

  function cancelEditNotes() {
    setEditingNotesId(null);
  }

  async function handleSaveNotes(id: string) {
    setSavingNotes(true);
    try {
      const res = await fetch('/api/reservations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, notes: editNotes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al actualizar notas');
      toast.success('Notas actualizadas correctamente');
      setEditingNotesId(null);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error al actualizar notas'); }
    finally { setSavingNotes(false); }
  }

  async function handleSaveQuantity(id: string) {
    if (editQuantity <= 0) {
      toast.error('La cantidad debe ser mayor a 0');
      return;
    }
    setSavingQty(true);
    try {
      const res = await fetch('/api/reservations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, quantity: editQuantity }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error al actualizar cantidad');
      toast.success('Cantidad actualizada correctamente');
      setEditingId(null);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error al actualizar cantidad'); }
    finally { setSavingQty(false); }
  }

  const filtered = reservations.filter(r => {
    const matchSearch = !search
      || String(r.customer_name ?? '').toLowerCase().includes(search.toLowerCase())
      || String(r.product_name ?? '').toLowerCase().includes(search.toLowerCase())
      || String(r.customer_phone ?? '').toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });

  const paginated = pageSize === 0 ? filtered : filtered.slice(0, page * pageSize).slice((page - 1) * pageSize);

  // Reset page on filters
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const counts = {
    total: reservations.length,
    pending: reservations.filter(r => r.status === 'pending').length,
    confirmed: reservations.filter(r => r.status === 'confirmed').length,
    cancelled: reservations.filter(r => r.status === 'cancelled').length,
  };

  return (
    <div className="space-y-5">
      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-4">
          <p className="text-xs text-[#6e7681] mb-1">Total</p>
          <p className="text-2xl font-semibold text-[#e6edf3]">{counts.total}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-[#6e7681] mb-1">Pendientes</p>
          <p className="text-2xl font-semibold text-yellow-400">{counts.pending}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-[#6e7681] mb-1">Confirmadas</p>
          <p className="text-2xl font-semibold text-green-400">{counts.confirmed}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-[#6e7681] mb-1">Canceladas</p>
          <p className="text-2xl font-semibold text-red-400">{counts.cancelled}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e7681]" />
            <input
              className="input pl-9"
              placeholder="Buscar cliente, producto o teléfono..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select className="input w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="pending">Pendientes</option>
            <option value="confirmed">Confirmadas</option>
            <option value="cancelled">Canceladas</option>
          </select>
        </div>
        <p className="text-sm text-[#8b949e]">{filtered.length} reservación(es)</p>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : paginated.length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="Sin reservaciones"
            description={search || statusFilter ? 'Intenta con otros filtros' : 'Aún no hay reservaciones de clientes'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#21262d]">
                  {['Fecha', 'Producto', 'Cliente', 'Teléfono', 'Cant.', 'Estado', 'Notas', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-[#8b949e] uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((r) => {
                  const st = statusLabels[r.status] ?? { label: r.status, color: 'badge-info' };
                  return (
                    <tr key={r.id} className="border-b border-[#21262d] last:border-0 table-row-hover">
                      <td className="px-4 py-3 text-[#8b949e] text-xs whitespace-nowrap">
                        {r.created_at ? formatDateTime(r.created_at) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Package className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" />
                          <span className="text-[#e6edf3] font-medium">{r.product_name ?? '—'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#e6edf3]">{r.customer_name}</td>
                      <td className="px-4 py-3 text-[#8b949e] text-xs">{r.customer_phone ?? '—'}</td>
                      <td className="px-4 py-3">
                        {editingId === r.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setEditQuantity(Math.max(1, editQuantity - 1))}
                              disabled={editQuantity <= 1 || savingQty}
                              className="w-7 h-7 bg-[#21262d] hover:bg-[#2d333b] disabled:opacity-30 rounded-lg flex items-center justify-center text-[#e6edf3] transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                              </svg>
                            </button>
                            <span className="w-10 text-center text-sm font-semibold text-[#e6edf3]">{editQuantity}</span>
                            <button
                              onClick={() => setEditQuantity(editQuantity + 1)}
                              disabled={savingQty}
                              className="w-7 h-7 bg-[#21262d] hover:bg-[#2d333b] disabled:opacity-30 rounded-lg flex items-center justify-center text-[#e6edf3] transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleSaveQuantity(r.id)}
                              disabled={savingQty}
                              className="p-1.5 rounded-lg text-green-400 hover:bg-green-500/10 transition-colors"
                              title="Guardar"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={savingQty}
                              className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                              title="Cancelar"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-[#e6edf3] font-medium">{Number(r.quantity)}</span>
                            {r.status === 'pending' && (
                              <button
                                onClick={() => startEdit(r)}
                                className="p-0.5 rounded text-[#6e7681] hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                                title="Editar cantidad"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center gap-1', st.color)}>
                          {r.status === 'confirmed' && <Check className="w-3 h-3" />}
                          {r.status === 'cancelled' && <X className="w-3 h-3" />}
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs max-w-[140px]">
                        {editingNotesId === r.id ? (
                          <div className="flex items-center gap-1">
                            <input
                              className="input text-xs py-1.5 px-2 w-full"
                              value={editNotes}
                              onChange={e => setEditNotes(e.target.value)}
                              placeholder="Sin notas"
                              disabled={savingNotes}
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveNotes(r.id)}
                              disabled={savingNotes}
                              className="p-1 rounded text-green-400 hover:bg-green-500/10 transition-colors flex-shrink-0"
                              title="Guardar"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </button>
                            <button
                              onClick={cancelEditNotes}
                              disabled={savingNotes}
                              className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                              title="Cancelar"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 group">
                            <span className="text-[#6e7681] truncate block max-w-[100px]">{r.notes || '—'}</span>
                            {r.status === 'pending' && (
                              <button
                                onClick={() => startEditNotes(r)}
                                className="p-0.5 rounded text-[#6e7681] opacity-0 group-hover:opacity-100 hover:text-brand-400 hover:bg-brand-500/10 transition-all flex-shrink-0"
                                title="Editar notas"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.status === 'pending' && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => updateStatus(r.id, 'confirmed')}
                              className="p-1.5 rounded-lg text-[#6e7681] hover:text-green-400 hover:bg-green-500/10 transition-colors"
                              title="Confirmar"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => updateStatus(r.id, 'cancelled')}
                              className="p-1.5 rounded-lg text-[#6e7681] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              title="Cancelar"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          currentPage={page}
          totalItems={filtered.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </div>
  );
}
