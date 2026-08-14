'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatCurrency, formatNumber, timeAgo, formatDateTime, cn } from '@/lib/utils';
import { api, apiFetch } from '@/lib/api-client';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useWorkMode, useSettingsStore } from '@/lib/stores/settings-store';
import {
  Plus, Sparkles, ShoppingCart, Users, CalendarCheck, TrendingUp,
  AlertTriangle, ExternalLink, Check, Receipt, ArrowRight, Wallet,
  Clock3, Play, Square, Banknote,
  type LucideIcon,
} from 'lucide-react';
import StatCard from '@/components/ui/StatCard';
import Modal from '@/components/ui/Modal';
import { toast } from '@/components/ui/toaster';
import { SHIFT_CHANGED_EVENT, SHIFT_SUMMARY_CHANGED_EVENT, notifyShiftChanged } from '@/lib/shift-events';
import OpenShiftModal from '@/components/shifts/OpenShiftModal';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface SellerData {
  mySalesToday: number;
  mySalesCountToday: number;
  mySalesWeek: number;
  mySalesMonth: number;
  salesChart: { date: string; total: number }[];
  topProducts: { name: string; total: number }[];
  debtorsCount: number;
  lowStockCount: number;
  recentSales: { id: string; total: number; date: string; payment_method: string; customer_name: string | null }[];
  timezone: string;
}

interface PendingReservation {
  id: string;
  customer_name: string;
  product_name: string;
  quantity: number;
  created_at: string;
}

type R = Record<string, unknown>;

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  mixed: 'Mixto',
  credit: 'Crédito',
};

const PAYMENT_COLORS: Record<string, string> = {
  cash: 'text-green-400 bg-green-500/10 border-green-500/20',
  transfer: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  mixed: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  credit: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
};

const QUICK_LINKS: { href: string; icon: LucideIcon; label: string; sub: string; color: string; iconColor: string }[] = [
  { href: '/dashboard/ventas/touch', icon: ShoppingCart, label: 'Ventas', sub: 'POS táctil — registra ventas al instante', color: 'hover:border-brand-500/30', iconColor: 'bg-brand-500/10 border-brand-500/20 text-brand-400' },
  { href: '/dashboard/reservaciones', icon: CalendarCheck, label: 'Reservaciones', sub: 'Pedidos de clientes', color: 'hover:border-yellow-500/30', iconColor: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' },
  { href: '/dashboard/clientes', icon: Users, label: 'Clientes', sub: 'Cartera y deudas', color: 'hover:border-purple-500/30', iconColor: 'bg-purple-500/10 border-purple-500/20 text-purple-400' },
];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1c2128] border border-[var(--border-secondary)] rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="text-[var(--text-secondary)] mb-1">{label}</p>
      <p className="text-brand-400 font-semibold">{formatCurrency(payload[0].value)}</p>
    </div>
  );
};

function fmtInTz(date: Date, tz: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('es-DO', { timeZone: tz, ...options }).format(date);
}

