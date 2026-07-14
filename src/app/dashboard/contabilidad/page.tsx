'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatCurrency, formatDateTime, cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { toast } from '@/components/ui/toaster';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import Pagination from '@/components/ui/Pagination';
import InfoTooltip from '@/components/ui/Tooltip';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import {
  DollarSign, ArrowUpRight, ArrowDownRight,
  Wallet, Banknote, TrendingUp, TrendingDown,
  Settings, Plus, History, Search, Info,
} from 'lucide-react';

type R = Record<string, unknown>;

export default function ContabilidadPage() {
  const [data, setData] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showInitialModal, setShowInitialModal] = useState(false);
  const [showCapitalModal, setShowCapitalModal] = useState(false);
  const [adjustForm, setAdjustForm] = useState({
    type: 'adjustment' as 'initial' | 'adjustment',
    cash_amount: 0,
    transfer_amount: 0,
    notes: '',
  });
  const [initialForm, setInitialForm] = useState({
    cash_amount: 0,
    transfer_amount: 0,
    notes: '',
  });
  const [capitalForm, setCapitalForm] = useState({
    cash_amount: 0,
    transfer_amount: 0,
    notes: '',
  });
  const [entries, setEntries] = useState<R[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState<'total' | 'week' | 'month' | '90days' | 'custom'>('total');
  const todayForDate = new Date();
  const fmtDateLocal = (d: Date) => d.toISOString().slice(0, 10);
  const firstOfMonth = new Date(todayForDate.getFullYear(), todayForDate.getMonth(), 1);
  const [fromDate, setFromDate] = useState(fmtDateLocal(firstOfMonth));
  const [toDate, setToDate] = useState(fmtDateLocal(todayForDate));

  const load = useCallback(async () => {
    try {
      const acctPromise = periodFilter === 'custom'
        ? api.getAccounting(`from=${fromDate}&to=${toDate}`)
        : api.getAccounting();
      const [acct, reg] = await Promise.all([
        acctPromise as Promise<R>,
        api.getCashRegister() as Promise<R[]>,
      ]);
      setData(acct);
      setEntries(reg);
    } catch (e) {
      if (e instanceof Error) toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [periodFilter, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);
  // Reset page when data or search changes
  useEffect(() => { setPage(1); }, [data]);
  useEffect(() => { setPage(1); }, [search]);

  async function handleInitialBalance() {
    if (!initialForm.cash_amount && !initialForm.transfer_amount) {
      toast.error('Debes ingresar al menos un monto');
      return;
    }
    try {
      await api.createCashRegisterEntry({
        type: 'initial',
        cash_amount: initialForm.cash_amount,
        transfer_amount: initialForm.transfer_amount,
        notes: initialForm.notes || 'Saldo inicial',
      });
      toast.success('Saldo inicial registrado');
      setShowInitialModal(false);
      setInitialForm({ cash_amount: 0, transfer_amount: 0, notes: '' });
      load();
    } catch (e) {
      if (e instanceof Error) toast.error(e.message);
    }
  }

  async function handleCapitalInjection() {
    if (!capitalForm.cash_amount && !capitalForm.transfer_amount) {
      toast.error('Debes ingresar al menos un monto');
      return;
    }
    if (capitalForm.cash_amount < 0 || capitalForm.transfer_amount < 0) {
      toast.error('Los montos no pueden ser negativos');
      return;
    }
    try {
      await api.createCashRegisterEntry({
        type: 'capital',
        cash_amount: capitalForm.cash_amount,
        transfer_amount: capitalForm.transfer_amount,
        notes: capitalForm.notes || 'Aporte de capital',
      });
      toast.success('Aporte de capital registrado');
      setShowCapitalModal(false);
      setCapitalForm({ cash_amount: 0, transfer_amount: 0, notes: '' });
      load();
    } catch (e) {
      if (e instanceof Error) toast.error(e.message);
    }
  }

  async function handleAdjustment() {
    if (!adjustForm.cash_amount && !adjustForm.transfer_amount) {
      toast.error('Debes ajustar al menos un monto');
      return;
    }
    try {
      await api.createCashRegisterEntry(adjustForm);
      toast.success('Ajuste registrado');
      setShowAdjustModal(false);
      setAdjustForm({ type: 'adjustment', cash_amount: 0, transfer_amount: 0, notes: '' });
      load();
    } catch (e) {
      if (e instanceof Error) toast.error(e.message);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={DollarSign}
        title="Error al cargar contabilidad"
        description="No se pudieron obtener los datos. Intenta de nuevo."
        action={<button onClick={load} className="btn-primary">Reintentar</button>}
      />
    );
  }

  const cashBalance = Number(data.cash_balance ?? 0);
  const transferBalance = Number(data.transfer_balance ?? 0);
  const totalBalance = Number(data.total_balance ?? 0);
  const todayCashIn = Number(data.today_cash_in ?? 0);
  const todayTransferIn = Number(data.today_transfer_in ?? 0);
  const todayCashOut = Number(data.today_cash_out ?? 0);
  const todayTransferOut = Number(data.today_transfer_out ?? 0);
  const todayNetCash = todayCashIn - todayCashOut;
  const todayNetTransfer = todayTransferIn - todayTransferOut;
  const unclassifiedExpenses = Number(data.unclassified_expenses ?? 0);
  const movements = (data.recent_movements ?? []) as R[];

  // Custom range data (when filter is 'custom')
  const customIncome = Number(data.custom_income ?? 0);
  const customIncomeCash = Number(data.custom_income_cash ?? 0);
  const customIncomeTransfer = Number(data.custom_income_transfer ?? 0);
  const customExpenses = Number(data.custom_expenses ?? 0);
  const customExpensesCash = Number(data.custom_expenses_cash ?? 0);
  const customExpensesTransfer = Number(data.custom_expenses_transfer ?? 0);
  const customFrom = String(data.custom_from ?? '');
  const customTo = String(data.custom_to ?? '');

  const dailyEvolution = (data.daily_evolution ?? []) as R[];
  const maxEvo = dailyEvolution.length
    ? Math.max(...dailyEvolution.flatMap(d => [Number(d.running_cash ?? 0), Number(d.running_transfer ?? 0)]))
    : 0;
  const yMaxEvo = Math.ceil(maxEvo * 1.15 / 1000) * 1000 || 1000;
  const hasInitialBalance = entries.some(e => String(e.type) === 'initial');
  const totalPurchases = Number(data.total_purchases ?? 0);
  const totalCapitalInjected = Number(data.total_capital_injected ?? 0);
  const capitalInjectedCash = Number(data.capital_injected_cash ?? 0);
  const capitalInjectedTransfer = Number(data.capital_injected_transfer ?? 0);

  // Filtro de búsqueda
  const q = search.toLowerCase();
  const filteredMovements = q
    ? movements.filter(m =>
        String(m.type ?? '').toLowerCase().includes(q) ||
        String(m.description ?? '').toLowerCase().includes(q) ||
        String(m.method ?? '').toLowerCase().includes(q)
      )
    : movements;
  const paginatedMovements = pageSize === 0 ? filteredMovements : filteredMovements.slice((page - 1) * pageSize, page * pageSize);

  const chartLabelMap: Record<string, string> = { running_cash: 'Efectivo', running_transfer: 'Transferencia' };

  const ChartTip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    // Find the current day's data entry from dailyEvolution
    const dayEntry = dailyEvolution.find((d: R) => String(d.date) === label);
    return (
      <div className="bg-[#1c2128] border border-[var(--border-secondary)] rounded-xl px-3 py-2.5 text-xs shadow-xl">
        <p className="text-[var(--text-secondary)] mb-1.5 font-medium border-b border-[var(--border-secondary)] pb-1">{label}</p>
        {payload.map((p, i) => (
          <p key={i} className="font-semibold mb-1" style={{ color: p.color }}>
            {chartLabelMap[p.name] ?? p.name}: {formatCurrency(p.value)}
          </p>
        ))}
        {dayEntry && (
          <div className="border-t border-[var(--border-secondary)] pt-1.5 mt-1.5 space-y-0.5 text-[10px] text-[var(--text-tertiary)]">
            <p>Ingresos: +{formatCurrency(Number(dayEntry.cash_in) + Number(dayEntry.transfer_in))}</p>
            <p>Egresos: -{formatCurrency(Number(dayEntry.cash_out) + Number(dayEntry.transfer_out))}</p>
            {(Number(dayEntry.register_cash) !== 0 || Number(dayEntry.register_transfer) !== 0) && (
              <p>Ajustes caja: {formatCurrency(Number(dayEntry.register_cash) + Number(dayEntry.register_transfer))}</p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-brand-400" />
            Contabilidad
          </h1>
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">Libro de caja — efectivo y transferencias</p>
        </div>
        <div className="flex gap-2">
          {!hasInitialBalance && (
            <button onClick={() => setShowInitialModal(true)} className="btn-primary flex items-center gap-1.5 text-sm">
              <Wallet className="w-4 h-4" />Saldo inicial
            </button>
          )}
          <button onClick={() => setShowCapitalModal(true)} className="btn-secondary flex items-center gap-1.5 text-sm">
            <TrendingUp className="w-4 h-4" />Aportar capital
          </button>
          <button onClick={() => setShowAdjustModal(true)} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Settings className="w-4 h-4" />Ajustar
          </button>
          <button onClick={() => setShowHistoryModal(true)} className="btn-secondary flex items-center gap-1.5 text-sm">
            <History className="w-4 h-4" />Historial
          </button>
        </div>
      </div>

      {/* Warning: no initial balance */}
      {!hasInitialBalance && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <Wallet className="w-5 h-5 text-yellow-400 flex-shrink-0" />
          <div>
            <p className="text-sm text-yellow-300 font-medium">Sin saldo inicial</p>
            <p className="text-xs text-[var(--text-secondary)]">Los balances reflejan solo movimientos registrados. Agrega un saldo inicial para mayor precisión.</p>
          </div>
        </div>
      )}

      {/* Warning: unclassified expenses */}
      {unclassifiedExpenses > 0 && (
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <TrendingDown className="w-5 h-5 text-orange-400 flex-shrink-0" />
          <div>
            <p className="text-sm text-orange-300 font-medium">
              {formatCurrency(unclassifiedExpenses)} en gastos sin clasificar
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              Estos gastos no tienen método de pago asignado y no se reflejan en los balances. Edítalos desde la sección Gastos.
            </p>
          </div>
        </div>
      )}

      {/* Balance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">          <div className="card p-5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-green-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-green-500/15 border border-green-500/20 flex items-center justify-center">
                <Banknote className="w-5 h-5 text-green-400" />
              </div>
              <div className="flex items-center gap-1.5">
                <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide font-medium">Efectivo</p>
                <InfoTooltip content="Saldo total calculado desde el primer registro. Incluye: saldo inicial, aportes de capital, ventas, abonos de clientes, gastos y compras de inventario." side="top">
                  <Info className="w-3 h-3 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-help" />
                </InfoTooltip>
              </div>
            </div>
            <p className="text-2xl font-bold text-green-400">${formatCurrency(cashBalance).replace('$', '')}</p>
            <div className="flex items-center gap-2 mt-2 text-xs text-[var(--text-tertiary)]">
              <span className={cn('flex items-center gap-1', todayNetCash >= 0 ? 'text-green-400' : 'text-red-400')}>
                {todayNetCash >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                Hoy: {formatCurrency(Math.abs(todayNetCash))}
              </span>
              <InfoTooltip content="Ingresos menos egresos del día de hoy en efectivo (ventas + abonos de clientes - gastos)." side="bottom">
                <Info className="w-3 h-3 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-help" />
              </InfoTooltip>
            </div>
          </div>

          <div className="card p-5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-blue-400" />
              </div>
              <div className="flex items-center gap-1.5">
                <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide font-medium">Transferencia</p>
                <InfoTooltip content="Saldo total calculado desde el primer registro. Incluye: saldo inicial, aportes de capital, ventas, abonos de clientes, gastos y compras de inventario." side="top">
                  <Info className="w-3 h-3 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-help" />
                </InfoTooltip>
              </div>
            </div>
            <p className="text-2xl font-bold text-blue-400">${formatCurrency(transferBalance).replace('$', '')}</p>
            <div className="flex items-center gap-2 mt-2 text-xs text-[var(--text-tertiary)]">
              <span className={cn('flex items-center gap-1', todayNetTransfer >= 0 ? 'text-blue-400' : 'text-red-400')}>
                {todayNetTransfer >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                Hoy: {formatCurrency(Math.abs(todayNetTransfer))}
              </span>
              <InfoTooltip content="Ingresos menos egresos del día de hoy por transferencia (ventas + abonos de clientes - gastos)." side="bottom">
                <Info className="w-3 h-3 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-help" />
              </InfoTooltip>
            </div>
          </div>

          <div className="card p-5 relative overflow-hidden bg-gradient-to-br from-brand-600/10 to-transparent border-brand-500/20">
            <div className="absolute top-0 right-0 w-24 h-24 bg-brand-500/10 rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-brand-500/15 border border-brand-500/20 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-brand-400" />
              </div>
              <div className="flex items-center gap-1.5">
                <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide font-medium">Total disponible</p>
                <InfoTooltip content="Suma del efectivo y la transferencia disponibles. Incluye todos los movimientos desde el inicio de la contabilidad." side="top">
                  <Info className="w-3 h-3 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-help" />
                </InfoTooltip>
              </div>
            </div>
            <p className="text-2xl font-bold text-brand-400">${formatCurrency(totalBalance).replace('$', '')}</p>
            <p className="text-xs text-[var(--text-tertiary)] mt-2">
              {formatCurrency(cashBalance)} efectivo + {formatCurrency(transferBalance)} transferencia
            </p>
          </div>
      </div>

      {/* Capital & Inventory Investments */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <TrendingDown className="w-4 h-4 text-orange-400" />
          Inversiones en inventario
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-orange-500/5 border border-orange-500/10 rounded-xl p-4">
            <p className="text-xs text-orange-400 font-medium flex items-center gap-1.5 mb-1">
              <TrendingDown className="w-3 h-3" /> Compras totales (reinversión)
            </p>
            <p className="text-lg font-semibold text-orange-400">{formatCurrency(totalPurchases)}</p>
            <p className="text-[10px] text-[var(--text-tertiary)] mt-1">Dinero reinvertido en mercancía</p>
          </div>
          <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl p-4">
            <p className="text-xs text-emerald-400 font-medium flex items-center gap-1.5 mb-1">
              <ArrowUpRight className="w-3 h-3" /> Aportes de capital
            </p>
            <p className="text-lg font-semibold text-emerald-400">{formatCurrency(totalCapitalInjected)}</p>
            <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
              {capitalInjectedCash > 0 ? `Ef: ${formatCurrency(capitalInjectedCash)}` : ''}
              {capitalInjectedCash > 0 && capitalInjectedTransfer > 0 ? ' · ' : ''}
              {capitalInjectedTransfer > 0 ? `Tr: ${formatCurrency(capitalInjectedTransfer)}` : ''}
              {totalCapitalInjected === 0 ? 'Sin aportes registrados' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Today's Flow */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Flujo del día</h3>
          <InfoTooltip content="Ingresos y egresos registrados hoy. Incluye ventas, abonos de clientes y gastos. Los pagos mixtos se dividen 50% efectivo / 50% transferencia." side="top">
            <Info className="w-3.5 h-3.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-help" />
          </InfoTooltip>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-green-500/5 border border-green-500/10 rounded-xl p-4">
            <p className="text-xs text-green-400 font-medium flex items-center gap-1.5 mb-1">
              <ArrowUpRight className="w-3 h-3" /> Efectivo ingreso
            </p>
            <p className="text-lg font-semibold text-green-400">{formatCurrency(todayCashIn)}</p>
          </div>
          <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4">
            <p className="text-xs text-red-400 font-medium flex items-center gap-1.5 mb-1">
              <ArrowDownRight className="w-3 h-3" /> Efectivo egreso
            </p>
            <p className="text-lg font-semibold text-red-400">{formatCurrency(todayCashOut)}</p>
          </div>
          <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-4">
            <p className="text-xs text-blue-400 font-medium flex items-center gap-1.5 mb-1">
              <ArrowUpRight className="w-3 h-3" /> Transfer. ingreso
            </p>
            <p className="text-lg font-semibold text-blue-400">{formatCurrency(todayTransferIn)}</p>
          </div>
          <div className="bg-red-500/5 border border-red-500/10 rounded-xl p-4">
            <p className="text-xs text-red-400 font-medium flex items-center gap-1.5 mb-1">
              <ArrowDownRight className="w-3 h-3" /> Transfer. egreso
            </p>
            <p className="text-lg font-semibold text-red-400">{formatCurrency(todayTransferOut)}</p>
          </div>
        </div>
      </div>

      {/* Daily Evolution Chart */}
      {dailyEvolution.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {periodFilter === 'custom' ? `Evolución del ${customFrom?.slice(5) ?? '—'} al ${customTo?.slice(5) ?? '—'}` : 'Evolución últimos 30 días'}
              </h3>
              <InfoTooltip content="Saldo acumulado día a día durante el periodo seleccionado. El valor final del gráfico coincide exactamente con los saldos mostrados en las tarjetas. Incluye: saldo inicial, aportes, ventas, abonos de clientes, gastos y compras de inventario." side="top">
                <Info className="w-3.5 h-3.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-help" />
              </InfoTooltip>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={dailyEvolution} margin={{ top: 4, right: 4, left: -15, bottom: 0 }}>
              <defs>
                <linearGradient id="gCash" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gTransfer" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#6e7681', fontSize: 10 }}
                tickLine={false}
                tickFormatter={(val: string) => val?.slice(5) ?? ''}
                interval={Math.floor(dailyEvolution.length / 6)}
              />
              <YAxis domain={[0, yMaxEvo]} tickFormatter={(v: number) => v>=1000 ? `${(v/1000).toFixed(1)}k` : String(v)} tick={{ fill: '#6e7681', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTip />} />
              <Legend
                iconSize={10}
                wrapperStyle={{ fontSize: 11, color: '#8b949e' }}
                formatter={(value: string) => {
                  const labels: Record<string, string> = { running_cash: 'Efectivo', running_transfer: 'Transferencia' };
                  return labels[value] ?? value;
                }}
              />
              <Area
                type="monotone"
                dataKey="running_cash"
                name="running_cash"
                stroke="#22c55e"
                strokeWidth={2}
                fill="url(#gCash)"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="running_transfer"
                name="running_transfer"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="url(#gTransfer)"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Period Filter */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 mb-4">
          <span className="text-xs text-[var(--text-secondary)] uppercase tracking-wide font-semibold">Filtrar por periodo</span>
          <div className="flex flex-wrap gap-1">
            {(['total', 'week', 'month', '90days', 'custom'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriodFilter(p)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  periodFilter === p
                    ? 'bg-brand-500/20 text-brand-400 border border-brand-500/30'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[#1c2128] border border-transparent'
                )}
              >
                {p === 'total' ? 'Todo' : p === 'week' ? 'Semana' : p === 'month' ? 'Último mes' : p === '90days' ? '90 días' : 'Personalizado'}
              </button>
            ))}
          </div>
          {periodFilter === 'custom' && (
            <div className="flex items-center gap-2 sm:ml-auto">
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
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="card p-4">
            <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
              Ingresos {periodFilter === 'total' ? 'históricos' : periodFilter === 'week' ? 'última semana' : periodFilter === 'month' ? 'último mes' : periodFilter === '90days' ? 'últimos 90 días' : `del ${customFrom?.slice(5) ?? '—'} al ${customTo?.slice(5) ?? '—'}`}
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">En efectivo</span>
                <span className="text-green-400 font-medium">
                  {formatCurrency(
                    periodFilter === 'total'
                      ? Number(data.total_cash_in ?? 0)
                      : periodFilter === 'custom'
                        ? customIncomeCash
                        : Number(data[`${periodFilter}_income_cash` as keyof R] ?? 0)
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Por transferencia</span>
                <span className="text-blue-400 font-medium">
                  {formatCurrency(
                    periodFilter === 'total'
                      ? Number(data.total_transfer_in ?? 0)
                      : periodFilter === 'custom'
                        ? customIncomeTransfer
                        : Number(data[`${periodFilter}_income_transfer` as keyof R] ?? 0)
                  )}
                </span>
              </div>
              <div className="border-t border-[var(--border-primary)] pt-2 flex justify-between font-semibold">
                <span className="text-[var(--text-primary)]">Total ingresado</span>
                <span className="text-[var(--text-primary)]">
                  {formatCurrency(
                    periodFilter === 'total'
                      ? Number(data.total_cash_in ?? 0) + Number(data.total_transfer_in ?? 0)
                      : periodFilter === 'custom'
                        ? customIncome
                        : Number(data[`${periodFilter}_income` as keyof R] ?? 0)
                  )}
                </span>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <h4 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-3">
              Egresos {periodFilter === 'total' ? 'históricos' : periodFilter === 'week' ? 'última semana' : periodFilter === 'month' ? 'último mes' : periodFilter === '90days' ? 'últimos 90 días' : `del ${customFrom?.slice(5) ?? '—'} al ${customTo?.slice(5) ?? '—'}`}
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">En efectivo</span>
                <span className="text-red-400 font-medium">
                  {formatCurrency(
                    periodFilter === 'total'
                      ? Number(data.total_cash_out ?? 0)
                      : periodFilter === 'custom'
                        ? customExpensesCash
                        : Number(data[`${periodFilter}_expenses_cash` as keyof R] ?? 0)
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-secondary)]">Por transferencia</span>
                <span className="text-red-400 font-medium">
                  {formatCurrency(
                    periodFilter === 'total'
                      ? Number(data.total_transfer_out ?? 0)
                      : periodFilter === 'custom'
                        ? customExpensesTransfer
                        : Number(data[`${periodFilter}_expenses_transfer` as keyof R] ?? 0)
                  )}
                </span>
              </div>
              <div className="border-t border-[var(--border-primary)] pt-2 flex justify-between font-semibold">
                <span className="text-[var(--text-primary)]">Total egresado</span>
                <span className="text-[var(--text-primary)]">
                  {formatCurrency(
                    periodFilter === 'total'
                      ? Number(data.total_cash_out ?? 0) + Number(data.total_transfer_out ?? 0)
                      : periodFilter === 'custom'
                        ? customExpenses
                        : Number(data[`${periodFilter}_expenses` as keyof R] ?? 0)
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Movements */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border-primary)] space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Movimientos recientes</h3>
            <span className="text-xs text-[var(--text-tertiary)]">{filteredMovements.length} de {movements.length} registro(s)</span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              className="input pl-9 text-sm"
              placeholder="Buscar por tipo, descripción o método de pago..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
        {filteredMovements.length === 0 ? (
          <div className="py-12">
            <EmptyState icon={DollarSign} title="Sin movimientos" description="Aún no hay movimientos registrados" />
          </div>
        ) : (
          <div className="divide-y divide-[#21262d]">
            {paginatedMovements.map((m, i) => {
              const type = String(m.type ?? '');
              const method = String(m.method ?? '');
              const description = String(m.description ?? '');
              const totalAmount = Number(m.total_amount ?? 0);
              const cashAmt = Number(m.cash_amount ?? 0);
              const transferAmt = Number(m.transfer_amount ?? 0);
              const isInflow = type === 'Venta' || type === 'Abono cliente' || type === 'Saldo inicial' || type === 'Aporte de capital';
              const isOutflow = type.startsWith('Gasto') || type === 'Compra inventario';

              const TypeIcon = isInflow ? TrendingUp : isOutflow ? TrendingDown : Settings;
              let typeColor = isInflow ? 'text-green-400 bg-green-500/10' :
                isOutflow ? 'text-red-400 bg-red-500/10' :
                'text-brand-400 bg-brand-500/10';

              let methodLabel = '';
              let methodColor = '';
              if (method === 'cash') { methodLabel = 'Efectivo'; methodColor = 'text-green-400 bg-green-500/10 border-green-500/20'; }
              else if (method === 'transfer') { methodLabel = 'Transfer.'; methodColor = 'text-blue-400 bg-blue-500/10 border-blue-500/20'; }
              else if (method === 'mixed') { methodLabel = 'Mixto'; methodColor = 'text-purple-400 bg-purple-500/10 border-purple-500/20'; }
              else if (method === 'register') { methodLabel = 'Caja'; methodColor = 'text-brand-400 bg-brand-500/10 border-brand-500/20'; }
              else if (method === 'credit') { methodLabel = 'Crédito'; methodColor = 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20'; }

              return (
                <div key={String(m.id ?? i)} className="px-5 py-3.5 hover:bg-[#1c2128] transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', typeColor)}>
                      <TypeIcon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-[var(--text-primary)] font-medium truncate">{type}</span>
                        {methodLabel && (
                          <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border', methodColor)}>
                            {methodLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">
                        {description}
                        {(cashAmt > 0 || transferAmt > 0) && method === 'mixed' && (
                          <span className="text-[var(--text-secondary)]">
                            {' · '}Ef: {formatCurrency(cashAmt)} / Tr: {formatCurrency(transferAmt)}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={cn('text-sm font-semibold', isInflow ? 'text-green-400' : isOutflow ? 'text-red-400' : 'text-[var(--text-primary)]')}>
                        {isInflow ? '+' : isOutflow ? '-' : ''}{formatCurrency(totalAmount)}
                      </p>
                      <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">
                        {m.date ? formatDateTime(String(m.date)) : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <Pagination
          currentPage={page}
          totalItems={filteredMovements.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {/* Modal: Saldo Inicial */}
      <Modal open={showInitialModal} onClose={() => setShowInitialModal(false)} title="Registrar saldo inicial">
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">Establece el dinero disponible en caja y banco al inicio de la contabilidad.</p>
          <div>
            <label className="label">Efectivo disponible</label>
            <input type="number" min="0" step="1" className="input"
              value={initialForm.cash_amount || ''}
              onChange={e => setInitialForm(f => ({ ...f, cash_amount: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <div>
            <label className="label">Transferencia disponible</label>
            <input type="number" min="0" step="1" className="input"
              value={initialForm.transfer_amount || ''}
              onChange={e => setInitialForm(f => ({ ...f, transfer_amount: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <div>
            <label className="label">Nota (opcional)</label>
            <input type="text" className="input" placeholder="Ej: Saldo al iniciar el mes"
              value={initialForm.notes}
              onChange={e => setInitialForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="flex flex-col xs:flex-row gap-2 justify-end pt-2">
            <button onClick={() => setShowInitialModal(false)} className="btn-secondary flex-1 xs:flex-none">Cancelar</button>
            <button onClick={handleInitialBalance} className="btn-primary flex-1 xs:flex-none">Guardar saldo inicial</button>
          </div>
        </div>
      </Modal>

      {/* Modal: Aporte de Capital */}
      <Modal open={showCapitalModal} onClose={() => setShowCapitalModal(false)} title="Registrar aporte de capital">
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Registra un aporte de capital del dueño al negocio. Esto incrementará el saldo disponible.
          </p>
          <div>
            <label className="label">Efectivo aportado</label>
            <input type="number" min="0" step="1" className="input"
              value={capitalForm.cash_amount || ''}
              onChange={e => setCapitalForm(f => ({ ...f, cash_amount: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <div>
            <label className="label">Transferencia aportada</label>
            <input type="number" min="0" step="1" className="input"
              value={capitalForm.transfer_amount || ''}
              onChange={e => setCapitalForm(f => ({ ...f, transfer_amount: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <div>
            <label className="label">Nota (opcional)</label>
            <input type="text" className="input" placeholder="Ej: Aporte para nueva mercancía"
              value={capitalForm.notes}
              onChange={e => setCapitalForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="flex flex-col xs:flex-row gap-2 justify-end pt-2">
            <button onClick={() => setShowCapitalModal(false)} className="btn-secondary flex-1 xs:flex-none">Cancelar</button>
            <button onClick={handleCapitalInjection} className="btn-primary flex-1 xs:flex-none">Registrar aporte</button>
          </div>
        </div>
      </Modal>

      {/* Modal: Ajuste */}
      <Modal open={showAdjustModal} onClose={() => setShowAdjustModal(false)} title="Ajuste de caja">
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Registra un ajuste manual (ej: retiro de efectivo, corrección de saldo, ingreso extraordinario).
            Usa valores positivos para agregar y negativos para restar.
          </p>
          <div>
            <label className="label">Ajuste en efectivo</label>
            <input type="number" step="1" className="input" placeholder="Ej: -5000 o 3000"
              value={adjustForm.cash_amount || ''}
              onChange={e => setAdjustForm(f => ({ ...f, cash_amount: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <div>
            <label className="label">Ajuste en transferencia</label>
            <input type="number" step="1" className="input" placeholder="Ej: -5000 o 3000"
              value={adjustForm.transfer_amount || ''}
              onChange={e => setAdjustForm(f => ({ ...f, transfer_amount: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <div>
            <label className="label">Motivo del ajuste</label>
            <input type="text" className="input" placeholder="Ej: Retiro para pago a proveedor"
              value={adjustForm.notes}
              onChange={e => setAdjustForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="flex flex-col xs:flex-row gap-2 justify-end pt-2">
            <button onClick={() => setShowAdjustModal(false)} className="btn-secondary flex-1 xs:flex-none">Cancelar</button>
            <button onClick={handleAdjustment} className="btn-primary flex-1 xs:flex-none">Registrar ajuste</button>
          </div>
        </div>
      </Modal>

      {/* Modal: Historial de ajustes */}
      <Modal open={showHistoryModal} onClose={() => setShowHistoryModal(false)} title="Historial de caja">
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {entries.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)] text-center py-8">Sin registros de caja</p>
          ) : (
            entries.map(e => (
              <div key={String(e.id)} className="bg-[#161b22] rounded-xl p-4 border border-[var(--border-primary)]">
                <div className="flex items-center justify-between mb-2">
                  <span className={cn('badge', String(e.type) === 'initial' ? 'badge-info' : String(e.type) === 'capital' ? 'badge-success' : 'badge-warning')}>
                    {String(e.type) === 'initial' ? 'Saldo inicial' : String(e.type) === 'capital' ? 'Aporte capital' : 'Ajuste'}
                  </span>
                  <span className="text-xs text-[var(--text-tertiary)]">
                    {e.created_at ? formatDateTime(String(e.created_at)) : '—'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-[var(--text-tertiary)] text-xs">Efectivo</span>
                    <p className={cn('font-medium', Number(e.cash_amount) >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {Number(e.cash_amount) >= 0 ? '+' : ''}{formatCurrency(Number(e.cash_amount))}
                    </p>
                  </div>
                  <div>
                    <span className="text-[var(--text-tertiary)] text-xs">Transferencia</span>
                    <p className={cn('font-medium', Number(e.transfer_amount) >= 0 ? 'text-blue-400' : 'text-red-400')}>
                      {Number(e.transfer_amount) >= 0 ? '+' : ''}{formatCurrency(Number(e.transfer_amount))}
                    </p>
                  </div>
                </div>
                {e.notes ? <p className="text-xs text-[var(--text-secondary)] mt-2">{String(e.notes)}</p> : null}
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
