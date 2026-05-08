'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { BarChart3, TrendingUp, TrendingDown, Package, Users, Download, RefreshCw } from 'lucide-react';
import { exportToCSV } from '@/lib/export';

function exportCSV(data: R[], filename: string) { exportToCSV(data as Record<string, unknown>[], filename); }

type TabKey = 'ventas'|'rentabilidad'|'precios'|'reabastecimiento'|'cuentas';
type R = Record<string,unknown>;

const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key:'ventas', label:'Ventas', icon:TrendingUp },
  { key:'rentabilidad', label:'Rentabilidad', icon:BarChart3 },
  { key:'precios', label:'Variación Precios', icon:TrendingDown },
  { key:'reabastecimiento', label:'Reabastecimiento', icon:Package },
  { key:'cuentas', label:'Cuentas', icon:Users },
];

const Tip = ({ active, payload, label }: { active?:boolean; payload?:{name:string;value:number;color:string}[]; label?:string }) => {
  if (!active||!payload?.length) return null;
  return (
    <div className="bg-[#1c2128] border border-[#30363d] rounded-xl px-3 py-2.5 text-xs shadow-xl">
      <p className="text-[#8b949e] mb-1 font-medium">{label}</p>
      {payload.map((p,i)=><p key={i} className="font-semibold" style={{color:p.color}}>{p.name}: {Number(p.value)>100?formatCurrency(p.value):formatNumber(p.value)}</p>)}
    </div>
  );
};

