'use client';
import { Fragment, useEffect, useState, useCallback, useMemo } from 'react';
import { formatCurrency, formatDateTime, formatNumber, cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { useWorkMode } from '@/lib/stores/settings-store';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import { toast } from '@/components/ui/toaster';
import SearchableSelect from '@/components/ui/SearchableSelect';
import { ShoppingBag, Search, RotateCcw, Package, Truck, MapPin, User, Receipt, ChevronDown } from 'lucide-react';

type AnyRecord = Record<string, unknown>;

export default function ComprasPage() {
  const [purchases, setPurchases] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [invoiceFilter, setInvoiceFilter] = useState('');
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [products, setProducts] = useState<AnyRecord[]>([]);
  const [suppliers, setSuppliers] = useState<AnyRecord[]>([]);
  const workMode = useWorkMode();

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const loadPurchases = useCallback(async (productId?: string, supplierId?: string, invoiceNumber?: string, from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (productId) params.set('product_id', productId);
    if (supplierId) params.set('supplier_id', supplierId);
    if (invoiceNumber) params.set('invoice_number', invoiceNumber);
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
    loadPurchases(productFilter || undefined, supplierFilter || undefined, invoiceFilter || undefined, dateFrom || undefined, dateTo || undefined);
  }, [productFilter, supplierFilter, invoiceFilter, dateFrom, dateTo, loadPurchases]);

  const filtered = purchases.filter(p => {
    const q = search.toLowerCase();
    if (!q) return true;
    return String(p.product_name ?? '').toLowerCase().includes(q)
        || String(p.supplier_name ?? '').toLowerCase().includes(q)
        || String(p.notes ?? '').toLowerCase().includes(q)
        || String(p.invoice_number ?? '').toLowerCase().includes(q);
  });

  // Agrupar en una sola fila las compras de una misma factura; las compras
  // sin factura se muestran individualmente.
  const grouped = useMemo(() => {
    const byInvoice = new Map<string, AnyRecord[]>();
    const rows: { key: string | null; invoice_number: string | null; purchases: AnyRecord[]; total: number; count: number }[] = [];
    for (const p of filtered) {
      const inv = String(p.invoice_number ?? '').trim();
      if (!inv) {
        rows.push({ key: null, invoice_number: null, purchases: [p], total: Number(p.total_cost ?? 0), count: 1 });
        continue;
      }
      // Clave: factura + proveedor, para no mezclar facturas con el mismo
      // número de distintos proveedores
      const key = `${inv}|${String(p.supplier_id ?? '')}`;
      const arr = byInvoice.get(key) ?? [];
      arr.push(p);
      byInvoice.set(key, arr);
    }
    for (const [key, list] of byInvoice) {
      rows.push({
        key,
        invoice_number: key.slice(0, key.lastIndexOf('|')),
        purchases: list,
        total: list.reduce((s, p) => s + Number(p.total_cost ?? 0), 0),
        count: list.length,
      });
    }
    rows.sort((a, b) => {
      const da = String(a.purchases[0]?.created_at ?? '');
      const db = String(b.purchases[0]?.created_at ?? '');
      return da < db ? 1 : da > db ? -1 : 0;
    });
    return rows;
  }, [filtered]);

  const paginated = pageSize === 0 ? grouped : grouped.slice(0, page * pageSize).slice((page - 1) * pageSize);
  const colSpan = 9 + (workMode === 'shifts' ? 1 : 0);

  // Reset page when search changes
  useEffect(() => { setPage(1); }, [search, productFilter, supplierFilter, invoiceFilter, dateFrom, dateTo]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
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
          <div className="max-w-[160px]">
            <SearchableSelect
              options={[
                { value: '', label: 'Todos los proveedores' },
                ...suppliers.map(s => ({ value: String(s.id), label: String(s.name) }))
              ]}
              value={supplierFilter}
              onChange={v => setSupplierFilter(v)}
              placeholder="Todos los proveedores"
              noResultsMessage="Sin proveedores"
            />
          </div>
          <input
            className="input text-sm max-w-[150px]"
            placeholder="N.º de factura..."
            value={invoiceFilter}
            onChange={e => setInvoiceFilter(e.target.value)}
            title="Filtrar por número de factura"
          />
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
            onClick={() => { setProductFilter(''); setSupplierFilter(''); setInvoiceFilter(''); setDateFrom(''); setDateTo(''); loadPurchases(); }}
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
            <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide mb-1">Total compras</p>
            <p className="text-lg sm:text-xl font-semibold text-[var(--text-primary)]">{grouped.length}</p>
          </div>
          <div className="card p-3 sm:p-4">
            <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide mb-1">Costo total</p>
            <p className="text-lg sm:text-xl font-semibold text-brand-400">
              {formatCurrency(purchases.reduce((s, p) => s + Number(p.total_cost ?? 0), 0))}
            </p>
          </div>
          <div className="card p-3 sm:p-4">
            <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide mb-1">Productos distintos</p>
            <p className="text-lg sm:text-xl font-semibold text-[var(--text-primary)]">
              {new Set(purchases.map(p => String(p.product_id))).size}
            </p>
          </div>
          <div className="card p-3 sm:p-4">
            <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide mb-1">Cant. total</p>
            <p className="text-lg sm:text-xl font-semibold text-[var(--text-primary)]">
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
                <tr className="border-b border-[var(--border-primary)]">
                  {['Fecha', 'Producto', 'Proveedor', 'Factura', ...(workMode === 'shifts' ? ['Caja'] : []), 'Cantidad', 'P. Unitario', 'Total', 'Almacén', 'Usuario'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((g, gi) => {
                  const first = g.purchases[0];
                  const single = g.key === null ? first : null;
                  const expanded = g.key !== null && expandedInvoice === g.key;
                  const totalQty = g.purchases.reduce((s, p) => s + Number(p.quantity ?? 0), 0);
                  return (
                    <Fragment key={gi}>
                      <tr
                        className={cn('border-b border-[var(--border-primary)] last:border-0 table-row-hover', g.key !== null && 'cursor-pointer')}
                        onClick={g.key !== null ? () => setExpandedInvoice(expanded ? null : g.key) : undefined}
                      >
                        <td className="px-4 py-3 text-[var(--text-secondary)] text-xs whitespace-nowrap">
                          {first.created_at ? formatDateTime(String(first.created_at)) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {single ? (
                            <div className="flex items-center gap-2">
                              <Package className="w-3.5 h-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
                              <span className="text-[var(--text-primary)] font-medium">{String(single.product_name ?? '—')}</span>
                            </div>
                          ) : (
                            <span className="text-[var(--text-primary)] font-medium">
                              {g.count} {g.count === 1 ? 'producto' : 'productos'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Truck className="w-3.5 h-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
                            <span className="text-[var(--text-secondary)]">{String(first.supplier_name ?? '—')}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {g.key !== null ? (
                            <button
                              onClick={e => { e.stopPropagation(); setExpandedInvoice(expanded ? null : g.key); }}
                              className={cn(
                                'inline-flex items-center gap-1.5 text-xs font-mono rounded-md px-2 py-1 whitespace-nowrap border transition-colors',
                                expanded ? 'bg-brand-500/20 border-brand-500/40 text-brand-300' : 'bg-brand-500/10 border-brand-500/20 text-brand-400 hover:bg-brand-500/15'
                              )}
                              title={expanded ? 'Ocultar detalle de la factura' : 'Ver detalle de la factura'}
                            >
                              <Receipt className="w-3 h-3 flex-shrink-0" />{g.invoice_number}
                              <ChevronDown className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
                            </button>
                          ) : (
                            <span className="text-[var(--text-tertiary)] text-xs">—</span>
                          )}
                        </td>
                        {workMode === 'shifts' && (
                          <td className="px-4 py-3 text-[var(--text-secondary)] text-xs whitespace-nowrap">
                            {first.pos_name ? String(first.pos_name) : <span className="text-[var(--text-tertiary)] italic">—</span>}
                          </td>
                        )}
                        <td className="px-4 py-3 text-[var(--text-primary)] font-medium">
                          {single ? formatNumber(Number(single.quantity), 2) : formatNumber(totalQty, 2)}
                        </td>
                        <td className="px-4 py-3 text-[var(--text-secondary)]">
                          {single ? formatCurrency(Number(single.unit_price)) : '—'}
                        </td>
                        <td className="px-4 py-3 text-brand-400 font-semibold">
                          {formatCurrency(g.total)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
                            <span className="text-[var(--text-secondary)] text-xs">{String(first.location_name ?? '—')}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <User className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
                            <span className="text-[var(--text-secondary)] text-xs">{String(first.user_name ?? '—')}</span>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)]/40">
                          <td colSpan={colSpan} className="px-4 py-3">
                            <div className="rounded-xl border border-[var(--border-primary)] overflow-hidden bg-[var(--bg-primary)]">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-[var(--border-primary)]">
                                    {['Producto', 'Cantidad', 'P. Unitario', 'Total', 'Almacén'].map(h => (
                                      <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide">{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.purchases.map((line, li) => (
                                    <tr key={li} className="border-b border-[var(--border-primary)] last:border-0">
                                      <td className="px-3 py-2 text-[var(--text-primary)] font-medium">{String(line.product_name ?? '—')}</td>
                                      <td className="px-3 py-2 text-[var(--text-secondary)]">{formatNumber(Number(line.quantity), 2)}</td>
                                      <td className="px-3 py-2 text-[var(--text-secondary)]">{formatCurrency(Number(line.unit_price))}</td>
                                      <td className="px-3 py-2 text-[var(--text-primary)] font-medium">{formatCurrency(Number(line.total_cost))}</td>
                                      <td className="px-3 py-2 text-[var(--text-secondary)] text-xs">{String(line.location_name ?? '—')}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          currentPage={page}
          totalItems={grouped.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
    </div>
  );
}
