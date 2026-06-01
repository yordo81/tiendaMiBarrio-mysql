'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { api } from '@/lib/api-client';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import { toast } from '@/components/ui/toaster';
import { TrendingDown, Plus, Search, Trash2 } from 'lucide-react';
type R = Record<string,unknown>;

export default function GastosPage() {
  const { user } = useAuthStore();
  const [expenses, setExpenses] = useState<R[]>([]);
  const [categories, setCategories] = useState<R[]>([]);
  const [products, setProducts] = useState<R[]>([]);
  const [locations, setLocations] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<R | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ category_id:'', description:'', amount:0, product_id:'', product_quantity:0, location_id:'', date:'' });

  const canDelete = user?.role === 'owner' || user?.role === 'admin';

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    const [e, c, p, l] = await Promise.all([api.getExpenses(), api.getExpenseCategories(), api.getProducts(), api.getLocations()]);
    setExpenses(e); setCategories(c); setProducts(p as R[]); setLocations(l); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Auto-calc amount when product is selected
  useEffect(() => {
    if (form.product_id && form.product_quantity > 0) {
      const prod = products.find(p => String(p.id) === form.product_id);
      if (prod) setForm(f => ({ ...f, amount: Number(prod.cost) * f.product_quantity }));
    }
  }, [form.product_id, form.product_quantity, products]);

  async function handleSave() {
    if (!form.description.trim() || form.amount <= 0) return;
    if (form.product_id && !form.location_id) {
      toast.error('Debes seleccionar el almacén de origen para el producto');
      return;
    }
    setSaving(true);
    try {
      await api.createExpense({ ...form, category_id: form.category_id || null, product_id: form.product_id || null, product_quantity: form.product_quantity || null, location_id: form.location_id || null, date: form.date || undefined });
      toast.success('Gasto registrado'); setShowModal(false);
      setForm({ category_id:'', description:'', amount:0, product_id:'', product_quantity:0, location_id:'', date:'' }); load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); }
  }

  const filtered = expenses.filter(e => String(e.description??'').toLowerCase().includes(search.toLowerCase()) || String(e.category_name??'').toLowerCase().includes(search.toLowerCase()));
  const paginated = pageSize === 0 ? filtered : filtered.slice(0, page * pageSize).slice((page - 1) * pageSize);

  // Reset page when search changes
  useEffect(() => { setPage(1); }, [search]);
  const totalMonth = expenses.filter(e => { const d=new Date(String(e.date??'')); const n=new Date(); return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear(); }).reduce((a,e)=>a+Number(e.amount??0),0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-4"><p className="text-xs text-[#6e7681] mb-1">Gastos este mes</p><p className="text-2xl font-semibold text-red-400">{formatCurrency(totalMonth)}</p></div>
        <div className="card p-4"><p className="text-xs text-[#6e7681] mb-1">Total registros</p><p className="text-2xl font-semibold text-[#e6edf3]">{expenses.length}</p></div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e7681]"/><input className="input pl-9" placeholder="Buscar gastos..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <button onClick={()=>setShowModal(true)} className="btn-primary flex items-center gap-2 flex-shrink-0"><Plus className="w-4 h-4"/>Registrar gasto</button>
      </div>
      <div className="card overflow-hidden">
        {loading?<div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
        :paginated.length===0?<EmptyState icon={TrendingDown} title="Sin gastos" description="Registra el primer gasto" action={<button onClick={()=>setShowModal(true)} className="btn-primary">Registrar</button>}/>:(
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#21262d]">{['Fecha','Categoría','Descripción','Producto','Monto',''].map(h=><th key={h} className="text-left px-4 py-3 text-xs font-medium text-[#8b949e] uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>{paginated.map(e=>(
                <tr key={String(e.id)} className="border-b border-[#21262d] last:border-0 table-row-hover">
                  <td className="px-4 py-3 text-[#8b949e] text-xs">{e.date?formatDate(String(e.date)):'—'}</td>
                  <td className="px-4 py-3 text-[#8b949e]">{String(e.category_name??'—')}</td>
                  <td className="px-4 py-3 text-[#e6edf3]">{String(e.description??'—')}</td>
                  <td className="px-4 py-3 text-[#8b949e] text-xs">{e.product_name?`${String(e.product_name)} x${Number(e.product_quantity??0)}`:'—'}</td>
                  <td className="px-4 py-3 text-red-400 font-medium">{formatCurrency(Number(e.amount??0))}</td>
                  <td className="px-4 py-3">{canDelete && (
                    <button onClick={()=>setDeleteTarget(e)} className="p-1.5 rounded-lg text-[#6e7681] hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      <ConfirmDialog open={!!deleteTarget} onClose={()=>setDeleteTarget(null)} onConfirm={async ()=>{if(!deleteTarget)return;setDeleting(true);try{await api.deleteExpense(String(deleteTarget.id));toast.success('Gasto eliminado');setDeleteTarget(null);load();}catch(e){toast.error(e instanceof Error?e.message:'Error')}finally{setDeleting(false);}}} title="Eliminar gasto" message={`¿Eliminar "${String(deleteTarget?.description??'')}" por ${formatCurrency(Number(deleteTarget?.amount??0))}? Esta acción restaurará el stock si corresponde.`} loading={deleting}/>

      <Modal open={showModal} onClose={()=>setShowModal(false)} title="Registrar gasto" size="md">
        <div className="space-y-4">
          <div><label className="label">Categoría</label>
            <select className="input" value={form.category_id} onChange={e=>setForm(f=>({...f,category_id:e.target.value}))}>
              <option value="">Sin categoría</option>
              {categories.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
            </select>
          </div>
          <div><label className="label">Descripción *</label><input className="input" placeholder="Ej: Compra para uso interno..." value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
          <div className="p-3 bg-[#0d1117] rounded-xl border border-[#21262d] space-y-3">
            <p className="text-xs font-medium text-[#8b949e] uppercase tracking-wide">Producto del inventario (opcional)</p>
            <div><label className="label">Producto</label>
              <select className="input" value={form.product_id} onChange={e=>setForm(f=>({...f,product_id:e.target.value,product_quantity:0,amount:0}))}>
                <option value="">No aplica</option>
                {products.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)} — costo: {formatCurrency(Number(p.cost))}</option>)}
              </select>
            </div>
            {form.product_id&&<>
              <div><label className="label">Cantidad</label><input type="number" min="0.01" step="0.01" className="input" value={form.product_quantity||''} onChange={e=>setForm(f=>({...f,product_quantity:parseFloat(e.target.value)||0}))}/></div>
              <div><label className="label">Almacén de origen *</label>
                <select className="input" value={form.location_id} onChange={e=>setForm(f=>({...f,location_id:e.target.value}))}>
                  <option value="">Seleccionar almacén</option>
                  {locations.map(l=><option key={String(l.id)} value={String(l.id)}>{String(l.name)}</option>)}
                </select>
              </div>
            </>}
          </div>
          <div><label className="label">Monto *</label><input type="number" min="0.01" step="0.01" className="input" value={form.amount||''} onChange={e=>setForm(f=>({...f,amount:parseFloat(e.target.value)||0}))}/></div>
          <div><label className="label">Fecha</label><input type="date" className="input" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/></div>
          <div className="flex gap-3"><button onClick={()=>setShowModal(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleSave} disabled={saving||!form.description.trim()||form.amount<=0} className="btn-primary flex-1 disabled:opacity-50">{saving?'Guardando...':'Registrar gasto'}</button></div>
        </div>
      </Modal>
    </div>
  );
}
