'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatDateTime, formatNumber, cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { toast } from '@/components/ui/toaster';
import { Warehouse, Plus, Edit2, Trash2, ArrowRightLeft, PackagePlus, List, BarChart3, RefreshCw, Package, DollarSign, Layers } from 'lucide-react';
type R = Record<string,unknown>;

const movLabel:Record<string,string> = { entrada:'Entrada', salida:'Salida', traslado_out:'Traslado (salida)', traslado_in:'Traslado (entrada)', venta:'Venta', ajuste:'Ajuste' };
const movColor:Record<string,string> = { entrada:'text-green-400', salida:'text-red-400', traslado_out:'text-orange-400', traslado_in:'text-blue-400', venta:'text-purple-400', ajuste:'text-yellow-400' };
const typeLabel:Record<string,string> = { warehouse:'Almacén', store:'Punto de venta' };
const typeColor:Record<string,string> = { warehouse:'badge-info', store:'badge-success' };

export default function AlmacenesPage() {
  const [tab, setTab] = useState<'almacenes'|'transferencias'>('almacenes');
  const [locations, setLocations] = useState<R[]>([]);
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
  const [trForm, setTrForm] = useState({from_location_id:'',to_location_id:'',product_id:'',quantity:0,notes:''});
  const [movForm, setMovForm] = useState({location_id:'',product_id:'',type:'entrada',quantity:0,notes:''});
  const [locStockMap, setLocStockMap] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [locs, prods, trans, summary] = await Promise.all([api.getLocations(), api.getProducts(), api.getTransfers(), api.getLocationStockSummary()]);
    setLocations(locs); setProducts(prods); setTransfers(trans); setStockSummary(summary); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

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

  async function loadDetail(locId: string) {
    const [st, mv] = await Promise.all([api.getLocationStock(locId), api.getLocationMovements(locId)]);
    setLocStock(st); setLocMoves(mv);
  }

  async function openDetail(loc: R) { setSelLoc(loc); setDetailTab('stock'); setShowDetail(true); loadDetail(String(loc.id)); }

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

  async function handleTransfer() {
    const { from_location_id, to_location_id, product_id, quantity, notes } = trForm;
    if (!from_location_id||!to_location_id||!product_id||quantity<=0) { toast.error('Completa todos los campos'); return; }
    if (from_location_id===to_location_id) { toast.error('Origen y destino no pueden ser iguales'); return; }
    setSaving(true);
    try {
      await api.createTransfer({ from_location_id, to_location_id, product_id, quantity, notes: notes||null });
      toast.success('Traslado registrado'); setShowTransfer(false);
      setTrForm({from_location_id:'',to_location_id:'',product_id:'',quantity:0,notes:''}); load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error al trasladar. Verifica el stock disponible.'); } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#21262d] pb-0">
        {([['almacenes','Almacenes / Puntos de venta',Warehouse],['transferencias','Traslados',ArrowRightLeft]] as const).map(([key,label,Icon])=>(
          <button key={key} onClick={()=>setTab(key as 'almacenes'|'transferencias')} className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',tab===key?'border-brand-500 text-brand-400':'border-transparent text-[#8b949e] hover:text-[#e6edf3]')}>
            <Icon className="w-4 h-4"/>{label}
          </button>
        ))}
      </div>

      {tab==='almacenes'&&(
        <>
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
                      <p className="text-sm font-semibold text-[#e6edf3] truncate">{String(s.location_name)}</p>
                      <span className={s.location_type === 'store' ? 'badge-success' : 'badge-info'}>
                        {s.location_type === 'warehouse' ? 'Almacén' : 'Punto de venta'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mt-1">
                      <div className="flex flex-col items-center p-2 rounded-lg bg-[#0d1117] border border-[#21262d]">
                        <Layers className="w-4 h-4 text-blue-400 mb-1" />
                        <p className="text-lg font-bold text-[#e6edf3]">{count}</p>
                        <p className="text-[10px] text-[#6e7681] uppercase tracking-wide">Productos</p>
                      </div>
                      <div className="flex flex-col items-center p-2 rounded-lg bg-[#0d1117] border border-[#21262d]">
                        <Package className="w-4 h-4 text-green-400 mb-1" />
                        <p className="text-lg font-bold text-[#e6edf3]">{qty.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        <p className="text-[10px] text-[#6e7681] uppercase tracking-wide">Cantidad</p>
                      </div>
                      <div className="flex flex-col items-center p-2 rounded-lg bg-[#0d1117] border border-[#21262d]">
                        <DollarSign className="w-4 h-4 text-yellow-400 mb-1" />
                        <p className="text-lg font-bold text-[#e6edf3]">{'$' + val.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        <p className="text-[10px] text-[#6e7681] uppercase tracking-wide">Valor</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-sm text-[#8b949e]">{locations.length} ubicación(es)</p>
            <div className="flex gap-2 flex-wrap">
              <button onClick={()=>setShowMov(true)} className="btn-secondary flex items-center gap-2 text-sm"><PackagePlus className="w-4 h-4"/>Entrada / Salida / Ajuste</button>
              <button onClick={()=>setShowTransfer(true)} className="btn-secondary flex items-center gap-2 text-sm"><ArrowRightLeft className="w-4 h-4"/>Trasladar stock</button>
              <button onClick={()=>{setEditLoc(null);setLocForm({name:'',type:'warehouse',address:'',notes:''});setShowLocModal(true);}} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4"/>Nuevo almacén</button>
            </div>
          </div>
          {loading?<div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
          :locations.length===0?<EmptyState icon={Warehouse} title="Sin almacenes" description="Crea tu primer almacén o punto de venta" action={<button onClick={()=>setShowLocModal(true)} className="btn-primary">Crear almacén</button>}/>:(
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {locations.map(loc=>(
                <div key={String(loc.id)} className="card p-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="font-semibold text-[#e6edf3] truncate">{String(loc.name)}</p>{loc.address?<p className="text-xs text-[#6e7681] mt-0.5">{String(loc.address)}</p>:null}</div>
                    <span className={typeColor[String(loc.type)]??'badge-info'}>{typeLabel[String(loc.type)]??String(loc.type)}</span>
                  </div>
                  {loc.notes?<p className="text-xs text-[#8b949e]">{String(loc.notes)}</p>:null}
                  <div className="flex items-center gap-2 pt-1 border-t border-[#21262d]">
                    <button onClick={()=>openDetail(loc)} className="btn-secondary text-xs flex items-center gap-1.5 flex-1 justify-center"><BarChart3 className="w-3.5 h-3.5"/>Ver stock</button>
                    <button onClick={()=>{setEditLoc(loc);setLocForm({name:String(loc.name),type:String(loc.type),address:String(loc.address??''),notes:String(loc.notes??'')});setShowLocModal(true);}} className="p-2 rounded-lg text-[#6e7681] hover:text-brand-400 hover:bg-brand-500/10 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                    <button onClick={()=>setDelTarget(loc)} className="p-2 rounded-lg text-[#6e7681] hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab==='transferencias'&&(
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-[#8b949e]">Historial de traslados</p>
            <button onClick={()=>setShowTransfer(true)} className="btn-primary flex items-center gap-2"><ArrowRightLeft className="w-4 h-4"/>Nuevo traslado</button>
          </div>
          <div className="card overflow-hidden">
            {loading?<div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
            :transfers.length===0?<EmptyState icon={ArrowRightLeft} title="Sin traslados" description="Registra el primer traslado" action={<button onClick={()=>setShowTransfer(true)} className="btn-primary">Nuevo traslado</button>}/>:(
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[#21262d]">{['Fecha','Origen','Destino','Producto','Cantidad','Usuario'].map(h=><th key={h} className="text-left px-4 py-3 text-xs font-medium text-[#8b949e] uppercase tracking-wide">{h}</th>)}</tr></thead>
                  <tbody>{transfers.map(t=>(
                    <tr key={String(t.id)} className="border-b border-[#21262d] last:border-0 table-row-hover">
                      <td className="px-4 py-3 text-[#8b949e] text-xs whitespace-nowrap">{t.created_at?formatDateTime(String(t.created_at)):'—'}</td>
                      <td className="px-4 py-3 text-[#e6edf3]">{String(t.from_location_name??'—')}</td>
                      <td className="px-4 py-3 text-[#e6edf3]">{String(t.to_location_name??'—')}</td>
                      <td className="px-4 py-3 text-[#e6edf3]">{String(t.product_name??'—')}</td>
                      <td className="px-4 py-3 text-brand-400 font-medium">{formatNumber(Number(t.quantity),2)} {String(t.unit??'')}</td>
                      <td className="px-4 py-3 text-[#8b949e] text-xs">{String(t.user_name??'—')}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Detail Modal */}
      <Modal open={showDetail} onClose={()=>setShowDetail(false)} title={`${String(selLoc?.name??'')} — ${typeLabel[String(selLoc?.type??'warehouse')]}`} size="xl">
        <div className="space-y-4">
          <div className="flex gap-1 border-b border-[#21262d]">
            {([['stock','Stock actual',BarChart3],['movimientos','Movimientos',List]] as const).map(([key,label,Icon])=>(
              <button key={key} onClick={()=>setDetailTab(key as 'stock'|'movimientos')} className={cn('flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px transition-colors',detailTab===key?'border-brand-500 text-brand-400':'border-transparent text-[#8b949e] hover:text-[#e6edf3]')}>
                <Icon className="w-3.5 h-3.5"/>{label}
              </button>
            ))}
            <div className="flex-1"/>
            <button onClick={()=>selLoc&&loadDetail(String(selLoc.id))} className="p-2 text-[#6e7681] hover:text-[#e6edf3] transition-colors mb-px" title="Actualizar"><RefreshCw className="w-3.5 h-3.5"/></button>
          </div>

          {detailTab==='stock'&&(
            locStock.length===0?(
              <div className="flex flex-col items-center justify-center py-10 text-[#6e7681]">
                <PackagePlus size={32} className="mb-3 opacity-40"/>
                <p className="text-sm text-center">Sin stock en este almacén.</p>
                <p className="text-xs text-center mt-1">Usa <strong className="text-[#e6edf3]">Entrada</strong> para cargar productos aquí.</p>
              </div>
            ):(
              <div className="overflow-x-auto rounded-xl border border-[#21262d]">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[#21262d] bg-[#0d1117]">{['Producto','Stock disponible','Unidad'].map(h=><th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-[#6e7681] uppercase tracking-wide">{h}</th>)}</tr></thead>
                  <tbody>{locStock.map(s=>(
                    <tr key={String(s.id)} className="border-b border-[#21262d] last:border-0 hover:bg-[#1c2128]">
                      <td className="px-4 py-2.5 text-[#e6edf3] font-medium">{String(s.product_name??'—')}</td>
                      <td className="px-4 py-2.5"><span className={cn('font-semibold',Number(s.quantity)<=0?'text-red-400':'text-green-400')}>{formatNumber(Number(s.quantity),2)}</span></td>
                      <td className="px-4 py-2.5 text-[#8b949e]">{String(s.unit??'')}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )
          )}

          {detailTab==='movimientos'&&(
            locMoves.length===0?<p className="text-center text-[#6e7681] py-8 text-sm">Sin movimientos</p>:(
              <div className="overflow-x-auto rounded-xl border border-[#21262d]">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-[#21262d] bg-[#0d1117]">{['Fecha','Tipo','Producto','Cantidad','Notas','Usuario'].map(h=><th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-[#6e7681] uppercase tracking-wide">{h}</th>)}</tr></thead>
                  <tbody>{locMoves.map(m=>(
                    <tr key={String(m.id)} className="border-b border-[#21262d] last:border-0 hover:bg-[#1c2128]">
                      <td className="px-4 py-2.5 text-[#8b949e] text-xs whitespace-nowrap">{m.created_at?formatDateTime(String(m.created_at)):'—'}</td>
                      <td className="px-4 py-2.5"><span className={cn('text-xs font-medium',movColor[String(m.type??'')]??'text-[#e6edf3]')}>{movLabel[String(m.type??'')]??String(m.type??'')}</span></td>
                      <td className="px-4 py-2.5 text-[#e6edf3]">{String(m.product_name??'—')}</td>
                      <td className="px-4 py-2.5 text-[#e6edf3] font-medium">{formatNumber(Number(m.quantity),2)}</td>
                      <td className="px-4 py-2.5 text-[#8b949e] text-xs">{m.notes?String(m.notes):'—'}</td>
                      <td className="px-4 py-2.5 text-[#8b949e] text-xs">{String(m.user_name??'—')}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )
          )}

          <div className="flex gap-3 pt-2 border-t border-[#21262d]">
            <button onClick={()=>{setMovForm(f=>({...f,location_id:String(selLoc?.id??'')}));setShowMov(true);}} className="btn-secondary flex items-center gap-2 text-sm"><PackagePlus className="w-4 h-4"/>Entrada / Salida / Ajuste</button>
            <button onClick={()=>{setTrForm(f=>({...f,from_location_id:String(selLoc?.id??'')}));setShowTransfer(true);}} className="btn-secondary flex items-center gap-2 text-sm"><ArrowRightLeft className="w-4 h-4"/>Trasladar</button>
          </div>
        </div>
      </Modal>

      {/* Movement Modal */}
      <Modal open={showMov} onClose={()=>setShowMov(false)} title="Entrada / Salida / Ajuste de stock" size="md">
        <div className="space-y-4">
          <div className="p-3 bg-[#0d1117] rounded-xl border border-[#21262d] text-xs text-[#8b949e] space-y-1">
            <p><strong className="text-green-400">Entrada:</strong> Carga productos del inventario general a un almacén. El stock global se reduce.</p>
            <p><strong className="text-red-400">Salida:</strong> Retira productos de un almacén (devolución, merma, etc.).</p>
            <p><strong className="text-yellow-400">Ajuste:</strong> Establece la cantidad exacta (corrección de conteo físico).</p>
          </div>
          <div><label className="label">Almacén *</label>
            <select className="input" value={movForm.location_id} onChange={e=>setMovForm(f=>({...f,location_id:e.target.value}))}>
              <option value="">Seleccionar almacén / punto de venta</option>
              {locations.map(l=><option key={String(l.id)} value={String(l.id)}>{String(l.name)} ({typeLabel[String(l.type)]??String(l.type)})</option>)}
            </select>
          </div>
          <div><label className="label">Producto *</label>
            <select className="input" value={movForm.product_id} onChange={e=>setMovForm(f=>({...f,product_id:e.target.value}))}>
              <option value="">Seleccionar producto</option>
              {products.map(p=>{
                const locQty = movForm.location_id ? (locStockMap[String(p.id)]??0) : Number(p.stock??0);
                return <option key={String(p.id)} value={String(p.id)}>{String(p.name)} — stock en almacén: {formatNumber(locQty,2)} {String(p.unit??'')}</option>;
              })}
            </select>
          </div>
          <div><label className="label">Tipo *</label>
            <div className="grid grid-cols-3 gap-2">
              {([['entrada','Entrada','text-green-400'],['salida','Salida','text-red-400'],['ajuste','Ajuste','text-yellow-400']] as const).map(([v,label,color])=>(
                <button key={v} onClick={()=>setMovForm(f=>({...f,type:v}))} className={cn('px-3 py-2.5 rounded-lg text-sm border font-medium transition-colors',movForm.type===v?`bg-[#21262d] border-[#6e7681] ${color}`:'border-[#30363d] text-[#8b949e] hover:border-[#6e7681]')}>{label}</button>
              ))}
            </div>
          </div>
          <div><label className="label">{movForm.type==='ajuste'?'Stock exacto *':'Cantidad *'}</label>
            <input type="number" min="1" step="1" className="input" value={movForm.quantity||''} onChange={e=>setMovForm(f=>({...f,quantity:parseFloat(e.target.value)||0}))}/>
            {movForm.type==='entrada'&&movForm.product_id&&(
              <p className="text-xs text-[#6e7681] mt-1">Stock disponible en este almacén: <strong className="text-[#e6edf3]">{formatNumber(locStockMap[String(movForm.product_id)]??0,2)}</strong></p>
            )}
          </div>
          <div><label className="label">Notas</label><input className="input" placeholder="Motivo, referencia..." value={movForm.notes} onChange={e=>setMovForm(f=>({...f,notes:e.target.value}))}/></div>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>setShowMov(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleMovement} disabled={saving||!movForm.location_id||!movForm.product_id||movForm.quantity<=0} className="btn-primary flex-1 disabled:opacity-50">{saving?'Registrando...':'Registrar'}</button></div>
        </div>
      </Modal>

      {/* Transfer Modal */}
      <Modal open={showTransfer} onClose={()=>setShowTransfer(false)} title="Trasladar stock entre ubicaciones" size="md">
        <div className="space-y-4">
          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-400">El traslado mueve stock entre almacenes/puntos de venta. El stock global no cambia.</div>
          <div><label className="label">Origen *</label>
            <select className="input" value={trForm.from_location_id} onChange={e=>setTrForm(f=>({...f,from_location_id:e.target.value}))}>
              <option value="">Seleccionar origen</option>
              {locations.map(l=><option key={String(l.id)} value={String(l.id)}>{String(l.name)}</option>)}
            </select>
          </div>
          <div><label className="label">Destino *</label>
            <select className="input" value={trForm.to_location_id} onChange={e=>setTrForm(f=>({...f,to_location_id:e.target.value}))}>
              <option value="">Seleccionar destino</option>
              {locations.filter(l=>String(l.id)!==trForm.from_location_id).map(l=><option key={String(l.id)} value={String(l.id)}>{String(l.name)}</option>)}
            </select>
          </div>
          <div><label className="label">Producto *</label>
            <select className="input" value={trForm.product_id} onChange={e=>setTrForm(f=>({...f,product_id:e.target.value}))}>
              <option value="">Seleccionar producto</option>
              {products.map(p=><option key={String(p.id)} value={String(p.id)}>{String(p.name)}</option>)}
            </select>
          </div>
          <div><label className="label">Cantidad *</label><input type="number" min="1" step="1" className="input" value={trForm.quantity||''} onChange={e=>setTrForm(f=>({...f,quantity:parseFloat(e.target.value)||0}))}/></div>
          <div><label className="label">Notas</label><input className="input" placeholder="Motivo..." value={trForm.notes} onChange={e=>setTrForm(f=>({...f,notes:e.target.value}))}/></div>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>setShowTransfer(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handleTransfer} disabled={saving||!trForm.from_location_id||!trForm.to_location_id||!trForm.product_id||trForm.quantity<=0} className="btn-primary flex-1 disabled:opacity-50">{saving?'Trasladando...':'Confirmar traslado'}</button></div>
        </div>
      </Modal>

      {/* Location CRUD Modal */}
      <Modal open={showLocModal} onClose={()=>setShowLocModal(false)} title={editLoc?'Editar ubicación':'Nueva ubicación'} size="sm">  <div className="space-y-4">
          <div><label className="label">Nombre *</label><input className="input" placeholder="Ej: Almacén Central, Sucursal Norte..." value={locForm.name} onChange={e=>setLocForm(f=>({...f,name:e.target.value}))}/></div>
          <div><label className="label">Tipo</label>
            <div className="grid grid-cols-2 gap-2">
              {(['warehouse','store'] as const).map(t=>(
                <button key={t} onClick={()=>setLocForm(f=>({...f,type:t}))} className={cn('px-3 py-2.5 rounded-lg text-sm border transition-colors',locForm.type===t?'bg-brand-600 border-brand-600 text-white':'border-[#30363d] text-[#8b949e] hover:border-[#6e7681] hover:text-[#e6edf3]')}>
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

      <ConfirmDialog open={!!delTarget} onClose={()=>setDelTarget(null)} onConfirm={handleDelLoc} title="Eliminar ubicación" message={`¿Eliminar "${String(delTarget?.name??'')}"?`} loading={saving}/>
    </div>
  );
}
