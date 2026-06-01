'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatCurrency, formatDateTime, generateId, cn, formatNumber } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { api } from '@/lib/api-client';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { toast } from '@/components/ui/toaster';
import { ShoppingCart, Plus, Search, X, Eye, CreditCard, CheckCircle, Ban } from 'lucide-react';

type AnyRecord = Record<string,unknown>;
type PayMethod = 'cash'|'transfer'|'mixed'|'credit';
const statusLabel: Record<string,string> = { completed:'Pagada', pending:'Pendiente', partial:'Parcial', cancelled:'Cancelada' };
const statusClass: Record<string,string> = { completed:'badge-success', pending:'badge-warning', partial:'badge-info', cancelled:'badge-danger' };

export default function VentasPage() {
  const [sales, setSales] = useState<AnyRecord[]>([]);
  const [products, setProducts] = useState<AnyRecord[]>([]);
  const [customers, setCustomers] = useState<AnyRecord[]>([]);
  const [locations, setLocations] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selectedSale, setSelectedSale] = useState<AnyRecord|null>(null);
  const [showPaySale, setShowPaySale] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [paySaleForm, setPaySaleForm] = useState({ amount: 0, method: 'cash', notes: '' });
  const [paySaleSaving, setPaySaleSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [cart, setCart] = useState<{product:AnyRecord;quantity:number;unit_price:number}[]>([]);
  const [locationId, setLocationId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');
  const [amountCash, setAmountCash] = useState(0);
  const [amountTransfer, setAmountTransfer] = useState(0);
  const [saleNotes, setSaleNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const { user } = useAuthStore();

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    try {
      const [s, p, c, l] = await Promise.all([api.getSales('limit=50'), api.getProducts(), api.getCustomers(), api.getLocations()]);
      setSales(s); setProducts(p); setCustomers(c); setLocations(l);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cargar los datos');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const cartTotal = cart.reduce((a,i) => a + i.quantity * i.unit_price, 0);
  function addToCart(p: AnyRecord) {
    setCart(prev => { const ex = prev.find(i=>i.product.id===p.id); return ex ? prev.map(i=>i.product.id===p.id?{...i,quantity:i.quantity+1}:i) : [...prev,{product:p,quantity:1,unit_price:Number(p.sale_price)}]; });
    setProductSearch('');
  }
  function resetForm() { setCart([]); setLocationId(locations.length > 0 ? String(locations[0].id) : ''); setCustomerId(''); setPayMethod('cash'); setAmountCash(0); setAmountTransfer(0); setSaleNotes(''); }

  async function openDetail(sale: AnyRecord) {
    const detail = await api.getSaleDetail(String(sale.id));
    setSelectedSale({ ...sale, items: detail.items, payments: detail.payments, customer_payments: detail.customer_payments, total_paid: detail.total_paid });
    setShowDetail(true);
  }

  async function handleCancelSale() {
    if (!selectedSale) return;
    setCancelling(true);
    try {
      await api.cancelSale(String(selectedSale.id));
      toast.success('Venta cancelada — inventario y saldos restaurados');
      setShowCancelConfirm(false);
      setShowDetail(false);
      setSelectedSale(null);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error al cancelar venta'); } finally { setCancelling(false); }
  }

  async function handlePaySale() {
    if (!selectedSale || paySaleForm.amount <= 0) return;
    setPaySaleSaving(true);
    try {
      await api.paySale(String(selectedSale.id), paySaleForm);
      toast.success('Pago registrado');
      setShowPaySale(false);
      setPaySaleForm({ amount: 0, method: 'cash', notes: '' });
      // Recargar detalle
      const detail = await api.getSaleDetail(String(selectedSale.id));
      setSelectedSale(prev => ({ ...prev, ...detail, items: detail.items, payments: detail.payments, customer_payments: detail.customer_payments, total_paid: detail.total_paid }));
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error al registrar pago'); } finally { setPaySaleSaving(false); }
  }

  async function handleSave() {
    if (cart.length === 0) return;
    if (payMethod === 'credit' && !customerId) { toast.error('Las ventas a crédito requieren cliente'); return; }
    setSaving(true);
    try {
      const total = cartTotal;
      await api.createSale({
        items: cart.map(i => ({ product_id: i.product.id, quantity: i.quantity, unit_price: i.unit_price, cost: Number(i.product.cost??0) })),
        payment: { method: payMethod, amount_cash: payMethod==='cash'?total:payMethod==='mixed'?amountCash:0, amount_transfer: payMethod==='transfer'?total:payMethod==='mixed'?amountTransfer:0 },
        customer_id: customerId || null,
        location_id: locationId || null,
        notes: saleNotes || null,
      });
      toast.success('Venta registrada'); setShowNew(false); resetForm(); load();
    } catch(e) { toast.error(e instanceof Error ? e.message : 'Error al registrar la venta'); } finally { setSaving(false); }
  }

  const filteredSales = sales.filter(s => String(s.customer_name??'').toLowerCase().includes(search.toLowerCase()));
  const paginatedSales = pageSize === 0 ? filteredSales : filteredSales.slice(0, page * pageSize).slice((page - 1) * pageSize);

  // Reset page when search changes
  useEffect(() => { setPage(1); }, [search]);
  const filteredProducts = products.filter(p => String(p.name).toLowerCase().includes(productSearch.toLowerCase())).slice(0,8);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e7681]"/><input className="input pl-9" placeholder="Buscar ventas..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <button onClick={()=>{resetForm();setShowNew(true);}} className="btn-primary flex items-center gap-2 flex-shrink-0"><Plus className="w-4 h-4"/>Nueva venta</button>
      </div>

      <div className="card overflow-hidden">
        {loading?<div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
        :paginatedSales.length===0?<EmptyState icon={ShoppingCart} title="Sin ventas" description="Registra tu primera venta" action={<button onClick={()=>setShowNew(true)} className="btn-primary">Nueva venta</button>}/>:(
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[#21262d]">{['Fecha','Cliente','Total','Tipo','Estado',''].map(h=><th key={h} className="text-left px-4 py-3 text-xs font-medium text-[#8b949e] uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>{paginatedSales.map(s=>(
                <tr key={String(s.id)} className="border-b border-[#21262d] last:border-0 table-row-hover">
                  <td className="px-4 py-3 text-[#8b949e] text-xs">{s.date?formatDateTime(String(s.date)):'—'}</td>
                  <td className="px-4 py-3 text-[#e6edf3]">{s.customer_name?String(s.customer_name):<span className="text-[#6e7681] italic">Sin cliente</span>}</td>
                  <td className="px-4 py-3 text-[#e6edf3] font-semibold">{formatCurrency(Number(s.total))}</td>
                  <td className="px-4 py-3 text-[#8b949e]">{s.status==='pending'?'Crédito':'Contado'}</td>
                  <td className="px-4 py-3"><span className={statusClass[String(s.status)]??'badge-info'}>{statusLabel[String(s.status)]??String(s.status)}</span></td>
                  <td className="px-4 py-3"><button onClick={()=>openDetail(s)} className="p-1.5 rounded-lg text-[#6e7681] hover:text-brand-400 hover:bg-brand-500/10 transition-colors"><Eye className="w-3.5 h-3.5"/></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <Pagination currentPage={page} totalItems={filteredSales.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {/* New Sale Modal */}
      <Modal open={showNew} onClose={()=>{setShowNew(false);resetForm();}} title="Nueva venta" size="xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div><label className="label">Buscar producto</label>
              <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6e7681]"/><input className="input pl-9" placeholder="Nombre..." value={productSearch} onChange={e=>setProductSearch(e.target.value)}/></div>
            </div>
            {productSearch&&(
              <div className="border border-[#30363d] rounded-xl overflow-hidden bg-[#0d1117]">
                {filteredProducts.length===0?<p className="text-center text-[#6e7681] py-4 text-sm">Sin resultados</p>
                :filteredProducts.map(p=>(
                  <button key={String(p.id)} onClick={()=>addToCart(p)} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#161b22] text-left border-b border-[#21262d] last:border-0 transition-colors">
                    <div><p className="text-sm text-[#e6edf3]">{String(p.name)}</p><p className="text-xs text-[#6e7681]">Stock: {formatNumber(Number(p.stock),1)}</p></div>
                    <span className="text-brand-400 font-semibold text-sm">{formatCurrency(Number(p.sale_price))}</span>
                  </button>
                ))}
              </div>
            )}
            {cart.length>0&&(
              <div className="space-y-2">
                <p className="text-xs font-medium text-[#8b949e] uppercase tracking-wide">Carrito</p>
                {cart.map(item=>(
                  <div key={String(item.product.id)} className="flex items-center gap-2 bg-[#0d1117] rounded-xl px-3 py-2.5 border border-[#21262d]">
                    <div className="flex-1 min-w-0"><p className="text-sm text-[#e6edf3] truncate">{String(item.product.name)}</p></div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={()=>setCart(prev=>prev.map(i=>i.product.id===item.product.id?{...i,quantity:Math.max(0.01,i.quantity-1)}:i))} className="w-6 h-6 rounded-md bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] flex items-center justify-center text-xs">−</button>
                      <input type="number" min="0" step="1" value={item.quantity} onChange={e=>setCart(prev=>prev.map(i=>i.product.id===item.product.id?{...i,quantity:parseFloat(e.target.value)||0.01}:i))} className="w-14 input text-center text-xs py-1"/>
                      <button onClick={()=>setCart(prev=>prev.map(i=>i.product.id===item.product.id?{...i,quantity:i.quantity+1}:i))} className="w-6 h-6 rounded-md bg-[#21262d] text-[#e6edf3] hover:bg-[#30363d] flex items-center justify-center text-xs">+</button>
                      <input type="number" min="0" step="1" value={item.unit_price} onChange={e=>setCart(prev=>prev.map(i=>i.product.id===item.product.id?{...i,unit_price:parseFloat(e.target.value)||0}:i))} className="w-20 input text-right text-xs py-1"/>
                      <button onClick={()=>setCart(prev=>prev.filter(i=>i.product.id!==item.product.id))} className="text-[#6e7681] hover:text-red-400"><X className="w-4 h-4"/></button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-end pt-1"><span className="text-lg font-semibold text-[#e6edf3]">Total: {formatCurrency(cartTotal)}</span></div>
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div><label className="label">Almacén de salida *</label>
              <select className="input" value={locationId} onChange={e=>setLocationId(e.target.value)}>
                {locations.length === 0 && <option value="">Cargando ubicaciones...</option>}
                {locations.map(l=><option key={String(l.id)} value={String(l.id)}>{String(l.name)}</option>)}
              </select>
            </div>
            <div><label className="label">Cliente (opcional)</label>
              <select className="input" value={customerId} onChange={e=>setCustomerId(e.target.value)}>
                <option value="">Sin cliente</option>
                {customers.map(c=><option key={String(c.id)} value={String(c.id)}>{String(c.name)}{Number(c.balance)>0?` (debe ${formatCurrency(Number(c.balance))})`:''}</option>)}
              </select>
            </div>
            <div><label className="label">Método de pago</label>
              <div className="grid grid-cols-2 gap-2">
                {(['cash','transfer','mixed','credit'] as PayMethod[]).map(m=>{
                  const labels: Record<PayMethod,string> = {cash:'Efectivo',transfer:'Transferencia',mixed:'Mixto',credit:'Crédito'};
                  return(<button key={m} onClick={()=>setPayMethod(m)} className={cn('px-3 py-2 rounded-lg text-sm border transition-colors',payMethod===m?'bg-brand-600 border-brand-600 text-white':'border-[#30363d] text-[#8b949e] hover:border-[#6e7681] hover:text-[#e6edf3]')}>{labels[m]}</button>);
                })}
              </div>
            </div>
            {payMethod==='mixed'&&(
              <div className="grid grid-cols-2 gap-3 p-3 bg-[#0d1117] rounded-xl border border-[#21262d]">
                <div><label className="label">Efectivo</label><input type="number" min="0" step="0.01" className="input" value={amountCash||''} onChange={e=>setAmountCash(parseFloat(e.target.value)||0)}/></div>
                <div><label className="label">Transferencia</label><input type="number" min="0" step="0.01" className="input" value={amountTransfer||''} onChange={e=>setAmountTransfer(parseFloat(e.target.value)||0)}/></div>
                {(amountCash+amountTransfer)!==cartTotal&&cartTotal>0 ? <p className="col-span-2 text-xs text-yellow-400">⚠ La suma no coincide con el total</p> : null}
              </div>
            )}
            {payMethod==='credit'&&<div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-xs text-yellow-400">⚠ Se registrará como deuda. Debes seleccionar un cliente.</div>}
            <div><label className="label">Notas</label><input className="input" placeholder="Notas opcionales..." value={saleNotes} onChange={e=>setSaleNotes(e.target.value)}/></div>
            <button onClick={handleSave} disabled={saving||cart.length===0} className="btn-primary w-full py-3 text-base disabled:opacity-50">
              {saving?'Registrando...':`Confirmar — ${formatCurrency(cartTotal)}`}
            </button>
          </div>
        </div>
      </Modal>

      {/* Sale Detail Modal */}
      <Modal open={showDetail} onClose={()=>setShowDetail(false)} title="Detalle de venta" size="lg">
        {selectedSale&&(
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-[#0d1117] rounded-xl p-3"><p className="text-xs text-[#6e7681] mb-1">Fecha</p><p className="text-[#e6edf3]">{selectedSale.date?formatDateTime(String(selectedSale.date)):'—'}</p></div>
              <div className="bg-[#0d1117] rounded-xl p-3"><p className="text-xs text-[#6e7681] mb-1">Estado</p><span className={statusClass[String(selectedSale.status)]??'badge-info'}>{statusLabel[String(selectedSale.status)]??String(selectedSale.status)}</span></div>
              <div className="bg-[#0d1117] rounded-xl p-3"><p className="text-xs text-[#6e7681] mb-1">Cliente</p><p className="text-[#e6edf3]">{String(selectedSale.customer_name??'Sin cliente')}</p></div>
              <div className="bg-[#0d1117] rounded-xl p-3"><p className="text-xs text-[#6e7681] mb-1">Total</p><p className="text-[#e6edf3] font-semibold">{formatCurrency(Number(selectedSale.total))}</p></div>
            </div>
            {(selectedSale.items as AnyRecord[]|undefined)?.length&&(
              <div>
                <p className="text-xs font-medium text-[#8b949e] uppercase tracking-wide mb-2">Productos</p>
                <div className="rounded-xl border border-[#21262d] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-[#21262d] bg-[#0d1117]">{['Producto','Cant.','Precio','Subtotal'].map(h=><th key={h} className="px-3 py-2 text-left text-xs font-medium text-[#6e7681]">{h}</th>)}</tr></thead>
                    <tbody>{(selectedSale.items as AnyRecord[]).map(item=>(
                      <tr key={String(item.id)} className="border-b border-[#21262d] last:border-0">
                        <td className="px-3 py-2 text-[#e6edf3]">{String(item.product_name??'—')}</td>
                        <td className="px-3 py-2 text-[#8b949e]">{formatNumber(Number(item.quantity),2)}</td>
                        <td className="px-3 py-2 text-[#8b949e]">{formatCurrency(Number(item.unit_price))}</td>
                        <td className="px-3 py-2 text-[#e6edf3] font-medium">{formatCurrency(Number(item.quantity)*Number(item.unit_price))}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}
            {/* Payment method info */}
            {(selectedSale.payments as AnyRecord[]|undefined)?.map(pay=>(
              <div key={String(pay.id)} className="flex justify-between items-center text-sm p-3 bg-[#0d1117] rounded-xl border border-[#21262d]">
                <span className="text-[#8b949e] capitalize">{({cash:'Efectivo',transfer:'Transferencia',mixed:'Mixto',credit:'Crédito'} as Record<string,string>)[String(pay.method)]??String(pay.method)}</span>
                <span className="text-[#e6edf3] font-medium">{pay.method==='mixed'?`Ef: ${formatCurrency(Number(pay.amount_cash))} / Tr: ${formatCurrency(Number(pay.amount_transfer))}`:formatCurrency(Number(pay.amount_cash)+Number(pay.amount_transfer))}</span>
              </div>
            ))}
            {/* Abonos vinculados */}
            {(selectedSale as any).customer_payments?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-[#8b949e] uppercase tracking-wide mb-2">Abonos recibidos</p>
                <div className="space-y-2">
                  {(selectedSale as any).customer_payments.map((cp: AnyRecord) => (
                    <div key={String(cp.id)} className="flex justify-between items-center text-sm p-3 bg-green-500/5 rounded-xl border border-green-500/20">
                      <div>
                        <span className="text-green-400 font-medium">{formatCurrency(Number(cp.amount))}</span>
                        <span className="text-xs text-[#6e7681] ml-2">{cp.date ? formatDateTime(String(cp.date)) : '—'} · {String(cp.method)}</span>
                      </div>
                      {cp.notes ? <span className="text-xs text-[#8b949e]">{String(cp.notes)}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Botón Cobrar si está pendiente/parcial */}
            {(selectedSale.status === 'pending' || selectedSale.status === 'partial') && !!selectedSale.customer_id && (
              <button
                onClick={() => {
                  setPaySaleForm({
                    amount: Number(selectedSale.total) - Number((selectedSale as any).total_paid ?? 0),
                    method: 'cash',
                    notes: '',
                  });
                  setShowPaySale(true);
                }}
                className="btn-primary w-full flex items-center justify-center gap-2 py-3 text-base"
              >
                <CreditCard className="w-5 h-5" />
                Cobrar — {formatCurrency(Number(selectedSale.total) - Number((selectedSale as any).total_paid ?? 0))} restantes
              </button>
            )}
            {/* Botón Cancelar (para cualquier venta no cancelada) — solo admin/owner */}
            {selectedSale.status !== 'cancelled' && (user?.role === 'owner' || user?.role === 'admin') && (
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="btn-danger w-full flex items-center justify-center gap-2 py-3 text-base"
              >
                <Ban className="w-5 h-5" />
                Cancelar venta
              </button>
            )}
          </div>
        )}
      </Modal>

      {/* Pay Sale Modal */}
      <Modal open={showPaySale} onClose={() => setShowPaySale(false)} title={`Registrar pago — ${String(selectedSale?.customer_name ?? '')}`} size="sm">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-[#0d1117] rounded-xl border border-[#21262d] text-sm">
              <p className="text-xs text-[#6e7681]">Total venta</p>
              <p className="text-[#e6edf3] font-semibold">{formatCurrency(Number(selectedSale?.total ?? 0))}</p>
            </div>
            <div className="p-3 bg-[#0d1117] rounded-xl border border-[#21262d] text-sm">
              <p className="text-xs text-[#6e7681]">Pagado</p>
              <p className="text-green-400 font-semibold">{formatCurrency(Number((selectedSale as any)?.total_paid ?? 0))}</p>
            </div>
          </div>
          <div><label className="label">Monto a cobrar *</label><input type="number" min="0.01" step="0.01" className="input" value={paySaleForm.amount || ''} onChange={e => setPaySaleForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))} /></div>
          <div><label className="label">Método</label>
            <select className="input" value={paySaleForm.method} onChange={e => setPaySaleForm(f => ({ ...f, method: e.target.value }))}>
              <option value="cash">Efectivo</option>
              <option value="transfer">Transferencia</option>
              <option value="mixed">Mixto</option>
            </select>
          </div>
          <div><label className="label">Notas</label><input className="input" value={paySaleForm.notes} onChange={e => setPaySaleForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div className="flex gap-3">
            <button onClick={() => setShowPaySale(false)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={handlePaySale} disabled={paySaleSaving || paySaleForm.amount <= 0} className="btn-primary flex-1 disabled:opacity-50">
              {paySaleSaving ? 'Registrando...' : <span className="flex items-center justify-center gap-2"><CheckCircle className="w-4 h-4" />Confirmar pago</span>}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Cancel Sale — solo admin/owner */}
      <ConfirmDialog
        open={showCancelConfirm}
        onClose={() => setShowCancelConfirm(false)}
        onConfirm={handleCancelSale}
        title="Cancelar venta"
        message={`¿Estás seguro de cancelar esta venta por ${formatCurrency(Number(selectedSale?.total ?? 0))}? Se restaurará el inventario y, si es crédito, se ajustará el saldo del cliente. Esta acción no se puede deshacer.`}
        confirmLabel={cancelling ? 'Cancelando...' : 'Sí, cancelar venta'}
        loading={cancelling}
      />
    </div>
  );
}