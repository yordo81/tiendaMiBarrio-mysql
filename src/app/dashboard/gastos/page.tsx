'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatCurrency, formatDate, formatNumber } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { usePosSelector } from '@/hooks/use-pos';
import { api } from '@/lib/api-client';
import { notifyShiftSummaryChanged } from '@/lib/shift-events';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import SearchableSelect from '@/components/ui/SearchableSelect';
import Pagination from '@/components/ui/Pagination';
import { r2 } from '@/lib/currency';
import { toast } from '@/components/ui/toaster';
import { TrendingDown, Plus, Search, Trash2, X } from 'lucide-react';
type R = Record<string,unknown>;

// Monedas (con tipo) para elegir en qué se pagó el gasto: igual que en el
// POS, las físicas solo sirven para efectivo y las digitales para transferencia.
interface CurrencyOpt { code: string; name: string; symbol: string; is_base: boolean; currencyType: 'cash'|'digital'; rate: number; }

const paymentMethodLabel: Record<string,string> = { cash:'Efectivo', transfer:'Transferencia', mixed:'Mixto' };

/**
 * Parsea el desglose multi-moneda de un gasto mixto (`expenses.mixed_parts`,
 * migration-036). mysql2 puede devolver la columna JSON ya parseada o como
 * string. Null si no hay desglose (mixtos de una sola moneda u otros métodos).
 */
