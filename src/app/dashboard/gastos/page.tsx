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
import { toast } from '@/components/ui/toaster';
import { TrendingDown, Plus, Search, Trash2 } from 'lucide-react';
type R = Record<string,unknown>;

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
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<R | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ category_id:'', description:'', amount:0, product_id:'', product_quantity:0, location_id:'', date:'' });

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
    if (!form.description.trim() || form.amount <= 0) return;
    if (form.product_id && !form.location_id) {
      toast.error('Debes seleccionar el almacén de origen para el producto');
      return;
    }
    setSaving(true);
    try {
      // El gasto es una salida de efectivo de caja: se guarda como 'cash'
      // (los métodos de pago se retiraron del formulario).
      await api.createExpense({ ...form, category_id: form.category_id || null, payment_method: 'cash', product_id: form.product_id || null, product_quantity: form.product_quantity || null, location_id: form.location_id || null, pos_id: workMode === 'shifts' ? posId || null : null, date: form.date || undefined });
      toast.success('Gasto registrado'); notifyShiftSummaryChanged(); setShowModal(false); resetPos();
      setForm({ category_id:'', description:'', amount:0, product_id:'', product_quantity:0, location_id:'', date:'' }); load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); }
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
    return true;
  });
  const paginated = pageSize === 0 ? filtered : filtered.slice(0, page * pageSize).slice((page - 1) * pageSize);

  // Reset page when search changes
  useEffect(() => { setPage(1); }, [search]);
  const totalMonth = expenses.filter(e => { const d=new Date(String(e.date??'')); const n=new Date(); return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear(); }).reduce((a,e)=>a+Number(e.amount??0),0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4"><p className="text-xs text-[var(--text-tertiary)] mb-1">Gastos este mes</p><p className="text-2xl font-semibold text-red-400">{formatCurrency(totalMonth)}</p></div>
        <div className="card p-4"><p className="text-xs text-[var(--text-tertiary)] mb-1">Total registros</p><p className="text-2xl font-semibold text-[var(--text-primary)]">{expenses.length}</p></div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]"/><input className="input pl-9" placeholder="Buscar gastos..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="flex gap-2 items-center">
          <input type="date" className="input text-sm max-w-[140px]" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} title="Desde" />
          <input type="date" className="input text-sm max-w-[140px]" value={dateTo} onChange={e=>setDateTo(e.target.value)} title="Hasta" />
          {(dateFrom||dateTo) && (
            <button onClick={()=>{setDateFrom('');setDateTo('')}} className="btn-secondary p-2" title="Limpiar filtros"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg></button>
          )}
          <button onClick={()=>setShowModal(true)} className="btn-primary flex items-center gap-2 flex-shrink-0"><Plus className="w-4 h-4"/>Registrar gasto</button>
        </div>
      </div>
      <div className="card overflow-hidden">
        {loading?<div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
        :paginated.length===0?<EmptyState icon={TrendingDown} title="Sin gastos" description="Registra el primer gasto" action={<button onClick={()=>setShowModal(true)} className="btn-primary">Registrar</button>}/>:(
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border-primary)]">{['Fecha','Categoría','Descripción','Producto',...(workMode==='shifts'?['Caja']:[]),'Monto',''].map(h=><th key={h} className="text-left px-4 py-3 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>{paginated.map(e=>{
                return (
                <tr key={String(e.id)} className="border-b border-[var(--border-primary)] last:border-0 table-row-hover">
                  <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{e.date?formatDate(String(e.date)):'—'}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{String(e.category_name??'—')}</td>
                  <td className="px-4 py-3 text-[var(--text-primary)]">{String(e.description??'—')}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{e.product_name?`${String(e.product_name)} x${Number(e.product_quantity??0)}`:'—'}</td>
                  {workMode==='shifts'&&<td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{e.pos_name?String(e.pos_name):<span className="text-[var(--text-tertiary)] italic">—</span>}</td>}
                  <td className="px-4 py-3 text-red-400 font-medium">{formatCurrency(Number(e.amount??0))}</td>
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
              <select className="input" value={form.product_id} disabled={!form.location_id} onChange={e=>setForm(f=>({...f,product_id:e.target.value,product_quantity:0,amount:0}))}>
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
          <div><label className="label">Monto *</label><input type="number" min="1" step="1" className="input" value={form.amount||''} onChange={e=>setForm(f=>({...f,amount:parseFloat(e.target.value)||0}))}/></div>
          <div><label className="label">Fecha</label><input type="date" className="input" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></div>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>setShowModal(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleSave} disabled={saving||!form.description.trim()||form.amount<=0} className="btn-primary flex-1 disabled:opacity-50">{saving?'Guardando...':'Registrar gasto'}</button></div>
        </div>
      </Modal>
    </div>
  );
}
