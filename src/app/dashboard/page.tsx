'use client';
import { useEffect, useState } from 'react';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import { DollarSign, ShoppingCart, Package, Users, TrendingUp, TrendingDown, BarChart2, AlertTriangle } from 'lucide-react';
import StatCard from '@/components/ui/StatCard';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DashData {
  salesToday: number; salesWeek: number; salesMonth: number;
  expensesMonth: number; netProfitMonth: number;
  pendingDebt: number; pendingDebtCount: number; lowStockCount: number;
  salesChart: { date: string; total: number }[];
  topProducts: { name: string; total: number }[];
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1c2128] border border-[#30363d] rounded-xl px-3 py-2 text-xs shadow-xl">
      <p className="text-[#8b949e] mb-1">{label}</p>
      <p className="text-brand-400 font-semibold">{formatCurrency(payload[0].value)}</p>
    </div>
  );
};

export default function DashboardPage() {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/reports?type=dashboard&days=30')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Ventas hoy" value={formatCurrency(data?.salesToday ?? 0)} icon={DollarSign} variant="default" loading={loading} />
        <StatCard title="Esta semana" value={formatCurrency(data?.salesWeek ?? 0)} icon={BarChart2} variant="info" loading={loading} />
        <StatCard title="Este mes" value={formatCurrency(data?.salesMonth ?? 0)} icon={TrendingUp} variant="success" loading={loading} />
        <StatCard title="Ganancia neta" value={formatCurrency(data?.netProfitMonth ?? 0)} icon={data?.netProfitMonth && data.netProfitMonth >= 0 ? TrendingUp : TrendingDown} variant={data?.netProfitMonth && data.netProfitMonth >= 0 ? 'success' : 'danger'} loading={loading} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Gastos mes" value={formatCurrency(data?.expensesMonth ?? 0)} icon={TrendingDown} variant="warning" loading={loading} />
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
                <YAxis tick={{ fill: '#6e7681', fontSize: 10 }} tickLine={false} axisLine={false}/>
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
