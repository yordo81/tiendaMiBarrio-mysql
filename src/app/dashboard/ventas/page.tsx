'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency, formatMoney, formatDateTime, formatNumber } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { usePosSelector } from '@/hooks/use-pos';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { api } from '@/lib/api-client';
import { notifyShiftSummaryChanged } from '@/lib/shift-events';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import SearchableSelect from '@/components/ui/SearchableSelect';
import Pagination from '@/components/ui/Pagination';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PaySaleModal, { type PayCurrencyOption } from '@/components/sales/PaySaleModal';
import { toast } from '@/components/ui/toaster';
import { printReceipt, buildReceiptFromSale, fetchDefaultTicketPrinter } from '@/lib/receipt';
import { convertAmount, r2 } from '@/lib/currency';
import { ShoppingCart, Plus, Search, Eye, CreditCard, Ban, Printer, Clock3 } from 'lucide-react';

type AnyRecord = Record<string,unknown>;

// Etiqueta compacta de la moneda de una venta (badge de la tabla/detalle)
function saleCurrencyBadge(s: AnyRecord): { label: string; title: string } | null {
  const code = String(s.currency_code ?? '').trim();
  if (!code) return null; // sin moneda = moneda base: no se marca
  const symbol = String(s.currency_symbol ?? '').trim();
  return { label: symbol ? `${symbol} ${code}` : code, title: String(s.currency_name ?? code) };
}

// Formatea un monto con la moneda real de la venta (símbolo y código)
function fmtSaleAmount(s: AnyRecord, amount: number): string {
  return formatMoney(amount, s.currency_symbol ? String(s.currency_symbol) : null, s.currency_code ? String(s.currency_code) : null);
}

// Convierte el total de la venta a la moneda base con la tasa congelada
// (NULL/1 = ya está en base). Para mostrar el equivalente en el detalle.
function saleTotalInBase(s: AnyRecord): number | null {
  const rate = Number(s.exchange_rate ?? 0);
  if (!s.currency_code || !rate || rate === 1) return null;
  return Math.round(Number(s.total) * rate * 100) / 100;
}
const statusLabel: Record<string,string> = { completed:'Pagada', pending:'Pendiente', partial:'Parcial', cancelled:'Cancelada' };
const statusClass: Record<string,string> = { completed:'badge-success', pending:'badge-warning', partial:'badge-info', cancelled:'badge-danger' };