function parseMixedPartsClient(raw: unknown): { code: string; amount: number; method: string }[] | null {
  let arr: unknown = raw;
  if (typeof raw === 'string') {
    try { arr = raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map(p => ({ code: String(p.code ?? ''), amount: Number(p.amount ?? 0), method: String(p.method ?? 'cash') }));
}
const paymentMethodColor: Record<string,string> = { cash:'text-green-400 bg-green-500/10 border-green-500/20', transfer:'text-blue-400 bg-blue-500/10 border-blue-500/20', mixed:'text-amber-400 bg-amber-500/10 border-amber-500/20' };

export default function GastosPage() {
  const { user } = useAuthStore();
  const [expenses, setExpenses] = useState<R[]>([]);
  const [categories, setCategories] = useState<R[]>([]);
  // Productos con existencia en el almacén de origen elegido (se cargan
  // bajo demanda al seleccionar el almacén).
  const [locProducts, setLocProducts] = useState<R[]>([]);
  const [locLoading, setLocLoading] = useState(false);
  const [locations, setLocations] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [currencies, setCurrencies] = useState<CurrencyOpt[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('' as ''|'cash'|'transfer'|'mixed');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<R | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ category_id:'', description:'', amount:0, product_id:'', product_quantity:0, location_id:'', date:'', payment_method:'cash' as 'cash'|'transfer'|'mixed', currency:'' });
  // Mixto multi-moneda: una parte por moneda con la que se paga (físicas y
  // digitales mezcladas; '' = moneda base). Cada parte declara su monto y el
  // método real lo fija el TIPO de la moneda, igual que en el POS.
  const [mixedParts, setMixedParts] = useState<{ code: string; amount: number }[]>([]);

  const canDelete = user?.role === 'owner' || user?.role === 'admin';
  const { workMode, posId, setPosId, posOptions, hasOpenShift, resetPos } = usePosSelector(showModal);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    const [e, c, l] = await Promise.all([api.getExpenses(), api.getExpenseCategories(), api.getLocations()]);
    setExpenses(e); setCategories(c); setLocations(l); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Cargar las monedas activas con su tipo y tasa hacia la base (misma
  // fuente y formato que el POS táctil) para el selector del modal.
  useEffect(() => {
    let alive = true;
    fetch('/api/currencies').then(r => r.json()).then(d => {
      if (!alive) return;
      const raw = (d.currencies ?? []) as { code: string; name: string; symbol: string; is_base: boolean; currency_type?: string; rates: Record<string, number> }[];
      const baseCode = raw.find(c => c.is_base)?.code ?? '';
      const list: CurrencyOpt[] = raw.map(c => ({
        code: c.code, name: c.name, symbol: c.symbol, is_base: c.is_base,
        currencyType: c.currency_type === 'digital' ? 'digital' : 'cash',
        // Tasa hacia la base: 1 unidad = rate unidades base. La base = 1.
        // Una moneda extranjera sin tasa queda a 0 (no se puede pagar con ella).
        rate: c.is_base ? 1 : (c.rates?.[baseCode] ?? 0),
      }));
      setCurrencies(list.filter(c => c.is_base || c.rate > 0));
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Cargar solo los productos con existencia en el almacén de origen
  // seleccionado. Si el almacén cambia, se reinicia la selección de producto.
  useEffect(() => {
    if (!form.location_id) { setLocProducts([]); setLocLoading(false); return; }
    let cancelled = false;
    setLocLoading(true);
    api.getProducts(`location_id=${form.location_id}`)
      .then(list => { if (!cancelled) setLocProducts((list as R[]).filter(p => Number(p.stock) > 0)); })
      .catch(() => { if (!cancelled) setLocProducts([]); })
      .finally(() => { if (!cancelled) setLocLoading(false); });
    return () => { cancelled = true; };
  }, [form.location_id]);

  // En modo turnos, precargar el origen con la ubicación de la caja elegida
  // (el producto se descuenta del almacén / punto de venta de esa caja).
  useEffect(() => {
    if (workMode !== 'shifts' || !posId) return;
    const pos = posOptions.find(p => String(p.id) === posId);
    const locId = pos ? String(pos.location_id ?? '') : '';
    if (locId) setForm(f => ({ ...f, location_id: locId, product_id: '', product_quantity: 0, amount: 0 }));
  }, [posId, posOptions, workMode]);

  // Auto-calc amount when product is selected
  useEffect(() => {
    if (form.product_id && form.product_quantity > 0) {
      const prod = locProducts.find(p => String(p.id) === form.product_id);
      if (prod) setForm(f => ({ ...f, amount: Number(prod.cost) * f.product_quantity }));
    }
  }, [form.product_id, form.product_quantity, locProducts]);

  async function handleSave() {
    if (!form.description.trim() || (isMixedMulti ? mixedTotalBase <= 0 : form.amount <= 0)) return;
    if (form.product_id && !form.location_id) {
      toast.error('Debes seleccionar el almacén de origen para el producto');
      return;
    }
    if (isMixedMulti && mixedParts.filter(p => p.amount > 0).length === 0) {
      toast.error('Indica el monto de al menos una moneda del mixto');
      return;
    }
    setSaving(true);
    try {
      // Si el gasto tiene producto asociado siempre es cash; si no,
      // se usa el método seleccionado por el usuario (cash/transfer/mixed).
      // La moneda elegida se envía tal cual ('' = base): el servidor la
      // valida contra el método y congela la tasa de conversión.
      // El mixto con partes multi-moneda envía `parts`: una por moneda, y el
      // servidor congela la tasa de cada una (físicas = efectivo, digitales =
      // transferencia). El total en base de las partes lo recalcula el servidor.
      await api.createExpense({
        ...form,
        category_id: form.category_id || null,
        payment_method: form.product_id ? 'cash' : form.payment_method,
        currency: isMixedMulti ? '' : (form.currency || ''),
        parts: isMixedMulti ? mixedParts.filter(p => p.amount > 0).map(p => ({ currency: p.code || null, amount: p.amount })) : undefined,
        amount: isMixedMulti ? mixedTotalBase : form.amount,
        product_id: form.product_id || null,
        product_quantity: form.product_quantity || null,
        location_id: form.location_id || null,
        pos_id: workMode === 'shifts' ? posId || null : null,
        date: form.date || undefined,
      });
      toast.success('Gasto registrado'); notifyShiftSummaryChanged(); setShowModal(false); resetPos();
      setForm({ category_id:'', description:'', amount:0, product_id:'', product_quantity:0, location_id:'', date:'', payment_method:'cash', currency:'' });
      setMixedParts([]);
      load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); }
  }

  // ── Moneda del gasto (modal) ──────────────────────────────
  const baseCurrency = currencies.find(c => c.is_base) ?? null;
  const expenseCurrency = form.currency ? currencies.find(c => c.code === form.currency) ?? null : null;
  const isForeignExpense = !!expenseCurrency && !expenseCurrency.is_base;
  // Equivalente en base: lo que guardará `amount` y sumarán los reportes.
  const amountBase = isForeignExpense && expenseCurrency ? Math.round(form.amount * expenseCurrency.rate * 100) / 100 : form.amount;
  // Monedas admitidas según el método: efectivo → físicas, transferencia →
  // digitales, mixto → ambas. Con producto asociado el método es efectivo.
  const expenseEffectiveMethod: 'cash'|'transfer'|'mixed' = form.product_id ? 'cash' : form.payment_method;
  const expenseCurrencies = currencies.filter(c =>
    expenseEffectiveMethod === 'cash' ? c.currencyType === 'cash'
      : expenseEffectiveMethod === 'transfer' ? c.currencyType === 'digital'
      : true
  );
  // Mixto multi-moneda: se paga la mezcla entre monedas físicas (efectivo)
  // y digitales (transferencia); solo aplica sin producto (que fuerza efectivo).
  const isMixedMulti = !form.product_id && form.payment_method === 'mixed';
  // Total del mixto en MONEDA BASE: suma de cada parte × su tasa. Las partes
  // definen el total (el servidor lo recalcula igual con la tasa congelada).
  const mixedTotalBase = isMixedMulti
    ? r2(mixedParts.reduce((a, p) => {
        const c = currencies.find(cur => (cur.is_base ? '' : cur.code) === p.code);
        return a + (p.amount > 0 ? p.amount * (c?.rate ?? 1) : 0);
      }, 0))
    : 0;
  // Marca/desmarca una moneda en el mixto (una parte por moneda).
  function toggleMixedPart(c: CurrencyOpt) {
    const code = c.is_base ? '' : c.code;
    setMixedParts(prev => prev.some(p => p.code === code)
      ? prev.filter(p => p.code !== code)
      : [...prev, { code, amount: 0 }]);
  }

  const filtered = expenses.filter(e => {
    const matchSearch = String(e.description??'').toLowerCase().includes(search.toLowerCase()) || String(e.category_name??'').toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    // e.date llega en UTC (ISO); se convierte a la fecha local del negocio
    // antes de comparar con el rango, igual que formatDate al mostrar. Si no,
    // un gasto de la noche local quedaba como "día siguiente" en UTC y
    // desaparecía del filtro de su día.
    const dKey = e.date ? formatDate(String(e.date), 'yyyy-MM-dd') : '';
    if (dateFrom && dKey < dateFrom) return false;
    if (dateTo && dKey > dateTo) return false;
    if (paymentFilter && String(e.payment_method??'cash') !== paymentFilter) return false;
    return true;
  });
  const paginated = pageSize === 0 ? filtered : filtered.slice(0, page * pageSize).slice((page - 1) * pageSize);

  // Reset page when search changes
  useEffect(() => { setPage(1); }, [search, paymentFilter]);
  const totalMonth = expenses.filter(e => { const d=new Date(String(e.date??'')); const n=new Date(); return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear(); }).reduce((a,e)=>a+Number(e.amount??0),0);
  const cashTotal = expenses.filter(e => (e.payment_method ?? 'cash') === 'cash').reduce((a,e)=>a+Number(e.amount??0),0);
  const transferTotal = expenses.filter(e => e.payment_method === 'transfer').reduce((a,e)=>a+Number(e.amount??0),0);
  const mixedTotal = expenses.filter(e => e.payment_method === 'mixed').reduce((a,e)=>a+Number(e.amount??0),0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="card p-4"><p className="text-xs text-[var(--text-tertiary)] mb-1">Gastos este mes</p><p className="text-2xl font-semibold text-red-400">{formatCurrency(totalMonth)}</p></div>
        <div className="card p-4"><p className="text-xs text-[var(--text-tertiary)] mb-1">Total registros</p><p className="text-2xl font-semibold text-[var(--text-primary)]">{expenses.length}</p></div>
        <div className="card p-4"><p className="text-xs text-[var(--text-tertiary)] mb-1">Efectivo</p><p className="text-2xl font-semibold text-green-400">{formatCurrency(cashTotal)}</p></div>
        <div className="card p-4"><p className="text-xs text-[var(--text-tertiary)] mb-1">Transferencia</p><p className="text-2xl font-semibold text-blue-400">{formatCurrency(transferTotal)}</p></div>
        <div className="card p-4"><p className="text-xs text-[var(--text-tertiary)] mb-1">Mixto</p><p className="text-2xl font-semibold text-amber-400">{formatCurrency(mixedTotal)}</p></div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]"/><input className="input pl-9" placeholder="Buscar gastos..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="flex gap-2 items-center">
          <input type="date" className="input text-sm max-w-[140px]" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} title="Desde" />
          <input type="date" className="input text-sm max-w-[140px]" value={dateTo} onChange={e=>setDateTo(e.target.value)} title="Hasta" />
          {(dateFrom||dateTo||paymentFilter) && (
            <button onClick={()=>{setDateFrom('');setDateTo('');setPaymentFilter('')}} className="btn-secondary p-2" title="Limpiar filtros"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
          )}
          <div className="flex gap-1">
            {[{value:'' as const,label:'Todos'},{value:'cash' as const,label:'Efectivo'},{value:'transfer' as const,label:'Transferencia'},{value:'mixed' as const,label:'Mixto'}].map(f=>(
              <button key={f.value} onClick={()=>setPaymentFilter(f.value)}
                className={`px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors ${paymentFilter===f.value?(f.value==='cash'?'bg-green-500/15 text-green-400 border-green-500/30':f.value==='transfer'?'bg-blue-500/15 text-blue-400 border-blue-500/30':f.value==='mixed'?'bg-amber-500/15 text-amber-400 border-amber-500/30':'bg-brand-600/20 text-brand-400 border-brand-600/30'):'text-[var(--text-secondary)] border-[var(--border-secondary)] hover:text-[var(--text-primary)] hover:border-[#6e7681]'}`}>
                {f.label}
              </button>
            ))}
          </div>
          <button onClick={()=>setShowModal(true)} className="btn-primary flex items-center gap-2 flex-shrink-0"><Plus className="w-4 h-4"/>Registrar gasto</button>
        </div>
      </div>
      <div className="card overflow-hidden">
        {loading?<div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
        :paginated.length===0?<EmptyState icon={TrendingDown} title="Sin gastos" description="Registra el primer gasto" action={<button onClick={()=>setShowModal(true)} className="btn-primary">Registrar</button>}/>:(
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border-primary)]">{['Fecha','Categoría','Descripción','Producto',...(workMode==='shifts'?['Caja']:[]),'Monto','Método',''].map(h=><th key={h} className="text-left px-4 py-3 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>{paginated.map(e=>{
                return (
                <tr key={String(e.id)} className="border-b border-[var(--border-primary)] last:border-0 table-row-hover">
                  <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{e.date?formatDate(String(e.date)):'—'}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{String(e.category_name??'—')}</td>
                  <td className="px-4 py-3 text-[var(--text-primary)]">{String(e.description??'—')}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{e.product_name?`${String(e.product_name)} x${Number(e.product_quantity??0)}`:'—'}</td>
                  {workMode==='shifts'&&<td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{e.pos_name?String(e.pos_name):<span className="text-[var(--text-tertiary)] italic">—</span>}</td>}
                  <td className="px-4 py-3 text-red-400 font-medium">{formatCurrency(Number(e.amount??0))}{(() => {
                    // Mixto multi-moneda: desglose de sus partes en su moneda.
                    // Si no hay desglose, se muestra la moneda única si la tiene.
                    const parts = parseMixedPartsClient(e.mixed_parts);
                    if (parts) return parts.map((p,i)=>(
                      <p key={i} className="text-[10px] text-[var(--text-tertiary)] font-normal">{formatNumber(p.amount)} {p.code || 'Base'}</p>
                    ));
                    return !!e.currency_code && (
                      <p className="text-[10px] text-[var(--text-tertiary)] font-normal">{formatNumber(Number(e.currency_amount??0))} {String(e.currency_code)}</p>
                    );
                  })()}</td>
                  <td className="px-4 py-3"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${paymentMethodColor[String(e.payment_method??'cash')] ?? paymentMethodColor.cash}`}>{paymentMethodLabel[String(e.payment_method??'cash')] ?? 'Efectivo'}</span></td>
                  <td className="px-4 py-3">{canDelete && (
                    <button onClick={()=>setDeleteTarget(e)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                  )}</td>
                </tr>
              )})}</tbody>
            </table>
          </div>
        )}
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      <ConfirmDialog open={!!deleteTarget} onClose={()=>setDeleteTarget(null)} onConfirm={async ()=>{if(!deleteTarget)return;setDeleting(true);try{await api.deleteExpense(String(deleteTarget.id));toast.success('Gasto eliminado');notifyShiftSummaryChanged();setDeleteTarget(null);load();}catch(e){toast.error(e instanceof Error?e.message:'Error')}finally{setDeleting(false);}}} title="Eliminar gasto" message={`¿Eliminar "${String(deleteTarget?.description??'')}" por ${formatCurrency(Number(deleteTarget?.amount??0))}? Esta acción restaurará el stock si corresponde.`} loading={deleting}/>

      <Modal open={showModal} onClose={()=>setShowModal(false)} title="Registrar gasto" size="md">
        <div className="space-y-4">
          {workMode==='shifts'&&(
            <div>
              <label className="label">Caja (punto de venta)</label>
              <SearchableSelect
                options={posOptions.map(p => ({ value: String(p.id), label: String(p.name), sublabel: hasOpenShift(String(p.id)) ? (p.location_name ? `Turno abierto · ${String(p.location_name)}` : 'Turno abierto') : (p.location_name ? String(p.location_name) : undefined) }))}
                value={posId}
                onChange={setPosId}
                placeholder="Selecciona la caja…"
                noResultsMessage="No hay cajas creadas"
              />
              {posId && !hasOpenShift(posId) && (
                <p className="text-[10px] text-yellow-400 mt-1">Esta caja no tiene un turno abierto. El gasto no se incluirá en ningún arqueo.</p>
              )}
            </div>
          )}
          <div><label className="label">Categoría</label>
            <SearchableSelect
              options={[
                { value: '', label: 'Sin categoría' },
                ...categories.map(c => ({ value: String(c.id), label: String(c.name) }))
              ]}
              value={form.category_id}
              onChange={v => setForm(f => ({ ...f, category_id: v }))}
              placeholder="Sin categoría"
              noResultsMessage="Sin categorías"
            />
          </div>
          <div><label className="label">Descripción *</label><input className="input" placeholder="Ej: Compra para uso interno..." value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
          <div className="p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] space-y-3">
            <p className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">Producto del inventario (opcional)</p>
            <div>
              <label className="label">Almacén de origen *</label>
              <SearchableSelect
                options={[
                  { value: '', label: 'Seleccionar almacén' },
                  ...locations.map(l => ({ value: String(l.id), label: String(l.name) }))
                ]}
                value={form.location_id}
                onChange={v => setForm(f => ({ ...f, location_id: v, product_id: '', product_quantity: 0, amount: 0 }))}
                placeholder="Seleccionar almacén"
                noResultsMessage="Sin almacenes"
              />
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1">Solo se mostrarán productos con existencia en este almacén.</p>
            </div>
            <div><label className="label">Producto</label>
              <select className="input" value={form.product_id} disabled={!form.location_id} onChange={e=>{
                // Con producto el método es efectivo: si la moneda elegida es
                // digital (transferencia) ya no es compatible y se restablece a
                // la base; el desglose del mixto también deja de aplicar.
                setMixedParts([]);
                setForm(f=>{
                  const currencyBlocked = f.currency && (currencies.find(c => c.code === f.currency)?.currencyType ?? 'cash') !== 'cash';
                  return { ...f, product_id: e.target.value, product_quantity: 0, amount: 0, payment_method: 'cash', currency: currencyBlocked ? '' : f.currency };
                });
              }}>
                <option value="">No aplica</option>
                {!form.location_id
                  ? <option disabled>Selecciona primero el almacén de origen</option>
                  : locLoading
                    ? <option disabled>Cargando productos…</option>
                    : locProducts.length===0
                      ? <option disabled>Sin productos con existencia en este almacén</option>
                      : locProducts.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)} — costo: {formatCurrency(Number(p.cost))} · disp: {formatNumber(Number(p.stock))}</option>)}
              </select>
            </div>
            {form.product_id&&<>
              <div>
                <label className="label">Cantidad</label>
                <input type="number" min="1" step="1" className="input" value={form.product_quantity||''} onChange={e=>setForm(f=>({...f,product_quantity:parseFloat(e.target.value)||0}))}/>
                {(() => {
                  const prod = locProducts.find(p => String(p.id) === form.product_id);
                  const avail = prod ? Number(prod.stock ?? 0) : 0;
                  if (avail > 0 && form.product_quantity > avail) {
                    return <p className="text-[10px] text-red-400 mt-1">⚠ Máx disponible en el almacén: {formatNumber(avail)}</p>;
                  }
                  return null;
                })()}
              </div>
            </>}
          </div>
          {!form.product_id && (
          <div>
            <label className="label">Método de pago *</label>
            <div className="flex gap-2">
              {[{value:'cash' as const,label:'Efectivo'},{value:'transfer' as const,label:'Transferencia'},{value:'mixed' as const,label:'Mixto'}].map(m=>(
                <button key={m.value} type="button" onClick={()=>{
                  setForm(f=>({...f,payment_method:m.value,currency:''}));
                  // Mixto multi-moneda: arranca con la base + una moneda del
                  // tipo opuesto (efectivo + transferencia), como en el POS.
                  if (m.value === 'mixed') {
                    const digital = currencies.find(c => !c.is_base && c.currencyType === 'digital');
                    setMixedParts(digital ? [{ code: '', amount: 0 }, { code: digital.code, amount: 0 }] : [{ code: '', amount: 0 }]);
                  } else {
                    setMixedParts([]);
                  }
                }}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${form.payment_method===m.value?'bg-brand-600/20 text-brand-400 border-brand-600/30':'text-[var(--text-secondary)] border-[var(--border-secondary)] hover:text-[var(--text-primary)] hover:border-[#6e7681]'}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          )}
          {isMixedMulti && (
          <div>
            <label className="label">Monedas del pago (mezcla) *</label>
            <p className="text-[10px] text-[var(--text-tertiary)] mb-2">Marca las monedas con que se paga la mezcla; el método real lo fija cada una: físicas → efectivo, digitales → transferencia.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {currencies.map(c=>{
                const code = c.is_base ? '' : c.code;
                const selected = mixedParts.some(p=>p.code===code);
                return (
                <button key={c.code} type="button" onClick={()=>toggleMixedPart(c)} title={c.name}
                  className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    selected
                      ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
                      : 'text-[var(--text-secondary)] border-[var(--border-secondary)] hover:text-[var(--text-primary)] hover:border-[#6e7681]'}`}>
                  <span>{c.symbol}</span>
                  <span>{c.code}</span>
                  {!c.is_base && <span className="text-[9px] font-normal uppercase rounded px-1 border" style={{color:'var(--text-tertiary)'}}>{c.currencyType==='digital'?'Digital':'Efectivo'}</span>}
                </button>
              );})}
            </div>
            {mixedParts.length>0 && (
              <div className="space-y-2 mt-2">
                {mixedParts.map((p, idx) => {
                  const c = currencies.find(cur => (cur.is_base ? '' : cur.code) === p.code);
                  const partBase = r2(p.amount * (c?.rate ?? 1));
                  return (
                    <div key={idx} className="rounded-lg border p-2.5 space-y-2" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {c?.symbol ? `${c.symbol} ` : ''}{p.code || c?.code || '—'}
                        </span>
                        <span className={`ml-auto text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${c?.currencyType==='digital'?'bg-blue-500/10 text-blue-400 border-blue-500/20':'bg-[var(--bg-muted)] text-[var(--text-tertiary)] border-[var(--border-primary)]'}`}>
                          {c?.currencyType==='digital'?'Transferencia':'Efectivo'}
                        </span>
                        <button type="button" onClick={()=>setMixedParts(prev=>prev.filter((_,i)=>i!==idx))} className="p-1 rounded-md text-[var(--text-tertiary)] hover:text-red-400" aria-label="Quitar parte">
                          <X className="w-3.5 h-3.5"/>
                        </button>
                      </div>
                      <input type="number" min="0" step="0.05" className="input" placeholder="0.00" value={p.amount||''}
                        onChange={e=>setMixedParts(prev=>prev.map((pp,i)=>i===idx?{...pp, amount:parseFloat(e.target.value)||0}:pp))}/>
                      {p.amount>0 && (
                        <p className="text-[10px] text-[var(--text-tertiary)]">≈ {formatCurrency(partBase)} en {baseCurrency?.code ?? 'base'}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <p className={`text-[11px] font-medium mt-1 ${mixedTotalBase>0?'text-green-400':'text-yellow-400'}`}>
              {mixedTotalBase>0 ? `Total del gasto ≈ ${formatCurrency(mixedTotalBase)}` : 'Indica el monto de al menos una moneda'}
            </p>
          </div>
          )}
          {!isMixedMulti && (
          <div>
            <label className="label">Moneda *</label>
            {expenseCurrencies.length === 0 ? (
              <p className="text-[10px] text-yellow-400 mt-1">
                {expenseEffectiveMethod === 'cash'
                  ? 'No hay monedas físicas activas con tasa de cambio registrada'
                  : 'No hay monedas digitales activas con tasa de cambio registrada'}
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {expenseCurrencies.map(c=>(
                  <button key={c.code} type="button"
                    onClick={()=>setForm(f=>({...f,currency:c.is_base?'':c.code}))}
                    title={c.name}
                    className={`flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      (c.is_base ? '' : c.code) === form.currency
                        ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
                        : 'text-[var(--text-secondary)] border-[var(--border-secondary)] hover:text-[var(--text-primary)] hover:border-[#6e7681]'}`}>
                    <span>{c.symbol}</span>
                    <span>{c.code}</span>
                    {!c.is_base && <span className="text-[9px] font-normal uppercase rounded px-1 border" style={{color:'var(--text-tertiary)'}}>{c.currencyType==='digital'?'Digital':'Efectivo'}</span>}
                  </button>
                ))}
              </div>
            )}
            <p className="text-[10px] text-[var(--text-tertiary)] mt-1">Sincronizada con el método: {expenseEffectiveMethod==='cash'?'efectivo → monedas físicas':expenseEffectiveMethod==='transfer'?'transferencia → monedas digitales':'mixto → ambas monedas'}</p>
          </div>
          )}
          {!isMixedMulti && (
          <div>
            <label className="label">Monto * {expenseCurrency && <span className="text-[var(--text-tertiary)] font-normal">en {expenseCurrency.code}</span>}</label>
            <input type="number" min="1" step="1" className="input" value={form.amount||''} onChange={e=>setForm(f=>({...f,amount:parseFloat(e.target.value)||0}))}/>
            {isForeignExpense && form.amount > 0 && (
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                ≈ {formatCurrency(amountBase)} en {baseCurrency?.code ?? 'la moneda base'} (tasa: 1 {expenseCurrency.code} = {expenseCurrency.rate} {baseCurrency?.code ?? ''})
              </p>
            )}
          </div>
          )}
          <div><label className="label">Fecha</label><input type="date" className="input" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></div>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>setShowModal(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleSave} disabled={saving||!form.description.trim()||(isMixedMulti?mixedTotalBase<=0:form.amount<=0)} className="btn-primary flex-1 disabled:opacity-50">{saving?'Guardando...':'Registrar gasto'}</button></div>
        </div>
      </Modal>
    </div>
  );
}
