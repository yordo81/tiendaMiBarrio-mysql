'use client';
import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { formatDateTime, formatNumber, cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import SearchableSelect from '@/components/ui/SearchableSelect';
import { toast } from '@/components/ui/toaster';
import Pagination from '@/components/ui/Pagination';
import { Warehouse, Plus, Edit2, Trash2, ArrowRightLeft, PackagePlus, List, BarChart3, RefreshCw, Package, DollarSign, Layers, Search, Banknote, Power, Store, ChevronDown } from 'lucide-react';
import { useAuthStore } from '@/lib/stores/auth-store';
type R = Record<string,unknown>;

const movLabel:Record<string,string> = { entrada:'Entrada', salida:'Salida', traslado_out:'Traslado (salida)', traslado_in:'Traslado (entrada)', venta:'Venta', ajuste:'Ajuste', gasto:'Gasto' };
const movColor:Record<string,string> = { entrada:'text-green-400', salida:'text-red-400', traslado_out:'text-orange-400', traslado_in:'text-blue-400', venta:'text-purple-400', ajuste:'text-yellow-400', gasto:'text-orange-400' };
const typeLabel:Record<string,string> = { warehouse:'Almacén', store:'Punto de venta' };
const typeColor:Record<string,string> = { warehouse:'badge-info', store:'badge-success' };

export default function AlmacenesPage() {
  const [tab, setTab] = useState<'almacenes'|'transferencias'|'cajas'>('almacenes');
  const [locations, setLocations] = useState<R[]>([]);
  const [posList, setPosList] = useState<R[]>([]);
  const [openShifts, setOpenShifts] = useState<R[]>([]);
  const [showPosModal, setShowPosModal] = useState(false);
  const [editPos, setEditPos] = useState<R|null>(null);
  const [posForm, setPosForm] = useState({name:'',location_id:'',active:true});
  const [posDelTarget, setPosDelTarget] = useState<R|null>(null);
  const { user } = useAuthStore();
  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const [products, setProducts] = useState<R[]>([]);
  const [transfers, setTransfers] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [stockSummary, setStockSummary] = useState<R[]>([]);
  const [selLoc, setSelLoc] = useState<R|null>(null);
  const [locStock, setLocStock] = useState<R[]>([]);
  const [locMoves, setLocMoves] = useState<R[]>([]);
  const [showDetail, setShowDetail] = useState(false);
  const [detailTab, setDetailTab] = useState<'stock'|'movimientos'>('stock');
  const [showLocModal, setShowLocModal] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showMov, setShowMov] = useState(false);
  const [editLoc, setEditLoc] = useState<R|null>(null);
  const [delTarget, setDelTarget] = useState<R|null>(null);
  const [saving, setSaving] = useState(false);
  const [locForm, setLocForm] = useState({name:'',type:'warehouse',address:'',notes:''});
  const [trForm, setTrForm] = useState({from_location_id:'',to_location_id:'',notes:''});
  const [trItems, setTrItems] = useState<{product_id:string;quantity:number}[]>([{product_id:'',quantity:0}]);
  const [trStockMap, setTrStockMap] = useState<Record<string, number>>({});
  // Selección múltiple en la pestaña Stock del detalle de una ubicación
  const [selectedStock, setSelectedStock] = useState<Set<string>>(new Set());
  // Productos precargados al abrir el modal de traslado desde el detalle
  const presetTrItemsRef = useRef<{product_id:string;quantity:number}[] | null>(null);
  const [movForm, setMovForm] = useState({location_id:'',product_id:'',type:'entrada',quantity:0,notes:''});
  const [locStockMap, setLocStockMap] = useState<Record<string, number>>({});
  // Pagination for transfers
  const [transferPage, setTransferPage] = useState(1);
  const [transferPageSize, setTransferPageSize] = useState(10);
  // Lote expandido en el historial de traslados (ver sus productos)
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);
  // Agrupa los traslados del mismo lote para mostrarlos como un solo movimiento.
  // batch_id identifica el lote de forma definitiva; las filas legacy (sin
  // batch_id) se agrupan por origen/destino/usuario/fecha.
  const transferGroups = (() => {
    const map = new Map<string, { key: string; created_at: string; from_location_name: string; to_location_name: string; user_name: string; items: R[] }>();
    for (const t of transfers) {
      const key = String(t.batch_id ?? '') || `${String(t.from_location_id ?? '')}|${String(t.to_location_id ?? '')}|${String(t.user_id ?? '')}|${String(t.created_at ?? '')}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          created_at: String(t.created_at ?? ''),
          from_location_name: String(t.from_location_name ?? '—'),
          to_location_name: String(t.to_location_name ?? '—'),
          user_name: String(t.user_name ?? '—'),
          items: [],
        };
        map.set(key, g);
      }
      g.items.push(t);
    }
    return Array.from(map.values());
  })();
  const paginatedGroups = transferPageSize === 0
    ? transferGroups
    : transferGroups.slice((transferPage - 1) * transferPageSize, transferPage * transferPageSize);
  // Search & pagination for stock & movements inside detail modal
  const [stockSearch, setStockSearch] = useState('');
  const [stockPage, setStockPage] = useState(1);
  const [stockPageSize, setStockPageSize] = useState(10);
  const [movPage, setMovPage] = useState(1);
  const [movPageSize, setMovPageSize] = useState(10);
  const activeStock = locStock.filter(s => Number(s.quantity) > 0);
  const filteredStock = stockSearch.trim()
    ? activeStock.filter(s => String(s.product_name ?? '').toLowerCase().includes(stockSearch.toLowerCase()))
    : activeStock;
  const paginatedStock = stockPageSize === 0
    ? filteredStock
    : filteredStock.slice((stockPage - 1) * stockPageSize, stockPage * stockPageSize);
  const paginatedMoves = movPageSize === 0
    ? locMoves
    : locMoves.slice((movPage - 1) * movPageSize, movPage * movPageSize);
  // Puntos de venta (almacenes tipo store) disponibles para asociar cajas
  const storeLocations = locations.filter(l => String(l.type) === 'store');
  const openPosIds = new Set(openShifts.map(s => String(s.pos_id)));

  const load = useCallback(async () => {
    setLoading(true);
    const [locs, prods, trans, summary, pos, shifts] = await Promise.all([
      api.getLocations(), api.getProducts(), api.getTransfers(), api.getLocationStockSummary(), api.getPos(), api.getShifts(),
    ]);
    setLocations(locs); setProducts(prods); setTransfers(trans); setStockSummary(summary);
    setPosList(pos); setOpenShifts((shifts.open ?? []) as R[]);
    setExpandedBatch(null);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Deep-link: /dashboard/almacenes?tab=cajas (enlaces desde otros módulos)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'cajas') setTab('cajas');
  }, []);

  // Fetch location-specific stock whenever location changes in the movement form
  useEffect(() => {
    if (movForm.location_id) {
      api.getLocationStock(movForm.location_id).then(stock => {
        const map: Record<string, number> = {};
        stock.forEach((s: Record<string,unknown>) => { map[String(s.product_id)] = Number(s.quantity); });
        setLocStockMap(map);
      }).catch(() => setLocStockMap({}));
    } else {
      setLocStockMap({});
    }
  }, [movForm.location_id]);

  // Stock disponible en el origen para el traslado (para mostrar y validar).
  // Se re-ejecuta también al abrir el modal para no mostrar datos obsoletos.
  useEffect(() => {
    if (trForm.from_location_id) {
      api.getLocationStock(trForm.from_location_id).then(stock => {
        const map: Record<string, number> = {};
        stock.forEach((s: Record<string,unknown>) => { map[String(s.product_id)] = Number(s.quantity); });
        setTrStockMap(map);
      }).catch(() => setTrStockMap({}));
    } else {
      setTrStockMap({});
    }
  }, [trForm.from_location_id, showTransfer]);

  // Al abrir el modal de traslado, usar los productos precargados (si vienen
  // de la selección en el detalle) o comenzar con una lista limpia.
  useEffect(() => {
    if (showTransfer) {
      setTrItems(presetTrItemsRef.current ?? [{ product_id: '', quantity: 0 }]);
      presetTrItemsRef.current = null;
    }
  }, [showTransfer]);

  async function loadDetail(locId: string) {
    const [st, mv] = await Promise.all([api.getLocationStock(locId), api.getLocationMovements(locId)]);
    setLocStock(st); setLocMoves(mv);
  }

  async function openDetail(loc: R) { setSelLoc(loc); setDetailTab('stock'); setStockSearch(''); setStockPage(1); setSelectedStock(new Set()); setShowDetail(true); loadDetail(String(loc.id)); }

  async function handleSaveLoc() {
    if (!locForm.name.trim()) return;
    setSaving(true);
    try {
      const payload = { name:locForm.name, type:locForm.type, address:locForm.address||null, notes:locForm.notes||null };
      if (editLoc) await api.updateLocation({ id:editLoc.id, ...payload });
      else await api.createLocation(payload);
      toast.success(editLoc?'Actualizado':'Creado'); setShowLocModal(false); load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); }
  }

  async function handleDelLoc() {
    if (!delTarget) return; setSaving(true);
    await api.deleteLocation(String(delTarget.id));
    toast.success('Eliminado'); setSaving(false); setDelTarget(null); load();
  }

  async function handleSavePos() {
    if (!posForm.location_id) { toast.error('Selecciona el punto de venta (tienda) de la caja'); return; }
    if (!posForm.name.trim()) { toast.error('Escribe el nombre de la caja'); return; }
    setSaving(true);
    try {
      const payload = { name: posForm.name.trim(), location_id: posForm.location_id, active: posForm.active };
      if (editPos) await api.updatePos({ id: editPos.id, ...payload });
      else await api.createPos(payload);
      toast.success(editPos ? 'Caja actualizada' : 'Caja creada'); setShowPosModal(false); load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); }
  }

  async function handleDelPos() {
    if (!posDelTarget) return; setSaving(true);
    try {
      await api.deletePos(String(posDelTarget.id));
      toast.success('Caja desactivada'); setPosDelTarget(null); load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); }
  }

  async function handleReactivatePos(p: R) {
    try {
      await api.updatePos({ id: String(p.id), name: String(p.name), location_id: String(p.location_id??''), active: true });
      toast.success('Caja activada'); load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); }
  }

  async function handleMovement() {
    const { location_id, product_id, type, quantity, notes } = movForm;
    if (!location_id||!product_id||quantity<=0) { toast.error('Completa todos los campos'); return; }
    setSaving(true);
    try {
      await api.createLocationMovement({ location_id, product_id, type, quantity, notes: notes||null });
      toast.success('Movimiento registrado'); setShowMov(false);
      setMovForm({location_id:'',product_id:'',type:'entrada',quantity:0,notes:''}); load();
      if (selLoc && String(selLoc.id)===location_id) loadDetail(location_id);
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); }
  }

  function updateTrItem(idx: number, patch: Partial<{product_id:string;quantity:number}>) {
    setTrItems(list => list.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }
  function addTrItem() { setTrItems(list => [...list, { product_id: '', quantity: 0 }]); }
  function removeTrItem(idx: number) { setTrItems(list => list.length > 1 ? list.filter((_, i) => i !== idx) : list); }

  function toggleStockSel(pid: string) {
    setSelectedStock(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      return next;
    });
  }
  function toggleAllStockSel() {
    setSelectedStock(prev => {
      const next = new Set(prev);
      const allSelected = filteredStock.length > 0 && filteredStock.every(s => next.has(String(s.product_id)));
      if (allSelected) filteredStock.forEach(s => next.delete(String(s.product_id)));
      else filteredStock.forEach(s => next.add(String(s.product_id)));
      return next;
    });
  }
  function handleTransferSelected() {
    const locId = String(selLoc?.id ?? '');
    const items = locStock
      .filter(s => selectedStock.has(String(s.product_id)))
      .map(s => ({ product_id: String(s.product_id), quantity: 1 }));
    if (items.length === 0) { toast.error('Selecciona al menos un producto'); return; }
    presetTrItemsRef.current = items;
    setTrForm(f => ({ ...f, from_location_id: locId }));
    setShowTransfer(true);
  }

  async function handleTransfer() {
    const { from_location_id, to_location_id, notes } = trForm;
    if (!from_location_id || !to_location_id) { toast.error('Selecciona origen y destino'); return; }
    if (from_location_id===to_location_id) { toast.error('Origen y destino no pueden ser iguales'); return; }
    const items = trItems
      .map(i => ({ product_id: i.product_id, quantity: Number(i.quantity) || 0 }))
      .filter(i => i.product_id && i.quantity > 0);
    if (items.length === 0) { toast.error('Agrega al menos un producto con cantidad'); return; }
    for (const it of items) {
      // Solo valida contra el stock cuando ya se cargaron los datos del origen;
      // si el fetch falló o aún no resuelve, la API valida contra el stock real.
      const available = trStockMap[it.product_id];
      if (available !== undefined && it.quantity > available) {
        toast.error('Stock insuficiente en el origen para uno de los productos');
        return;
      }
    }
    setSaving(true);
    try {
      await api.createTransfer({ from_location_id, to_location_id, items, notes: notes || null });
      toast.success(items.length > 1 ? `Traslado registrado (${items.length} productos)` : 'Traslado registrado');
      setShowTransfer(false);
      setTrForm({from_location_id:'',to_location_id:'',notes:''});
      setTrItems([{ product_id: '', quantity: 0 }]);
      setSelectedStock(new Set());
      load();
      if (selLoc && String(selLoc.id) === from_location_id) loadDetail(from_location_id);
    } catch(e) { toast.error(e instanceof Error?e.message:'Error al trasladar. Verifica el stock disponible.'); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border-primary)] pb-0">
        {([['almacenes','Almacenes / Puntos de venta',Warehouse],['transferencias','Traslados',ArrowRightLeft],['cajas','Cajas',Banknote]] as const).map(([key,label,Icon])=>(
          <button key={key} onClick={()=>setTab(key as 'almacenes'|'transferencias'|'cajas')} className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',tab===key?'border-brand-500 text-brand-400':'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]')}>
            <Icon className="w-4 h-4"/>{label}
          </button>
        ))}
      </div>

      {tab==='almacenes'&&(
        
        <>
              <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-[var(--text-secondary)]">{locations.length} ubicación(es)</p>
            <div className="flex gap-2 flex-wrap">
              <button onClick={()=>setShowMov(true)} className="btn-secondary flex items-center gap-2 text-sm"><PackagePlus className="w-4 h-4"/>Entrada / Salida / Ajuste</button>
              <button onClick={()=>setShowTransfer(true)} className="btn-secondary flex items-center gap-2 text-sm"><ArrowRightLeft className="w-4 h-4"/>Trasladar stock</button>
              <button onClick={()=>{setEditLoc(null);setLocForm({name:'',type:'warehouse',address:'',notes:''});setShowLocModal(true);}} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4"/>Nuevo almacén</button>
            </div>
          </div>

          {/* Summary cards */}
          {!loading && stockSummary.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {stockSummary.map(s => {
                const qty = Number(s.total_quantity);
                const val = Number(s.total_value);
                const count = Number(s.product_count);
                return (
                  <div key={String(s.location_id)} className="card p-4 flex flex-col gap-2 border-l-4 border-l-brand-500">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{String(s.location_name)}</p>
                      <span className={s.location_type === 'store' ? 'badge-success' : 'badge-info'}>
                        {s.location_type === 'warehouse' ? 'Almacén' : 'Punto de venta'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mt-1">
                      <div className="flex flex-col items-center p-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)]">
                        <Layers className="w-4 h-4 text-blue-400 mb-1" />
                        <p className="text-lg font-bold text-[var(--text-primary)]">{count}</p>
                        <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">Productos</p>
                      </div>
                      <div className="flex flex-col items-center p-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)]">
                        <Package className="w-4 h-4 text-green-400 mb-1" />
                        <p className="text-lg font-bold text-[var(--text-primary)]">{qty.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">Cantidad</p>
                      </div>
                      <div className="flex flex-col items-center p-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)]">
                        <DollarSign className="w-4 h-4 text-yellow-400 mb-1" />
                        <p className="text-lg font-bold text-[var(--text-primary)]">{'$' + val.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        <p className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">Valor</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {loading?<div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
          :locations.length===0?<EmptyState icon={Warehouse} title="Sin almacenes" description="Crea tu primer almacén o punto de venta" action={<button onClick={()=>setShowLocModal(true)} className="btn-primary">Crear almacén</button>}/>:(
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {locations.map(loc=>(
                <div key={String(loc.id)} className="card p-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="font-semibold text-[var(--text-primary)] truncate">{String(loc.name)}</p>{loc.address?<p className="text-xs text-[var(--text-tertiary)] mt-0.5">{String(loc.address)}</p>:null}</div>
                    <span className={typeColor[String(loc.type)]??'badge-info'}>{typeLabel[String(loc.type)]??String(loc.type)}</span>
                  </div>
                  {loc.notes?<p className="text-xs text-[var(--text-secondary)]">{String(loc.notes)}</p>:null}
                  <div className="flex items-center gap-2 pt-1 border-t border-[var(--border-primary)]">
                    <button onClick={()=>openDetail(loc)} className="btn-secondary text-xs flex items-center gap-1.5 flex-1 justify-center"><BarChart3 className="w-3.5 h-3.5"/>Ver stock</button>
                    <button onClick={()=>{setEditLoc(loc);setLocForm({name:String(loc.name),type:String(loc.type),address:String(loc.address??''),notes:String(loc.notes??'')});setShowLocModal(true);}} className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-brand-400 hover:bg-brand-500/10 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                    <button onClick={()=>setDelTarget(loc)} className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab==='cajas'&&(
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-[var(--text-secondary)]">{posList.length} caja(s) asociadas a puntos de venta</p>
            {canManage&&(
              <button onClick={()=>{setEditPos(null);setPosForm({name:'',location_id:'',active:true});setShowPosModal(true);}} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4"/>Nueva caja</button>
            )}
          </div>

          {storeLocations.length===0&&(
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-4 flex items-start gap-3">
              <Store className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-yellow-300 font-medium">No hay puntos de venta creados</p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">Cada caja se asocia a un almacén tipo <b>Punto de venta</b>. Crea uno primero para poder registrar cajas.</p>
                {canManage&&(
                  <button onClick={()=>{setEditLoc(null);setLocForm({name:'',type:'store',address:'',notes:''});setShowLocModal(true);}} className="btn-secondary text-xs mt-3 flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/>Crear punto de venta</button>
                )}
              </div>
            </div>
          )}

          {loading?<div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
          :posList.length===0?<EmptyState icon={Banknote} title="Sin cajas" description="Crea tu primera caja asociada a un punto de venta" action={canManage?<button onClick={()=>{setEditPos(null);setPosForm({name:'',location_id:'',active:true});setShowPosModal(true);}} className="btn-primary">Nueva caja</button>:undefined}/>:(
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {posList.map(p=>{
                const posActive = Number(p.active)===1;
                const hasOpen = openPosIds.has(String(p.id));
                return (
                  <div key={String(p.id)} className={cn('card p-5 flex flex-col gap-3',!posActive&&'opacity-60')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-[var(--text-primary)] truncate">{String(p.name)}</p>
                        <p className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate flex items-center gap-1">
                          <Store className="w-3 h-3 shrink-0" />{String(p.location_name??'—')}
                        </p>
                      </div>
                      <span className={posActive?'badge-success':'badge-danger'}>{posActive?'Activa':'Inactiva'}</span>
                    </div>
                    {hasOpen&&(
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-green-500/10 text-green-400 border border-green-500/20 w-fit">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />Turno abierto
                      </span>
                    )}
                    <div className="flex items-center gap-2 pt-1 border-t border-[var(--border-primary)]">
                      {canManage?(
                        <>
                          <button onClick={()=>{setEditPos(p);setPosForm({name:String(p.name),location_id:String(p.location_id??''),active:posActive});setShowPosModal(true);}} className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-brand-400 hover:bg-brand-500/10 transition-colors" title="Editar caja"><Edit2 className="w-3.5 h-3.5"/></button>
                          {posActive?(
                            <button onClick={()=>setPosDelTarget(p)} className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Desactivar caja"><Power className="w-3.5 h-3.5"/></button>
                          ):(
                            <button onClick={()=>handleReactivatePos(p)} className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-green-400 hover:bg-green-500/10 transition-colors" title="Activar caja"><Power className="w-3.5 h-3.5"/></button>
                          )}
                        </>
                      ):(
                        <span className="text-[10px] text-[var(--text-tertiary)]">Solo el dueño o administrador pueden gestionar cajas</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab==='transferencias'&&(
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--text-secondary)]">Historial de traslados</p>
            <button onClick={()=>setShowTransfer(true)} className="btn-primary flex items-center gap-2"><ArrowRightLeft className="w-4 h-4"/>Nuevo traslado</button>
          </div>
          <div className="card overflow-hidden">
            {loading?<div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
            :transfers.length===0?<EmptyState icon={ArrowRightLeft} title="Sin traslados" description="Registra el primer traslado" action={<button onClick={()=>setShowTransfer(true)} className="btn-primary">Nuevo traslado</button>}/>:(<>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[var(--border-primary)]">{['Fecha','Origen','Destino','Productos','Cant. total','Usuario'].map(h=><th key={h} className="text-left px-4 py-3 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">{h}</th>)}</tr></thead>
                  <tbody>{paginatedGroups.map(g=>{
                    const isOpen = expandedBatch === g.key;
                    const totalQty = g.items.reduce((s, it) => s + Number(it.quantity ?? 0), 0);
                    return (
                      <Fragment key={g.key}>
                        <tr onClick={()=>setExpandedBatch(isOpen ? null : g.key)} title="Ver productos del traslado" className={cn('border-b border-[var(--border-primary)] table-row-hover cursor-pointer', isOpen && 'bg-[#1c2128]')}>
                          <td className="px-4 py-3 text-[var(--text-secondary)] text-xs whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              <ChevronDown className={cn('w-3.5 h-3.5 text-[var(--text-tertiary)] transition-transform duration-200', isOpen && 'rotate-180')}/>
                              {g.created_at ? formatDateTime(g.created_at) : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[var(--text-primary)]">{g.from_location_name}</td>
                          <td className="px-4 py-3 text-[var(--text-primary)]">{g.to_location_name}</td>
                          <td className="px-4 py-3 text-[var(--text-primary)]">{g.items.length === 1 ? '1 producto' : `${g.items.length} productos`}</td>
                          <td className="px-4 py-3 text-brand-400 font-medium">{formatNumber(totalQty, 2)}</td>
                          <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{g.user_name}</td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-[var(--border-primary)] last:border-0">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="rounded-lg border border-[var(--border-secondary)] overflow-hidden">
                                <table className="w-full text-sm">
                                  <thead><tr className="border-b border-[var(--border-secondary)] bg-[var(--bg-primary)]">{['Producto','Cantidad'].map(h=><th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide">{h}</th>)}</tr></thead>
                                  <tbody>{g.items.map(it=>(
                                    <tr key={String(it.id)} className="border-b border-[var(--border-secondary)] last:border-0">
                                      <td className="px-3 py-2 text-[var(--text-primary)]">{String(it.product_name??'—')}</td>
                                      <td className="px-3 py-2 text-brand-400 font-medium">{formatNumber(Number(it.quantity), 2)} {String(it.unit??'')}</td>
                                    </tr>
                                  ))}</tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}</tbody>
                </table>
              </div>
              <Pagination currentPage={transferPage} totalItems={transferGroups.length} pageSize={transferPageSize} onPageChange={setTransferPage} onPageSizeChange={setTransferPageSize} /></>
            )}
          </div>
        </>
      )}

      {/* Detail Modal */}
      <Modal open={showDetail} onClose={()=>setShowDetail(false)} title={`${String(selLoc?.name??'')} — ${typeLabel[String(selLoc?.type??'warehouse')]}`} size="xl">
        <div className="space-y-4">
          <div className="flex gap-1 border-b border-[var(--border-primary)]">
            {([['stock','Stock actual',BarChart3],['movimientos','Movimientos',List]] as const).map(([key,label,Icon])=>(
              <button key={key} onClick={()=>setDetailTab(key as 'stock'|'movimientos')} className={cn('flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition-colors',detailTab===key?'border-brand-500 text-brand-400':'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]')}>
                <Icon className="w-3.5 h-3.5"/>{label}
              </button>
            ))}
            <div className="flex-1"/>
            <button onClick={()=>selLoc&&loadDetail(String(selLoc.id))} className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors mb-px" title="Actualizar"><RefreshCw className="w-3.5 h-3.5"/></button>
          </div>

          {detailTab==='stock'&&(
            <>
              {/* Search input for stock */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
                <input
                  className="input pl-9"
                  placeholder="Buscar producto por nombre..."
                  value={stockSearch}
                  onChange={e => { setStockSearch(e.target.value); setStockPage(1); }}
                />
                {activeStock.length > 0 && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-tertiary)]">
                    {filteredStock.length} / {activeStock.length}
                  </span>
                )}
              </div>

              {/* Selección múltiple para trasladar varios productos a la vez */}
              {selectedStock.size > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-brand-500/20 bg-brand-500/10 px-3 py-2">
                  <p className="text-xs text-brand-300 font-medium">{selectedStock.size} producto(s) seleccionado(s)</p>
                  <div className="flex items-center gap-2">
                    <button onClick={()=>setSelectedStock(new Set())} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">Limpiar</button>
                    <button onClick={handleTransferSelected} className="btn-primary text-xs flex items-center gap-1.5"><ArrowRightLeft className="w-3.5 h-3.5"/>Trasladar</button>
                  </div>
                </div>
              )}

              {filteredStock.length===0?(
                <div className="flex flex-col items-center justify-center py-10 text-[var(--text-tertiary)]">
                  <PackagePlus size={32} className="mb-3 opacity-40"/>
                  <p className="text-sm text-center">
                    {stockSearch
                      ? 'No hay productos que coincidan con la búsqueda.'
                      : 'Sin stock en este almacén.'}
                  </p>
                  {!stockSearch && (
                    <p className="text-xs text-center mt-1">Usa <strong className="text-[var(--text-primary)]">Entrada</strong> para cargar productos aquí.</p>
                  )}
                </div>
              ):(<>
                <div className="overflow-x-auto rounded-xl border border-[var(--border-primary)]">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-[var(--border-primary)] bg-[var(--bg-primary)]">
                      <th className="w-10 px-2 py-2.5"><input type="checkbox" checked={filteredStock.length>0&&filteredStock.every(s=>selectedStock.has(String(s.product_id)))} onChange={toggleAllStockSel} title="Seleccionar todos" className="accent-brand-500"/></th>
                      {['Producto','Stock disponible','Unidad'].map(h=><th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">{h}</th>)}
                    </tr></thead>
                    <tbody>{paginatedStock.map(s=>{ const pid = String(s.product_id); return (
                      <tr key={String(s.id)} className={cn('border-b border-[var(--border-primary)] last:border-0 hover:bg-[#1c2128]',selectedStock.has(pid)&&'bg-brand-500/5')}>
                        <td className="px-2 py-2.5"><input type="checkbox" checked={selectedStock.has(pid)} onChange={()=>toggleStockSel(pid)} className="accent-brand-500"/></td>
                        <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium">{String(s.product_name??'—')}</td>
                        <td className="px-4 py-2.5"><span className={cn('font-semibold',Number(s.quantity)<=0?'text-red-400':'text-green-400')}>{formatNumber(Number(s.quantity),2)}</span></td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">{String(s.unit??'')}</td>
                      </tr>
                    );})}</tbody>
                  </table>
                </div>
                <Pagination currentPage={stockPage} totalItems={filteredStock.length} pageSize={stockPageSize} onPageChange={setStockPage} onPageSizeChange={setStockPageSize} /></>
              )}
            </>
          )}

          {detailTab==='movimientos'&&(
            locMoves.length===0?<p className="text-center text-[var(--text-tertiary)] py-8 text-sm">Sin movimientos</p>:(<>
              <div className="overflow-x-auto rounded-xl border border-[var(--border-primary)]">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[var(--border-primary)] bg-[var(--bg-primary)]">{['Fecha','Tipo','Producto','Cantidad','Notas','Usuario'].map(h=><th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">{h}</th>)}</tr></thead>
                  <tbody>{paginatedMoves.map(m=>(
                    <tr key={String(m.id)} className="border-b border-[var(--border-primary)] last:border-0 hover:bg-[#1c2128]">
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] text-xs whitespace-nowrap">{m.created_at?formatDateTime(String(m.created_at)):'—'}</td>
                      <td className="px-4 py-2.5"><span className={cn('text-xs font-medium',movColor[String(m.type??'')]??'text-[var(--text-primary)]')}>{movLabel[String(m.type??'')]??String(m.type??'')}</span></td>
                      <td className="px-4 py-2.5 text-[var(--text-primary)]">{String(m.product_name??'—')}</td>
                      <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium">{formatNumber(Number(m.quantity),2)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] text-xs">{m.notes?String(m.notes):'—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] text-xs">{String(m.user_name??'—')}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <Pagination currentPage={movPage} totalItems={locMoves.length} pageSize={movPageSize} onPageChange={setMovPage} onPageSizeChange={setMovPageSize} /></>
            )
          )}

          <div className="flex gap-3 pt-2 border-t border-[var(--border-primary)]">
            <button onClick={()=>{setMovForm(f=>({...f,location_id:String(selLoc?.id??'')}));setShowMov(true);}} className="btn-secondary flex items-center gap-2 text-sm"><PackagePlus className="w-4 h-4"/>Entrada / Salida / Ajuste</button>
            <button onClick={()=>{setTrForm(f=>({...f,from_location_id:String(selLoc?.id??'')}));setShowTransfer(true);}} className="btn-secondary flex items-center gap-2 text-sm"><ArrowRightLeft className="w-4 h-4"/>Trasladar</button>
          </div>
        </div>
      </Modal>

      {/* Movement Modal */}
      <Modal open={showMov} onClose={()=>setShowMov(false)} title="Entrada / Salida / Ajuste de stock" size="md">
        <div className="space-y-4">
          <div className="p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] text-xs text-[var(--text-secondary)] space-y-1">
            <p><strong className="text-green-400">Entrada:</strong> Carga productos a un almacén (entrada al inventario). El stock global aumenta.</p>
            <p><strong className="text-red-400">Salida:</strong> Retira productos de un almacén (devolución, merma, etc.).</p>
            <p><strong className="text-yellow-400">Ajuste:</strong> Establece la cantidad exacta (corrección de conteo físico).</p>
          </div>
          <div><label className="label">Almacén *</label>
            <SearchableSelect
              options={locations.map(l => ({
                value: String(l.id),
                label: `${String(l.name)} (${typeLabel[String(l.type)] ?? String(l.type)})`
              }))}
              value={movForm.location_id}
              onChange={v => setMovForm(f => ({ ...f, location_id: v }))}
              placeholder="Seleccionar almacén / punto de venta"
              noResultsMessage="Sin almacenes"
            />
          </div>
          <div><label className="label">Producto *</label>
            <SearchableSelect
              options={products.map(p=>({
                value: String(p.id),
                label: String(p.name),
                sublabel: `Stock: ${formatNumber(movForm.location_id ? (locStockMap[String(p.id)]??0) : Number(p.stock??0),2)} ${String(p.unit??'')}`
              }))}
              value={movForm.product_id}
              onChange={v=>setMovForm(f=>({...f,product_id:v}))}
              placeholder="Buscar producto…"
              noResultsMessage="No se encontraron productos"
            />
          </div>
          <div><label className="label">Tipo *</label>
            <div className="grid grid-cols-3 gap-2">
              {([['entrada','Entrada','text-green-400'],['salida','Salida','text-red-400'],['ajuste','Ajuste','text-yellow-400']] as const).map(([v,label,color])=>(
                <button key={v} onClick={()=>setMovForm(f=>({...f,type:v}))} className={cn('px-3 py-2.5 rounded-lg text-sm border font-medium transition-colors',movForm.type===v?`bg-[var(--bg-muted)] border-[#6e7681] ${color}`:'border-[var(--border-secondary)] text-[var(--text-secondary)] hover:border-[#6e7681]')}>{label}</button>
              ))}
            </div>
          </div>
          <div><label className="label">{movForm.type==='ajuste'?'Stock exacto *':'Cantidad *'}</label>
            <input type="number" min="1" step="1" className="input" value={movForm.quantity||''} onChange={e=>setMovForm(f=>({...f,quantity:parseFloat(e.target.value)||0}))}/>
            {movForm.type==='entrada'&&movForm.product_id&&(
              <p className="text-xs text-[var(--text-tertiary)] mt-1">Stock disponible en este almacén: <strong className="text-[var(--text-primary)]">{formatNumber(locStockMap[String(movForm.product_id)]??0,2)}</strong></p>
            )}
          </div>
          <div><label className="label">Notas</label><input className="input" placeholder="Motivo, referencia..." value={movForm.notes} onChange={e=>setMovForm(f=>({...f,notes:e.target.value}))}/></div>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>setShowMov(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleMovement} disabled={saving||!movForm.location_id||!movForm.product_id||movForm.quantity<=0} className="btn-primary flex-1 disabled:opacity-50">{saving?'Registrando...':'Registrar'}</button></div>
        </div>
      </Modal>

      {/* Transfer Modal */}
      <Modal open={showTransfer} onClose={()=>setShowTransfer(false)} title="Trasladar stock entre ubicaciones" size="lg">
        <div className="space-y-4">
          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-400">El traslado mueve stock entre almacenes/puntos de venta. El stock global no cambia. Puedes incluir varios productos en un mismo traslado.</div>
          <div><label className="label">Origen *</label>
            <SearchableSelect
              options={locations.map(l => ({ value: String(l.id), label: String(l.name) }))}
              value={trForm.from_location_id}
              onChange={v => setTrForm(f => ({ ...f, from_location_id: v }))}
              placeholder="Seleccionar origen"
              noResultsMessage="Sin almacenes"
            />
          </div>
          <div><label className="label">Destino *</label>
            <SearchableSelect
              options={locations
                .filter(l => String(l.id) !== trForm.from_location_id)
                .map(l => ({ value: String(l.id), label: String(l.name) }))}
              value={trForm.to_location_id}
              onChange={v => setTrForm(f => ({ ...f, to_location_id: v }))}
              placeholder="Seleccionar destino"
              noResultsMessage="Sin almacenes disponibles"
            />
          </div>
          <div><label className="label">Productos a trasladar *</label>
            <div className="space-y-2">
              {trItems.map((it, idx) => {
                const available = trForm.from_location_id ? (trStockMap[it.product_id] ?? 0) : Number(products.find(p=>String(p.id)===it.product_id)?.stock ?? 0);
                const over = !!it.product_id && it.quantity > 0 && it.quantity > available;
                return (
                  <div key={idx} className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <SearchableSelect
                        options={products.map(p=>({
                          value: String(p.id),
                          label: String(p.name),
                          sublabel: `Stock: ${formatNumber(trForm.from_location_id ? (trStockMap[String(p.id)] ?? 0) : Number(p.stock ?? 0), 2)} ${String(p.unit ?? '')}`
                        }))}
                        value={it.product_id}
                        onChange={v=>{
                          if (trItems.some((o, oi) => oi !== idx && o.product_id === v)) {
                            toast.error('Ese producto ya está en la lista');
                            return;
                          }
                          updateTrItem(idx, { product_id: v });
                        }}
                        placeholder="Buscar producto…"
                        noResultsMessage="No se encontraron productos"
                      />
                    </div>
                    <div className="w-28 shrink-0">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        className={cn('input', over && 'border-red-500/60')}
                        placeholder="Cant."
                        value={it.quantity || ''}
                        onChange={e=>updateTrItem(idx, { quantity: parseFloat(e.target.value) || 0 })}
                      />
                      {over && (
                        <p className="text-[10px] text-red-400 mt-0.5">Máx: {formatNumber(available, 2)}</p>
                      )}
                    </div>
                    <button type="button" onClick={()=>removeTrItem(idx)} disabled={trItems.length===1} className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30" title="Quitar producto"><Trash2 className="w-4 h-4"/></button>
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={addTrItem} className="mt-2 text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1 transition-colors"><Plus className="w-3.5 h-3.5"/>Agregar otro producto</button>
            {!trForm.from_location_id && (
              <p className="text-xs text-[var(--text-tertiary)] mt-1">Selecciona el origen para ver el stock disponible por producto.</p>
            )}
          </div>
          <div><label className="label">Notas</label><input className="input" placeholder="Motivo..." value={trForm.notes} onChange={e=>setTrForm(f=>({...f,notes:e.target.value}))}/></div>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>setShowTransfer(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleTransfer} disabled={saving||!trForm.from_location_id||!trForm.to_location_id||!trItems.some(i=>i.product_id&&i.quantity>0)} className="btn-primary flex-1 disabled:opacity-50">{saving?'Trasladando...':'Confirmar traslado'}</button></div>
        </div>
      </Modal>

      {/* Location CRUD Modal */}
      <Modal open={showLocModal} onClose={()=>setShowLocModal(false)} title={editLoc?'Editar ubicación':'Nueva ubicación'} size="sm">  <div className="space-y-4">
          <div><label className="label">Nombre *</label><input className="input" placeholder="Ej: Almacén Central, Sucursal Norte..." value={locForm.name} onChange={e=>setLocForm(f=>({...f,name:e.target.value}))}/></div>
          <div><label className="label">Tipo</label>
            <div className="grid grid-cols-2 gap-2">
              {(['warehouse','store'] as const).map(t=>(
                <button key={t} onClick={()=>setLocForm(f=>({...f,type:t}))} className={cn('px-3 py-2.5 rounded-lg text-sm border transition-colors',locForm.type===t?'bg-brand-600 border-brand-600 text-white':'border-[var(--border-secondary)] text-[var(--text-secondary)] hover:border-[#6e7681] hover:text-[var(--text-primary)]')}>
                  {t==='warehouse'?'🏭 Almacén':'🏪 Punto de venta'}
                </button>
              ))}
            </div>
          </div>
          <div><label className="label">Dirección</label><input className="input" placeholder="Opcional" value={locForm.address} onChange={e=>setLocForm(f=>({...f,address:e.target.value}))}/></div>
          <div><label className="label">Notas</label><input className="input" placeholder="Opcional" value={locForm.notes} onChange={e=>setLocForm(f=>({...f,notes:e.target.value}))}/></div>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>setShowLocModal(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleSaveLoc} disabled={saving||!locForm.name.trim()} className="btn-primary flex-1 disabled:opacity-50">{saving?'Guardando...':editLoc?'Actualizar':'Crear'}</button></div>
        </div>
      </Modal>

      {/* Pos/Caja CRUD Modal */}
      <Modal open={showPosModal} onClose={()=>setShowPosModal(false)} title={editPos?'Editar caja':'Nueva caja'} size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Punto de venta (tienda) *</label>
            <SearchableSelect
              options={storeLocations.map(l=>({ value: String(l.id), label: String(l.name) }))}
              value={posForm.location_id}
              onChange={v => {
                const prevLoc = storeLocations.find(l => String(l.id) === posForm.location_id);
                const newLoc = storeLocations.find(l => String(l.id) === v);
                const prevName = prevLoc ? String(prevLoc.name) : '';
                const auto = !posForm.name.trim() || posForm.name === prevName;
                setPosForm(f => ({ ...f, location_id: v, name: auto && newLoc ? String(newLoc.name) : f.name }));
              }}
              placeholder="Seleccionar punto de venta…"
              noResultsMessage="No hay puntos de venta. Créalos en esta misma página."
              disabled={storeLocations.length===0}
            />
            {storeLocations.length===0&&(
              <button type="button" onClick={()=>{setShowPosModal(false);setEditLoc(null);setLocForm({name:'',type:'store',address:'',notes:''});setShowLocModal(true);}} className="mt-2 text-xs text-brand-400 hover:text-brand-300 transition-colors">
                + Crear punto de venta primero
              </button>
            )}
          </div>
          <div>
            <label className="label">Nombre de la caja *</label>
            <input className="input" placeholder="Ej: Caja principal" maxLength={60} value={posForm.name} onChange={e=>setPosForm(f=>({...f,name:e.target.value}))}/>
          </div>
          <div>
            <label className="label">Estado</label>
            <button type="button" onClick={()=>setPosForm(f=>({...f,active:!f.active}))} className={cn('w-full px-3 py-2.5 rounded-lg text-sm border font-medium transition-colors flex items-center justify-center gap-2',posForm.active?'bg-green-500/10 border-green-500/30 text-green-400':'bg-[var(--bg-primary)] border-[var(--border-secondary)] text-[var(--text-secondary)]')}>
              <span className={cn('w-2 h-2 rounded-full',posForm.active?'bg-green-400':'bg-[var(--text-tertiary)]')} />
              {posForm.active?'Activa':'Inactiva'}
            </button>
            <p className="text-[10px] text-[var(--text-tertiary)] mt-1">Las cajas inactivas no aparecen en los selectores ni pueden abrir turnos.</p>
          </div>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>setShowPosModal(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleSavePos} disabled={saving||!posForm.location_id||!posForm.name.trim()} className="btn-primary flex-1 disabled:opacity-50">{saving?'Guardando...':editPos?'Actualizar':'Crear caja'}</button></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!delTarget} onClose={()=>setDelTarget(null)} onConfirm={handleDelLoc} title="Eliminar ubicación" message={`¿Eliminar "${String(delTarget?.name??'')}"?`} loading={saving}/>
      <ConfirmDialog open={!!posDelTarget} onClose={()=>setPosDelTarget(null)} onConfirm={handleDelPos} title="Desactivar caja" confirmLabel="Desactivar" message={`¿Desactivar la caja "${String(posDelTarget?.name??'')}"? No aparecerá en los selectores ni podrá abrir turnos hasta reactivarla.`} loading={saving}/>
    </div>
  );
}