export default function VentasPage() {
  const [sales, setSales] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDetail, setShowDetail] = useState(false);
  const [selectedSale, setSelectedSale] = useState<AnyRecord|null>(null);
  const [showPaySale, setShowPaySale] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [search, setSearch] = useState('');
  // ── Monedas para mostrar tasa en el detalle ──
  type CurrencyOption = PayCurrencyOption & { rateUpdatedAt?: string | null };
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const { workMode } = usePosSelector(false);
  const { user } = useAuthStore();
  const router = useRouter();
  // POS táctil: solo se usa si está activado en Configuración → Operación
  const posEnabled = useSettingsStore(s => s.settings?.enable_touch_pos !== false);

  // Nuevo: redirigir directo al POS táctil cuando aplica; sin modal.
  // Owner, administrador y vendedor registran ventas desde el POS táctil.
  function startNewSale() {
    const canSell = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'seller';
    if (canSell && posEnabled) {
      router.push('/dashboard/ventas/touch');
      return;
    }
    toast.info('No tienes permiso para registrar ventas');
  }

  // Date range filter — default to current month
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
  // Fecha local del navegador (para el rango "hoy" del vendedor en modo días)
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [fromDate, setFromDate] = useState(fmtDate(firstOfMonth));
  const [toDate, setToDate] = useState(fmtDate(today));

  // Filtro por caja (punto de venta); '' = todas, 'none' = sin caja asignada
  const [posFilter, setPosFilter] = useState('');
  const [posList, setPosList] = useState<AnyRecord[]>([]);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // ── Historial propio del vendedor ──────────────────────────────
  // Cada vendedor ve únicamente sus ventas: en modo turnos las de su turno
  // abierto (desde la apertura de la caja), en modo días las de hoy.
  const isSeller = user?.role === 'seller';
  const [myOpenShift, setMyOpenShift] = useState<AnyRecord | null>(null);
  const [myShiftLoaded, setMyShiftLoaded] = useState(false);

  useEffect(() => {
    if (!isSeller || workMode !== 'shifts') {
      setMyOpenShift(null);
      setMyShiftLoaded(true);
      return;
    }
    setMyShiftLoaded(false);
    api.getShifts()
      .then(d => {
        const open = (d.open ?? []) as AnyRecord[];
        // El turno propio: el de la caja asignada al vendedor (o el que él abrió)
        const mine = open.find(s => String(s.pos_id) === String(user?.pos_id ?? ''))
          ?? open.find(s => String(s.user_id) === String(user?.id ?? ''))
          ?? null;
        setMyOpenShift(mine);
      })
      .catch(() => setMyOpenShift(null))
      .finally(() => setMyShiftLoaded(true));
  }, [isSeller, workMode, user?.id, user?.pos_id]);

  const load = useCallback(async () => {
    // En modo turnos, esperar a conocer el turno abierto del vendedor antes
    // de consultar (evita mostrar "sin ventas" mientras se carga el turno).
    if (isSeller && workMode === 'shifts' && !myShiftLoaded) return;
    try {
      const qs = new URLSearchParams({ limit: '200' });
      if (isSeller) {
        // Solo mis ventas, según el modo de trabajo
        qs.set('user_id', String(user?.id ?? ''));
        if (workMode === 'shifts') {
          if (myOpenShift) {
            // Desde la apertura del turno en hora local del negocio (las
            // ventas se guardan en hora local; opened_at de la BD es UTC)
            const opened = String(myOpenShift.opened_at_local ?? myOpenShift.opened_at_raw ?? '');
            if (opened) qs.set('from', opened.slice(0, 19));
          } else {
            // Sin turno abierto no hay ventas del turno que mostrar
            qs.set('from', '9999-01-01');
          }
        } else {
          // Modo días: solo las ventas de hoy (fecha local del navegador)
          const todayStr = localToday();
          qs.set('from', todayStr);
          qs.set('to', todayStr);
        }
      } else {
        qs.set('from', fromDate);
        qs.set('to', toDate);
        if (posFilter) qs.set('pos_id', posFilter);
      }
      const [s] = await Promise.all([api.getSales(qs.toString())]);
      setSales(s);
      // Cargar monedas para el selector de nueva venta
      try {
        const curRes = await fetch('/api/currencies');
        if (curRes.ok) {
          const curData = await curRes.json();
          const rawCurrencies = curData.currencies as { code: string; name: string; symbol: string; is_base: boolean; currency_type?: string; rates: Record<string, number>; usd_rate?: number | null }[];
          const baseCode = rawCurrencies?.find(c => c.is_base)?.code ?? '';
          const ratesUpdatedAt = (curData.rates_updated_at ?? {}) as Record<string, string>;
          setCurrencies((rawCurrencies ?? []).map(c => ({
            code: c.code, name: c.name, symbol: c.symbol, is_base: c.is_base,
            // 'cash' = moneda física (solo efectivo); 'digital' = solo transferencia
            currencyType: c.currency_type === 'digital' ? 'digital' : 'cash',
            rate: c.rates?.[baseCode] ?? 1,
            // Referencia al dólar: 1 USD = X moneda (toda tasa se guarda como fila USD → moneda)
            usdRate: c.usd_rate ?? null,
            rateUpdatedAt: c.is_base ? null : (ratesUpdatedAt[`USD->${c.code}`] ?? null),
          })));
        }
      } catch { /* monedas opcionales */ }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cargar los datos');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, posFilter, isSeller, user?.id, workMode, myOpenShift, myShiftLoaded]);
  useEffect(() => { load(); }, [load]);

  // Rótulo del rango que ve el vendedor (turno abierto o día de hoy)
  const myRangeLabel = workMode === 'shifts'
    ? (myOpenShift
      ? `Turno abierto desde ${String(myOpenShift.opened_at_local ?? myOpenShift.opened_at_raw ?? '').slice(0, 16).replace('T', ' ')}`
      : 'Sin turno abierto — no hay ventas del turno')
    : `Ventas de hoy (${localToday()})`;

  // Cajas para el filtro: se cargan aparte para no bloquear el historial si falla
  useEffect(() => {
    api.getPos().then(setPosList).catch(() => setPosList([]));
  }, []);

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
      notifyShiftSummaryChanged();
      setShowCancelConfirm(false);
      setShowDetail(false);
      setSelectedSale(null);
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Error al cancelar venta'); } finally { setCancelling(false); }
  }

  // Imprime el comprobante del cliente con los datos de una venta ya registrada
  async function printTicketFor(opts: { sale: AnyRecord; items: AnyRecord[]; payMethod: string; cash: number; transfer: number; notes?: string | null; currencyCode?: string | null; currencySymbol?: string | null; exchangeRate?: number | null; baseCurrencyCode?: string | null; baseCurrencySymbol?: string | null; payments?: { method: string; amount: unknown; currency_code?: string | null; currency_symbol?: string | null }[] }) {
    await useSettingsStore.getState().load();
    const s = useSettingsStore.getState().settings;
    try {
      const method = s?.receipt_print_method ?? 'browser';
      // Con varias impresoras registradas, el ticket va a la impresora
      // asignada en Configuración (is_default).
      const printer = method === 'usb' ? await fetchDefaultTicketPrinter() : null;
      await printReceipt(
        buildReceiptFromSale({
          sale: opts.sale,
          items: opts.items,
          businessName: s?.business_name ?? 'TiendaMiBarrio',
          logoUrl: s?.logo_url ?? null,
          payMethod: (opts.payMethod || 'cash') as 'cash' | 'transfer' | 'mixed' | 'credit',
          cash: opts.cash,
          transfer: opts.transfer,
          notes: opts.notes ?? null,
          currencyCode: opts.currencyCode ?? (opts.sale.currency_code ? String(opts.sale.currency_code) : null),
          currencySymbol: opts.currencySymbol ?? (opts.sale.currency_symbol ? String(opts.sale.currency_symbol) : null),
          exchangeRate: opts.exchangeRate ?? (opts.sale.exchange_rate != null ? Number(opts.sale.exchange_rate) : null),
          baseCurrencyCode: opts.baseCurrencyCode ?? null,
          baseCurrencySymbol: opts.baseCurrencySymbol ?? null,
          payments: opts.payments,
        }),
        { method, width: s?.receipt_printer_width ?? '80', printer }
      );
    } catch (e) {
      toast.error(`No se pudo imprimir el ticket: ${e instanceof Error ? e.message : 'error desconocido'}`);
    }
  }

  // Tras registrar un abono desde el asistente: refresca el detalle de la venta
  // (estado, total abonado y abonos) y el listado.
  async function handlePaid() {
    if (!selectedSale) return;
    try {
      const detail = await api.getSaleDetail(String(selectedSale.id));
      setSelectedSale(prev => {
        if (!prev) return prev;
        const paid = Number(detail.total_paid ?? 0);
        // El estado de la venta lo decide el servidor según el total abonado:
        // se refleja aquí para que el botón Cobrar desaparezca al quedar saldada.
        const status = paid + 0.01 >= Number(prev.total ?? 0)
          ? 'completed'
          : paid > 0 ? 'partial' : String(prev.status ?? 'pending');
        return { ...prev, ...detail, items: detail.items, payments: detail.payments, customer_payments: detail.customer_payments, total_paid: detail.total_paid, status };
      });
    } catch { /* el listado se refresca igualmente */ }
    load();
  }

  const filteredSales = sales.filter(s => String(s.customer_name??'').toLowerCase().includes(search.toLowerCase()));
  const paginatedSales = pageSize === 0 ? filteredSales : filteredSales.slice(0, page * pageSize).slice((page - 1) * pageSize);

  // Reset page when search or caja filter changes
  useEffect(() => { setPage(1); }, [search, posFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3 flex-1 w-full sm:w-auto flex-wrap">
          <div className="relative flex-1 min-w-[160px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]"/>
            <input className="input pl-9" placeholder="Buscar ventas..." value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          {isSeller ? (
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-3 py-2">
              <Clock3 className="w-3.5 h-3.5 text-brand-400" />
              <span>{myRangeLabel}</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <label className="text-xs text-[var(--text-secondary)] whitespace-nowrap">Desde</label>
                <input
                  type="date"
                  className="input py-1.5 px-2 text-xs w-36"
                  value={fromDate}
                  onChange={e => { setFromDate(e.target.value); setPage(1); }}
                />
                <label className="text-xs text-[var(--text-secondary)] whitespace-nowrap">Hasta</label>
                <input
                  type="date"
                  className="input py-1.5 px-2 text-xs w-36"
                  value={toDate}
                  onChange={e => { setToDate(e.target.value); setPage(1); }}
                />
              </div>
              {posList.length > 0 && (
                <div className="w-44">
                  <SearchableSelect
                    options={[
                      { value: '', label: 'Todas las cajas' },
                      ...posList.map(p => ({
                        value: String(p.id),
                        label: String(p.name),
                        sublabel: p.location_name ? String(p.location_name) : undefined,
                      })),
                      { value: 'none', label: 'Sin caja asignada' },
                    ]}
                    value={posFilter}
                    onChange={v => { setPosFilter(v); setPage(1); }}
                    placeholder="Filtrar por caja"
                    noResultsMessage="Sin cajas"
                  />
                </div>
              )}
            </>
          )}
        </div>
        <button onClick={startNewSale} className="btn-primary flex items-center gap-2 flex-shrink-0"><Plus className="w-4 h-4"/>Nueva venta</button>
      </div>

      <div className="card overflow-hidden">
        {loading?<div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"/></div>
        :paginatedSales.length===0?<EmptyState icon={ShoppingCart} title="Sin ventas" description="Registra tu primera venta" action={<button onClick={startNewSale} className="btn-primary">Nueva venta</button>}/>:(
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-[var(--border-primary)]">{['Fecha','Cliente','Vendedor',...(workMode==='shifts'?['Caja']:[]),'Total','Tipo','Estado',''].map(h=><th key={h} className="text-left px-4 py-3 text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>{paginatedSales.map(s=>(
                <tr key={String(s.id)} className="border-b border-[var(--border-primary)] last:border-0 table-row-hover">
                  <td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{s.date?formatDateTime(String(s.date)):'—'}</td>
                  <td className="px-4 py-3 text-[var(--text-primary)]">{s.customer_name?String(s.customer_name):<span className="text-[var(--text-tertiary)] italic">Sin cliente</span>}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{s.user_name?String(s.user_name):<span className="text-[var(--text-tertiary)] italic">—</span>}</td>
                  {workMode==='shifts'&&<td className="px-4 py-3 text-[var(--text-secondary)] text-xs">{s.pos_name?String(s.pos_name):<span className="text-[var(--text-tertiary)] italic">—</span>}</td>}
                  <td className="px-4 py-3 text-[var(--text-primary)] font-semibold">
                    {(() => { const b = saleCurrencyBadge(s); return <span className="inline-flex items-center gap-1.5">{fmtSaleAmount(s, Number(s.total))}{b && <span className="inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20" title={b.title}>{b.label}</span>}</span>; })()}
                    {/* Ventas a crédito: lo cobrado y lo que queda pendiente
                        (se actualiza tras cada abono, en cualquier moneda) */}
                    {(s.status === 'pending' || s.status === 'partial' || Number(s.total_paid ?? 0) > 0) && (
                      <div className="mt-0.5 text-[10px] font-normal text-[var(--text-tertiary)]">
                        {(() => {
                          const total = Number(s.total ?? 0);
                          const paid = Number(s.total_paid ?? 0);
                          const left = Math.max(0, Math.round((total - paid) * 100) / 100);
                          return paid > 0
                            ? <>Cobrado {fmtSaleAmount(s, paid)} · Pendiente {fmtSaleAmount(s, left)}</>
                            : <>Pendiente {fmtSaleAmount(s, total)}</>;
                        })()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{s.status==='pending'?'Crédito':'Contado'}</td>
                  <td className="px-4 py-3"><span className={statusClass[String(s.status)]??'badge-info'}>{statusLabel[String(s.status)]??String(s.status)}</span></td>
                  <td className="px-4 py-3"><button onClick={()=>openDetail(s)} className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-brand-400 hover:bg-brand-500/10 transition-colors"><Eye className="w-3.5 h-3.5"/></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <Pagination currentPage={page} totalItems={filteredSales.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {/* Sale Detail Modal */}
      <Modal open={showDetail} onClose={()=>setShowDetail(false)} title="Detalle de venta" size="lg">
        {selectedSale&&(
          <div className="space-y-4">
            <button
              onClick={() => {
                const pays = (selectedSale.payments as AnyRecord[] | undefined) ?? [];
                const pay = pays[0] as AnyRecord | undefined;
                const base = currencies.find(c => c.is_base);
                printTicketFor({
                  sale: selectedSale,
                  items: ((selectedSale.items as AnyRecord[] | undefined) ?? []) as AnyRecord[],
                  payMethod: String(pay?.method ?? 'cash'),
                  cash: pays.length > 1 ? 0 : Number(pay?.amount_cash ?? selectedSale.total ?? 0),
                  transfer: pays.length > 1 ? 0 : Number(pay?.amount_transfer ?? 0),
                  // Cobro dividido: una fila de pago por moneda → desglose en el ticket
                  payments: pays.map(p => ({
                    method: String(p.method ?? 'cash'),
                    amount: Number(p.amount_cash ?? 0) > 0 ? Number(p.amount_cash) : Number(p.amount_transfer ?? 0),
                    // NULL = moneda base → se resuelve al código base para el ticket
                    currency_code: p.currency_code ? String(p.currency_code) : (base?.code ?? null),
                    currency_symbol: currencies.find(c => c.code === String(p.currency_code ?? ''))?.symbol ?? null,
                  })),
                  notes: selectedSale.notes ? String(selectedSale.notes) : null,
                  baseCurrencyCode: base?.code ?? null,
                  baseCurrencySymbol: base?.symbol ?? null,
                });
              }}
              className="btn-secondary w-full flex items-center justify-center gap-2 py-3 text-base"
            >
              <Printer className="w-5 h-5" />
              Imprimir ticket
            </button>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-[var(--bg-primary)] rounded-xl p-3"><p className="text-xs text-[var(--text-tertiary)] mb-1">Fecha</p><p className="text-[var(--text-primary)]">{selectedSale.date?formatDateTime(String(selectedSale.date)):'—'}</p></div>
              <div className="bg-[var(--bg-primary)] rounded-xl p-3"><p className="text-xs text-[var(--text-tertiary)] mb-1">Estado</p><span className={statusClass[String(selectedSale.status)]??'badge-info'}>{statusLabel[String(selectedSale.status)]??String(selectedSale.status)}</span>{(() => { const b = saleCurrencyBadge(selectedSale); return b ? <span className="ml-2 inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20" title={b.title}>{b.label}</span> : null; })()}</div>
              <div className="bg-[var(--bg-primary)] rounded-xl p-3"><p className="text-xs text-[var(--text-tertiary)] mb-1">Cliente</p><p className="text-[var(--text-primary)]">{String(selectedSale.customer_name??'Sin cliente')}</p></div>
              <div className="bg-[var(--bg-primary)] rounded-xl p-3"><p className="text-xs text-[var(--text-tertiary)] mb-1">Total</p>
                <p className="text-[var(--text-primary)] font-semibold">{formatMoney(Number(selectedSale.total), selectedSale.currency_symbol ? String(selectedSale.currency_symbol) : null, selectedSale.currency_code ? String(selectedSale.currency_code) : null)}</p>
                {(() => {
                  // Venta en moneda distinta de la base: tasa (siempre contra
                  // el dólar: 1 USD = X moneda) y equivalente en la base
                  const code = String(selectedSale.currency_code ?? '');
                  const usdRate = Number(selectedSale.usd_rate ?? 0);
                  const inBase = saleTotalInBase(selectedSale);
                  if (!code || !inBase) return null;
                  const base = currencies.find(c => c.is_base);
                  const tasa = usdRate > 0 && usdRate !== 1 ? `Tasa: 1 USD = ${usdRate} ${code} · ` : '';
                  return (
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                      {tasa}≈ {formatMoney(inBase, base?.symbol, base?.code)} en {base?.code ?? 'moneda base'}
                    </p>
                  );
                })()}
                {/* Ventas a crédito: lo abonado y lo pendiente, en la moneda de
                    la venta (los abonos pueden venir en otras monedas) */}
                {(Number((selectedSale as any).total_paid ?? 0) > 0 || selectedSale.status === 'pending' || selectedSale.status === 'partial') && (
                  <p className="text-[11px] mt-1 text-[var(--text-tertiary)]">
                    Cobrado <span className="text-green-400">{fmtSaleAmount(selectedSale, Number((selectedSale as any).total_paid ?? 0))}</span>
                    {' · '}Pendiente <span className="text-yellow-400">{fmtSaleAmount(selectedSale, Math.max(0, r2(Number(selectedSale.total) - Number((selectedSale as any).total_paid ?? 0))))}</span>
                  </p>
                )}
              </div>
            </div>
            {(selectedSale.items as AnyRecord[]|undefined)?.length&&(
              <div>
                <p className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-2">Productos</p>
                <div className="rounded-xl border border-[var(--border-primary)] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-[var(--border-primary)] bg-[var(--bg-primary)]">{['Producto','Cant.','Precio','Subtotal'].map(h=><th key={h} className="px-3 py-2 text-left text-xs font-medium text-[var(--text-tertiary)]">{h}</th>)}</tr></thead>
                    <tbody>{(selectedSale.items as AnyRecord[]).map(item=>{
                      const unitPrice = Number(item.unit_price);
                      const currentPrice = item.current_sale_price != null ? Number(item.current_sale_price) : null;
                      const priceModified = currentPrice != null && !isNaN(currentPrice) && currentPrice !== unitPrice;
                      return (
                      <tr key={String(item.id)} className="border-b border-[var(--border-primary)] last:border-0">
                        <td className="px-3 py-2 text-[var(--text-primary)]">
                          {String(item.product_name??'—')}
                          {priceModified && (
                            <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded px-1.5 py-0.5" title={`Precio original: ${formatCurrency(currentPrice)}`}>✓ Precio modificado</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">{formatNumber(Number(item.quantity),2)}</td>
                        <td className="px-3 py-2">
                          <span className={priceModified ? 'text-yellow-400 font-medium' : 'text-[var(--text-secondary)]'}>{formatCurrency(unitPrice)}</span>
                          {priceModified && (
                            <span className="ml-1 text-[10px] text-[var(--text-tertiary)] line-through">{formatCurrency(currentPrice)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[var(--text-primary)] font-medium">{formatCurrency(Number(item.quantity)*unitPrice)}</td>
                      </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              </div>
            )}
            {/* Payment method info */}
            {(selectedSale.payments as AnyRecord[]|undefined)?.map(pay=>{
              const methodName = pay.method === 'transfer' ? 'Transferencia' : pay.method === 'mixed' ? 'Mixto' : pay.method === 'credit' ? 'Crédito' : 'Efectivo';
              // Moneda del pago: NULL en la BD = moneda base. Se muestra UNA sola
              // vez (como código) en la etiqueta, sin repetir símbolo y código.
              const payCode = String(pay.currency_code ?? '').trim() || (currencies.find(c => c.is_base)?.code ?? '');
              return (
                <div key={String(pay.id)} className="flex justify-between items-center text-sm p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)]">
                  <span className="text-[var(--text-secondary)]">{methodName}{payCode ? ` · ${payCode}` : ''}</span>
                  <span className="text-[var(--text-primary)] font-medium">{pay.method==='mixed'?`Ef: ${formatCurrency(Number(pay.amount_cash))} / Tr: ${formatCurrency(Number(pay.amount_transfer))}`:formatCurrency(Number(pay.amount_cash)+Number(pay.amount_transfer))}</span>
                </div>
              );
            })}
            {/* Abonos vinculados */}
            {(selectedSale as any).customer_payments?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-2">Abonos recibidos</p>
                <div className="space-y-2">
                  {(selectedSale as any).customer_payments.map((cp: AnyRecord) => {
                    // El abono puede venir en cualquier moneda; se muestra con su
                    // código y, si difiere, su equivalente en la moneda de la venta.
                    const baseCode = currencies.find(c => c.is_base)?.code ?? '';
                    const cpCode = String(cp.currency_code ?? '').trim() || baseCode;
                    const saleCode = String(selectedSale.currency_code ?? '').trim() || baseCode;
                    const cpSym = currencies.find(c => c.code === cpCode)?.symbol ?? null;
                    const amount = Number(cp.amount ?? 0);
                    const eq = cpCode === saleCode ? null : convertAmount(amount, cpCode, saleCode, currencies);
                    return (
                    <div key={String(cp.id)} className="flex justify-between items-center text-sm p-3 bg-green-500/5 rounded-xl border border-green-500/20">
                      <div>
                        <span className="text-green-400 font-medium">{formatMoney(amount, cpSym, cpCode || null)}</span>
                        {eq != null && (
                          <span className="text-[10px] text-[var(--text-tertiary)] ml-1.5">
                            ≈ {formatMoney(eq, currencies.find(c => c.code === saleCode)?.symbol, saleCode)} en {saleCode}
                          </span>
                        )}
                        <span className="text-xs text-[var(--text-tertiary)] ml-2">{cp.date ? formatDateTime(String(cp.date)) : '—'} · {String(cp.method)}</span>
                      </div>
                      {cp.notes ? <span className="text-xs text-[var(--text-secondary)]">{String(cp.notes)}</span> : null}
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Botón Cobrar si está pendiente/parcial */}
            {(selectedSale.status === 'pending' || selectedSale.status === 'partial') && !!selectedSale.customer_id && (
              <button
                onClick={() => setShowPaySale(true)}
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

      {/* Asistente de cobro paso a paso (igual que el POS táctil) */}
      <PaySaleModal
        open={showPaySale}
        sale={selectedSale}
        currencies={currencies}
        onClose={() => setShowPaySale(false)}
        onPaid={handlePaid}
      />

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