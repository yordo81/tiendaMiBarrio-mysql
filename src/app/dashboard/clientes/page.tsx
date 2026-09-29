'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatCurrency, formatDateTime, cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { api } from '@/lib/api-client';
import { notifyShiftSummaryChanged } from '@/lib/shift-events';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import PaySaleModal, { type PayCurrencyOption } from '@/components/sales/PaySaleModal';
import { toast } from '@/components/ui/toaster';
import { Users, Plus, Search, Edit2, CreditCard, History, ShoppingCart, Trash2, Phone, PhoneOff, CheckCircle, ToggleLeft, ToggleRight } from 'lucide-react';
type R = Record<string,unknown>;

const PHONE_REGEX = /^(\+?53)?[\s.-]?\d{7,8}$/;
// Moneda tal como la consume el asistente de cobro (igual que en ventas)
type CurrencyOption = PayCurrencyOption & { rateUpdatedAt?: string | null };

export default function ClientesPage() {
  const { user } = useAuthStore();
  const [customers, setCustomers] = useState<R[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [editCustomer, setEditCustomer] = useState<R|null>(null);
  const [deleteTarget, setDeleteTarget] = useState<R|null>(null);
  const [deleting, setDeleting] = useState(false);
  // Abonos con el mismo asistente de cobro del POS táctil (PaySaleModal en
  // modo deuda de cliente). Abre siempre sobre el saldo general del cliente.
  const [payTarget, setPayTarget] = useState<R|null>(null);
  const [history, setHistory] = useState<R[]>([]);
  const [histTarget, setHistTarget] = useState<R|null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name:'', phone:'', notes:'' });
  const [phoneTouched, setPhoneTouched] = useState(false);

  const canDelete = user?.role === 'owner' || user?.role === 'admin';
  // Monedas activas para el asistente de cobro (mismo formato que en ventas).
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => { const d = await api.getCustomers({ includeInactive: true }); setCustomers(d); setLoading(false); }, []);
  useEffect(() => { load(); }, [load]);

  // Monedas para el asistente de cobro (físicas/digitales y tasas), igual
  // que las carga la página de ventas.
  useEffect(() => {
    let alive = true;
    fetch('/api/currencies').then(r => r.json()).then(d => {
      if (!alive) return;
      const raw = d.currencies as { code: string; name: string; symbol: string; is_base: boolean; currency_type?: string; rates: Record<string, number>; usd_rate?: number | null }[];
      const baseCode = raw?.find(c => c.is_base)?.code ?? '';
      const ratesUpdatedAt = (d.rates_updated_at ?? {}) as Record<string, string>;
      setCurrencies((raw ?? []).map(c => ({
        code: c.code, name: c.name, symbol: c.symbol, is_base: c.is_base,
        // 'cash' = moneda física (solo efectivo); 'digital' = solo transferencia
        currencyType: c.currency_type === 'digital' ? 'digital' : 'cash',
        rate: c.rates?.[baseCode] ?? 1,
        usdRate: c.usd_rate ?? null,
        rateUpdatedAt: c.is_base ? null : (ratesUpdatedAt[`USD->${c.code}`] ?? null),
      })));
    }).catch(() => { /* monedas opcionales */ });
    return () => { alive = false; };
  }, []);

  async function handleSave() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editCustomer) await api.updateCustomer({ id: editCustomer.id, ...form });
      else await api.createCustomer(form);
      toast.success(editCustomer?'Cliente actualizado':'Cliente creado'); setShowModal(false); load();
    } catch(e) { toast.error(e instanceof Error?e.message:'Error'); } finally { setSaving(false); setPhoneTouched(false); }
  }

  // Tras registrar el abono con el asistente: refresca el listado (el saldo
  // del cliente ya se actualizó en el servidor).
  function handlePaid() {
    notifyShiftSummaryChanged();
    load();
  }

  async function openHistory(c: R) {
    setHistTarget(c);
    const d = await api.getPayments(String(c.id));
    setHistory(d); setShowHistory(true);
  }

  async function toggleActive(c: R) {
    const newActive = !Boolean(c.active);
    try {
      await api.updateCustomer({ id: c.id, active: newActive });
      toast.success(newActive ? 'Cliente activado' : 'Cliente desactivado');
      load();
    } catch(e) { toast.error(e instanceof Error ? e.message : 'Error'); }
  }

  const filtered = customers.filter(c => {
    const matchSearch = String(c.name).toLowerCase().includes(search.toLowerCase());
    const matchActive = showInactive ? true : Boolean(c.active);
    return matchSearch && matchActive;
  });
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
        <div className="flex items-center gap-2 flex-1 max-w-xs">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]"/><input className="input pl-9" placeholder="Buscar clientes..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <button onClick={()=>setShowInactive(v=>!v)} className={cn('flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors flex-shrink-0', showInactive ? 'bg-brand-600/20 border-brand-600/50 text-brand-400' : 'border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:border-[#6e7681]')}>
            {showInactive ? <ToggleRight className="w-3.5 h-3.5"/> : <ToggleLeft className="w-3.5 h-3.5"/>}
            Inactivos
          </button>
        </div>
        <button onClick={()=>{setEditCustomer(null);setForm({name:'',phone:'',notes:''});setPhoneTouched(false);setShowModal(true);}} className="btn-primary flex items-center gap-2 flex-shrink-0"><Plus className="w-4 h-4"/>Nuevo cliente</button>
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
                    <button onClick={()=>openHistory(c)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-blue-400 hover:bg-blue-500/10 transition-colors" title="Historial"><History className="w-3.5 h-3.5"/></button>
                    {Number(c.balance)>0&&<button onClick={()=>{setPayTarget(c);setShowPayModal(true);}} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-green-400 hover:bg-green-500/10 transition-colors" title="Abonar"><CreditCard className="w-3.5 h-3.5"/></button>}
                    <button onClick={()=>{setEditCustomer(c);setForm({name:String(c.name),phone:String(c.phone??''),notes:String(c.notes??'')});setPhoneTouched(false);setShowModal(true);}} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-brand-400 hover:bg-brand-500/10 transition-colors" title="Editar"><Edit2 className="w-3.5 h-3.5"/></button>
                    <button onClick={()=>toggleActive(c)} className={cn('p-1.5 rounded-lg transition-colors', Boolean(c.active) ? 'text-green-400 hover:text-red-400 hover:bg-red-500/10' : 'text-red-400 hover:text-green-400 hover:bg-green-500/10')} title={Boolean(c.active) ? 'Desactivar' : 'Activar'}>
                      {Boolean(c.active) ? <ToggleRight className="w-3.5 h-3.5"/> : <ToggleLeft className="w-3.5 h-3.5"/>}
                    </button>
                    {canDelete && <button onClick={()=>setDeleteTarget(c)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Eliminar"><Trash2 className="w-3.5 h-3.5"/></button>}
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

      {/* Asistente de cobro paso a paso (igual que el POS táctil): abono al
          saldo general del cliente, en cualquier moneda activa. */}
      <PaySaleModal
        open={showPayModal}
        sale={null}
        customer={payTarget}
        customerBalance={Number(payTarget?.balance ?? 0)}
        currencies={currencies}
        onClose={() => { setShowPayModal(false); setPayTarget(null); }}
        onPaid={handlePaid}
      />

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
