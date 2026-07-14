'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatCurrency, formatDateTime, cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { api } from '@/lib/api-client';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import { toast } from '@/components/ui/toaster';
import { Users, Plus, Search, Edit2, CreditCard, History, ShoppingCart, Trash2, Phone, PhoneOff, CheckCircle } from 'lucide-react';
type R = Record<string,unknown>;

const PHONE_REGEX = /^(\+?53)?[\s.-]?\d{7,8}$/;

export default function ClientesPage() {
  const { user } = useAuthStore();
  const [customers, setCustomers] = useState<R[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editCustomer, setEditCustomer] = useState<R|null>(null);
  const [deleteTarget, setDeleteTarget] = useState<R|null>(null);
  const [deleting, setDeleting] = useState(false);
  const [payTarget, setPayTarget] = useState<R|null>(null);
  const [history, setHistory] = useState<R[]>([]);
  const [histTarget, setHistTarget] = useState<R|null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name:'', phone:'', notes:'' });
  const [phoneTouched, setPhoneTouched] = useState(false);

  const canDelete = user?.role === 'owner' || user?.role === 'admin';
  const [payForm, setPayForm] = useState({ amount:0, method:'cash', notes:'', sale_id:'' });
  const [pendingSales, setPendingSales] = useState<R[]>([]);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => { const d = await api.getCustomers(); setCustomers(d); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editCustomer) await api.updateCustomer({ id: editCustomer.id, ...form });
      else await api.createCustomer(form);
      toast.success(editCustomer?'Cliente actualizado':'Cliente creado'); setShowModal(false); load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); setPhoneTouched(false); }
  }

  async function handlePay() {
    if (!payTarget||payForm.amount<=0) return;
    setSaving(true);
    try {
      await api.addPayment({ customer_id: payTarget.id, amount: payForm.amount, method: payForm.method, notes: payForm.notes, sale_id: payForm.sale_id || null });
      toast.success('Abono registrado'); setShowPayModal(false); setPayTarget(null); setPendingSales([]); load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); }
  }

  async function openHistory(c: R) {
    setHistTarget(c);
    const d = await api.getPayments(String(c.id));
    setHistory(d); setShowHistory(true);
  }

  const filtered = customers.filter(c => String(c.name).toLowerCase().includes(search.toLowerCase()));
  const paginated = pageSize === 0 ? filtered : filtered.slice(0, page * pageSize).slice((page - 1) * pageSize);

  // Reset page when search changes
  useEffect(() => { setPage(1); }, [search]);
  const totalDebt = customers.reduce((a,c) => a+Number(c.balance??0),0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="card p-4"><p className="text-xs text-[var(--text-tertiary)] mb-1">Total clientes</p><p className="text-2xl font-semibold text-[var(--text-primary)]">{customers.length}</p></div>
        <div className="card p-4"><p className="text-xs text-[var(--text-tertiary)] mb-1">Con deuda</p><p className="text-2xl font-semibold text-yellow-400">{customers.filter(c=>Number(c.balance)>0).length}</p></div>
        <div className="card p-4"><p className="text-xs text-[var(--text-tertiary)] mb-1">Total por cobrar</p><p className="text-2xl font-semibold text-red-400">{formatCurrency(totalDebt)}</p></div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-xs"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]"/><input className="input pl-9" placeholder="Buscar clientes..." value={search} onChange={e=>setSearch(e.target.value)}/></div>          <button onClick={()=>{setEditCustomer(null);setForm({name:'',phone:'',notes:''});setPhoneTouched(false);setShowModal(true);}} className="btn-primary flex items-center gap-2 flex-shrink-0"><Plus className="w-4 h-4"/>Nuevo cliente</button>
      </div>
      <div className="card overflow-hidden">
        {loading?<div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
        :paginated.length===0?<EmptyState icon={Users} title="Sin clientes" description="Agrega tu primer cliente" action={<button onClick={()=>setShowModal(true)} className="btn-primary">Agregar</button>}/>:(
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border-primary)]">{['Cliente','Teléfono','Saldo',''].map(h=><th key={h} className="text-left px-4 py-3 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>{paginated.map(c=>(
                <tr key={String(c.id)} className="border-b border-[var(--border-primary)] last:border-0 table-row-hover">
                  <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{String(c.name)}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{String(c.phone??'—')}</td>
                  <td className="px-4 py-3"><span className={cn('font-medium',Number(c.balance)>0?'text-red-400':'text-green-400')}>{formatCurrency(Number(c.balance??0))}</span></td>
                  <td className="px-4 py-3"><div className="flex gap-1">
                    <button onClick={()=>openHistory(c)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-blue-400 hover:bg-blue-500/10 transition-colors"><History className="w-3.5 h-3.5"/></button>
                    {Number(c.balance)>0&&<button onClick={async ()=>{setPayTarget(c);setPayForm({amount:0,method:'cash',notes:'',sale_id:''});const sales = await api.getSales('limit=100');setPendingSales(sales.filter((s:R)=>String(s.customer_id)===String(c.id)&&(s.status==='pending'||s.status==='partial')));setShowPayModal(true);}} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-green-400 hover:bg-green-500/10 transition-colors"><CreditCard className="w-3.5 h-3.5"/></button>}
                    <button onClick={()=>{setEditCustomer(c);setForm({name:String(c.name),phone:String(c.phone??''),notes:String(c.notes??'')});setPhoneTouched(false);setShowModal(true);}} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-brand-400 hover:bg-brand-500/10 transition-colors"><Edit2 className="w-3.5 h-3.5"/></button>
                    {canDelete && <button onClick={()=>setDeleteTarget(c)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="w-3.5 h-3.5"/></button>}
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <Pagination currentPage={page} totalItems={filtered.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      <Modal open={showModal} onClose={()=>{setShowModal(false); setPhoneTouched(false);}} title={editCustomer?'Editar cliente':'Nuevo cliente'} size="sm">
        <div className="space-y-4">
          <div><label className="label">Nombre *</label><input className="input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Nombre del cliente"/></div>
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
          <div><label className="label">Notas</label><input className="input" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Notas opcionales"/></div>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>{setShowModal(false); setPhoneTouched(false);}} className="btn-secondary flex-1">Cancelar</button><button onClick={handleSave} disabled={saving||!form.name.trim()} className="btn-primary flex-1 disabled:opacity-50">{saving?'Guardando...':editCustomer?'Actualizar':'Crear'}</button></div>
        </div>
      </Modal>

      <Modal open={showPayModal} onClose={()=>setShowPayModal(false)} title={`Registrar abono — ${String(payTarget?.name??'')}`} size="sm">
        <div className="space-y-4">
          <div className="p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] text-sm"><p className="text-[var(--text-tertiary)]">Saldo pendiente</p><p className="text-red-400 font-semibold text-lg">{formatCurrency(Number(payTarget?.balance??0))}</p></div>
          <div><label className="label">Vincular a venta (opcional)</label>
            <select className="input" value={payForm.sale_id} onChange={e=>{
              const saleId = e.target.value;
              const sale = pendingSales.find(s => String(s.id) === saleId);
              setPayForm(f => ({
                ...f,
                sale_id: saleId,
                amount: sale ? Number(sale.total) : f.amount,
              }));
            }}>
              <option value="">— Abono general (sin vincular) —</option>
              {pendingSales.map(s => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.date ? formatDateTime(String(s.date)).slice(0,10) : '—'} · {formatCurrency(Number(s.total))} ({String(s.status)})
                </option>
              ))}
            </select>
            {payForm.sale_id && <p className="text-xs text-green-400 mt-1">Al pagar el total, la venta se marcará como completada</p>}
          </div>
          <div><label className="label">Monto del abono *</label><input type="number" min="1" step="1" className="input" value={payForm.amount||''} onChange={e=>setPayForm(f=>({...f,amount:parseFloat(e.target.value)||0}))}/></div>
          <div><label className="label">Método</label>
            <select className="input" value={payForm.method} onChange={e=>setPayForm(f=>({...f,method:e.target.value}))}>
              <option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="mixed">Mixto</option>
            </select>
          </div>
          <div><label className="label">Notas</label><input className="input" value={payForm.notes} onChange={e=>setPayForm(f=>({...f,notes:e.target.value}))}/></div>
          <div className="flex flex-col xs:flex-row gap-2 xs:gap-3"><button onClick={()=>setShowPayModal(false)} className="btn-secondary flex-1">Cancelar</button><button onClick={handlePay} disabled={saving||payForm.amount<=0} className="btn-primary flex-1 disabled:opacity-50">{saving?'Registrando...':'Registrar abono'}</button></div>
        </div>
      </Modal>

      <Modal open={showHistory} onClose={()=>setShowHistory(false)} title={`Historial — ${String(histTarget?.name??'')}`} size="md">
        {history.length===0?<p className="text-center text-[var(--text-tertiary)] py-8 text-sm">Sin abonos registrados</p>:(
          <div className="space-y-2">
            {history.map(p=>(
              <div key={String(p.id)} className="flex justify-between items-center p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] text-sm">
                <div><p className="text-[var(--text-primary)] font-medium">{formatCurrency(Number(p.amount))}</p><p className="text-xs text-[var(--text-tertiary)]">{p.date?formatDateTime(String(p.date)):'—'} · {String(p.method)}{p.sale_id?' · Vinculado a venta':''}</p></div>
                <div className="flex items-center gap-2">{p.sale_id ? <ShoppingCart className="w-3.5 h-3.5 text-brand-400" /> : null}{p.notes ? <p className="text-xs text-[var(--text-secondary)]">{String(p.notes)}</p> : null}</div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleteTarget} onClose={()=>setDeleteTarget(null)} onConfirm={async ()=>{if(!deleteTarget)return;setDeleting(true);try{await api.deleteCustomer(String(deleteTarget.id));toast.success('Cliente eliminado');setDeleteTarget(null);load();}catch(e){toast.error(e instanceof Error?e.message:'Error')}finally{setDeleting(false);}}} title="Eliminar cliente" message={`¿Eliminar "${String(deleteTarget?.name??'')}"? El cliente quedará oculto pero su historial se conserva.`} loading={deleting}/>
    </div>
  );
}
