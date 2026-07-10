'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import { Clock, DollarSign, ShoppingCart, Package, Users, TrendingUp, TrendingDown, BarChart2, AlertTriangle, Calendar, Plus, ShoppingBag, ExternalLink, Check } from 'lucide-react';
import StatCard from '@/components/ui/StatCard';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DashData {
  salesToday: number; salesWeek: number; salesMonth: number;
  netProfitToday: number; netProfitWeek: number; netProfitMonth: number;
  cogsToday: number; cogsWeek: number; cogsMonth: number;
  expensesToday: number; expensesWeek: number; expensesMonth: number;
  pendingDebt: number; pendingDebtCount: number; lowStockCount: number;
  salesChart: { date: string; total: number }[];
  topProducts: { name: string; total: number }[];
  timezone: string;
}

type Period = 'today' | 'week' | 'month';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Hoy' },
  { key: 'week', label: 'Esta semana' },
  { key: 'month', label: 'Este mes' },
];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1c2128] border border-[#30363d] rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="text-[#8b949e] mb-1">{label}</p>
      <p className="text-brand-400 font-semibold">{formatCurrency(payload[0].value)}</p>
    </div>
  );
};

function fmtInTz(date: Date, tz: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('es-DO', { timeZone: tz, ...options }).format(date);
}

