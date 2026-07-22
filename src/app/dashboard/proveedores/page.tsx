'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { api } from '@/lib/api-client';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import SearchableSelect from '@/components/ui/SearchableSelect';
import { toast } from '@/components/ui/toaster';
import { Truck, Plus, Search, Edit2, Trash2, TrendingDown, History, Phone, PhoneOff, CheckCircle } from 'lucide-react';
type R = Record<string,unknown>;

const PHONE_REGEX = /^(\+?53)?[\s.-]?\d{7,8}$/;

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
  const [phoneTouched, setPhoneTouched] = useState(false);
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
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); setPhoneTouched(false); }
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
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]"/><input className="input pl-9" placeholder="Buscar proveedores..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="flex gap-2">
          <button onClick={()=>setShowPriceModal(true)} className="btn-secondary flex items-center gap-2"><TrendingDown className="w-4 h-4"/>Registrar precio</button>
          <button onClick={()=>{setEditSupplier(null);setForm({name:'',contact:'',phone:'',notes:''});setPhoneTouched(false);setShowModal(true);}} className="btn-primary flex items-center gap-2 flex-shrink-0"><Plus className="w-4 h-4"/>Nuevo proveedor</button>
        </div>
      </div>
      <div className="card overflow-hidden">
        {loading?<div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
        :paginated.length===0?<EmptyState icon={Truck} title="Sin proveedores" description="Agrega tu primer proveedor" action={<button onClick={()=>setShowModal(true)} className="btn-primary">Agregar proveedor</button>}/>:(
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border-primary)]">{['Proveedor','Contacto','Teléfono',''].map(h=><th key={h} className="text-left px-4 py-3 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>{paginated.map(s=>(
                <tr key={String(s.id)} className="border-b border-[var(--border-primary)] last:border-0 table-row-hover">
                  <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{String(s.name)}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{String(s.contact??'—')}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{String(s.phone??'—')}</td>
                  <td className="px-4 py-3"><div className="flex gap-1">
                    <button onClick={()=>{setEditSupplier(s);setForm({name:String(s.name),contact:String(s.contact??''),phone:String(s.phone??''),notes:String(s.notes??'')});setPhoneTouched(false);setShowModal(true);}} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-brand-400 hover:bg-brand-500/10 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                    {(user?.role==='owner'||user?.role==='admin') && <button onClick={()=>setDeleteTarget(s)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>}
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
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Historial de precios por producto</h3>
        <div className="flex gap-3 mb-4">
          <select className="input flex-1 max-w-xs" value={selectedProduct} onChange={async e => { setSelectedProduct(e.target.value); if(e.target.value) { const d=await api.getPurchasePrices(e.target.value); setPriceHistory(d); } }}>
            <option value="">Selecciona un producto</option>
            {products.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}
          </select>
        </div>
        {priceHistory.length>0?(
          <div className="overflow-x-auto rounded-xl border border-[var(--border-primary)]">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border-primary)] bg-[var(--bg-primary)]">{['Fecha','Proveedor','Precio','Notas'].map(h=><th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>{priceHistory.map(p=>(
                <tr key={String(p.id)} className="border-b border-[var(--border-primary)] last:border-0 hover:bg-[#1c2128]">
                  <td className="px-4 py-2.5 text-[var(--text-secondary)] text-xs">{p.date?formatDate(String(p.date)):'—'}</td>
                  <td className="px-4 py-2.5 text-[var(--text-primary)]">{String(p.supplier_name??'—')}</td>
                  <td className="px-4 py-2.5 text-brand-400 font-medium">{formatCurrency(Number(p.price))}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)] text-xs">{String(p.notes??'—')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ):<p className="text-sm text-[var(--text-tertiary)]">Selecciona un producto para ver el historial de precios.</p>}
      </div>

      <Modal open={showModal} onClose={()=>{setShowModal(false); setPhoneTouched(false);}} title={editSupplier?'Editar proveedor':'Nuevo proveedor'} size="md">
        <div className="space-y-4">
          <div><label className="label">Nombre *</label><input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
          <div><label className="label">Contacto</label><input className="input" value={form.contact} onChange={e=>setForm(f=>({...f,contact:e.target.value}))}/></div>
          <div>
            <label className="label">Teléfono</label>
            <div className="relative">
              {form.phone.trim() ? (
                PHONE_REGEX.test(form.phone.trim()) ? (
                  <CheckCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
                ) : (
                  <PhoneOff className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400" />
                )
              ) : (
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
              )}
              <input
                className={`input pl-10 ${
                  phoneTouched && form.phone.trim()
                    ? PHONE_REGEX.test(form.phone.trim())
                      ? 'border-green-500/50 focus:border-green-500 focus:ring-green-500/20'
                      : 'border-amber-500/50 focus:border-amber-500 focus:ring-amber-500/20'
                    : ''
                }`}
                value={form.phone}
                onChange={e=>setForm(f=>({...f,phone:e.target.value}))}
                placeholder="Ej: +53 55280263"
                onFocus={() => setPhoneTouched(true)}
              />
              {phoneTouched && form.phone.trim() && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {PHONE_REGEX.test(form.phone.trim()) ? (
                    <span className="text-[10px] text-green-400 font-medium">Válido</span>
                  ) : (
                    <span className="text-[10px] text-amber-400 font-medium">Inválido</span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div><label className="label">Notas</label><input className="input" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}/></div>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>{setShowModal(false); setPhoneTouched(false);}} className="btn-secondary flex-1">Cancelar</button><button onClick={handleSave} disabled={saving||!form.name.trim()} className="btn-primary flex-1 disabled:opacity-50">{saving?'Guardando...':editSupplier?'Actualizar':'Crear'}</button></div>
        </div>
      </Modal>

      <Modal open={showPriceModal} onClose={()=>setShowPriceModal(false)} title="Registrar precio de compra" size="md">
        <div className="space-y-4">
          <div><label className="label">Producto *</label>
            <SearchableSelect
              options={[
                { value: '', label: 'Seleccionar producto' },
                ...products.map(p => ({ value: String(p.id), label: String(p.name) }))
              ]}
              value={priceForm.product_id}
              onChange={v => setPriceForm(f => ({ ...f, product_id: v }))}
              placeholder="Seleccionar producto"
              noResultsMessage="Sin productos"
            />
          </div>
          <div><label className="label">Proveedor *</label>
            <SearchableSelect
              options={[
                { value: '', label: 'Seleccionar proveedor' },
                ...suppliers.map(s => ({ value: String(s.id), label: String(s.name) }))
              ]}
              value={priceForm.supplier_id}
              onChange={v => setPriceForm(f => ({ ...f, supplier_id: v }))}
              placeholder="Seleccionar proveedor"
              noResultsMessage="Sin proveedores"
            />
          </div>
          <div><label className="label">Precio *</label><input type="number" min="1" step="1" className="input" value={priceForm.price||''} onChange={e=>setPriceForm(f=>({...f,price:parseFloat(e.target.value)||0}))}/></div>
          <div><label className="label">Notas</label><input className="input" value={priceForm.notes} onChange={e=>setPriceForm(f=>({...f,notes:e.target.value}))}/></div>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>setShowPriceModal(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleAddPrice} disabled={saving||!priceForm.product_id||!priceForm.supplier_id||priceForm.price<=0} className="btn-primary flex-1 disabled:opacity-50">{saving?'Guardando...':'Registrar precio'}</button></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onClose={()=>setDeleteTarget(null)} onConfirm={handleDelete} title="Eliminar proveedor" message={`¿Eliminar "${String(deleteTarget?.name??'')}"?`} loading={saving}/>
    </div>
  );
}
