'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatDateTime, formatNumber, cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import { List, Filter, X, RefreshCw, Calendar, Package, Warehouse, MoveHorizontal, ArrowRightLeft } from 'lucide-react';
type R = Record<string,unknown>;

const movLabel:Record<string,string> = {
  entrada:'Entrada', salida:'Salida', traslado_out:'Traslado (salida)',
  traslado_in:'Traslado (entrada)', venta:'Venta', ajuste:'Ajuste', gasto:'Gasto',
};
const movColor:Record<string,string> = {
  entrada:'text-green-400', salida:'text-red-400', traslado_out:'text-orange-400',
  traslado_in:'text-blue-400', venta:'text-purple-400', ajuste:'text-yellow-400', gasto:'text-orange-400',
};
const movBg:Record<string,string> = {
  entrada:'bg-green-500/10 border-green-500/20', salida:'bg-red-500/10 border-red-500/20',
  traslado_out:'bg-orange-500/10 border-orange-500/20', traslado_in:'bg-blue-500/10 border-blue-500/20',
  venta:'bg-purple-500/10 border-purple-500/20', ajuste:'bg-yellow-500/10 border-yellow-500/20',
  gasto:'bg-orange-500/10 border-orange-500/20',
};

export default function MovimientosPage() {
  const [movements, setMovements] = useState<R[]>([]);
  const [locations, setLocations] = useState<R[]>([]);
  const [products, setProducts] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [typeFilter, setTypeFilter] = useState('');
  const [locFilter, setLocFilter] = useState('');
  const [prodFilter, setProdFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const hasActiveFilters = typeFilter || locFilter || prodFilter || fromDate || toDate;

  // Client-side type filter
  const filteredMovements = typeFilter ? movements.filter(m => String(m.type) === typeFilter) : movements;

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const paginated = pageSize === 0 ? filteredMovements : filteredMovements.slice(0, page * pageSize).slice((page - 1) * pageSize);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [typeFilter, locFilter, prodFilter, fromDate, toDate]);

  const load = useCallback(async () => {
    setLoading(true);
    const params: { location_id?: string; product_id?: string; from?: string; to?: string } = {};
    if (locFilter) params.location_id = locFilter;
    if (prodFilter) params.product_id = prodFilter;
    if (fromDate) params.from = fromDate;
    if (toDate) params.to = toDate;
    try {
      const [moves, locs, prods] = await Promise.all([
        api.getMovementsFiltered(params),
        api.getLocations(),
        api.getProducts(),
      ]);
      setMovements(moves);
      setLocations(locs);
      setProducts(prods);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [locFilter, prodFilter, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  function clearFilters() {
    setTypeFilter('');
    setLocFilter('');
    setProdFilter('');
    setFromDate('');
    setToDate('');
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-display font-semibold text-[#e6edf3] flex items-center gap-2">
            <MoveHorizontal className="w-5 h-5 text-brand-400" />
            Movimientos de stock
          </h1>
          <p className="text-sm text-[#8b949e] mt-1">
            {filteredMovements.length} movimiento(s) encontrado(s)
            {typeFilter && ` · ${movLabel[typeFilter] ?? typeFilter}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn('btn-secondary flex items-center gap-2 text-sm', showFilters && 'ring-1 ring-brand-500/50')}
          >
            <Filter className="w-4 h-4" />
            Filtros
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-brand-500" />
            )}
          </button>
          <button onClick={load} className="btn-secondary p-2.5" title="Actualizar">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="card p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-[#e6edf3] flex items-center gap-2">
              <Filter className="w-4 h-4 text-brand-400" />
              Filtros
            </h3>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1">
                <X className="w-3 h-3" />
                Limpiar filtros
              </button>
            )}
          </div>
          {/* Type filter — badge-style buttons */}
          <div>
            <label className="label flex items-center gap-1.5">
              <ArrowRightLeft className="w-3.5 h-3.5 text-[#6e7681]" />
              Tipo de movimiento
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setTypeFilter('')}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                  !typeFilter
                    ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
                    : 'text-[#8b949e] border-[#30363d] hover:text-[#e6edf3] hover:border-[#6e7681]'
                )}
              >
                Todos
              </button>
              {(['entrada', 'salida', 'venta', 'ajuste', 'gasto'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(typeFilter === t ? '' : t)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                    typeFilter === t
                      ? movBg[t]
                      : 'text-[#8b949e] border-[#30363d] hover:text-[#e6edf3] hover:border-[#6e7681]'
                  )}
                >
                  <span className={cn('w-1.5 h-1.5 rounded-full', movColor[t] ?? 'bg-[#8b949e]')} />
                  {movLabel[t]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Warehouse filter */}
            <div>
              <label className="label flex items-center gap-1.5">
                <Warehouse className="w-3.5 h-3.5 text-[#6e7681]" />
                Almacén
              </label>
              <select
                className="input"
                value={locFilter}
                onChange={e => setLocFilter(e.target.value)}
              >
                <option value="">Todos los almacenes</option>
                {locations.map(l => (
                  <option key={String(l.id)} value={String(l.id)}>
                    {String(l.name)}
                  </option>
                ))}
              </select>
            </div>

            {/* Product filter */}
            <div>
              <label className="label flex items-center gap-1.5">
                <Package className="w-3.5 h-3.5 text-[#6e7681]" />
                Producto
              </label>
              <select
                className="input"
                value={prodFilter}
                onChange={e => setProdFilter(e.target.value)}
              >
                <option value="">Todos los productos</option>
                {products.map(p => (
                  <option key={String(p.id)} value={String(p.id)}>
                    {String(p.name)}
                  </option>
                ))}
              </select>
            </div>

            {/* From date */}
            <div>
              <label className="label flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#6e7681]" />
                Desde
              </label>
              <input
                type="date"
                className="input"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
              />
            </div>

            {/* To date */}
            <div>
              <label className="label flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#6e7681]" />
                Hasta
              </label>
              <input
                type="date"
                className="input"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Movements table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredMovements.length === 0 ? (
          <EmptyState
            icon={List}
            title="Sin movimientos"
            description={hasActiveFilters ? 'No hay movimientos con los filtros seleccionados.' : 'Aún no hay movimientos registrados.'}
          />
        ) : (            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#21262d] bg-[#0d1117]">
                  {['Fecha', 'Tipo', 'Almacén', 'Producto', 'Cantidad', 'Notas', 'Usuario'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-[#6e7681] uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map(m => {
                  const type = String(m.type ?? '');
                  return (
                    <tr key={String(m.id)} className="border-b border-[#21262d] last:border-0 hover:bg-[#1c2128] transition-colors">
                      <td className="px-4 py-3 text-[#8b949e] text-xs whitespace-nowrap">
                        {m.created_at ? formatDateTime(String(m.created_at)) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border', movBg[type] ?? 'bg-[#21262d] border-[#30363d] text-[#8b949e]')}>
                          <span className={cn('w-1.5 h-1.5 rounded-full', movColor[type] ?? 'bg-[#8b949e]')} />
                          {movLabel[type] ?? type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#e6edf3]">
                        {String(m.location_name ?? '—')}
                      </td>
                      <td className="px-4 py-3 text-[#e6edf3] font-medium">
                        {String(m.product_name ?? '—')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('font-semibold', movColor[type] ?? 'text-[#e6edf3]')}>
                          {formatNumber(Number(m.quantity), 2)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#8b949e] text-xs max-w-[200px] truncate" title={String(m.notes ?? '')}>
                        {m.notes ? String(m.notes) : '—'}
                      </td>
                      <td className="px-4 py-3 text-[#8b949e] text-xs whitespace-nowrap">
                        {String(m.user_name ?? '—')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination currentPage={page} totalItems={filteredMovements.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {/* Summary card — based on current page */}
      {!loading && paginated.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['entrada', 'salida', 'venta', 'ajuste', 'gasto'] as const).map(t => {
            const count = paginated.filter(m => String(m.type) === t).length;
            const total = paginated
              .filter(m => String(m.type) === t)
              .reduce((sum, m) => sum + Number(m.quantity ?? 0), 0);
            if (count === 0) return null;
            return (
              <div key={t} className={cn('card p-3 border-l-4', {
                'border-l-green-500': t === 'entrada',
                'border-l-red-500': t === 'salida',
                'border-l-purple-500': t === 'venta',
                'border-l-yellow-500': t === 'ajuste',
                'border-l-orange-500': t === 'gasto',
              })}>
                <p className="text-xs text-[#6e7681] uppercase tracking-wide">{movLabel[t]}</p>
                <p className={cn('text-lg font-semibold mt-0.5', movColor[t])}>
                  {formatNumber(total, 2)}
                </p>
                <p className="text-xs text-[#6e7681]">{count} movimiento(s)</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