export default function DashboardPage() {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<Date | null>(null);
  const [period, setPeriod] = useState<Period>('today');
  const [pendingReservations, setPendingReservations] = useState<{ id: string; customer_name: string; product_name: string; quantity: number; created_at: string }[]>([]);
  const [reservationsLoading, setReservationsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reports?type=dashboard&days=30')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));

    // Fetch pending reservations
    fetch('/api/reservations?status=pending')
      .then(r => r.json())
      .then(d => { setPendingReservations(Array.isArray(d) ? d.slice(0, 3) : []); setReservationsLoading(false); })
      .catch(() => setReservationsLoading(false));
  }, []);

  // Initialize clock on client only (avoid hydration mismatch) and update every 30s
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const maxSales = data?.salesChart?.length
    ? Math.max(...data.salesChart.map(d => d.total))
    : 0;
  const yMax = Math.ceil(maxSales * 1.15 / 1000) * 1000 || 1000;

  // Valores según el período seleccionado
  const salesValue = data ? (period === 'today' ? data.salesToday : period === 'week' ? data.salesWeek : data.salesMonth) : 0;
  const netProfitValue = data ? (period === 'today' ? data.netProfitToday : period === 'week' ? data.netProfitWeek : data.netProfitMonth) : 0;
  const expensesValue = data ? (period === 'today' ? data.expensesToday : period === 'week' ? data.expensesWeek : data.expensesMonth) : 0;

  const periodLabel = period === 'today' ? 'hoy' : period === 'week' ? 'esta semana' : 'este mes';

  const tz = data?.timezone ?? 'America/Havana';

  return (
    <div className="space-y-6">
      {/* System date/time indicator */}
      {now && (
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2 text-sm text-[#8b949e]">
            <Clock className="w-4 h-4 text-brand-400" />
            <span className="capitalize">{fmtInTz(now, tz, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
            <span className="text-[#6e7681]">·</span>
            <span className="font-mono font-medium text-[#e6edf3]">{fmtInTz(now, tz, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
            <span className="text-[10px] bg-[#21262d] px-1.5 py-0.5 rounded text-[#6e7681] font-mono">
              {tz.split('/').pop()}
            </span>
          </div>
          {loading && <div className="w-32 h-4 bg-[#21262d] rounded animate-pulse" />}
        </div>
      )}

      {/* Period filter buttons */}
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-[#6e7681]" />
        <div className="flex gap-1 bg-[#161b22] rounded-lg p-0.5 border border-[#21262d]">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-all',
                period === key
                  ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30 shadow-sm'
                  : 'text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#21262d] border border-transparent'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Quick actions ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Link
          href="/dashboard/ventas"
          className="card p-4 flex items-center gap-3 hover:border-brand-500/30 transition-all duration-200 hover:-translate-y-0.5 group"
        >
          <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center group-hover:bg-brand-500/20 transition-colors">
            <Plus className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#e6edf3] group-hover:text-brand-400 transition-colors">Nueva venta</p>
            <p className="text-xs text-[#6e7681]">Registrar venta</p>
          </div>
        </Link>
        <Link
          href="/dashboard/inventario"
          className="card p-4 flex items-center gap-3 hover:border-emerald-500/30 transition-all duration-200 hover:-translate-y-0.5 group"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
            <ShoppingBag className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#e6edf3] group-hover:text-emerald-400 transition-colors">Registrar compra</p>
            <p className="text-xs text-[#6e7681]">Nuevo pedido</p>
          </div>
        </Link>
        <Link
          href="/dashboard/inventario"
          className="card p-4 flex items-center gap-3 hover:border-blue-500/30 transition-all duration-200 hover:-translate-y-0.5 group"
        >
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/20 transition-colors">
            <Package className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#e6edf3] group-hover:text-blue-400 transition-colors">Ver productos</p>
            <p className="text-xs text-[#6e7681]">Inventario</p>
          </div>
        </Link>
        <Link
          href="/dashboard/clientes"
          className="card p-4 flex items-center gap-3 hover:border-purple-500/30 transition-all duration-200 hover:-translate-y-0.5 group"
        >
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center group-hover:bg-purple-500/20 transition-colors">
            <Users className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#e6edf3] group-hover:text-purple-400 transition-colors">Ver clientes</p>
            <p className="text-xs text-[#6e7681]">Cartera</p>
          </div>
        </Link>
      </div>

      {/* Main stat cards — filtrados por período */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard title={`Ventas ${periodLabel}`} value={formatCurrency(salesValue)} icon={DollarSign} variant="default" loading={loading} />
        <StatCard
          title={`Ganancia neta ${periodLabel}`}
          value={formatCurrency(netProfitValue)}
          icon={netProfitValue >= 0 ? TrendingUp : TrendingDown}
          variant={netProfitValue >= 0 ? 'success' : 'danger'}
          loading={loading}
        />
        <StatCard title={`Gastos ${periodLabel}`} value={formatCurrency(expensesValue)} icon={TrendingDown} variant="warning" loading={loading} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard title="Por cobrar" value={formatCurrency(data?.pendingDebt ?? 0)} subtitle={`${data?.pendingDebtCount ?? 0} clientes con deuda`} icon={Users} variant={data?.pendingDebt && data.pendingDebt > 0 ? 'warning' : 'default'} loading={loading} />
        <StatCard title="Stock bajo" value={String(data?.lowStockCount ?? 0)} subtitle="Productos bajo mínimo" icon={AlertTriangle} variant={data?.lowStockCount && data.lowStockCount > 0 ? 'danger' : 'success'} loading={loading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-[#e6edf3] mb-4">Ventas últimos 30 días</h3>
          {loading ? <div className="h-48 bg-[#21262d] rounded-lg animate-pulse"/> : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data?.salesChart ?? []} margin={{ top: 4, right: 4, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2a84ff" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#2a84ff" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d"/>
                <XAxis dataKey="date" tick={{ fill: '#6e7681', fontSize: 10 }} tickLine={false} interval={6}/>
                <YAxis domain={[0, yMax]} tickFormatter={(v: number) => v>=1000 ? `${(v/1000).toFixed(1)}k` : String(v)} tick={{ fill: '#6e7681', fontSize: 10 }} tickLine={false} axisLine={false}/>
                <Tooltip content={<CustomTooltip/>}/>
                <Area type="monotone" dataKey="total" stroke="#2a84ff" strokeWidth={2} fill="url(#gv)"/>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-semibold text-[#e6edf3] mb-4">Top productos</h3>
          {loading ? <div className="space-y-2">{[1,2,3,4,5].map(i=><div key={i} className="h-8 bg-[#21262d] rounded animate-pulse"/>)}</div> : (
            data?.topProducts?.length ? (
              <div className="space-y-3">
                {data.topProducts.map((p, i) => {
                  const max = data.topProducts[0]?.total ?? 1;
                  return (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-[#e6edf3] truncate max-w-[140px]">{p.name}</span>
                        <span className="text-[#8b949e] ml-2">{formatCurrency(p.total)}</span>
                      </div>
                      <div className="h-1.5 bg-[#21262d] rounded-full">
                        <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(p.total / max) * 100}%` }}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm text-[#6e7681] text-center py-8">Sin ventas aún</p>
          )}
        </div>
      </div>

      {/* ── Pending Reservations Widget ── */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[#e6edf3]">
            Reservaciones pendientes
            {!reservationsLoading && pendingReservations.length > 0 && (
              <span className="ml-2 text-xs font-normal text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full border border-yellow-500/20">
                {pendingReservations.length} nueva(s)
              </span>
            )}
          </h3>
          <Link
            href="/dashboard/reservaciones"
            className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1 transition-colors"
          >
            Ver todas
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
        {reservationsLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-14 bg-[#21262d] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : pendingReservations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-[#6e7681]">
            <Check className="w-8 h-8 text-green-400/50 mb-2" />
            <p className="text-sm">No hay reservaciones pendientes</p>
            <p className="text-xs mt-0.5">Los pedidos de clientes aparecerán aquí</p>
          </div>
        ) : (
          <div className="space-y-2">
            {pendingReservations.map(r => (
              <div
                key={r.id}
                className="flex items-center gap-3 p-3 bg-[#0d1117] rounded-xl border border-[#21262d] hover:border-yellow-500/20 transition-colors"
              >
                <div className="w-9 h-9 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center flex-shrink-0">
                  <ShoppingCart className="w-4 h-4 text-yellow-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#e6edf3] truncate">{r.customer_name}</p>
                  <p className="text-xs text-[#8b949e] truncate">
                    {r.product_name} · {Number(r.quantity)} unidad(es)
                  </p>
                </div>
                <span className="text-[10px] text-[#6e7681] whitespace-nowrap">
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
    </div>
  );
}
