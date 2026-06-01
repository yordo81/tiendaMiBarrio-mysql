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
import { Truck, Plus, Search, Edit2, Trash2, TrendingDown, History } from 'lucide-react';
type R = Record<string,unknown>;

export default function ProveedoresPage() {
  const { user } = useAuthStore();
  const [suppliers, setSuppliers] = useState<R[]>([]);
  const [products, setProducts] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [showHistModal, setShowHistModal] = useState(false);
  const [editSupplier, setEditSupplier] = useState<R|null>(null);
  const [deleteTarget, setDeleteTarget] = useState<R|null>(null);
  const [priceHistory, setPriceHistory] = useState<R[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name:'', contact:'', phone:'', notes:'' });
  const [priceForm, setPriceForm] = useState({ product_id:'', supplier_id:'', price:0, notes:'' });

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([api.getSuppliers(), api.getProducts()]);
    setSuppliers(s); setProducts(p); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editSupplier) await api.updateSupplier({ id: editSupplier.id, ...form });
      else await api.createSupplier(form);
      toast.success(editSupplier?'Proveedor actualizado':'Proveedor creado'); setShowModal(false); load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    await api.deleteSupplier(String(deleteTarget.id));
    toast.success('Proveedor eliminado'); setSaving(false); setDeleteTarget(null); load();
  }

  async function handleAddPrice() {
    if (!priceForm.product_id||!priceForm.supplier_id||priceForm.price<=0) return;
    setSaving(true);
    try {
      await api.createPurchasePrice(priceForm);
      toast.success('Precio registrado'); setShowPriceModal(false); setPriceForm({ product_id:'', supplier_id:'', price:0, notes:'' });
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); }
  }

  async function openHistory(productId: string) {
    setSelectedProduct(productId);
    const data = await api.getPurchasePrices(productId);
    setPriceHistory(data); setShowHistModal(true);
  }

  const filtered = suppliers.filter(s => String(s.name).toLowerCase().includes(search.toLowerCase()));
  const paginated = pageSize === 0 ? filtered : filtered.slice(0, page * pageSize).slice((page - 1) * pageSize);

  // Reset page when search changes
  useEffect(() => { setPage(1); }, [search]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e7681]"/><input className="input pl-9" placeholder="Buscar proveedores..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="flex gap-2">
          <button onClick={()=>setShowPriceModal(true)} className="btn-secondary flex items-center gap-2"><TrendingDown className="w-4 h-4"/>Registrar precio</button>
          <button onClick={()=>{setEditSupplier(null);setForm({name:'',contact:'',phone:'',notes:''});setShowModal(true);}} className="btn-primary flex items-center gap-2 flex-shrink-0"><Plus className="w-4 h-4"/>Nuevo proveedor</button>
        </div>
      </div>
      <div className="card overflow-hidden">
        {loading?<div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
        :paginated.length===0?<EmptyState icon={Truck} title="Sin proveedores" description="Agrega tu primer proveedor" action={<button onClick={()=>setShowModal(true)} className="btn-primary">Agregar proveedor</button>}/>:(
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#21262d]">{['Proveedor','Contacto','Teléfono',''].map(h=><th key={h} className="text-left px-4 py-3 text-xs font-medium text-[#8b949e] uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>{paginated.map(s=>(
                <tr key={String(s.id)} className="border-b border-[#21262d] last:border-0 table-row-hover">
                  <td className="px-4 py-3 font-medium text-[#e6edf3]">{String(s.name)}</td>
                  <td className="px-4 py-3 text-[#8b949e]">{String(s.contact??'—')}</td>
                  <td className="px-4 py-3 text-[#8b949e]">{String(s.phone??'—')}</td>
                  <td className="px-4 py-3"><div className="flex gap-1">
                    <button onClick={()=>{setEditSupplier(s);setForm({name:String(s.name),contact:String(s.contact??''),phone:String(s.phone??''),notes:String(s.notes??'')});setShowModal(true);}} className="p-1.5 rounded-lg text-[#6e7681] hover:text-brand-400 hover:bg-brand-500/10 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                    {(user?.role==='owner'||user?.role==='admin') && <button onClick={()=>setDeleteTarget(s)} className="p-1.5 rounded-lg text-[#6e7681] hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>}
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {/* Historial de precios por producto */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-[#e6edf3] mb-3">Historial de precios por producto</h3>
        <div className="flex gap-3 mb-4">
          <select className="input flex-1 max-w-xs" value={selectedProduct} onChange={async e => { setSelectedProduct(e.target.value); if(e.target.value) { const d=await api.getPurchasePrices(e.target.value); setPriceHistory(d); } }}>
            <option value="">Selecciona un producto</option>
            {products.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}
          </select>
        </div>
        {priceHistory.length>0?(
          <div className="overflow-x-auto rounded-xl border border-[#21262d]">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#21262d] bg-[#0d1117]">{['Fecha','Proveedor','Precio','Notas'].map(h=><th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-[#6e7681] uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>{priceHistory.map(p=>(
                <tr key={String(p.id)} className="border-b border-[#21262d] last:border-0 hover:bg-[#1c2128]">
                  <td className="px-4 py-2.5 text-[#8b949e] text-xs">{p.date?formatDate(String(p.date)):'—'}</td>
                  <td className="px-4 py-2.5 text-[#e6edf3]">{String(p.supplier_name??'—')}</td>
                  <td className="px-4 py-2.5 text-brand-400 font-medium">{formatCurrency(Number(p.price))}</td>
                  <td className="px-4 py-2.5 text-[#8b949e] text-xs">{String(p.notes??'—')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ):<p className="text-sm text-[#6e7681]">Selecciona un producto para ver el historial de precios.</p>}
      </div>

      <Modal open={showModal} onClose={()=>setShowModal(false)} title={editSupplier?'Editar proveedor':'Nuevo proveedor'} size="md">
        <div className="space-y-4">
          <div><label className="label">Nombre *</label><input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
          <div><label className="label">Contacto</label><input className="input" value={form.contact} onChange={e=>setForm(f=>({...f,contact:e.target.value}))}/></div>
          <div><label className="label">Teléfono</label><input className="input" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))}/></div>
          <div><label className="label">Notas</label><input className="input" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></div>
          <div className="flex gap-3"><button onClick={()=>setShowModal(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleSave} disabled={saving||!form.name.trim()} className="btn-primary flex-1 disabled:opacity-50">{saving?'Guardando...':editSupplier?'Actualizar':'Crear'}</button></div>
        </div>
      </Modal>

      <Modal open={showPriceModal} onClose={()=>setShowPriceModal(false)} title="Registrar precio de compra" size="md">
        <div className="space-y-4">
          <div><label className="label">Producto *</label>
            <select className="input" value={priceForm.product_id} onChange={e=>setPriceForm(f=>({...f,product_id:e.target.value}))}>
              <option value="">Seleccionar producto</option>
              {products.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}
            </select>
          </div>
          <div><label className="label">Proveedor *</label>
            <select className="input" value={priceForm.supplier_id} onChange={e=>setPriceForm(f=>({...f,supplier_id:e.target.value}))}>
              <option value="">Seleccionar proveedor</option>
              {suppliers.map(s=><option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}
            </select>
          </div>
          <div><label className="label">Precio *</label><input type="number" min="0.01" step="0.01" className="input" value={priceForm.price||''} onChange={e=>setPriceForm(f=>({...f,price:parseFloat(e.target.value)||0}))}/></div>
          <div><label className="label">Notas</label><input className="input" value={priceForm.notes} onChange={e=>setPriceForm(f=>({...f,notes:e.target.value}))}/></div>
          <div className="flex gap-3"><button onClick={()=>setShowPriceModal(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleAddPrice} disabled={saving||!priceForm.product_id||!priceForm.supplier_id||priceForm.price<=0} className="btn-primary flex-1 disabled:opacity-50">{saving?'Guardando...':'Registrar precio'}</button></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onClose={()=>setDeleteTarget(null)} onConfirm={handleDelete} title="Eliminar proveedor" message={`¿Eliminar "${String(deleteTarget?.name??'')}"?`} loading={saving}/>
    </div>
  );
}
