'use client';
import { useEffect, useState } from 'react';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import { Clock, DollarSign, ShoppingCart, Package, Users, TrendingUp, TrendingDown, BarChart2, AlertTriangle, Calendar } from 'lucide-react';
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

  useEffect(() => {
    fetch('/api/reports?type=dashboard&days=30')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
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
    </div>
  );
}