export default function ReportesPage() {
  const [tab, setTab] = useState<TabKey>('ventas');
  const [range, setRange] = useState<'7d'|'30d'|'90d'>('30d');
  const [loading, setLoading] = useState(false);
  const [salesData, setSalesData] = useState<R[]>([]);
  const [salesSummary, setSalesSummary] = useState({ total:0, count:0, avg:0, gastos:0, utilidad:0 });
  const [margins, setMargins] = useState<R[]>([]);
  const [priceProducts, setPriceProducts] = useState<R[]>([]);
  const [priceHistory, setPriceHistory] = useState<R[]>([]);
  const [selectedPriceProduct, setSelectedPriceProduct] = useState('');
  const [forecasts, setForecasts] = useState<R[]>([]);
  const [debts, setDebts] = useState<R[]>([]);
  const [totalDebt, setTotalDebt] = useState(0);

  const days = range==='7d'?7:range==='30d'?30:90;

  const loadSales = useCallback(async () => {
    setLoading(true);
    const [d, e] = await Promise.all([
      fetch(`/api/reports?type=sales_detail&days=${days}`).then(r=>r.json()),
      fetch(`/api/expenses?from=${new Date(Date.now()-days*864e5).toISOString().slice(0,10)}`).then(r=>r.json()),
    ]);
    setSalesData(d as R[]);
    const totalV = (d as R[]).reduce((a,r)=>a+Number(r.total??0),0);
    const totalG = (e as R[]).reduce((a,r)=>a+Number(r.amount??0),0);
    const cnt = (d as R[]).reduce((a,r)=>a+Number(r.count??0),0);
    setSalesSummary({ total:totalV, count:cnt, avg:cnt?totalV/cnt:0, gastos:totalG, utilidad:totalV-totalG });
    setLoading(false);
  }, [days]);

  const loadMargins = useCallback(async () => {
    setLoading(true);
    const d = await fetch(`/api/reports?type=margins&days=${days}`).then(r=>r.json());
    setMargins(d as R[]); setLoading(false);
  }, [days]);

  const loadPriceHistory = useCallback(async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    const d = await fetch(`/api/reports?type=price_history&product_id=${pid}`).then(r=>r.json());
    setPriceHistory(d as R[]); setLoading(false);
  }, []);

  const loadProducts = useCallback(async () => {
    const d = await fetch('/api/products').then(r=>r.json());
    setPriceProducts(d as R[]);
    if ((d as R[]).length&&!selectedPriceProduct) { setSelectedPriceProduct(String((d as R[])[0].id)); loadPriceHistory(String((d as R[])[0].id)); }
  }, [selectedPriceProduct, loadPriceHistory]);

  const loadForecasts = useCallback(async () => {
    setLoading(true);
    const d = await fetch('/api/reports?type=restock').then(r=>r.json());
    setForecasts(d as R[]); setLoading(false);
  }, []);

  const loadDebts = useCallback(async () => {
    setLoading(true);
    const d = await fetch('/api/reports?type=debts').then(r=>r.json());
    setDebts(d as R[]); setTotalDebt((d as R[]).reduce((a,r)=>a+Number(r.balance??0),0)); setLoading(false);
  }, []);

  useEffect(() => {
    if (tab==='ventas') loadSales();
    else if (tab==='rentabilidad') loadMargins();
    else if (tab==='precios') loadProducts();
    else if (tab==='reabastecimiento') loadForecasts();
    else if (tab==='cuentas') loadDebts();
  }, [tab, range]);

  const urgencyBadge = (u: string) => u==='critical'?<span className="badge-danger">Crítico</span>:u==='soon'?<span className="badge-warning">Pronto</span>:<span className="badge-success">OK</span>;

  return (
    <div className="space-y-5">
      <div className="flex gap-1 overflow-x-auto pb-1">
        {tabs.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)} className={cn('flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors', tab===t.key?'bg-brand-600/20 text-brand-400 font-medium':'text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#161b22]')}>
            <t.icon size={15}/>{t.label}
          </button>
        ))}
      </div>

      {(tab==='ventas'||tab==='rentabilidad')&&(
        <div className="flex gap-2">
          {(['7d','30d','90d'] as const).map(r=>(
            <button key={r} onClick={()=>setRange(r)} className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors', range===r?'bg-brand-600 border-brand-600 text-white':'border-[#30363d] text-[#8b949e] hover:text-[#e6edf3] hover:border-[#6e7681]')}>
              {r==='7d'?'7 días':r==='30d'?'30 días':'90 días'}
            </button>
          ))}
        </div>
      )}

      {loading&&<div className="flex justify-center h-48 items-center"><div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>}

      {!loading&&tab==='ventas'&&(
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[{label:'Total ventas',value:formatCurrency(salesSummary.total),color:'text-blue-400'},{label:'Nº ventas',value:String(salesSummary.count),color:'text-[#e6edf3]'},{label:'Ticket prom.',value:formatCurrency(salesSummary.avg),color:'text-purple-400'},{label:'Gastos',value:formatCurrency(salesSummary.gastos),color:'text-red-400'},{label:'Utilidad',value:formatCurrency(salesSummary.utilidad),color:salesSummary.utilidad>=0?'text-green-400':'text-red-400'}].map(c=>(
              <div key={c.label} className="card p-4"><p className="text-xs text-[#6e7681] mb-1">{c.label}</p><p className={cn('text-lg font-semibold',c.color)}>{c.value}</p></div>
            ))}
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#e6edf3]">Ventas por día</h3>
              <button onClick={()=>exportCSV(salesData,'ventas')} className="btn-secondary flex items-center gap-1.5 text-xs"><Download size={13}/>CSV</button>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={salesData} margin={{top:4,right:4,left:-15,bottom:0}}>
                <defs><linearGradient id="gv" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2a84ff" stopOpacity={0.3}/><stop offset="95%" stopColor="#2a84ff" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d"/>
                <XAxis dataKey="date" tick={{fill:'#6e7681',fontSize:10}} tickLine={false} interval={Math.floor(days/7)}/>
                <YAxis tick={{fill:'#6e7681',fontSize:10}} tickLine={false} axisLine={false}/>
                <Tooltip content={<Tip/>}/>
                <Area type="monotone" dataKey="total" name="Ventas" stroke="#2a84ff" strokeWidth={2} fill="url(#gv)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!loading&&tab==='rentabilidad'&&(
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#e6edf3]">Margen por producto</h3>
            <button onClick={()=>exportCSV(margins,'rentabilidad')} className="btn-secondary flex items-center gap-1.5 text-xs"><Download size={13}/>CSV</button>
          </div>
          {margins.length===0?<p className="text-center text-[#6e7681] py-8 text-sm">Sin datos en este período</p>:(
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[#21262d]">{['Producto','P.Venta','Costo','Margen','%','Total'].map(h=><th key={h} className="px-3 py-2 text-left text-xs font-medium text-[#6e7681] uppercase tracking-wide">{h}</th>)}</tr></thead>
                <tbody>{margins.map((m,i)=>(
                  <tr key={i} className="border-b border-[#21262d] last:border-0 hover:bg-[#1c2128]">
                    <td className="px-3 py-2.5 text-[#e6edf3] font-medium">{String(m.name)}</td>
                    <td className="px-3 py-2.5 text-[#8b949e]">{formatCurrency(Number(m.sale_price))}</td>
                    <td className="px-3 py-2.5 text-[#8b949e]">{formatCurrency(Number(m.cost))}</td>
                    <td className="px-3 py-2.5 text-green-400">{formatCurrency(Number(m.margin))}</td>
                    <td className="px-3 py-2.5"><div className="flex items-center gap-2"><div className="flex-1 bg-[#21262d] rounded-full h-1.5 max-w-[60px]"><div className="h-1.5 rounded-full bg-brand-500" style={{width:`${Math.min(100,Number(m.margin_pct))}%`}}/></div><span className={cn('text-xs font-medium',Number(m.margin_pct)>=20?'text-green-400':Number(m.margin_pct)>=10?'text-yellow-400':'text-red-400')}>{formatNumber(Number(m.margin_pct),1)}%</span></div></td>
                    <td className="px-3 py-2.5 text-[#8b949e]">{formatCurrency(Number(m.total_sold))}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!loading&&tab==='precios'&&(
        <div className="card p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
            <h3 className="text-sm font-semibold text-[#e6edf3] flex-1">Historial de precios de compra</h3>
            <select className="input max-w-xs" value={selectedPriceProduct} onChange={e=>{setSelectedPriceProduct(e.target.value);loadPriceHistory(e.target.value);}}>
              <option value="">Selecciona un producto</option>
              {priceProducts.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}
            </select>
          </div>
          {priceHistory.length===0?<div className="flex flex-col items-center justify-center py-14 text-[#6e7681]"><TrendingDown size={32} className="mb-3 opacity-40"/><p className="text-sm">Selecciona un producto para ver el historial</p></div>:(
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={priceHistory} margin={{top:4,right:4,left:-15,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d"/>
                <XAxis dataKey="date" tick={{fill:'#6e7681',fontSize:10}} tickLine={false}/>
                <YAxis tick={{fill:'#6e7681',fontSize:10}} tickLine={false} axisLine={false}/>
                <Tooltip content={<Tip/>}/>
                <Legend iconSize={10} wrapperStyle={{fontSize:11,color:'#8b949e'}}/>
                {Array.from(new Set(priceHistory.map(p=>String(p.supplier_name)))).map((s,i)=>(
                  <Line key={s} type="monotone" dataKey="price" data={priceHistory.filter(p=>p.supplier_name===s)} name={s} stroke={`hsl(${i*60+200},70%,60%)`} strokeWidth={2} dot={{r:4}} connectNulls/>
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {!loading&&tab==='reabastecimiento'&&(
        <div className="space-y-5">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div><h3 className="text-sm font-semibold text-[#e6edf3]">Proyección de reabastecimiento</h3><p className="text-xs text-[#6e7681] mt-0.5">Basado en ventas promedio de los últimos 30 días</p></div>
              <div className="flex gap-2">
                <button onClick={loadForecasts} className="btn-secondary flex items-center gap-1.5 text-xs"><RefreshCw size={13}/>Actualizar</button>
                <button onClick={()=>exportCSV(forecasts,'reabastecimiento')} className="btn-secondary flex items-center gap-1.5 text-xs"><Download size={13}/>CSV</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[#21262d]">{['Producto','Stock actual','Venta/día','Días restantes','Fecha pedido','Urgencia'].map(h=><th key={h} className="px-3 py-2 text-left text-xs font-medium text-[#6e7681] uppercase tracking-wide">{h}</th>)}</tr></thead>
                <tbody>{forecasts.map(f=>(
                  <tr key={String(f.id)} className="border-b border-[#21262d] last:border-0 hover:bg-[#1c2128]">
                    <td className="px-3 py-2.5 text-[#e6edf3] font-medium">{String(f.name)}</td>
                    <td className="px-3 py-2.5 text-[#8b949e]">{formatNumber(Number(f.stock),1)}</td>
                    <td className="px-3 py-2.5 text-[#8b949e]">{Number(f.avg_daily_sales)>0?formatNumber(Number(f.avg_daily_sales),2):'—'}</td>
                    <td className="px-3 py-2.5"><span className={cn('font-medium',Number(f.days_until_empty)<=3?'text-red-400':Number(f.days_until_empty)<=7?'text-yellow-400':'text-green-400')}>{Number(f.days_until_empty)>=9999?'∞':`${Number(f.days_until_empty)}d`}</span></td>
                    <td className="px-3 py-2.5 text-[#8b949e] text-xs">{Number(f.days_until_empty)>=9999?'—':String(f.restock_date)}</td>
                    <td className="px-3 py-2.5">{urgencyBadge(String(f.urgency))}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!loading&&tab==='cuentas'&&(
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-5"><p className="text-xs text-[#6e7681] mb-1">Total por cobrar</p><p className="text-2xl font-semibold text-red-400">{formatCurrency(totalDebt)}</p></div>
            <div className="card p-5"><p className="text-xs text-[#6e7681] mb-1">Clientes con deuda</p><p className="text-2xl font-semibold text-[#e6edf3]">{debts.length}</p></div>
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#e6edf3]">Cuentas pendientes</h3>
              <button onClick={()=>exportCSV(debts,'cuentas')} className="btn-secondary flex items-center gap-1.5 text-xs"><Download size={13}/>CSV</button>
            </div>
            {debts.length===0?<p className="text-center text-[#6e7681] py-8 text-sm">No hay cuentas pendientes 🎉</p>:(
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[#21262d]">{['Cliente','Teléfono','Saldo','% del total'].map(h=><th key={h} className="px-3 py-2 text-left text-xs font-medium text-[#6e7681] uppercase tracking-wide">{h}</th>)}</tr></thead>
                  <tbody>{debts.map(d=>(
                    <tr key={String(d.id)} className="border-b border-[#21262d] last:border-0 hover:bg-[#1c2128]">
                      <td className="px-3 py-2.5 text-[#e6edf3] font-medium">{String(d.name)}</td>
                      <td className="px-3 py-2.5 text-[#8b949e]">{String(d.phone??'—')}</td>
                      <td className="px-3 py-2.5 text-red-400 font-medium">{formatCurrency(Number(d.balance))}</td>
                      <td className="px-3 py-2.5"><div className="flex items-center gap-2"><div className="flex-1 bg-[#21262d] rounded-full h-1.5 max-w-[60px]"><div className="h-1.5 rounded-full bg-red-500" style={{width:`${Math.min(100,(Number(d.balance)/totalDebt)*100)}%`}}/></div><span className="text-xs text-[#8b949e]">{formatNumber((Number(d.balance)/totalDebt)*100,1)}%</span></div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
