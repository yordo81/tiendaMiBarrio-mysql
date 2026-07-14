'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { formatCurrency, formatNumber, calcMargin, cn, generateId, formatDateTime } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { api } from '@/lib/api-client';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import { toast } from '@/components/ui/toaster';
import { Package, Plus, Search, Edit2, Trash2, AlertTriangle, Tag, History, ArrowRightLeft, ShoppingBag, Image as ImageIcon, Upload, X as XIcon } from 'lucide-react';

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
  const [purchaseForm, setPurchaseForm] = useState({ product_id: '', supplier_id: '', quantity: 0, price: 0, location_id: '', notes: '', is_capital: false });
  const [purchaseSaving, setPurchaseSaving] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [editProduct, setEditProduct] = useState<AnyRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AnyRecord | null>(null);
  const [historyProduct, setHistoryProduct] = useState<AnyRecord | null>(null);
  const [movements, setMovements] = useState<AnyRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AnyRecord>({});
  const [moveForm, setMoveForm] = useState({ type: 'in', quantity: 0, reason: '', location_id: '' });
  const [moveLocStock, setMoveLocStock] = useState<number | null>(null);
  const [purchaseLocStockMap, setPurchaseLocStockMap] = useState<Record<string, number>>({});
  const [showZeroStock, setShowZeroStock] = useState(false);
  const [showLowStockBanner, setShowLowStockBanner] = useState(() => localStorage.getItem('inv_hide_low_stock') !== 'true');

  function dismissLowStockBanner() {
    setShowLowStockBanner(false);
    localStorage.setItem('inv_hide_low_stock', 'true');
  }

  function restoreLowStockBanner() {
    setShowLowStockBanner(true);
    localStorage.removeItem('inv_hide_low_stock');
  }
  const [showCatModal, setShowCatModal] = useState(false);
  const [editCat, setEditCat] = useState<AnyRecord | null>(null);
  const [deleteCat, setDeleteCat] = useState<AnyRecord | null>(null);
  const [catForm, setCatForm] = useState({ name: '', parent_id: '' });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Inicialización única del filtro de ubicación
  const locInitialized = useRef(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async (locId?: string) => {
    setLoading(true);
    const params = locId ? `location_id=${locId}` : undefined;
    const [prods, cats, sups, locs] = await Promise.all([api.getProducts(params), api.getCategories(), api.getSuppliers(), api.getLocations()]);
    setProducts(prods); setCategories(cats); setSuppliers(sups); setLocations(locs); setLoading(false);
  }, []);

  // Inicializar locFilter con el primer almacén (solo una vez al montar)
  useEffect(() => {
    if (locations.length > 0 && !locInitialized.current) {
      locInitialized.current = true;
      setLocFilter(String(locations[0].id));
    }
  }, [locations]);

  // Cargar datos cada vez que cambie el filtro de ubicación
  useEffect(() => { load(locFilter || undefined); }, [load, locFilter]);

  function openNew() { setEditProduct(null); setForm({ name:'', sale_price:0, cost:0, stock:0, min_stock:0, unit:'unidad', supplier_ids:[], location_id: locations.length > 0 ? String(locations[0].id) : '', is_capital: false }); setImageFile(null); setImagePreview(null); setShowModal(true); }
  function openEdit(p: AnyRecord) { setEditProduct(p); setForm({ ...p, supplier_ids: (p.supplier_ids as string[]|undefined) ?? [] }); setImageFile(null); setImagePreview(String(p.image_url??'')); setShowModal(true); }

  async function handleSave() {
    if (!String(form.name ?? '').trim()) return;
    setSaving(true);
    try {
      let imageUrl = String(form.image_url ?? '');
      // Upload image if a new file was selected
      if (imageFile) {
        setImageUploading(true);
        const formData = new FormData();
        formData.append('file', imageFile);
        const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!uploadRes.ok) { const err = await uploadRes.json(); throw new Error(err.error ?? 'Error al subir imagen'); }
        const uploadData = await uploadRes.json();
        imageUrl = uploadData.url;
        setImageUploading(false);
      }
      const payload = { ...form, image_url: imageUrl || null };
      if (editProduct) await api.updateProduct(String(editProduct.id), payload);
      else await api.createProduct({
        ...payload,
        is_capital: form.is_capital === true,
      });
      toast.success(editProduct ? 'Producto actualizado' : 'Producto creado');
      setShowModal(false); load();
    } catch(e) { toast.error(e instanceof Error ? e.message : 'Error al guardar'); } finally { setSaving(false); setImageUploading(false); }
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
      is_capital: false,
    });
    setPurchaseLocStockMap({});
    setShowPurchaseModal(true);
  }

  // Fetch location-specific stock for the purchase modal
  useEffect(() => {
    if (purchaseForm.location_id) {
      api.getLocationStock(purchaseForm.location_id).then(stock => {
        const map: Record<string, number> = {};
        stock.forEach((s: Record<string,unknown>) => { map[String(s.product_id)] = Number(s.quantity); });
        setPurchaseLocStockMap(map);
      }).catch(() => setPurchaseLocStockMap({}));
    } else {
      setPurchaseLocStockMap({});
    }
  }, [purchaseForm.location_id]);

  function openMove() {
    setMoveForm({ type: 'in', quantity: 0, reason: '', location_id: locations.length > 0 ? String(locations[0].id) : '' });
    setMoveLocStock(null);
    setShowMoveModal(true);
  }

  // Fetch stock of the selected product in the chosen location
  useEffect(() => {
    if (!showMoveModal || !moveForm.location_id || !historyProduct) {
      setMoveLocStock(null);
      return;
    }
    api.getLocationStock(moveForm.location_id).then(stock => {
      const found = stock.find((s: Record<string,unknown>) => String(s.product_id) === String(historyProduct.id));
      setMoveLocStock(found ? Number(found.quantity) : 0);
    }).catch(() => setMoveLocStock(0));
  }, [moveForm.location_id, showMoveModal, historyProduct]);

  async function handlePurchase() {
    if (!purchaseForm.product_id || !purchaseForm.supplier_id || purchaseForm.quantity <= 0 || purchaseForm.price < 0) {
      toast.error('Completa todos los campos requeridos');
      return;
    }
    setPurchaseSaving(true);
    try {
      const res = await api.registerPurchase({
        product_id: purchaseForm.product_id,
        supplier_id: purchaseForm.supplier_id,
        quantity: purchaseForm.quantity,
        price: purchaseForm.price,
        location_id: purchaseForm.location_id,
        notes: purchaseForm.notes,
        is_capital: purchaseForm.is_capital,
      });
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
      <div className="flex gap-1 border-b border-[var(--border-primary)] pb-0">
        {([['productos','Productos',Package],['categorias','Categorías',Tag]] as const).map(([key,label,Icon]) => (
          <button key={key} onClick={() => setTab(key as Tab)} className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors', tab===key?'border-brand-500 text-brand-400':'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]')}>
            <Icon className="w-4 h-4"/>{label}
          </button>
        ))}
      </div>

      {tab === 'productos' && (
        <>
          {lowStock.length > 0 && showLowStockBanner && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 flex items-center gap-3 group">
              <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0"/>
              <p className="text-yellow-400 text-sm flex-1"><span className="font-semibold">{lowStock.length}</span> producto(s) con stock bajo: {lowStock.slice(0,3).map(p=>String(p.name)).join(', ')}{lowStock.length>3?'...':''}</p>
              <button
                onClick={dismissLowStockBanner}
                className="text-yellow-400/60 hover:text-yellow-400 transition-colors p-1 rounded-lg hover:bg-yellow-500/10"
                title="Ocultar aviso"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div className="flex gap-2 flex-1 w-full sm:w-auto">
              <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]"/><input className="input pl-9" placeholder="Buscar..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
              <select className="input w-44" value={catFilter} onChange={e=>setCatFilter(e.target.value)}>
                <option value="">Todas las categorías</option>
                {categories.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
              </select>
              <select className="input w-44" value={locFilter} onChange={e=>setLocFilter(e.target.value)}>
                <option value="">Todos los almacenes</option>
                {locations.map(l=><option key={String(l.id)} value={String(l.id)}>{String(l.name)}</option>)}
              </select>
              <button onClick={()=>setShowZeroStock(v=>!v)} className={cn('flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors flex-shrink-0', showZeroStock ? 'bg-brand-600/20 border-brand-600/50 text-brand-400' : 'border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:border-[#6e7681]')}>
                <span className="text-sm">{showZeroStock ? '☑' : '☐'}</span> Stock 0
              </button>
              {!showLowStockBanner && lowStock.length > 0 && (
                <button
                  onClick={restoreLowStockBanner}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-[var(--border-secondary)] text-yellow-400 hover:text-yellow-300 hover:border-yellow-500/40 hover:bg-yellow-500/5 transition-colors"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Stock bajo ({lowStock.length})
                </button>
              )}
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
                  <thead><tr className="border-b border-[var(--border-primary)]">{['img-col','Producto','Categoría','Proveedores','Ubicación','Stock','Precio','Costo','Margen','actions-col'].map(h=><th key={h} className="text-left px-4 py-3 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">{['img-col','actions-col'].includes(h)?'':h}</th>)}</tr></thead>
                  <tbody>
                    {paginated.map(p => {
                      const lowS = Number(p.stock)<=Number(p.min_stock)&&Number(p.min_stock)>0;
                      const margin = calcMargin(Number(p.sale_price), Number(p.cost));
                      return (
                        <tr key={String(p.id)} className="border-b border-[var(--border-primary)] last:border-0 table-row-hover">
                          <td className="px-4 py-3 w-12">
                            <div className="w-10 h-10 bg-[var(--bg-primary)] rounded-lg border border-[var(--border-primary)] overflow-hidden flex items-center justify-center flex-shrink-0">
                              {String(p.image_url??'') ? (
                                <img
                                  src={String(p.image_url)}
                                  alt={String(p.name)}
                                  className="w-full h-full object-cover"
                                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                />
                              ) : (
                                <ImageIcon className="w-4 h-4 text-[#30363d]" />
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3"><div className="font-medium text-[var(--text-primary)]">{String(p.name)}</div>{Boolean(p.description) ? <div className="text-xs text-[var(--text-tertiary)] truncate max-w-[140px]">{String(p.description)}</div> : null}</td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">{String(p.category_name??'—')}</td>
                          <td className="px-4 py-3 text-[var(--text-secondary)] text-xs max-w-[120px] truncate">{(p.supplier_names as string[]|undefined)?.join(', ')||'—'}</td>
                          <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{String(p.location_name??'—')}</td>
                          <td className="px-4 py-3"><span className={cn('font-medium',lowS?'text-red-400':'text-[var(--text-primary)]')}>{formatNumber(Number(p.stock),1)} {String(p.unit)}</span>{lowS ? <span className="ml-1.5 badge-danger text-[10px]">Bajo</span> : null}</td>
                          <td className="px-4 py-3 text-[var(--text-primary)]">{formatCurrency(Number(p.sale_price))}</td>
                          <td className="px-4 py-3 text-[var(--text-secondary)]">{formatCurrency(Number(p.cost))}</td>
                          <td className="px-4 py-3"><span className={cn('font-medium',margin>=20?'text-green-400':margin>=10?'text-yellow-400':'text-red-400')}>{margin.toFixed(1)}%</span></td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button onClick={()=>openHistory(p)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-blue-400 hover:bg-blue-500/10 transition-colors"><History className="w-3.5 h-3.5"/></button>
                              <button onClick={()=>openEdit(p)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-brand-400 hover:bg-brand-500/10 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                              {(user?.role === 'owner' || user?.role === 'admin') && <button onClick={()=>setDeleteTarget(p)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>}
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
            <p className="text-sm text-[var(--text-secondary)]">{categories.length} categoría(s)</p>
            <button onClick={()=>{setEditCat(null);setCatForm({name:'',parent_id:''});setShowCatModal(true);}} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4"/>Nueva categoría</button>
          </div>
          <div className="card overflow-hidden">
            {categories.length===0?<EmptyState icon={Tag} title="Sin categorías" description="Crea categorías para organizar productos" action={<button onClick={()=>setShowCatModal(true)} className="btn-primary">Crear categoría</button>}/>:(
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--border-primary)]">{['Nombre','Cat. padre','Productos',''].map(h=><th key={h} className="text-left px-4 py-3 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">{h}</th>)}</tr></thead>
                <tbody>{categories.map(c=>{
                  const parent = categories.find(x=>x.id===c.parent_id);
                  const count = products.filter(p=>p.category_id===c.id).length;
                  return(<tr key={String(c.id)} className="border-b border-[var(--border-primary)] last:border-0 table-row-hover">
                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{String(c.name)}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{parent?String(parent.name):'—'}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{count}</td>
                    <td className="px-4 py-3"><div className="flex gap-1">
                      <button onClick={()=>{setEditCat(c);setCatForm({name:String(c.name),parent_id:String(c.parent_id??'')});setShowCatModal(true);}} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-brand-400 hover:bg-brand-500/10 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                      <button onClick={()=>setDeleteCat(c)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                    </div></td>
                  </tr>);
                })}</tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Product Modal */}
      <Modal open={showModal} onClose={()=>{ setShowModal(false); setImageFile(null); if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview); setImagePreview(null); }} title={editProduct?'Editar producto':'Nuevo producto'} size="xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><label className="label">Nombre *</label><input className="input" value={String(form.name??'')} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
          <div className="sm:col-span-2"><label className="label">Descripción</label><input className="input" value={String(form.description??'')} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
          {/* Image upload with drag & drop */}
          <div className="sm:col-span-2">
            <label className="label">Imagen del producto</label>
            <div
              ref={dropRef}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
              onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
              onDragLeave={e => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
              onDrop={e => {
                e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) {
                    toast.error('Tipo de archivo no permitido. Usa: JPEG, PNG, WebP o GIF');
                    return;
                  }
                  if (file.size > 10 * 1024 * 1024) {
                    toast.error('La imagen no puede superar los 10MB');
                    return;
                  }
                  setImageFile(file);
                  setImagePreview(URL.createObjectURL(file));
                }
              }}
              className={`relative flex items-start gap-4 p-4 rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer ${
                isDragOver
                  ? 'border-brand-500 bg-brand-500/10 shadow-lg shadow-brand-500/10'
                  : 'border-[var(--border-secondary)] bg-[var(--bg-primary)]/50 hover:border-[#6e7681] hover:bg-[var(--bg-primary)]/80'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 10 * 1024 * 1024) {
                      toast.error('La imagen no puede superar los 10MB');
                      return;
                    }
                    setImageFile(file);
                    setImagePreview(URL.createObjectURL(file));
                  }
                }}
              />

              {/* Preview */}
              <div className="w-24 h-24 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-secondary)] overflow-hidden flex items-center justify-center flex-shrink-0 transition-all duration-200">
                {imagePreview ? (
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="w-8 h-8 text-[#30363d]" />
                )}
              </div>

              {/* Info & actions */}
              <div className="flex-1 space-y-2 min-w-0">
                {imagePreview ? (
                  <>
                    <p className="text-sm text-[var(--text-primary)] font-medium">Imagen seleccionada</p>
                    <div className="flex gap-2">
                      <button
                        onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-muted)] hover:bg-[#2d333b] text-xs text-[var(--text-primary)] rounded-lg border border-[var(--border-secondary)] transition-all hover:border-[#6e7681]"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Cambiar
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); setImageFile(null); setImagePreview(null); setForm(f => ({ ...f, image_url: null })); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <XIcon className="w-3.5 h-3.5" />
                        Eliminar
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                      <Upload className="w-4 h-4 text-[var(--text-tertiary)]" />
                      <span>Arrastra una imagen aquí o <span className="text-brand-400 font-medium underline underline-offset-2">selecciona un archivo</span></span>
                    </div>
                    <p className="text-[10px] text-[var(--text-tertiary)]">JPEG, PNG, WebP o GIF. Máximo 10MB.</p>
                  </>
                )}
              </div>

              {/* Drag-over overlay indicator */}
              {isDragOver && (
                <div className="absolute inset-0 rounded-xl bg-brand-600/5 border-2 border-brand-500 flex items-center justify-center pointer-events-none">
                  <div className="flex flex-col items-center gap-2 text-brand-400">
                    <Upload className="w-8 h-8" />
                    <span className="text-sm font-semibold">Suelta la imagen aquí</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div><label className="label">Categoría</label>
            <select className="input" value={String(form.category_id??'')} onChange={e=>setForm(f=>({...f,category_id:e.target.value||null}))}>
              <option value="">Sin categoría</option>
              {categories.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.name)}</option>)}
            </select>
          </div>
          <div><label className="label">Unidad</label><input className="input" value={String(form.unit??'unidad')} onChange={e=>setForm(f=>({...f,unit:e.target.value}))}/></div>
          <div><label className="label">Precio de venta</label><input type="number" min="0" step="1" className="input" value={Number(form.sale_price??0)} onChange={e=>setForm(f=>({...f,sale_price:parseFloat(e.target.value)||0}))}/></div>
          <div><label className="label">Costo</label><input type="number" min="0" step="1" className="input" value={Number(form.cost??0)} onChange={e=>setForm(f=>({...f,cost:parseFloat(e.target.value)||0}))}/></div>
          <div>
            <label className="label">Stock {editProduct?'actual':'inicial'}</label>
            <input type="number" min="0" step="1" className="input" value={Number(form.stock??0)} onChange={e=>setForm(f=>({...f,stock:parseFloat(e.target.value)||0}))}/>
            {!editProduct && Number(form.stock??0) > 0 && (
              <div className="mt-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] p-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={form.is_capital === true}
                      onChange={e => setForm(f => ({ ...f, is_capital: e.target.checked }))}
                    />
                    <div className="w-10 h-6 bg-[var(--bg-muted)] rounded-full peer-checked:bg-brand-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
                  </div>
                  <div>
                    <p className="text-sm text-[var(--text-primary)] font-medium">¿Es aporte de capital nuevo?</p>
                    <p className="text-xs text-[var(--text-tertiary)]">
                      {form.is_capital
                        ? 'Se registrará como ingreso de nuevo capital del dueño (incrementa el saldo disponible)'
                        : 'Se registrará como reinversión de ganancias (egreso de caja por compra de inventario)'}
                    </p>
                  </div>
                </label>
              </div>
            )}
          </div>
          {!editProduct && (
            <div><label className="label">Almacén destino</label>
              <select className="input" value={String(form.location_id??'')} onChange={e=>setForm(f=>({...f,location_id:e.target.value}))}>
                {locations.length === 0 && <option value="">Cargando...</option>}
                {locations.map(l=><option key={String(l.id)} value={String(l.id)}>{String(l.name)}</option>)}
              </select>
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1">El stock inicial se registrará en este almacén</p>
            </div>
          )}
          <div><label className="label">Stock mínimo</label><input type="number" min="0" step="1" className="input" value={Number(form.min_stock??0)} onChange={e=>setForm(f=>({...f,min_stock:parseFloat(e.target.value)||0}))}/></div>
          <div className="sm:col-span-2">
            <label className="label">Proveedores</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-36 overflow-y-auto p-2 bg-[var(--bg-primary)] rounded-lg border border-[var(--border-secondary)]">
              {suppliers.length===0?<p className="text-xs text-[var(--text-tertiary)] col-span-3 py-2">No hay proveedores</p>:suppliers.map(s=>{
                const sids = (form.supplier_ids as string[]|undefined)??[];
                const checked = sids.includes(String(s.id));
                return(<label key={String(s.id)} className={cn('flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm transition-colors',checked?'bg-brand-600/20 text-brand-400':'hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]')}>
                  <input type="checkbox" className="accent-brand-600" checked={checked} onChange={e=>setForm(f=>({...f,supplier_ids:e.target.checked?[...sids,String(s.id)]:sids.filter(id=>id!==String(s.id))}))}/>
                  {String(s.name)}
                </label>);
              })}
            </div>
          </div>
        </div>
        {Number(form.sale_price??0)>0&&Number(form.cost??0)>0&&(
          <div className="mt-4 bg-[var(--bg-primary)] rounded-lg px-4 py-2.5 text-sm flex gap-4">
            <span className="text-[var(--text-secondary)]">Margen: <span className="text-green-400 font-semibold">{calcMargin(Number(form.sale_price),Number(form.cost)).toFixed(1)}%</span></span>
            <span className="text-[var(--text-secondary)]">Ganancia: <span className="text-green-400 font-semibold">{formatCurrency(Number(form.sale_price)-Number(form.cost))}</span></span>
          </div>
        )}
        <div className="flex flex-col xs:flex-row gap-2 justify-end mt-5">
          <button onClick={()=>{ setShowModal(false); setImageFile(null); if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview); setImagePreview(null); }} className="btn-secondary flex-1 xs:flex-none">Cancelar</button>
          <button onClick={handleSave} disabled={saving||!String(form.name??'').trim()} className="btn-primary flex-1 xs:flex-none disabled:opacity-50">{saving?'Guardando...':editProduct?'Actualizar':'Crear'}</button>
        </div>
      </Modal>

      {/* History Modal */}
      <Modal open={showHistoryModal} onClose={()=>setShowHistoryModal(false)} title={`Historial — ${String(historyProduct?.name??'')}`} size="xl">
        <div className="flex justify-end mb-4 gap-2">
          <button onClick={() => openPurchase(String(historyProduct?.id))} className="btn-secondary flex items-center gap-2"><ShoppingBag className="w-4 h-4"/>Registrar compra</button>
          <button onClick={openMove} className="btn-primary flex items-center gap-2"><ArrowRightLeft className="w-4 h-4"/>Registrar movimiento</button>
        </div>
        {movements.length===0?<p className="text-center text-[var(--text-tertiary)] py-8 text-sm">Sin movimientos</p>:(
          <div className="overflow-x-auto rounded-xl border border-[var(--border-primary)]">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border-primary)] bg-[var(--bg-primary)]">{['Fecha','Tipo','Cantidad','Razón','Usuario'].map(h=><th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>{movements.map(m=>(
                <tr key={String(m.id)} className="border-b border-[var(--border-primary)] last:border-0 hover:bg-[var(--bg-tertiary)]">
                  <td className="px-4 py-2.5 text-[var(--text-secondary)] text-xs">{m.date?formatDateTime(String(m.date)):'—'}</td>
                  <td className="px-4 py-2.5"><span className={cn('font-medium text-xs',movTypeColor[String(m.type)]??'text-[var(--text-primary)]')}>{movTypeLabel[String(m.type)]??String(m.type)}</span></td>
                  <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium">{formatNumber(Number(m.quantity),2)}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">{String(m.reason??'—')}</td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)] text-xs">{String(m.user_name??'—')}</td>
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
                const locStock = purchaseForm.location_id ? (purchaseLocStockMap[String(p.id)]??0) : Number(p.stock??0);
                const lowS = Number(p.stock) <= Number(p.min_stock);
                return (
                  <option key={String(p.id)} value={String(p.id)}>
                    {String(p.name)} — Stock en almacén: {formatNumber(locStock, 1)} {String(p.unit)} · Costo actual: {formatCurrency(Number(p.cost))}
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

          {/* Tipo de inversión */}
          <div className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] p-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={purchaseForm.is_capital}
                  onChange={e => setPurchaseForm(f => ({ ...f, is_capital: e.target.checked }))}
                />
                <div className="w-10 h-6 bg-[var(--bg-muted)] rounded-full peer-checked:bg-brand-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
              </div>
              <div>
                <p className="text-sm text-[var(--text-primary)] font-medium">¿Es aporte de capital nuevo?</p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {purchaseForm.is_capital
                    ? 'Se registrará como ingreso de nuevo capital del dueño (incrementa el saldo disponible)'
                    : 'Se registrará como reinversión de ganancias (egreso de caja por compra de inventario)'}
                </p>
              </div>
            </label>
          </div>

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
              <div className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] p-3 text-sm space-y-1.5">
                <p className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">Resumen de la compra</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <p className="text-[var(--text-tertiary)]">Stock actual (global):</p><p className="text-[var(--text-primary)] text-right">{formatNumber(currentStock, 1)}</p>
                  {purchaseForm.location_id && <p className="text-[var(--text-tertiary)]">Stock en este almacén:</p>}
                  {purchaseForm.location_id && <p className="text-brand-400 text-right font-medium">{formatNumber(purchaseLocStockMap[String(prod.id)]??0, 1)}</p>}
                  <p className="text-[var(--text-tertiary)]">Stock después:</p><p className="text-green-400 text-right font-medium">{formatNumber(newStock, 1)}</p>
                  <p className="text-[var(--text-tertiary)]">Costo actual:</p><p className="text-[var(--text-primary)] text-right">{formatCurrency(currentCost)}</p>
                  <p className="text-[var(--text-tertiary)]">Nuevo costo promedio:</p><p className="text-brand-400 text-right font-semibold">{formatCurrency(Math.round(newCost * 100) / 100)}</p>
                  <p className="text-[var(--text-tertiary)]">Total compra:</p><p className="text-[var(--text-primary)] text-right font-medium">{formatCurrency(totalCost)}</p>
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
          {historyProduct && (
            <div className="p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] text-sm">
              <p className="font-medium text-[var(--text-primary)]">{String(historyProduct.name)}</p>
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5">Stock global: <strong className="text-[var(--text-primary)]">{formatNumber(Number(historyProduct.stock??0),2)}</strong></p>
            </div>
          )}
          <div><label className="label">Tipo</label>
            <select className="input" value={moveForm.type} onChange={e=>setMoveForm(f=>({...f,type:e.target.value}))}>
              <option value="in">Entrada</option><option value="out">Salida</option><option value="adjust">Ajuste (stock exacto)</option>
            </select>
          </div>
          <div><label className="label">Cantidad</label><input type="number" min="1" step="1" className="input" value={moveForm.quantity||''} onChange={e=>setMoveForm(f=>({...f,quantity:parseFloat(e.target.value)||0}))}/></div>
          <div><label className="label">Almacén destino</label>
            <select className="input" value={moveForm.location_id} onChange={e=>setMoveForm(f=>({...f,location_id:e.target.value}))}>
              {locations.map(l=>{
                const locName = String(l.name);
                return <option key={String(l.id)} value={String(l.id)}>{locName}</option>;
              })}
            </select>
            {moveForm.location_id && moveLocStock !== null && (
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                Stock en este almacén: <strong className={cn(moveLocStock <= 0 ? 'text-red-400' : 'text-[var(--text-primary)]')}>{formatNumber(moveLocStock, 2)}</strong>
              </p>
            )}
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
