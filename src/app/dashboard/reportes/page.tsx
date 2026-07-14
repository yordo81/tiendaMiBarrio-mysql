'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatCurrency, formatNumber, cn } from '@/lib/utils';
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { BarChart3, TrendingUp, TrendingDown, Package, Users, Download, RefreshCw, Warehouse } from 'lucide-react';
import InfoTooltip from '@/components/ui/Tooltip';
import { exportToCSV } from '@/lib/export';
import { api } from '@/lib/api-client';
import { toast } from '@/components/ui/toaster';

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
    <div className="bg-[#1c2128] border border-[var(--border-secondary)] rounded-xl px-3 py-2.5 text-xs shadow-xl">
      <p className="text-[var(--text-secondary)] mb-1 font-medium">{label}</p>
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
  const [marginSummary, setMarginSummary] = useState({ totalSales:0, totalCost:0, grossProfit:0, expenses:0, netProfit:0, netMarginPct:0 });
  const [priceProducts, setPriceProducts] = useState<R[]>([]);
  const [priceHistory, setPriceHistory] = useState<R[]>([]);
  const [selectedPriceProduct, setSelectedPriceProduct] = useState('');
  const [forecasts, setForecasts] = useState<R[]>([]);
  const [debts, setDebts] = useState<R[]>([]);
  const [totalDebt, setTotalDebt] = useState(0);
  const [locations, setLocations] = useState<R[]>([]);
  const [locationFilter, setLocationFilter] = useState('');

  const days = range==='7d'?7:range==='30d'?30:90;

  const loadSales = useCallback(async () => {
    setLoading(true);
    const locQ = locationFilter ? `&location_id=${locationFilter}` : '';
    const fromDate = new Date(Date.now()-days*864e5).toISOString().slice(0,10);

    // Fetch sales data
    let sales: R[] = [];
    try {
      const res = await fetch(`/api/reports?type=sales_detail&days=${days}${locQ}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Error al cargar ventas' }));
        toast.error(String(err?.error ?? 'Error al cargar ventas'));
      } else {
        const d = await res.json();
        sales = Array.isArray(d) ? d as R[] : [];
      }
    } catch(e) { console.error('[loadSales]', e); toast.error('Error de red al cargar ventas'); }

    // Fetch expenses separately so a failure doesn't block sales data
    let expenses: R[] = [];
    try {
      const res = await fetch(`/api/expenses?from=${fromDate}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Error al cargar gastos' }));
        toast.error(String(err?.error ?? 'Error al cargar gastos'));
      } else {
        const e = await res.json();
        expenses = Array.isArray(e) ? e as R[] : [];
      }
    } catch(e) { console.error('[loadSales]', e); toast.error('Error de red al cargar gastos'); }

    setSalesData(sales);
    const totalV = sales.reduce((a,r)=>a+Number(r.total??0),0);
    const totalG = expenses.reduce((a,r)=>a+Number(r.amount??0),0);
    const cnt = sales.reduce((a,r)=>a+Number(r.count??0),0);
    setSalesSummary({ total:totalV, count:cnt, avg:cnt?totalV/cnt:0, gastos:totalG, utilidad:totalV-totalG });
    setLoading(false);
  }, [days, locationFilter]);

  const loadMargins = useCallback(async () => {
    setLoading(true);
    try {
      const locQ = locationFilter ? `&location_id=${locationFilter}` : '';
      const fromDate = new Date(Date.now()-days*864e5).toISOString().slice(0,10);

      const [marginRes, expensesRes] = await Promise.all([
        fetch(`/api/reports?type=margins&days=${days}${locQ}`),
        fetch(`/api/expenses?from=${fromDate}`),
      ]);

      const marginsData = await marginRes.json();
      const margins = Array.isArray(marginsData) ? marginsData as R[] : [];
      setMargins(margins);

      // Calcular totales a partir de los datos de márgenes (que sí respetan el filtro days)
      const totalSales = margins.reduce((a, r) => a + Number(r.total_sold ?? 0), 0);
      const totalCost = margins.reduce((a, r) => a + Number(r.total_cost ?? 0), 0);
      const grossProfit = totalSales - totalCost;

      let expenses = 0;
      try {
        const expensesData = await expensesRes.json();
        expenses = (Array.isArray(expensesData) ? expensesData as R[] : [])
          .reduce((a, r) => a + Number(r.amount ?? 0), 0);
      } catch(e) { console.error('[loadMargins expenses]', e); }

      const netProfit = grossProfit - expenses;
      const netMarginPct = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;
      setMarginSummary({ totalSales, totalCost, grossProfit, expenses, netProfit, netMarginPct });
    } catch(e) { console.error('[loadMargins]', e); }
    finally { setLoading(false); }
  }, [days, locationFilter]);

  const loadPriceHistory = useCallback(async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    try {
      const d = await fetch(`/api/reports?type=price_history&product_id=${pid}`).then(r=>r.json());
      setPriceHistory(Array.isArray(d) ? d as R[] : []);
    } catch(e) { console.error('[loadPriceHistory]', e); }
    finally { setLoading(false); }
  }, []);

  const loadProducts = useCallback(async () => {
    try {
      const d = await fetch('/api/products').then(r=>r.json());
      const arr = Array.isArray(d) ? d as R[] : [];
      setPriceProducts(arr);
      if (arr.length && !selectedPriceProduct) { setSelectedPriceProduct(String(arr[0].id)); loadPriceHistory(String(arr[0].id)); }
    } catch(e) { console.error('[loadProducts]', e); }
  }, [selectedPriceProduct, loadPriceHistory]);

  const loadForecasts = useCallback(async () => {
    setLoading(true);
    try {
      const locQ = locationFilter ? `&location_id=${locationFilter}` : '';
      const d = await fetch(`/api/reports?type=restock${locQ}`).then(r=>r.json());
      setForecasts(Array.isArray(d) ? d as R[] : []);
    } catch(e) { console.error('[loadForecasts]', e); }
    finally { setLoading(false); }
  }, [locationFilter]);

  const loadDebts = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch('/api/reports?type=debts').then(r=>r.json());
      const arr = Array.isArray(d) ? d as R[] : [];
      setDebts(arr);
      setTotalDebt(arr.reduce((a,r)=>a+Number(r.balance??0),0));
    } catch(e) { console.error('[loadDebts]', e); }
    finally { setLoading(false); }
  }, []);

  // Cargar ubicaciones al montar
  useEffect(() => {
    api.getLocations().then(setLocations).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab==='ventas') loadSales();
    else if (tab==='rentabilidad') loadMargins();
    else if (tab==='precios') loadProducts();
    else if (tab==='reabastecimiento') loadForecasts();
    else if (tab==='cuentas') loadDebts();
  }, [tab, range, locationFilter]);

  const urgencyBadge = (u: string) => u==='critical'?<span className="badge-danger">Crítico</span>:u==='soon'?<span className="badge-warning">Pronto</span>:<span className="badge-success">OK</span>;

  const maxSalesTotal = salesData.length ? Math.max(...salesData.map(d => Number(d.total ?? 0))) : 0;
  const yMaxSales = Math.ceil(maxSalesTotal * 1.15 / 1000) * 1000 || 1000;
  const maxPriceVal = priceHistory.length ? Math.max(...priceHistory.map(d => Number(d.price ?? 0))) : 0;
  const yMaxPrice = Math.ceil(maxPriceVal * 1.15 / 1000) * 1000 || 1000;

  return (
    <div className="space-y-5">        <div className="flex gap-1 overflow-x-auto pb-1">
          {tabs.map(t=>(
            <button key={t.key} onClick={()=>setTab(t.key)} className={cn('flex items-center gap-2 px-3 py-2 rounded-lg text-sm whitespace-nowrap transition-colors', tab===t.key?'bg-brand-600/20 text-brand-400 font-medium':'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[#161b22]')}>
              <t.icon size={15}/>{t.label}
            </button>
          ))}
          <div className="flex-1" />
          {(tab==='ventas'||tab==='rentabilidad'||tab==='reabastecimiento')&&locations.length>0&&(
            <div className="flex items-center gap-2">
              <Warehouse size={14} className="text-[var(--text-tertiary)] shrink-0" />
              <select
                value={locationFilter}
                onChange={e => setLocationFilter(e.target.value)}
                className="input py-1.5 px-2 text-xs max-w-[180px]"
              >
                <option value="">Todos los almacenes</option>
                {locations.map(l => (
                  <option key={String(l.id)} value={String(l.id)}>{String(l.name)}</option>
                ))}
              </select>
            </div>
          )}
        </div>

      {(tab==='ventas'||tab==='rentabilidad')&&(
        <div className="flex gap-2">
          {(['7d','30d','90d'] as const).map(r=>(
            <button key={r} onClick={()=>setRange(r)} className={cn('px-3 py-1.5 text-xs rounded-lg border transition-colors', range===r?'bg-brand-600 border-brand-600 text-white':'border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[#6e7681]')}>
              {r==='7d'?'7 días':r==='30d'?'30 días':'90 días'}
            </button>
          ))}
        </div>
      )}

      {loading&&<div className="flex justify-center h-48 items-center"><div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>}

      {!loading&&tab==='ventas'&&(
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[{label:'Total ventas',value:formatCurrency(salesSummary.total),color:'text-blue-400',tip:'Suma total de ventas en el período (sin descuentos ni devoluciones)'},{label:'Nº ventas',value:String(salesSummary.count),color:'text-[var(--text-primary)]',tip:''},{label:'Ticket prom.',value:formatCurrency(salesSummary.avg),color:'text-purple-400',tip:'Valor promedio por venta = Total ventas ÷ Nº ventas'},{label:'Gastos',value:formatCurrency(salesSummary.gastos),color:'text-red-400',tip:'Suma de gastos operativos registrados en el período'},{label:'Utilidad',value:formatCurrency(salesSummary.utilidad),color:salesSummary.utilidad>=0?'text-green-400':'text-red-400',tip:'Ventas totales menos gastos del período'}].map(c=>(
              <div key={c.label} className="card p-4"><p className="text-xs text-[var(--text-tertiary)] mb-1">{c.tip ? <InfoTooltip content={c.tip} iconClassName="w-3 h-3 ml-0.5 inline-block -mt-0.5">{c.label}</InfoTooltip> : c.label}</p><p className={cn('text-lg font-semibold',c.color)}>{c.value}</p></div>
            ))}
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Ventas por día</h3>
              <button onClick={()=>exportCSV(salesData,'ventas')} className="btn-secondary flex items-center gap-1.5 text-xs"><Download size={13}/>CSV</button>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={salesData} margin={{top:4,right:4,left:-15,bottom:0}}>
                <defs><linearGradient id="gv" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2a84ff" stopOpacity={0.3}/><stop offset="95%" stopColor="#2a84ff" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d"/>
                <XAxis dataKey="date" tick={{fill:'#6e7681',fontSize:10}} tickLine={false} interval={Math.floor(days/7)}/>
                <YAxis domain={[0, yMaxSales]} tickFormatter={(v:number)=>v>=1000?`${(v/1000).toFixed(1)}k`:String(v)} tick={{fill:'#6e7681',fontSize:10}} tickLine={false} axisLine={false}/>
                <Tooltip content={<Tip/>}/>
                <Area type="monotone" dataKey="total" name="Ventas" stroke="#2a84ff" strokeWidth={2} fill="url(#gv)"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!loading&&tab==='rentabilidad'&&(
        <div className="space-y-5">
          {/* Resumen de costos y márgenes */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {[
              { label:'Ventas totales', value:formatCurrency(marginSummary.totalSales), color:'text-blue-400', tip:'Suma total de ventas en el período' },
              { label:'Costo ventas (COGS)', value:formatCurrency(marginSummary.totalCost), color:'text-orange-400', tip:'Costo total de los productos vendidos = Σ(cantidad × costo unitario)' },
              { label:'Margen bruto', value:formatCurrency(marginSummary.grossProfit), color:'text-green-400', tip:'Ventas totales menos costo de ventas. Ganancia antes de gastos operativos.' },
              { label:'Gastos operativos', value:formatCurrency(marginSummary.expenses), color:'text-red-400', tip:'Suma de gastos operativos registrados en el período (salarios, servicios, etc.)' },
              { label:'Margen neto', value:formatCurrency(marginSummary.netProfit), color:marginSummary.netProfit>=0?'text-emerald-400':'text-red-400', tip:'Margen bruto menos gastos operativos. Ganancia real del negocio.' },
              { label:'% Margen neto', value:`${formatNumber(marginSummary.netMarginPct,1)}%`, color:marginSummary.netMarginPct>=15?'text-emerald-400':marginSummary.netMarginPct>=5?'text-yellow-400':'text-red-400', tip:'Porcentaje de margen neto sobre ventas = (Margen neto ÷ Ventas) × 100' },
            ].map(c=>(
              <div key={c.label} className="card p-4">
                <p className="text-xs text-[var(--text-tertiary)] mb-1">{c.tip ? <InfoTooltip content={c.tip} iconClassName="w-3 h-3 ml-0.5 inline-block -mt-0.5">{c.label}</InfoTooltip> : c.label}</p>
                <p className={cn('text-lg font-semibold',c.color)}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* Barra visual de desglose */}
          {marginSummary.totalSales > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Desglose de cada peso vendido</h3>
              <div className="flex h-8 rounded-lg overflow-hidden text-xs font-medium">
                {(() => {
                  const costPct = (marginSummary.totalCost / marginSummary.totalSales) * 100;
                  const expensePct = (marginSummary.expenses / marginSummary.totalSales) * 100;
                  const profitPct = (marginSummary.netProfit / marginSummary.totalSales) * 100;
                  const totalPct = costPct + expensePct + Math.max(0, profitPct);
                  const norm = (v: number) => totalPct > 0 ? (v / totalPct) * 100 : 0;
                  return (
                    <>
                      {costPct > 0 && <div className="flex items-center justify-center bg-orange-600/70 text-orange-200" style={{width:`${norm(costPct)}%`}}>Costo {formatNumber(costPct,1)}%</div>}
                      {expensePct > 0 && <div className="flex items-center justify-center bg-red-600/70 text-red-200" style={{width:`${norm(expensePct)}%`}}>Gastos {formatNumber(expensePct,1)}%</div>}
                      {profitPct >= 0 && <div className="flex items-center justify-center bg-green-600/70 text-green-200" style={{width:`${norm(profitPct)}%`}}>Ganancia {formatNumber(profitPct,1)}%</div>}
                      {profitPct < 0 && <div className="flex items-center justify-center bg-red-800/70 text-red-300" style={{width:`${norm(Math.abs(profitPct))}%`}}>Pérdida {formatNumber(Math.abs(profitPct),1)}%</div>}
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Tabla de margen por producto */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Margen por producto</h3>
              <button onClick={()=>exportCSV(margins,'rentabilidad')} className="btn-secondary flex items-center gap-1.5 text-xs"><Download size={13}/>CSV</button>
            </div>
            {margins.length===0?<p className="text-center text-[var(--text-tertiary)] py-8 text-sm">Sin datos en este período</p>:(
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[var(--border-primary)]">{['Producto','P.Venta','Costo','Margen','%','Vendido','Costo total','Ganancia bruta'].map(h=>{
                const tips: Record<string,string> = {
                  'P.Venta':'Precio de venta al público promedio en el período',
                  'Costo':'Costo unitario promedio del producto',
                  'Margen':'Ganancia bruta por unidad = Precio de venta - Costo',
                  '%':'Porcentaje de margen sobre el precio de venta',
                  'Vendido':'Total vendido del producto en el período (cantidad × precio)',
                  'Costo total':'Costo total de las unidades vendidas = Σ(cantidad × costo)',
                  'Ganancia bruta':'Utilidad bruta total = Vendido - Costo total',
                };
                return <th key={h} className="px-3 py-2 text-left text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">{tips[h] ? <InfoTooltip content={tips[h]} iconClassName="w-3 h-3 ml-0.5 inline-block -mt-0.5">{h}</InfoTooltip> : h}</th>;
              })}</tr></thead>
                  <tbody>{margins.map((m,i)=>{
                    const gProfit = Number(m.gross_profit ?? 0);
                    return (
                    <tr key={i} className="border-b border-[var(--border-primary)] last:border-0 hover:bg-[var(--bg-tertiary)]">
                      <td className="px-3 py-2.5 text-[var(--text-primary)] font-medium">{String(m.name)}</td>
                      <td className="px-3 py-2.5 text-[var(--text-secondary)]">{formatCurrency(Number(m.sale_price))}</td>
                      <td className="px-3 py-2.5 text-[var(--text-secondary)]">{formatCurrency(Number(m.cost))}</td>
                      <td className="px-3 py-2.5 text-green-400">{formatCurrency(Number(m.margin))}</td>
                      <td className="px-3 py-2.5"><div className="flex items-center gap-2"><div className="flex-1 bg-[var(--bg-muted)] rounded-full h-1.5 max-w-[60px]"><div className="h-1.5 rounded-full bg-brand-500" style={{width:`${Math.min(100,Number(m.margin_pct))}%`}}/></div><span className={cn('text-xs font-medium',Number(m.margin_pct)>=20?'text-green-400':Number(m.margin_pct)>=10?'text-yellow-400':'text-red-400')}>{formatNumber(Number(m.margin_pct),1)}%</span></div></td>
                      <td className="px-3 py-2.5 text-[var(--text-secondary)]">{formatCurrency(Number(m.total_sold))}</td>
                      <td className="px-3 py-2.5 text-orange-400">{formatCurrency(Number(m.total_cost))}</td>
                      <td className="px-3 py-2.5"><span className={cn('font-medium',gProfit>=0?'text-green-400':'text-red-400')}>{formatCurrency(gProfit)}</span></td>
                    </tr>
                  )})}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {!loading&&tab==='precios'&&(
        <div className="card p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex-1">Historial de precios de compra</h3>
            <select className="input max-w-xs" value={selectedPriceProduct} onChange={e=>{setSelectedPriceProduct(e.target.value);loadPriceHistory(e.target.value);}}>
              <option value="">Selecciona un producto</option>
              {priceProducts.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}
            </select>
          </div>
          {priceHistory.length===0?<div className="flex flex-col items-center justify-center py-14 text-[var(--text-tertiary)]"><TrendingDown size={32} className="mb-3 opacity-40"/><p className="text-sm">Selecciona un producto para ver el historial</p></div>:(
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={priceHistory} margin={{top:4,right:4,left:-15,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#21262d"/>
                <XAxis dataKey="date" tick={{fill:'#6e7681',fontSize:10}} tickLine={false}/>
                <YAxis domain={[0, yMaxPrice]} tickFormatter={(v:number)=>v>=1000?`${(v/1000).toFixed(1)}k`:String(v)} tick={{fill:'#6e7681',fontSize:10}} tickLine={false} axisLine={false}/>
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
              <div><h3 className="text-sm font-semibold text-[var(--text-primary)]">Proyección de reabastecimiento</h3><p className="text-xs text-[var(--text-tertiary)] mt-0.5">Basado en ventas promedio de los últimos 30 días</p></div>
              <div className="flex gap-2">
                <button onClick={loadForecasts} className="btn-secondary flex items-center gap-1.5 text-xs"><RefreshCw size={13}/>Actualizar</button>
                <button onClick={()=>exportCSV(forecasts,'reabastecimiento')} className="btn-secondary flex items-center gap-1.5 text-xs"><Download size={13}/>CSV</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border-primary)]">{['Producto','Stock actual','Venta/día','Días restantes','Fecha pedido','Urgencia'].map(h=>{
              const tips: Record<string,string> = {
                'Venta/día':'Promedio de unidades vendidas por día en los últimos 30 días',
                'Días restantes':'Días estimados hasta agotar stock según el ritmo actual de ventas',
                'Fecha pedido':'Fecha estimada en la que se debe realizar el pedido al proveedor',
                'Urgencia':'Prioridad de reabastecimiento basada en los días restantes',
              };
              return <th key={h} className="px-3 py-2 text-left text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">{tips[h] ? <InfoTooltip content={tips[h]} iconClassName="w-3 h-3 ml-0.5 inline-block -mt-0.5">{h}</InfoTooltip> : h}</th>;
            })}</tr></thead>
                <tbody>{forecasts.map(f=>(
                  <tr key={String(f.id)} className="border-b border-[var(--border-primary)] last:border-0 hover:bg-[var(--bg-tertiary)]">
                    <td className="px-3 py-2.5 text-[var(--text-primary)] font-medium">{String(f.name)}</td>
                    <td className="px-3 py-2.5 text-[var(--text-secondary)]">{formatNumber(Number(f.stock),1)}</td>
                    <td className="px-3 py-2.5 text-[var(--text-secondary)]">{Number(f.avg_daily_sales)>0?formatNumber(Number(f.avg_daily_sales),2):'—'}</td>
                    <td className="px-3 py-2.5"><span className={cn('font-medium',Number(f.days_until_empty)<=3?'text-red-400':Number(f.days_until_empty)<=7?'text-yellow-400':'text-green-400')}>{Number(f.days_until_empty)>=9999?'∞':`${Number(f.days_until_empty)}d`}</span></td>
                    <td className="px-3 py-2.5 text-[var(--text-secondary)] text-xs">{Number(f.days_until_empty)>=9999?'—':String(f.restock_date)}</td>
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
            <div className="card p-5"><p className="text-xs text-[var(--text-tertiary)] mb-1"><InfoTooltip content="Suma total de saldos pendientes de todos los clientes" iconClassName="w-3 h-3 ml-0.5 inline-block -mt-[1px]">Total por cobrar</InfoTooltip></p><p className="text-2xl font-semibold text-red-400">{formatCurrency(totalDebt)}</p></div>
            <div className="card p-5"><p className="text-xs text-[var(--text-tertiary)] mb-1">Clientes con deuda</p><p className="text-2xl font-semibold text-[var(--text-primary)]">{debts.length}</p></div>
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Cuentas pendientes</h3>
              <button onClick={()=>exportCSV(debts,'cuentas')} className="btn-secondary flex items-center gap-1.5 text-xs"><Download size={13}/>CSV</button>
            </div>
            {debts.length===0?<p className="text-center text-[var(--text-tertiary)] py-8 text-sm">No hay cuentas pendientes 🎉</p>:(
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[var(--border-primary)]">{['Cliente','Teléfono','Saldo','% del total'].map(h=><th key={h} className="px-3 py-2 text-left text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">{h}</th>)}</tr></thead>
                  <tbody>{debts.map(d=>(
                    <tr key={String(d.id)} className="border-b border-[var(--border-primary)] last:border-0 hover:bg-[var(--bg-tertiary)]">
                      <td className="px-3 py-2.5 text-[var(--text-primary)] font-medium">{String(d.name)}</td>
                      <td className="px-3 py-2.5 text-[var(--text-secondary)]">{String(d.phone??'—')}</td>
                      <td className="px-3 py-2.5 text-red-400 font-medium">{formatCurrency(Number(d.balance))}</td>
                      <td className="px-3 py-2.5"><div className="flex items-center gap-2"><div className="flex-1 bg-[var(--bg-muted)] rounded-full h-1.5 max-w-[60px]"><div className="h-1.5 rounded-full bg-red-500" style={{width:`${Math.min(100,(Number(d.balance)/totalDebt)*100)}%`}}/></div><span className="text-xs text-[var(--text-secondary)]">{formatNumber((Number(d.balance)/totalDebt)*100,1)}%</span></div></td>
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