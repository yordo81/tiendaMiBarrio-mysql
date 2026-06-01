'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';
import { api } from '@/lib/api-client';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import { toast } from '@/components/ui/toaster';
import { ShoppingBag, Search, RotateCcw, Package, Truck, MapPin, User } from 'lucide-react';

type AnyRecord = Record<string, unknown>;

export default function ComprasPage() {
  const [purchases, setPurchases] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [products, setProducts] = useState<AnyRecord[]>([]);
  const [suppliers, setSuppliers] = useState<AnyRecord[]>([]);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadPurchases = useCallback(async (productId?: string, supplierId?: string, from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (productId) params.set('product_id', productId);
    if (supplierId) params.set('supplier_id', supplierId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('limit', '200');
    const qs = params.toString();
    const data = await api.getPurchases(qs || undefined);
    setPurchases(data);
  }, []);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api.getProducts(), api.getSuppliers()]);
      setProducts(p);
      setSuppliers(s);
      await loadPurchases();
    } catch (e) {
      // fallback: load purchases even if products/suppliers fail
      try { await loadPurchases(); } catch { /* ignore */ }
      if (e instanceof Error) toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [loadPurchases]);

  useEffect(() => { load(); }, [load]);

  // Fetch purchases when filters change
  useEffect(() => {
    loadPurchases(productFilter || undefined, supplierFilter || undefined, dateFrom || undefined, dateTo || undefined);
  }, [productFilter, supplierFilter, dateFrom, dateTo, loadPurchases]);

  const filtered = purchases.filter(p => {
    const q = search.toLowerCase();
    if (!q) return true;
    return String(p.product_name ?? '').toLowerCase().includes(q)
        || String(p.supplier_name ?? '').toLowerCase().includes(q)
        || String(p.notes ?? '').toLowerCase().includes(q);
  });

  const paginated = pageSize === 0 ? filtered : filtered.slice(0, page * pageSize).slice((page - 1) * pageSize);

  // Reset page when search changes
  useEffect(() => { setPage(1); }, [search, productFilter, supplierFilter, dateFrom, dateTo]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e7681]" />
          <input className="input pl-9" placeholder="Buscar compras..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-2 flex-wrap">
          <select
            className="input text-sm max-w-[160px]"
            value={productFilter}
            onChange={e => setProductFilter(e.target.value)}
          >
            <option value="">Todos los productos</option>
            {products.map(p => (
              <option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>
            ))}
          </select>
          <select
            className="input text-sm max-w-[160px]"
            value={supplierFilter}
            onChange={e => setSupplierFilter(e.target.value)}
          >
            <option value="">Todos los proveedores</option>
            {suppliers.map(s => (
              <option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>
            ))}
          </select>
          <input
            type="date"
            className="input text-sm max-w-[150px]"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            title="Desde"
          />
          <input
            type="date"
            className="input text-sm max-w-[150px]"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            title="Hasta"
          />
          <button
            onClick={() => { setProductFilter(''); setSupplierFilter(''); setDateFrom(''); setDateTo(''); loadPurchases(); }}
            className="btn-secondary p-2.5"
            title="Limpiar filtros"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {!loading && purchases.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="card p-3 sm:p-4">
            <p className="text-xs text-[#6e7681] uppercase tracking-wide mb-1">Total compras</p>
            <p className="text-lg sm:text-xl font-semibold text-[#e6edf3]">{purchases.length}</p>
          </div>
          <div className="card p-3 sm:p-4">
            <p className="text-xs text-[#6e7681] uppercase tracking-wide mb-1">Costo total</p>
            <p className="text-lg sm:text-xl font-semibold text-brand-400">
              {formatCurrency(purchases.reduce((s, p) => s + Number(p.total_cost ?? 0), 0))}
            </p>
          </div>
          <div className="card p-3 sm:p-4">
            <p className="text-xs text-[#6e7681] uppercase tracking-wide mb-1">Productos distintos</p>
            <p className="text-lg sm:text-xl font-semibold text-[#e6edf3]">
              {new Set(purchases.map(p => String(p.product_id))).size}
            </p>
          </div>
          <div className="card p-3 sm:p-4">
            <p className="text-xs text-[#6e7681] uppercase tracking-wide mb-1">Cant. total</p>
            <p className="text-lg sm:text-xl font-semibold text-[#e6edf3]">
              {formatNumber(purchases.reduce((s, p) => s + Number(p.quantity ?? 0), 0), 1)}
            </p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : paginated.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title="Sin compras registradas"
            description="Las compras que registres desde el panel de inventario aparecerán aquí con su historial completo."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#21262d]">
                  {['Fecha', 'Producto', 'Proveedor', 'Cantidad', 'P. Unitario', 'Total', 'Almacén', 'Usuario'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-[#8b949e] uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map(p => (
                  <tr key={String(p.id)} className="border-b border-[#21262d] last:border-0 table-row-hover">
                    <td className="px-4 py-3 text-[#8b949e] text-xs whitespace-nowrap">
                      {p.created_at ? formatDateTime(String(p.created_at)) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Package className="w-3.5 h-3.5 text-[#6e7681] flex-shrink-0" />
                        <span className="text-[#e6edf3] font-medium">{String(p.product_name ?? '—')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Truck className="w-3.5 h-3.5 text-[#6e7681] flex-shrink-0" />
                        <span className="text-[#8b949e]">{String(p.supplier_name ?? '—')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#e6edf3] font-medium">
                      {formatNumber(Number(p.quantity), 2)}
                    </td>
                    <td className="px-4 py-3 text-[#8b949e]">
                      {formatCurrency(Number(p.unit_price))}
                    </td>
                    <td className="px-4 py-3 text-brand-400 font-semibold">
                      {formatCurrency(Number(p.total_cost))}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-[#6e7681] flex-shrink-0" />
                        <span className="text-[#8b949e] text-xs">{String(p.location_name ?? '—')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3 h-3 text-[#6e7681] flex-shrink-0" />
                        <span className="text-[#8b949e] text-xs">{String(p.user_name ?? '—')}</span>
                      </div>
                    </td>
                  </tr>
                ))}
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
