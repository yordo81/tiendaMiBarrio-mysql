'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatCurrency, formatNumber, formatDateTime, calcMargin, cn, timeAgo } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { api } from '@/lib/api-client';
import { toast } from '@/components/ui/toaster';
import {
  Package, ArrowLeft, Edit2, Trash2, AlertTriangle, Calendar,
  DollarSign, BarChart3, Truck, Image as ImageIcon,
  Barcode, Archive, Clock, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import Link from 'next/link';

type AnyRecord = Record<string, unknown>;
type StockMovement = {
  id: string; type: string; quantity: number; reason: string;
  date: string; user_name: string | null;
};
type LocationStock = {
  location_id: string; location_name: string; quantity: number;
};

export default function ProductoDetallePage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const id = String(params.id);

  const [product, setProduct] = useState<AnyRecord | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [locationStock, setLocationStock] = useState<LocationStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMovements, setLoadingMovements] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const loadProduct = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${id}`);
      if (!res.ok) { router.push('/dashboard/inventario'); return; }
      const data = await res.json();
      setProduct(data);
    } catch { router.push('/dashboard/inventario'); }
    finally { setLoading(false); }
  }, [id, router]);

  const loadMovements = useCallback(async () => {
    setLoadingMovements(true);
    try {
      const movesData = await api.getMovements(id);
      setMovements(movesData as StockMovement[]);

      // Obtener stock por almacén consultando cada almacén
      const locs = await api.getLocations();
      const stockPromises = (locs as AnyRecord[]).map(async (loc) => {
        const stock = await api.getLocationStock(String(loc.id)) as AnyRecord[];
        const found = stock.find((s: AnyRecord) => String(s.product_id) === id);
        return found ? { location_id: String(loc.id), location_name: String(loc.name), quantity: Number(found.quantity) } : null;
      });
      const results = await Promise.all(stockPromises);
      setLocationStock(results.filter((r): r is LocationStock => r !== null));
    } catch { /* ignore */ }
    finally { setLoadingMovements(false); }
  }, [id]);

  useEffect(() => { loadProduct(); }, [loadProduct]);
  useEffect(() => { if (product) loadMovements(); }, [product, loadMovements]);

  const handleDelete = async () => {
    if (!confirm('¿Eliminar este producto? Esta acción no se puede deshacer.')) return;
    setDeleting(true);
    try {
      await api.deleteProduct(id);
      toast.success('Producto eliminado');
      router.push('/dashboard/inventario');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al eliminar');
    } finally { setDeleting(false); }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-[var(--text-tertiary)]">
        <Package className="w-12 h-12 mb-3 opacity-40" />
        <p className="text-base font-medium">Producto no encontrado</p>
        <Link href="/dashboard/inventario" className="mt-3 text-sm text-brand-400 hover:underline">Volver al inventario</Link>
      </div>
    );
  }

  const p = product;
  const margin = calcMargin(Number(p.sale_price), Number(p.cost));
  const totalLocationStock = locationStock.reduce((sum, ls) => sum + Number(ls.quantity), 0);
  const isLowStock = Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock);
  const isExpired = Boolean(p.expiration_date) && new Date(String(p.expiration_date)) < new Date(new Date().toDateString());
  const expiringSoon = Boolean(p.expiration_date) && !isExpired && (() => {
    const d = new Date(String(p.expiration_date));
    const days = Math.round((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days <= 30;
  })();

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Back button */}
      <Link
        href="/dashboard/inventario"
        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Volver al inventario
      </Link>

      {/* ── Header Card ── */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row gap-5">
          {/* Image */}
          <div className="w-24 h-24 sm:w-28 sm:h-28 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] overflow-hidden flex items-center justify-center flex-shrink-0">
            {String(p.image_url ?? '') ? (
              <img
                src={String(p.image_url)}
                alt={String(p.name)}
                className="w-full h-full object-cover"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <Package className="w-8 h-8 text-[#30363d]" />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-bold text-[var(--text-primary)] truncate">{String(p.name)}</h1>
                {Boolean(p.description) && (
                  <p className="text-sm text-[var(--text-tertiary)] mt-1">{String(p.description)}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-2">
                  {Boolean(p.category_name) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 text-[10px] font-medium border border-blue-500/20">
                      {String(p.category_name)}
                    </span>
                  )}
                  {Boolean(p.barcode) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--bg-muted)] text-[var(--text-tertiary)] text-[10px] font-medium border border-[var(--border-secondary)]">
                      <Barcode className="w-3 h-3" />
                      {String(p.barcode)}
                    </span>
                  )}
                  {Boolean(p.is_perishable === true) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-500/10 text-orange-400 text-[10px] font-medium border border-orange-500/20">
                      <Clock className="w-3 h-3" />
                      Perecedero
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <Link
                  href={`/dashboard/inventario?edit=${id}`}
                  className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                  title="Editar producto"
                >
                  <Edit2 className="w-4 h-4" />
                </Link>
                {(user?.role === 'owner' || user?.role === 'admin') && (
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30"
                    title="Eliminar producto"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Key stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <StatBox
                label="Precio venta"
                value={formatCurrency(Number(p.sale_price))}
                icon={DollarSign}
                color="text-green-400"
                bg="bg-green-500/10"
                border="border-green-500/20"
              />
              <StatBox
                label="Costo"
                value={formatCurrency(Number(p.cost))}
                icon={TrendingDown}
                color="text-orange-400"
                bg="bg-orange-500/10"
                border="border-orange-500/20"
              />
              <StatBox
                label="Margen"
                value={`${margin.toFixed(1)}%`}
                icon={BarChart3}
                color={margin >= 20 ? 'text-green-400' : margin >= 10 ? 'text-yellow-400' : 'text-red-400'}
                bg={margin >= 20 ? 'bg-green-500/10' : margin >= 10 ? 'bg-yellow-500/10' : 'bg-red-500/10'}
                border={margin >= 20 ? 'border-green-500/20' : margin >= 10 ? 'border-yellow-500/20' : 'border-red-500/20'}
                sub={`Ganancia: ${formatCurrency(Number(p.sale_price) - Number(p.cost))}`}
              />
              <StatBox
                label="Unidad"
                value={String(p.unit ?? '—')}
                icon={Package}
                color="text-blue-400"
                bg="bg-blue-500/10"
                border="border-blue-500/20"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Stock & Expiration Row ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Stock Card */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Archive className="w-4 h-4 text-[var(--text-tertiary)]" />
            Stock
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Total</span>
              <span className={cn(
                'text-lg font-bold',
                isLowStock ? 'text-red-400' : 'text-[var(--text-primary)]'
              )}>
                {formatNumber(Number(p.stock), 1)}
                <span className="text-sm font-normal text-[var(--text-tertiary)] ml-1">{String(p.unit)}</span>
              </span>
            </div>
            {isLowStock && (
              <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                Stock bajo (mínimo: {formatNumber(Number(p.min_stock), 1)})
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)]">
              <span>Stock mínimo</span>
              <span>{formatNumber(Number(p.min_stock), 1)} {String(p.unit)}</span>
            </div>

            {/* Stock por almacén */}
            {locationStock.length > 0 && (
              <div className="pt-2 border-t border-[var(--border-primary)]">
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-2 font-medium">Por almacén</p>
                <div className="space-y-1.5">
                  {locationStock.map(ls => (
                    <div key={ls.location_id} className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">{ls.location_name}</span>
                      <span className="font-medium text-[var(--text-primary)]">{formatNumber(Number(ls.quantity), 1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Expiration Card */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--text-tertiary)]" />
            Vencimiento
          </h3>
          {Boolean(p.is_perishable === true && p.expiration_date) ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--text-secondary)]">Fecha</span>
                <span className={cn(
                  'text-sm font-semibold',
                  isExpired ? 'text-red-400' : expiringSoon ? 'text-orange-400' : 'text-[var(--text-primary)]'
                )}>
                  {String(p.expiration_date).split('-').reverse().join('/')}
                </span>
              </div>
              <div className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-xs border',
                isExpired ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                expiringSoon ? 'bg-orange-500/10 border-orange-500/20 text-orange-400' :
                'bg-green-500/10 border-green-500/20 text-green-400'
              )}>
                {isExpired ? <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> :
                 expiringSoon ? <Clock className="w-3.5 h-3.5 flex-shrink-0" /> :
                 <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                {(() => {
                  const today = new Date(); today.setHours(0, 0, 0, 0);
                  const expDate = new Date(String(p.expiration_date)); expDate.setHours(0, 0, 0, 0);
                  const days = Math.round((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                  if (days < 0) return `VENCIDO hace ${Math.abs(days)} día(s)`;
                  if (days === 0) return 'Vence HOY';
                  if (days <= 5) return `⚠️ Vence en ${days} día(s)`;
                  if (days <= 30) return `Vence en ${days} día(s)`;
                  return `Vence en ${days} día(s)`;
                })()}
              </div>
            </div>
          ) : p.is_perishable === true ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-muted)] rounded-lg text-xs text-[var(--text-tertiary)]">
              <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
              Sin fecha de vencimiento asignada
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-muted)] rounded-lg text-xs text-[var(--text-tertiary)]">
              <Minus className="w-3.5 h-3.5 flex-shrink-0" />
              Producto no perecedero
            </div>
          )}

          {/* Suppliers */}
          {Boolean(p.supplier_names) && (p.supplier_names as string[]).length > 0 && (
            <div className="mt-4 pt-3 border-t border-[var(--border-primary)]">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-2 font-medium flex items-center gap-1.5">
                <Truck className="w-3 h-3" />
                Proveedores
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(p.supplier_names as string[]).map((name: string, i: number) => (
                  <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-md bg-[var(--bg-muted)] text-[10px] text-[var(--text-secondary)] border border-[var(--border-secondary)]">
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Stock Movements ── */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[var(--text-tertiary)]" />
          Movimientos de stock
        </h3>
        {loadingMovements ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : movements.length === 0 ? (
          <p className="text-center text-xs text-[var(--text-tertiary)] py-6">Sin movimientos registrados</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-primary)]">
                  {['Fecha', 'Tipo', 'Cantidad', 'Razón', 'Usuario'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movements.slice(0, 20).map(m => (
                  <tr key={m.id} className="border-b border-[var(--border-primary)] last:border-0 hover:bg-[var(--bg-tertiary)]">
                    <td className="px-3 py-2 text-xs text-[var(--text-secondary)] whitespace-nowrap">{formatDateTime(m.date)}</td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        'text-xs font-medium',
                        m.type === 'in' || m.type === 'entrada' ? 'text-green-400' :
                        m.type === 'out' || m.type === 'salida' ? 'text-red-400' :
                        m.type === 'adjust' || m.type === 'ajuste' ? 'text-yellow-400' :
                        m.type === 'expense' || m.type === 'gasto' ? 'text-orange-400' :
                        m.type === 'sale' || m.type === 'venta' ? 'text-blue-400' : 'text-[var(--text-primary)]'
                      )}>
                        {({ in: 'Entrada', out: 'Salida', adjust: 'Ajuste', expense: 'Gasto', sale: 'Venta',
                           entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste', gasto: 'Gasto', venta: 'Venta' } as Record<string, string>)[m.type] ?? m.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{formatNumber(Number(m.quantity), 2)}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text-tertiary)] max-w-[200px] truncate">{m.reason || '—'}</td>
                    <td className="px-3 py-2 text-xs text-[var(--text-tertiary)]">{m.user_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── StatBox component ──
function StatBox({
  label, value, icon: Icon, color, bg, border, sub
}: {
  label: string; value: string; icon: React.ElementType; color: string; bg: string; border: string; sub?: string;
}) {
  return (
    <div className={cn('rounded-xl border p-3', bg, border)}>
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={cn('w-3 h-3', color)} />
        <span className="text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn('text-base font-bold', color)}>{value}</p>
      {sub && <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Missing icon ──
function CheckCircle(props: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