export default function SellerDashboard() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [data, setData] = useState<SellerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<Date | null>(null);
  const [reservations, setReservations] = useState<PendingReservation[]>([]);
  const [reservationsLoading, setReservationsLoading] = useState(true);

  // ── Turno de caja (solo relevante en modo por turnos) ──
  const workMode = useWorkMode();
  const settings = useSettingsStore(s => s.settings);
  const loadSettings = useSettingsStore(s => s.load);
  // Módulo de reservaciones: se oculta del panel si está desactivado
  const showReservations = settings?.show_reservations !== false;
  // POS táctil: si está desactivado, el acceso rápido y el botón de nueva
  // venta llevan a la página de ventas con la ventana modal
  const posEnabled = settings?.enable_touch_pos !== false;
  const [shifts, setShifts] = useState<{ open: R[]; pos: R[] }>({ open: [], pos: [] });
  const [shiftsLoading, setShiftsLoading] = useState(true);
  const [showOpenShift, setShowOpenShift] = useState(false);
  const [closeShift, setCloseShift] = useState<R | null>(null);
  const [closeForm, setCloseForm] = useState({ closing_cash: 0, notes: '' });
  const [closingBusy, setClosingBusy] = useState(false);

  useEffect(() => {
    apiFetch<SellerData>('/api/reports?type=seller&days=30')
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setData(null); setLoading(false); });

    apiFetch<PendingReservation[]>('/api/reservations?status=pending')
      .then(d => { setReservations(Array.isArray(d) ? d : []); setReservationsLoading(false); })
      .catch(() => { setReservations([]); setReservationsLoading(false); });
  }, []);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Asegurar que el modo de trabajo (por días / por turnos) esté cargado
  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Estado de turnos: solo relevante en modo por turnos
  useEffect(() => {
    if (workMode !== 'shifts') { setShiftsLoading(false); return; }
    let alive = true;
    setShiftsLoading(true);
    api.getShifts()
      .then(d => { if (alive) { setShifts({ open: (d.open ?? []) as R[], pos: (d.pos ?? []) as R[] }); setShiftsLoading(false); } })
      .catch(() => { if (alive) setShiftsLoading(false); });
    return () => { alive = false; };
  }, [workMode]);

  const firstName = user?.name?.split(' ')[0] ?? 'Vendedor';
  const tz = data?.timezone ?? 'America/Havana';
  const pendingCount = reservations.length;
  const pendingPreview = reservations.slice(0, 3);

  const maxSales = data?.salesChart?.length
    ? Math.max(...data.salesChart.map(d => d.total))
    : 0;
  const yMax = Math.ceil(maxSales * 1.15 / 1000) * 1000 || 1000;

  const loadShifts = useCallback(() => {
    api.getShifts()
      .then(d => setShifts({ open: (d.open ?? []) as R[], pos: (d.pos ?? []) as R[] }))
      .catch(() => {});
  }, []);

  // Refrescar el widget cuando un turno cambia desde otro punto de entrada
  // (píldora del Topbar o módulo Turnos), para no dejar el estado obsoleto.
  useEffect(() => {
    const onShiftChanged = () => loadShifts();
    // El resumen en vivo (ventas, efectivo, esperado) cambia al registrar
    // ventas, abonos, gastos o movimientos de caja: refresca al instante.
    const onSummaryChanged = () => { if (workMode === 'shifts') loadShifts(); };
    window.addEventListener(SHIFT_CHANGED_EVENT, onShiftChanged);
    window.addEventListener(SHIFT_SUMMARY_CHANGED_EVENT, onSummaryChanged);
    return () => {
      window.removeEventListener(SHIFT_CHANGED_EVENT, onShiftChanged);
      window.removeEventListener(SHIFT_SUMMARY_CHANGED_EVENT, onSummaryChanged);
    };
  }, [loadShifts, workMode]);

  // Respaldo: mantener el panel al día cada 30s (cambios desde otra pestaña)
  useEffect(() => {
    if (workMode !== 'shifts') return;
    const id = setInterval(loadShifts, 30_000);
    return () => clearInterval(id);
  }, [workMode, loadShifts]);

  const openPosIds = new Set(shifts.open.map(s => String(s.pos_id)));
  const myOpenShift = shifts.open.find(s => String(s.user_id) === user?.id) ?? null;
  // Acumulado en vivo del turno propio (lo adjunta el GET /api/shifts)
  const myShiftSummary = (myOpenShift?.summary ?? null) as { total_sales: number; total_cash: number; expected_cash: number } | null;
  const otherOpenShifts = shifts.open.filter(s => String(s.user_id) !== user?.id);
  const freeCajas = shifts.pos.filter(p => !openPosIds.has(String(p.id)));
  const sellingBlocked = workMode === 'shifts' && !shiftsLoading && shifts.open.length === 0;

  async function handleCloseShift() {
    if (!closeShift) return;
    setClosingBusy(true);
    try {
      await api.closeShift(String(closeShift.id), { closing_cash: closeForm.closing_cash, notes: closeForm.notes });
      toast.success('Turno cerrado con arqueo');
      setCloseShift(null);
      setCloseForm({ closing_cash: 0, notes: '' });
      loadShifts();
      notifyShiftChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cerrar el turno');
    } finally {
      setClosingBusy(false);
    }
  }

  // En modo turnos la venta requiere un turno abierto: si está bloqueada,
  // guía al vendedor a abrir el turno desde el propio dashboard.
  // La venta se registra en el punto de venta táctil (/dashboard/ventas/touch)
  // o, si está desactivado, en la página de ventas con la ventana modal.
  const handleNewSale = () => {
    if (sellingBlocked) {
      toast.warning('Debes abrir un turno de caja antes de poder vender');
      setShowOpenShift(true);
      return;
    }
    router.push(posEnabled ? '/dashboard/ventas/touch' : '/dashboard/ventas');
  };

  return (
    <div className="space-y-6">
      {/* ── Cabecera de bienvenida ── */}
      <div className="relative overflow-hidden card p-6 sm:p-7">
        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-brand-500/10 blur-3xl pointer-events-none" aria-hidden />
        <div className="absolute -bottom-24 -left-16 w-64 h-64 rounded-full bg-brand-500/5 blur-3xl pointer-events-none" aria-hidden />
        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-brand-400 font-semibold mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Panel del vendedor
            </p>
            <h1 className="text-2xl sm:text-3xl font-display font-semibold text-[var(--text-primary)] truncate">
              ¡Hola, {firstName}! 👋
            </h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1.5 capitalize">
              {now ? fmtInTz(now, tz, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : ''}
              <span className="text-[var(--text-tertiary)]"> · </span>
              <span className="font-mono text-[var(--text-primary)] normal-case">{now ? fmtInTz(now, tz, { hour: '2-digit', minute: '2-digit', hour12: false }) : ''}</span>
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Link href="/dashboard/ventas" className="btn-secondary gap-2">
              <Receipt className="w-4 h-4" />
              Ver ventas
            </Link>
            <button
              onClick={handleNewSale}
              className={cn(
                'btn-primary gap-2 px-4 py-2.5 shadow-lg shadow-brand-600/25',
                sellingBlocked ? 'opacity-60 cursor-not-allowed' : 'hover:-translate-y-0.5 transition-transform'
              )}
              title={sellingBlocked ? 'Abre un turno de caja para poder vender' : undefined}
            >
              <Plus className="w-4 h-4" />
              Nueva venta
            </button>
          </div>
        </div>
      </div>

      {/* ── Turno de caja (solo en modo por turnos) ── */}
      {workMode === 'shifts' && (
        <div className={cn('card p-5', sellingBlocked ? 'border-yellow-500/30' : 'border-green-500/20')}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className={cn('w-10 h-10 rounded-xl border flex items-center justify-center', myOpenShift ? 'bg-green-500/10 border-green-500/20' : 'bg-yellow-500/10 border-yellow-500/20')}>
                <Clock3 className={cn('w-5 h-5', myOpenShift ? 'text-green-400' : 'text-yellow-400')} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Turno de caja</h3>
                <p className={cn('text-xs', myOpenShift ? 'text-green-400' : sellingBlocked ? 'text-yellow-400' : 'text-[var(--text-secondary)]')}>
                  {myOpenShift
                    ? `Turno abierto en ${String(myOpenShift.pos_name ?? 'la caja')}`
                    : shiftsLoading
                      ? 'Cargando turnos…'
                      : sellingBlocked
                        ? 'Sin turnos abiertos — debes abrir un turno para vender'
                        : `${shifts.open.length} caja(s) con turno abierto`}
                </p>
              </div>
            </div>
            {!myOpenShift && (
              <button
                onClick={() => setShowOpenShift(true)}
                className="btn-primary flex items-center gap-1.5 text-sm"
                disabled={freeCajas.length === 0}
                title={freeCajas.length === 0 ? 'Todas las cajas ya tienen un turno abierto' : undefined}
              >
                <Play className="w-3.5 h-3.5" />Abrir turno
              </button>
            )}
          </div>

          {/* Mi turno abierto: se puede cerrar con arqueo */}
          {myOpenShift && (
            <div className="bg-[var(--bg-primary)] border border-green-500/20 rounded-xl p-4 mb-3">
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-brand-500/15 text-brand-400 border border-brand-500/25 truncate">
                    {String(myOpenShift.pos_name ?? 'Caja')}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />Abierto
                  </span>
                </div>
                <button
                  onClick={() => { setCloseShift(myOpenShift); setCloseForm({ closing_cash: 0, notes: '' }); }}
                  className="btn-primary flex items-center gap-1.5 text-xs px-3 py-2"
                >
                  <Square className="w-3 h-3" />Cerrar turno
                </button>
              </div>
              <p className="text-xs text-[var(--text-tertiary)]">
                Abierto desde {myOpenShift.opened_at ? formatDateTime(String(myOpenShift.opened_at)) : '—'}
              </p>
              <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-[var(--border-primary)]">
                <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide font-medium">Fondo inicial</span>
                <span className="text-sm font-semibold text-[var(--text-primary)]">{formatCurrency(Number(myOpenShift.opening_cash ?? 0))}</span>
              </div>
              {myShiftSummary && (
                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-[var(--border-primary)]">
                  <div className="rounded-lg bg-[var(--bg-muted)] border border-[var(--border-primary)] px-3 py-2">
                    <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide font-medium">Ventas</p>
                    <p className="text-sm font-semibold text-brand-400 mt-0.5 truncate">{formatCurrency(myShiftSummary.total_sales)}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--bg-muted)] border border-[var(--border-primary)] px-3 py-2">
                    <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide font-medium">Efectivo</p>
                    <p className="text-sm font-semibold text-green-400 mt-0.5 truncate">{formatCurrency(myShiftSummary.total_cash)}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--bg-muted)] border border-[var(--border-primary)] px-3 py-2">
                    <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide font-medium">Esperado</p>
                    <p className="text-sm font-semibold text-[var(--text-primary)] mt-0.5 truncate">{formatCurrency(myShiftSummary.expected_cash)}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Alerta: ventas bloqueadas hasta abrir turno */}
          {sellingBlocked && (
            <div className="flex items-start gap-3 bg-yellow-500/10 border border-yellow-500/25 rounded-xl px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                <span className="text-[var(--text-primary)] font-medium">Las ventas están bloqueadas.</span>{' '}
                No hay turnos abiertos en ninguna caja. Abre un turno para poder registrar ventas.
              </p>
            </div>
          )}

          {/* Otros turnos abiertos en otras cajas */}
          {otherOpenShifts.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)] font-medium">Otros turnos abiertos</p>
              {otherOpenShifts.map(s => (
                <div key={String(s.id)} className="flex items-center justify-between gap-3 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{String(s.pos_name ?? 'Caja')}</p>
                    <p className="text-xs text-[var(--text-tertiary)] truncate">
                      Abierto por {String(s.user_name ?? '—')} desde {s.opened_at ? formatDateTime(String(s.opened_at)) : '—'}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-green-500/10 text-green-400 border border-green-500/20 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />Abierto
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Accesos rápidos ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {QUICK_LINKS.filter(l => l.href !== '/dashboard/reservaciones' || showReservations).map(({ href, icon: Icon, label, sub, color, iconColor }) => {
          // POS táctil desactivado → el acceso rápido apunta a la página de ventas
          const isTouchLink = href === '/dashboard/ventas/touch';
          const linkHref = isTouchLink && !posEnabled ? '/dashboard/ventas' : href;
          const linkSub = isTouchLink && !posEnabled ? 'Historial y nueva venta' : sub;
          return (
            <Link
              key={href}
              href={linkHref}
              className={cn('card p-4 flex items-center gap-3 transition-all duration-200 hover:-translate-y-0.5 group', color)}
            >
              <div className={cn('w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 transition-colors group-hover:brightness-125', iconColor)}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{label}</p>
                <p className="text-xs text-[var(--text-tertiary)] truncate">{linkSub}</p>
              </div>
              <ArrowRight className="w-4 h-4 text-[var(--text-tertiary)] ml-auto flex-shrink-0 transition-all group-hover:text-brand-400 group-hover:translate-x-0.5" />
            </Link>
          );
        })}
      </div>

      {/* ── Métricas de la jornada ── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          title="Mis ventas hoy"
          value={formatCurrency(data?.mySalesToday ?? 0)}
          subtitle={`${formatNumber(data?.mySalesCountToday ?? 0, 0)} venta(s) registrada(s)`}
          icon={Wallet}
          variant="default"
          loading={loading}
        />
        <StatCard title="Mis ventas esta semana" value={formatCurrency(data?.mySalesWeek ?? 0)} icon={TrendingUp} variant="success" loading={loading} />
        <StatCard title="Mis ventas este mes" value={formatCurrency(data?.mySalesMonth ?? 0)} icon={Receipt} variant="info" loading={loading} />
        {showReservations && (
          <StatCard
            title="Reservaciones pendientes"
            value={String(pendingCount)}
            subtitle="Pedidos por atender"
            icon={CalendarCheck}
            variant={pendingCount > 0 ? 'warning' : 'default'}
            loading={reservationsLoading}
          />
        )}
        <StatCard
          title="Clientes con deuda"
          value={formatNumber(data?.debtorsCount ?? 0, 0)}
          subtitle="Saldos por cobrar"
          icon={Users}
          variant={data?.debtorsCount && data.debtorsCount > 0 ? 'danger' : 'default'}
          loading={loading}
        />
        <StatCard
          title="Productos bajo stock"
          value={formatNumber(data?.lowStockCount ?? 0, 0)}
          subtitle="Cerca del mínimo"
          icon={AlertTriangle}
          variant={data?.lowStockCount && data.lowStockCount > 0 ? 'warning' : 'success'}
          loading={loading}
        />
      </div>

      {/* ── Gráfico y top productos ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Mis ventas últimos 30 días</h3>
          <p className="text-xs text-[var(--text-tertiary)] mb-4">Solo las ventas que registraste tú</p>
          {loading ? <div className="h-48 bg-[var(--bg-muted)] rounded-lg animate-pulse"/> : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data?.salesChart ?? []} margin={{ top: 4, right: 4, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="gvs" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2a84ff" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#2a84ff" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d"/>
                <XAxis dataKey="date" tick={{ fill: '#6e7681', fontSize: 10 }} tickLine={false} interval={6}/>
                <YAxis domain={[0, yMax]} tickFormatter={(v: number) => v>=1000 ? `${(v/1000).toFixed(1)}k` : String(v)} tick={{ fill: '#6e7681', fontSize: 10 }} tickLine={false} axisLine={false}/>
                <Tooltip content={<CustomTooltip/>}/>
                <Area type="monotone" dataKey="total" stroke="#2a84ff" strokeWidth={2} fill="url(#gvs)"/>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Top productos</h3>
          {loading ? <div className="space-y-2">{[1,2,3,4,5].map(i=><div key={i} className="h-8 bg-[var(--bg-muted)] rounded animate-pulse"/>)}</div> : (
            data?.topProducts?.length ? (
              <div className="space-y-3">
                {data.topProducts.map((p, i) => {
                  const max = data.topProducts[0]?.total ?? 1;
                  return (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[var(--text-primary)] truncate max-w-[140px]">{p.name}</span>
                        <span className="text-[var(--text-secondary)] ml-2">{formatCurrency(p.total)}</span>
                      </div>
                      <div className="h-1.5 bg-[var(--bg-muted)] rounded-full">
                        <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(p.total / max) * 100}%` }}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm text-[var(--text-tertiary)] text-center py-8">Sin ventas aún</p>
          )}
        </div>
      </div>

      {/* ── Reservaciones pendientes + Mis últimas ventas ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {showReservations && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Reservaciones pendientes
              {!reservationsLoading && pendingCount > 0 && (
                <span className="ml-2 text-xs font-normal text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full border border-yellow-500/20">
                  {pendingCount} nueva(s)
                </span>
              )}
            </h3>
            <Link href="/dashboard/reservaciones" className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1 transition-colors">
              Ver todas
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
          {reservationsLoading ? (
            <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-14 bg-[var(--bg-muted)] rounded-xl animate-pulse" />)}</div>
          ) : pendingCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-[var(--text-tertiary)]">
              <Check className="w-8 h-8 text-green-400/50 mb-2" />
              <p className="text-sm">No hay reservaciones pendientes</p>
              <p className="text-xs mt-0.5">Los pedidos de clientes aparecerán aquí</p>
            </div>
          ) : (
            <div className="space-y-2">
              {pendingPreview.map(r => (
                <div key={r.id} className="flex items-center gap-3 p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] hover:border-yellow-500/20 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center flex-shrink-0">
                    <ShoppingCart className="w-4 h-4 text-yellow-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.customer_name}</p>
                    <p className="text-xs text-[var(--text-secondary)] truncate">
                      {r.product_name} · {formatNumber(Number(r.quantity), 0)} unidad(es)
                    </p>
                  </div>
                  <span className="text-[10px] text-[var(--text-tertiary)] whitespace-nowrap">
                    {r.created_at ? (() => {
                      const diff = Date.now() - new Date(r.created_at).getTime();
                      const hours = Math.floor(diff / 3600000);
                      if (hours < 1) return 'Ahora';
                      if (hours < 24) return `Hace ${hours}h`;
                      return `Hace ${Math.floor(hours / 24)}d`;
                    })() : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        <div className={cn('card p-5', !showReservations && 'lg:col-span-2')}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Mis últimas ventas</h3>
            <Link href="/dashboard/ventas" className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1 transition-colors">
              Ver historial
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
          {loading ? (
            <div className="space-y-3">{[1, 2, 3, 4].map(i => <div key={i} className="h-14 bg-[var(--bg-muted)] rounded-xl animate-pulse" />)}</div>
          ) : !data?.recentSales?.length ? (
            <div className="flex flex-col items-center justify-center py-6 text-[var(--text-tertiary)]">
              <Receipt className="w-8 h-8 text-brand-400/40 mb-2" />
              <p className="text-sm">Aún no has registrado ventas</p>
              <button
                onClick={handleNewSale}
                className="mt-3 text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1 transition-colors"
              >
                <Plus className="w-3 h-3" />
                Registrar tu primera venta
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {data.recentSales.slice(0, 6).map(s => (
                <div key={s.id} className="flex items-center gap-3 p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] hover:border-brand-500/20 transition-colors">
                  <div className={cn('w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0', PAYMENT_COLORS[s.payment_method] ?? PAYMENT_COLORS.cash)}>
                    <Receipt className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{s.customer_name ?? 'Cliente ocasional'}</p>
                    <p className="text-xs text-[var(--text-secondary)] truncate">
                      {PAYMENT_LABELS[s.payment_method] ?? '—'} · {s.date ? timeAgo(s.date) : '—'}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-[var(--text-primary)] whitespace-nowrap">{formatCurrency(Number(s.total))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal: Abrir turno (compartido) */}
      <OpenShiftModal
        open={showOpenShift}
        pos={shifts.pos}
        openPosIds={openPosIds}
        onClose={() => setShowOpenShift(false)}
        onOpened={loadShifts}
        preferredPosId={user?.pos_id ?? undefined}
      />

      {/* Modal: Cerrar turno (arqueo) */}
      <Modal open={closeShift !== null} onClose={() => setCloseShift(null)} title="Cerrar turno — arqueo de caja">
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Cuenta el efectivo en caja y regístralo. El sistema calculará el efectivo esperado según los movimientos del turno y la diferencia.
          </p>
          <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl p-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-[var(--text-tertiary)]">Caja</p>
              <p className="font-medium text-[var(--text-primary)] truncate">{String(closeShift?.pos_name ?? '—')}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-tertiary)]">Fondo inicial</p>
              <p className="font-medium text-[var(--text-primary)]">{formatCurrency(Number(closeShift?.opening_cash ?? 0))}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-[var(--text-tertiary)]">Abierto desde</p>
              <p className="font-medium text-[var(--text-primary)] truncate">{closeShift?.opened_at ? formatDateTime(String(closeShift.opened_at)) : '—'}</p>
            </div>
          </div>
          <div>
            <label className="label">Efectivo contado en caja *</label>
            <div className="relative">
              <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
              <input type="number" min="0" step="1" className="input pl-9"
                value={closeForm.closing_cash || ''}
                onChange={e => setCloseForm(f => ({ ...f, closing_cash: parseFloat(e.target.value) || 0 }))}
              />
            </div>
          </div>
          <div>
            <label className="label">Nota (opcional)</label>
            <input type="text" className="input" placeholder="Ej: Turno cerrado sin novedades"
              value={closeForm.notes}
              onChange={e => setCloseForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="flex flex-col xs:flex-row gap-2 justify-end pt-2">
            <button onClick={() => setCloseShift(null)} className="btn-secondary flex-1 xs:flex-none">Cancelar</button>
            <button onClick={handleCloseShift} disabled={closingBusy} className="btn-primary flex-1 xs:flex-none disabled:opacity-50">
              {closingBusy ? 'Cerrando...' : 'Cerrar turno'}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
