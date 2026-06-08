'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatCurrency, formatNumber, calcMargin, cn, generateId, formatDateTime } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { api } from '@/lib/api-client';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import { toast } from '@/components/ui/toaster';
import { Package, Plus, Search, Edit2, Trash2, AlertTriangle, Tag, History, ArrowRightLeft, ShoppingBag } from 'lucide-react';

type Tab = 'productos' | 'categorias';
type AnyRecord = Record<string,unknown>;

export default function InventarioPage() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState<Tab>('productos');
  const [products, setProducts] = useState<AnyRecord[]>([]);
  const [categories, setCategories] = useState<AnyRecord[]>([]);
  const [suppliers, setSuppliers] = useState<AnyRecord[]>([]);
  const [locations, setLocations] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [locFilter, setLocFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState({ product_id: '', supplier_id: '', quantity: 0, price: 0, location_id: '', notes: '' });
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [editProduct, setEditProduct] = useState<AnyRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AnyRecord | null>(null);
  const [historyProduct, setHistoryProduct] = useState<AnyRecord | null>(null);
  const [movements, setMovements] = useState<AnyRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AnyRecord>({});
  const [moveForm, setMoveForm] = useState({ type: 'in', quantity: 0, reason: '', location_id: '' });
  const [showZeroStock, setShowZeroStock] = useState(false);
  const [showCatModal, setShowCatModal] = useState(false);
  const [editCat, setEditCat] = useState<AnyRecord | null>(null);
  const [deleteCat, setDeleteCat] = useState<AnyRecord | null>(null);
  const [catForm, setCatForm] = useState({ name: '', parent_id: '' });

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async (locId?: string) => {
    setLoading(true);
    const params = locId ? `location_id=${locId}` : undefined;
    const [prods, cats, sups, locs] = await Promise.all([api.getProducts(params), api.getCategories(), api.getSuppliers(), api.getLocations()]);
    setProducts(prods); setCategories(cats); setSuppliers(sups); setLocations(locs); setLoading(false);
  }, []);

  useEffect(() => { load(locFilter || undefined); }, [load, locFilter]);

  function openNew() { setEditProduct(null); setForm({ name:'', sale_price:0, cost:0, stock:0, min_stock:0, unit:'unidad', supplier_ids:[], location_id: locations.length > 0 ? String(locations[0].id) : '' }); setShowModal(true); }
  function openEdit(p: AnyRecord) { setEditProduct(p); setForm({ ...p, supplier_ids: (p.supplier_ids as string[]|undefined) ?? [] }); setShowModal(true); }

  async function handleSave() {
    if (!String(form.name ?? '').trim()) return;
    setSaving(true);
    try {
      if (editProduct) await api.updateProduct(String(editProduct.id), form);
      else await api.createProduct(form);
      toast.success(editProduct ? 'Producto actualizado' : 'Producto creado');
      setShowModal(false); load();
    } catch(e) { toast.error(e instanceof Error ? e.message : 'Error al guardar'); } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    await api.deleteProduct(String(deleteTarget.id));
    toast.success('Producto eliminado'); setSaving(false); setDeleteTarget(null); load();
  }

  async function openHistory(p: AnyRecord) {
    setHistoryProduct(p);
    const data = await api.getMovements(String(p.id));
    setMovements(data); setShowHistoryModal(true);
  }

  function openPurchase(productId?: string) {
    setPurchaseForm({
      product_id: productId ?? '',
      supplier_id: suppliers.length > 0 ? String(suppliers[0].id) : '',
      quantity: 0,
      price: 0,
      location_id: locations.length > 0 ? String(locations[0].id) : '',
      notes: '',
    });
    setShowPurchaseModal(true);
  }

  function openMove() {
    setMoveForm({ type: 'in', quantity: 0, reason: '', location_id: locations.length > 0 ? String(locations[0].id) : '' });
    setShowMoveModal(true);
  }

  async function handlePurchase() {
    if (!purchaseForm.product_id || !purchaseForm.supplier_id || purchaseForm.quantity <= 0 || purchaseForm.price < 0) {
      toast.error('Completa todos los campos requeridos');
      return;
    }
    setPurchaseSaving(true);
    try {
      const res = await api.registerPurchase(purchaseForm);
      toast.success(`Compra registrada — costo promedio: $${Number((res as any).cost_after).toFixed(2)}`);
      setShowPurchaseModal(false);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error al registrar compra'); } finally { setPurchaseSaving(false); }
  }

  async function handleMove() {
    if (!historyProduct || !moveForm.reason || moveForm.quantity <= 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/stock-movements', {
        method: 'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ product_id: historyProduct.id, ...moveForm })
      });
      if (!res.ok) throw new Error('Error al registrar');
      toast.success('Movimiento registrado'); setShowMoveModal(false); load(); openHistory(historyProduct);
    } catch(e) { toast.error(e instanceof Error ? e.message : 'Error'); } finally { setSaving(false); }
  }

  async function handleSaveCat() {
    if (!catForm.name.trim()) return;
    setSaving(true);
    try {
      if (editCat) await api.updateCategory({ id: editCat.id, ...catForm, parent_id: catForm.parent_id || null });
      else await api.createCategory({ ...catForm, parent_id: catForm.parent_id || null });
      toast.success(editCat ? 'Categoría actualizada' : 'Categoría creada');
      setShowCatModal(false); load();
    } catch(e) { toast.error(e instanceof Error ? e.message : 'Error'); } finally { setSaving(false); }
  }

  async function handleDeleteCat() {
    if (!deleteCat) return;
    setSaving(true);
    await api.deleteCategory(String(deleteCat.id));
    toast.success('Categoría eliminada'); setSaving(false); setDeleteCat(null); load();
  }

  const filtered = products.filter(p => {
    const matchSearch = String(p.name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchCat = catFilter ? p.category_id === catFilter : true;
    const matchStock = showZeroStock || Number(p.stock ?? 0) > 0;
    return matchSearch && matchCat && matchStock;
  });
  const paginated = pageSize === 0 ? filtered : filtered.slice(0, page * pageSize).slice((page - 1) * pageSize);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [search, catFilter, locFilter]);
  const lowStock = products.filter(p => Number(p.stock ?? 0) <= Number(p.min_stock ?? 0) && Number(p.min_stock ?? 0) > 0);
  const movTypeLabel: Record<string,string> = { in:'Entrada', out:'Salida', adjust:'Ajuste', expense:'Gasto', sale:'Venta' };
  const movTypeColor: Record<string,string> = { in:'text-green-400', out:'text-red-400', adjust:'text-yellow-400', expense:'text-orange-400', sale:'text-blue-400' };

  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b border-[#21262d] pb-0">
        {([['productos','Productos',Package],['categorias','Categorías',Tag]] as const).map(([key,label,Icon]) => (
          <button key={key} onClick={() => setTab(key as Tab)} className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors', tab===key?'border-brand-500 text-brand-400':'border-transparent text-[#8b949e] hover:text-[#e6edf3]')}>
            <Icon className="w-4 h-4"/>{label}
          </button>
        ))}
      </div>

      {tab === 'productos' && (
        <>
          {lowStock.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0"/>
              <p className="text-yellow-400 text-sm"><span className="font-semibold">{lowStock.length}</span> producto(s) con stock bajo: {lowStock.slice(0,3).map(p=>String(p.name)).join(', ')}{lowStock.length>3?'...':''}</p>
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex gap-2 flex-1 w-full sm:w-auto">
              <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e7681]"/><input className="input pl-9" placeholder="Buscar..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
              <select className="input w-44" value={catFilter} onChange={e=>setCatFilter(e.target.value)}>
                <option value="">Todas las categorías</option>
                {categories.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
              </select>
              <select className="input w-44" value={locFilter} onChange={e=>setLocFilter(e.target.value)}>
                <option value="">Todos los almacenes</option>
                {locations.map(l=><option key={String(l.id)} value={String(l.id)}>{String(l.name)}</option>)}
              </select>
              <button onClick={()=>setShowZeroStock(v=>!v)} className={cn('flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors flex-shrink-0', showZeroStock ? 'bg-brand-600/20 border-brand-600/50 text-brand-400' : 'border-[#30363d] text-[#6e7681] hover:text-[#8b949e] hover:border-[#6e7681]')}>
                <span className="text-sm">{showZeroStock ? '☑' : '☐'}</span> Stock 0
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={() => openPurchase()} className="btn-secondary flex items-center gap-2 flex-shrink-0"><ShoppingBag className="w-4 h-4"/>Registrar compra</button>
              <button onClick={openNew} className="btn-primary flex items-center gap-2 flex-shrink-0"><Plus className="w-4 h-4"/>Nuevo producto</button>
            </div>
          </div>

          <div className="card overflow-hidden">
            {loading ? <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
            : paginated.length === 0 ? <EmptyState icon={Package} title="No hay productos" description="Agrega tu primer producto" action={<button onClick={openNew} className="btn-primary">Agregar</button>}/>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[#21262d]">{['Producto','Categoría','Proveedores','Ubicación','Stock','Precio','Costo','Margen',''].map(h=><th key={h} className="text-left px-4 py-3 text-xs font-medium text-[#8b949e] uppercase tracking-wide">{h}</th>)}</tr></thead>
                  <tbody>
                    {paginated.map(p => {
                      const lowS = Number(p.stock)<=Number(p.min_stock)&&Number(p.min_stock)>0;
                      const margin = calcMargin(Number(p.sale_price), Number(p.cost));
                      return (
                        <tr key={String(p.id)} className="border-b border-[#21262d] last:border-0 table-row-hover">
                          <td className="px-4 py-3"><div className="font-medium text-[#e6edf3]">{String(p.name)}</div>{Boolean(p.description) ? <div className="text-xs text-[#6e7681] truncate max-w-[140px]">{String(p.description)}</div> : null}</td>
                          <td className="px-4 py-3 text-[#8b949e]">{String(p.category_name??'—')}</td>
                          <td className="px-4 py-3 text-[#8b949e] text-xs max-w-[120px] truncate">{(p.supplier_names as string[]|undefined)?.join(', ')||'—'}</td>
                          <td className="px-4 py-3 text-[#8b949e] text-xs">{String(p.location_name??'—')}</td>
                          <td className="px-4 py-3"><span className={cn('font-medium',lowS?'text-red-400':'text-[#e6edf3]')}>{formatNumber(Number(p.stock),1)} {String(p.unit)}</span>{lowS ? <span className="ml-1.5 badge-danger text-[10px]">Bajo</span> : null}</td>
                          <td className="px-4 py-3 text-[#e6edf3]">{formatCurrency(Number(p.sale_price))}</td>
                          <td className="px-4 py-3 text-[#8b949e]">{formatCurrency(Number(p.cost))}</td>
                          <td className="px-4 py-3"><span className={cn('font-medium',margin>=20?'text-green-400':margin>=10?'text-yellow-400':'text-red-400')}>{margin.toFixed(1)}%</span></td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button onClick={()=>openHistory(p)} className="p-1.5 rounded-lg text-[#6e7681] hover:text-blue-400 hover:bg-blue-500/10 transition-colors"><History className="w-3.5 h-3.5"/></button>
                              <button onClick={()=>openEdit(p)} className="p-1.5 rounded-lg text-[#6e7681] hover:text-brand-400 hover:bg-brand-500/10 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                              {(user?.role === 'owner' || user?.role === 'admin') && <button onClick={()=>setDeleteTarget(p)} className="p-1.5 rounded-lg text-[#6e7681] hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination currentPage={page} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </div>
        </>
      )}

      {tab === 'categorias' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-[#8b949e]">{categories.length} categoría(s)</p>
            <button onClick={()=>{setEditCat(null);setCatForm({name:'',parent_id:''});setShowCatModal(true);}} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4"/>Nueva categoría</button>
          </div>
          <div className="card overflow-hidden">
            {categories.length===0?<EmptyState icon={Tag} title="Sin categorías" description="Crea categorías para organizar productos" action={<button onClick={()=>setShowCatModal(true)} className="btn-primary">Crear categoría</button>}/>:(
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[#21262d]">{['Nombre','Cat. padre','Productos',''].map(h=><th key={h} className="text-left px-4 py-3 text-xs font-medium text-[#8b949e] uppercase tracking-wide">{h}</th>)}</tr></thead>
                <tbody>{categories.map(c=>{
                  const parent = categories.find(x=>x.id===c.parent_id);
                  const count = products.filter(p=>p.category_id===c.id).length;
                  return(<tr key={String(c.id)} className="border-b border-[#21262d] last:border-0 table-row-hover">
                    <td className="px-4 py-3 font-medium text-[#e6edf3]">{String(c.name)}</td>
                    <td className="px-4 py-3 text-[#8b949e]">{parent?String(parent.name):'—'}</td>
                    <td className="px-4 py-3 text-[#8b949e]">{count}</td>
                    <td className="px-4 py-3"><div className="flex gap-1">
                      <button onClick={()=>{setEditCat(c);setCatForm({name:String(c.name),parent_id:String(c.parent_id??'')});setShowCatModal(true);}} className="p-1.5 rounded-lg text-[#6e7681] hover:text-brand-400 hover:bg-brand-500/10 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                      <button onClick={()=>setDeleteCat(c)} className="p-1.5 rounded-lg text-[#6e7681] hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                    </div></td>
                  </tr>);
                })}</tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Product Modal */}
      <Modal open={showModal} onClose={()=>setShowModal(false)} title={editProduct?'Editar producto':'Nuevo producto'} size="xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><label className="label">Nombre *</label><input className="input" value={String(form.name??'')} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
          <div className="sm:col-span-2"><label className="label">Descripción</label><input className="input" value={String(form.description??'')} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
          <div><label className="label">Categoría</label>
            <select className="input" value={String(form.category_id??'')} onChange={e=>setForm(f=>({...f,category_id:e.target.value||null}))}>
              <option value="">Sin categoría</option>
              {categories.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
            </select>
          </div>
          <div><label className="label">Unidad</label><input className="input" value={String(form.unit??'unidad')} onChange={e=>setForm(f=>({...f,unit:e.target.value}))}/></div>
          <div><label className="label">Precio de venta</label><input type="number" min="0" step="1" className="input" value={Number(form.sale_price??0)} onChange={e=>setForm(f=>({...f,sale_price:parseFloat(e.target.value)||0}))}/></div>
          <div><label className="label">Costo</label><input type="number" min="0" step="1" className="input" value={Number(form.cost??0)} onChange={e=>setForm(f=>({...f,cost:parseFloat(e.target.value)||0}))}/></div>
          <div><label className="label">Stock {editProduct?'actual':'inicial'}</label><input type="number" min="0" step="1" className="input" value={Number(form.stock??0)} onChange={e=>setForm(f=>({...f,stock:parseFloat(e.target.value)||0}))}/></div>
          {!editProduct && (
            <div><label className="label">Almacén destino</label>
              <select className="input" value={String(form.location_id??'')} onChange={e=>setForm(f=>({...f,location_id:e.target.value}))}>
                {locations.length === 0 && <option value="">Cargando...</option>}
                {locations.map(l=><option key={String(l.id)} value={String(l.id)}>{String(l.name)}</option>)}
              </select>
              <p className="text-[10px] text-[#6e7681] mt-1">El stock inicial se registrará en este almacén</p>
            </div>
          )}
          <div><label className="label">Stock mínimo</label><input type="number" min="0" step="1" className="input" value={Number(form.min_stock??0)} onChange={e=>setForm(f=>({...f,min_stock:parseFloat(e.target.value)||0}))}/></div>
          <div className="sm:col-span-2">
            <label className="label">Proveedores</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-36 overflow-y-auto p-2 bg-[#0d1117] rounded-lg border border-[#30363d]">
              {suppliers.length===0?<p className="text-xs text-[#6e7681] col-span-3 py-2">No hay proveedores</p>:suppliers.map(s=>{
                const sids = (form.supplier_ids as string[]|undefined)??[];
                const checked = sids.includes(String(s.id));
                return(<label key={String(s.id)} className={cn('flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors',checked?'bg-brand-600/20 text-brand-400':'hover:bg-[#161b22] text-[#8b949e]')}>
                  <input type="checkbox" className="accent-brand-600" checked={checked} onChange={e=>setForm(f=>({...f,supplier_ids:e.target.checked?[...sids,String(s.id)]:sids.filter(id=>id!==String(s.id))}))}/>
                  {String(s.name)}
                </label>);
              })}
            </div>
          </div>
        </div>
        {Number(form.sale_price??0)>0&&Number(form.cost??0)>0&&(
          <div className="mt-4 bg-[#0d1117] rounded-lg px-4 py-2.5 text-sm flex gap-4">
            <span className="text-[#8b949e]">Margen: <span className="text-green-400 font-semibold">{calcMargin(Number(form.sale_price),Number(form.cost)).toFixed(1)}%</span></span>
            <span className="text-[#8b949e]">Ganancia: <span className="text-green-400 font-semibold">{formatCurrency(Number(form.sale_price)-Number(form.cost))}</span></span>
          </div>
        )}
        <div className="flex flex-col xs:flex-row gap-2 justify-end mt-5">
          <button onClick={()=>setShowModal(false)} className="btn-secondary flex-1 xs:flex-none">Cancelar</button>
          <button onClick={handleSave} disabled={saving||!String(form.name??'').trim()} className="btn-primary flex-1 xs:flex-none disabled:opacity-50">{saving?'Guardando...':editProduct?'Actualizar':'Crear'}</button>
        </div>
      </Modal>

      {/* History Modal */}
      <Modal open={showHistoryModal} onClose={()=>setShowHistoryModal(false)} title={`Historial — ${String(historyProduct?.name??'')}`} size="xl">
        <div className="flex justify-end mb-4 gap-2">
          <button onClick={() => openPurchase(String(historyProduct?.id))} className="btn-secondary flex items-center gap-2"><ShoppingBag className="w-4 h-4"/>Registrar compra</button>
          <button onClick={openMove} className="btn-primary flex items-center gap-2"><ArrowRightLeft className="w-4 h-4"/>Registrar movimiento</button>
        </div>
        {movements.length===0?<p className="text-center text-[#6e7681] py-8 text-sm">Sin movimientos</p>:(
          <div className="overflow-x-auto rounded-xl border border-[#21262d]">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#21262d] bg-[#0d1117]">{['Fecha','Tipo','Cantidad','Razón','Usuario'].map(h=><th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-[#6e7681] uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>{movements.map(m=>(
                <tr key={String(m.id)} className="border-b border-[#21262d] last:border-0 hover:bg-[#1c2128]">
                  <td className="px-4 py-2.5 text-[#8b949e] text-xs">{m.date?formatDateTime(String(m.date)):'—'}</td>
                  <td className="px-4 py-2.5"><span className={cn('font-medium text-xs',movTypeColor[String(m.type)]??'text-[#e6edf3]')}>{movTypeLabel[String(m.type)]??String(m.type)}</span></td>
                  <td className="px-4 py-2.5 text-[#e6edf3] font-medium">{formatNumber(Number(m.quantity),2)}</td>
                  <td className="px-4 py-2.5 text-[#8b949e]">{String(m.reason??'—')}</td>
                  <td className="px-4 py-2.5 text-[#8b949e] text-xs">{String(m.user_name??'—')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* Purchase Modal */}
      <Modal open={showPurchaseModal} onClose={() => setShowPurchaseModal(false)} title="Registrar compra" size="md">
        <div className="space-y-4">
          <div><label className="label">Producto *</label>
            <select className="input" value={purchaseForm.product_id} onChange={e => setPurchaseForm(f => ({ ...f, product_id: e.target.value }))}>
              <option value="">Seleccionar producto...</option>
              {products.map(p => {
                const lowS = Number(p.stock) <= Number(p.min_stock);
                return (
                  <option key={String(p.id)} value={String(p.id)}>
                    {String(p.name)} — Stock: {formatNumber(Number(p.stock), 1)} {String(p.unit)} · Costo actual: {formatCurrency(Number(p.cost))}
                    {lowS ? ' ⚠️ Stock bajo' : ''}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Proveedor *</label>
              <select className="input" value={purchaseForm.supplier_id} onChange={e => setPurchaseForm(f => ({ ...f, supplier_id: e.target.value }))}>
                <option value="">Seleccionar...</option>
                {suppliers.map(s => <option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}
              </select>
            </div>
            <div><label className="label">Almacén destino</label>
              <select className="input" value={purchaseForm.location_id} onChange={e => setPurchaseForm(f => ({ ...f, location_id: e.target.value }))}>
                {locations.map(l => <option key={String(l.id)} value={String(l.id)}>{String(l.name)}</option>)}
              </select>
            </div>
            <div><label className="label">Cantidad *</label><input type="number" min="1" step="1" className="input" value={purchaseForm.quantity || ''} onChange={e => setPurchaseForm(f => ({ ...f, quantity: parseFloat(e.target.value) || 0 }))} /></div>
            <div><label className="label">Precio unitario *</label><input type="number" min="0" step="1" className="input" value={purchaseForm.price || ''} onChange={e => setPurchaseForm(f => ({ ...f, price: parseFloat(e.target.value) || 0 }))} /></div>
          </div>
          <div><label className="label">Notas</label><input className="input" placeholder="Ej: Factura #123, lote..." value={purchaseForm.notes} onChange={e => setPurchaseForm(f => ({ ...f, notes: e.target.value }))} /></div>

          {/* Resumen con costo promedio */}
          {purchaseForm.product_id && purchaseForm.quantity > 0 && purchaseForm.price >= 0 && (() => {
            const prod = products.find(p => String(p.id) === purchaseForm.product_id);
            if (!prod) return null;
            const currentStock = Number(prod.stock ?? 0);
            const currentCost = Number(prod.cost ?? 0);
            const newStock = currentStock + purchaseForm.quantity;
            const newCost = ((currentStock * currentCost) + (purchaseForm.quantity * purchaseForm.price)) / newStock;
            const totalCost = purchaseForm.quantity * purchaseForm.price;
            return (
              <div className="bg-[#0d1117] rounded-xl border border-[#21262d] p-3 text-sm space-y-1.5">
                <p className="text-xs font-medium text-[#8b949e] uppercase tracking-wide">Resumen de la compra</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <p className="text-[#6e7681]">Stock actual:</p><p className="text-[#e6edf3] text-right">{formatNumber(currentStock, 1)}</p>
                  <p className="text-[#6e7681]">Stock después:</p><p className="text-green-400 text-right font-medium">{formatNumber(newStock, 1)}</p>
                  <p className="text-[#6e7681]">Costo actual:</p><p className="text-[#e6edf3] text-right">{formatCurrency(currentCost)}</p>
                  <p className="text-[#6e7681]">Nuevo costo promedio:</p><p className="text-brand-400 text-right font-semibold">{formatCurrency(Math.round(newCost * 100) / 100)}</p>
                  <p className="text-[#6e7681]">Total compra:</p><p className="text-[#e6edf3] text-right font-medium">{formatCurrency(totalCost)}</p>
                </div>
              </div>
            );
          })()}

          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3 pt-2">
            <button onClick={() => setShowPurchaseModal(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handlePurchase} disabled={purchaseSaving || !purchaseForm.product_id || !purchaseForm.supplier_id || purchaseForm.quantity <= 0} className="btn-primary flex-1 disabled:opacity-50">
              {purchaseSaving ? 'Registrando...' : <span className="flex items-center justify-center gap-2"><ShoppingBag className="w-4 h-4" />Registrar compra</span>}
            </button>
          </div>
        </div>
      </Modal>

      {/* Move Modal */}
      <Modal open={showMoveModal} onClose={()=>setShowMoveModal(false)} title="Registrar movimiento" size="sm">
        <div className="space-y-4">
          <div><label className="label">Tipo</label>
            <select className="input" value={moveForm.type} onChange={e=>setMoveForm(f=>({...f,type:e.target.value}))}>
              <option value="in">Entrada</option><option value="out">Salida</option><option value="adjust">Ajuste (stock exacto)</option>
            </select>
          </div>
          <div><label className="label">Cantidad</label><input type="number" min="1" step="1" className="input" value={moveForm.quantity||''} onChange={e=>setMoveForm(f=>({...f,quantity:parseFloat(e.target.value)||0}))}/></div>
          <div><label className="label">Almacén destino</label>
            <select className="input" value={moveForm.location_id} onChange={e=>setMoveForm(f=>({...f,location_id:e.target.value}))}>
              {locations.map(l=><option key={String(l.id)} value={String(l.id)}>{String(l.name)}</option>)}
            </select>
          </div>
          <div><label className="label">Razón *</label><input className="input" placeholder="Ej: Compra, Merma, Conteo físico..." value={moveForm.reason} onChange={e=>setMoveForm(f=>({...f,reason:e.target.value}))}/></div>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>setShowMoveModal(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleMove} disabled={saving||!moveForm.reason||moveForm.quantity<=0} className="btn-primary flex-1 disabled:opacity-50">{saving?'Guardando...':'Registrar'}</button></div>
        </div>
      </Modal>

      {/* Category Modal */}
      <Modal open={showCatModal} onClose={()=>setShowCatModal(false)} title={editCat?'Editar categoría':'Nueva categoría'} size="sm">
        <div className="space-y-4">
          <div><label className="label">Nombre *</label><input className="input" placeholder="Ej: Bebidas, Lácteos..." value={catForm.name} onChange={e=>setCatForm(f=>({...f,name:e.target.value}))}/></div>
          <div><label className="label">Categoría padre (opcional)</label>
            <select className="input" value={catForm.parent_id} onChange={e=>setCatForm(f=>({...f,parent_id:e.target.value}))}>
              <option value="">Sin categoría padre</option>
              {categories.filter(c=>c.id!==editCat?.id).map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
            </select>
          </div>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>setShowCatModal(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleSaveCat} disabled={saving||!catForm.name.trim()} className="btn-primary flex-1 disabled:opacity-50">{saving?'Guardando...':editCat?'Actualizar':'Crear'}</button></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onClose={()=>setDeleteTarget(null)} onConfirm={handleDelete} title="Eliminar producto" message={`¿Eliminar "${String(deleteTarget?.name??'')}"?`} loading={saving}/>
      <ConfirmDialog open={!!deleteCat} onClose={()=>setDeleteCat(null)} onConfirm={handleDeleteCat} title="Eliminar categoría" message={`¿Eliminar "${String(deleteCat?.name??'')}"? Los productos quedarán sin categoría.`} loading={saving}/>
    </div>
  );
}
