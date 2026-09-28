'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Check, Banknote, Landmark, Wallet, Coins, ChevronLeft, ChevronRight,
  CheckCircle, Phone, PhoneOff, Receipt,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { toast } from '@/components/ui/toaster';
import { formatMoney, cn } from '@/lib/utils';
import { normalizePhone } from '@/lib/validate';
import { api } from '@/lib/api-client';
import { notifyShiftSummaryChanged } from '@/lib/shift-events';
import { convertAmount, roundToNickel, r2 } from '@/lib/currency';

// ── Cobro de una venta pendiente (paso a paso) ─────────────────────
// Replica el asistente de cobro del POS táctil (/dashboard/ventas/touch):
// 1) Método de pago · 2) Moneda de pago · 3) Recibido · 4) Resumen.
// La deuda se sigue en la moneda de la venta; el cliente puede abonar en
// cualquiera de las monedas activas (físicas o digitales) o con un pago
// mixto (efectivo + transferencia). El servidor congela la tasa y convierte
// el abono a la moneda de la deuda.

type AnyRecord = Record<string, unknown>;

/** Moneda tal como la consumen el POS y los reportes (rate = 1 unidad = X base). */
export interface PayCurrencyOption {
  code: string;
  name: string;
  symbol: string;
  is_base: boolean;
  currencyType: 'cash' | 'digital';
  rate: number;
  usdRate?: number | null;
}

interface PaySaleModalProps {
  open: boolean;
  /** Venta seleccionada: requiere id, total, total_paid y currency_code. */
  sale: AnyRecord | null;
  currencies: PayCurrencyOption[];
  onClose: () => void;
  /** Tras registrar el abono (el padre recarga el detalle y el listado). */
  onPaid: () => void;
}

type PayMethod = 'cash' | 'transfer' | 'mixed';

const PAY_METHODS: { id: PayMethod; label: string; icon: typeof Banknote; desc: string }[] = [
  { id: 'cash', label: 'Efectivo', icon: Banknote, desc: 'Billetes o monedas' },
  { id: 'transfer', label: 'Transferencia', icon: Landmark, desc: 'Pago bancario' },
  { id: 'mixed', label: 'Mixto', icon: Wallet, desc: 'Efectivo + transferencia' },
];

const STEPS = [
  { n: 1, label: 'Método' },
  { n: 2, label: 'Moneda' },
  { n: 3, label: 'Recibido' },
  { n: 4, label: 'Resumen' },
];

export default function PaySaleModal({ open, sale, currencies, onClose, onPaid }: PaySaleModalProps) {
  const [step, setStep] = useState(1);
  const [method, setMethod] = useState<PayMethod>('cash');
  // '' = moneda base (igual que en el POS)
  const [payCurrency, setPayCurrency] = useState('');
  // null = usar el resto pendiente por defecto (el usuario aún no lo edita)
  const [amountInput, setAmountInput] = useState<number | null>(null);
  const [cashReceived, setCashReceived] = useState(0);
  const [amountTransfer, setAmountTransfer] = useState(0);
  const [transferPhone, setTransferPhone] = useState('');
  const [transferRef, setTransferRef] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const baseCurrency = currencies.find(c => c.is_base) ?? null;
  const saleCurrencyCode = sale?.currency_code ? String(sale.currency_code).toUpperCase() : (baseCurrency?.code ?? '');
  const saleCurrency = currencies.find(c => c.code === saleCurrencyCode) ?? baseCurrency;

  // Resto pendiente de la venta, en la moneda de la venta.
  const remainingSale = r2(Math.max(0, Number(sale?.total ?? 0) - Number(sale?.total_paid ?? 0)));

  const activeCurrencies = useMemo(
    () => currencies.filter(c => c.is_base || Number(c.rate) > 0),
    [currencies]
  );

  // Las monedas se filtran por método (físicas → efectivo, digitales →
  // transferencia, mixto → ambas), igual que en el POS táctil.
  const stepCurrencies = useMemo(() => {
    if (method === 'cash') return activeCurrencies.filter(c => c.currencyType === 'cash');
    if (method === 'transfer') return activeCurrencies.filter(c => c.currencyType === 'digital');
    return activeCurrencies;
  }, [activeCurrencies, method]);

  const payCode = payCurrency || (baseCurrency?.code ?? '');
  const payOption = currencies.find(c => c.code === payCode) ?? baseCurrency;
  // Resto pendiente expresado en la moneda de pago. Al convertir entre monedas
  // se redondea hacia arriba al múltiplo de 0.05 (no hay monedas de 1 centavo);
  // en la moneda de la deuda se respeta el monto exacto, sin sobrecobrar.
  const amountDue = payCode === saleCurrencyCode
    ? remainingSale
    : roundToNickel(convertAmount(remainingSale, saleCurrencyCode, payCode, currencies));
  const chargeAmount = amountInput ?? amountDue;
  const fmtMoney = (n: number) => formatMoney(n, payOption?.symbol, payOption?.code);

  // Al abrir: arranca en el paso 1, con la moneda de la venta (la deuda) y sin
  // montos capturados. Cada apertura parte de cero.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setMethod('cash');
    setPayCurrency(sale?.currency_code ? String(sale.currency_code).toUpperCase() : '');
    setAmountInput(null);
    setCashReceived(0);
    setAmountTransfer(0);
    setTransferPhone('');
    setTransferRef('');
    setNotes('');
  }, [open, sale?.id, sale?.currency_code]);

  const transferPhoneNormalized = transferPhone.trim() ? normalizePhone(transferPhone) : '';
  const transferPhoneValid = !!transferPhoneNormalized && /^(\+?53)?5\d{7}$/.test(transferPhoneNormalized);
  const hasTransfer = method === 'transfer' || method === 'mixed';

  // Parte en efectivo del cobro (efectivo: todo; mixto: el resto tras la transferencia).
  const cashPart = method === 'cash' ? chargeAmount : r2(Math.max(0, chargeAmount - amountTransfer));
  const change = r2(cashReceived - cashPart);
  // El efectivo recibido debe cubrir la parte en efectivo del cobro (±0.01):
  // se exige siempre que el método incluya efectivo. Sin registrarlo (0) no
  // se puede confirmar el abono.
  const cashCovers = method === 'transfer' || r2(cashReceived + 0.01) >= cashPart;
  const insufficientCash = (method === 'cash' || method === 'mixed') && !cashCovers;

  /** Elige el método y deja la moneda en una válida para ese método. */
  function pickMethod(next: PayMethod) {
    setMethod(next);
    setAmountInput(null);
    setCashReceived(0);
    setAmountTransfer(0);
    const allowed = next === 'cash'
      ? activeCurrencies.filter(c => c.currencyType === 'cash')
      : next === 'transfer'
        ? activeCurrencies.filter(c => c.currencyType === 'digital')
        : activeCurrencies;
    const values = allowed.map(c => (c.is_base ? '' : c.code));
    if (!values.includes(payCurrency)) setPayCurrency(allowed[0] ? (allowed[0].is_base ? '' : allowed[0].code) : '');
  }

  function pickCurrency(value: string) {
    setPayCurrency(value);
    setAmountInput(null);
  }

  /** Valida lo imprescindible antes de avanzar de paso. */
  function requestStep(next: number) {
    if (next > 2) {
      // La moneda debe ser válida para el método (físicas → efectivo,
      // digitales → transferencia) aunque se salte un paso desde el encabezado.
      const allowed = stepCurrencies.map(c => (c.is_base ? '' : c.code));
      if (allowed.length > 0 && !allowed.includes(payCurrency)) {
        toast.error('Selecciona una moneda válida para el método de pago');
        return;
      }
      if (chargeAmount <= 0) { toast.error('El monto a cobrar debe ser mayor a 0'); return; }
      if (chargeAmount > amountDue + 0.01) {
        toast.error(`El monto supera la deuda pendiente (${fmtMoney(amountDue)})`);
        return;
      }
      if (hasTransfer && transferPhone.trim() && !transferPhoneValid) {
        toast.error('Ingresa un teléfono celular válido (Ej: +53 55280263)');
        return;
      }
      if (transferRef.trim() && !/^[A-Za-z0-9]{1,13}$/.test(transferRef.trim())) {
        toast.error('El ID de pago solo puede contener letras y números (máximo 13)');
        return;
      }
    }
    if (next > 3 && method === 'mixed' && (amountTransfer <= 0 || amountTransfer >= chargeAmount)) {
      toast.error('Indica un monto de transferencia menor que el monto a cobrar');
      return;
    }
    // El efectivo recibido debe cubrir la parte en efectivo: sin dinero
    // suficiente no se avanza al resumen ni se confirma el abono.
    if (next > 3 && insufficientCash) {
      toast.error(`El efectivo recibido no cubre lo debido. Faltan ${fmtMoney(Math.max(0, r2(cashPart - cashReceived)))}`);
      return;
    }
    setStep(next);
  }

  function close() {
    setStep(1);
    onClose();
  }

  async function handleConfirm() {
    if (!sale) return;
    // Defensa extra: sin efectivo suficiente no se registra el abono.
    if (insufficientCash) {
      toast.error(`El efectivo recibido no cubre lo debido. Faltan ${fmtMoney(Math.max(0, r2(cashPart - cashReceived)))}`);
      return;
    }
    setSaving(true);
    try {
      let cash = 0;
      let transfer = 0;
      if (method === 'cash') cash = chargeAmount;
      else if (method === 'transfer') transfer = chargeAmount;
      else { transfer = amountTransfer; cash = cashPart; }

      const transferNotes: string[] = [];
      if (transferRef.trim()) transferNotes.push(`ID pago: ${transferRef.trim().toUpperCase()}`);
      if (transferPhone.trim()) transferNotes.push(`Tel: ${transferPhone.trim()}`);
      const combinedNotes = [notes.trim(), ...transferNotes].filter(Boolean).join(' · ') || null;

      await api.paySale(String(sale.id), {
        parts: [{
          method,
          amount_cash: cash,
          amount_transfer: transfer,
          currency_code: payCurrency || (baseCurrency?.code ?? ''),
        }],
        notes: combinedNotes,
      });
      toast.success('Abono registrado');
      notifyShiftSummaryChanged();
      onPaid();
      close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar el abono');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={close} title={`Cobrar venta — ${String(sale?.customer_name ?? 'Sin cliente')}`} size="xl">
      <div className="space-y-5">
        {/* Encabezado del paso a paso (igual que el POS táctil) */}
        <div className="flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <Fragment key={s.n}>
              {i > 0 && <span className="h-px flex-1 min-w-3" style={{ backgroundColor: step > s.n - 1 ? 'var(--brand-600)' : 'var(--border-primary)' }} />}
              <button
                type="button"
                onClick={() => (step > s.n ? setStep(s.n) : requestStep(s.n))}
                className="flex items-center gap-1.5"
              >
                <span
                  className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors',
                    step === s.n && 'text-white',
                    step > s.n && 'text-white'
                  )}
                  style={
                    step >= s.n
                      ? { backgroundColor: 'var(--brand-600)' }
                      : { backgroundColor: 'var(--bg-muted)', color: 'var(--text-tertiary)' }
                  }
                >
                  {step > s.n ? <Check className="w-3.5 h-3.5" /> : s.n}
                </span>
                <span
                  className={cn('text-[11px] font-semibold uppercase tracking-wide', step === s.n ? '' : step > s.n ? 'opacity-80' : 'opacity-60')}
                  style={{ color: step >= s.n ? 'var(--brand-600)' : 'var(--text-tertiary)' }}
                >
                  {s.label}
                </span>
              </button>
            </Fragment>
          ))}
        </div>

        {/* Deuda pendiente: desde el paso 3, donde se declaran los montos */}
        {step >= 3 && (
          <div className="rounded-xl border p-3" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
            <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Deuda pendiente</p>
            <p className="text-2xl font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
              {formatMoney(remainingSale, saleCurrency?.symbol, saleCurrency?.code)}
            </p>
            {payCode !== saleCurrencyCode && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                ≈ {formatMoney(amountDue, payOption?.symbol, payOption?.code)} en {payOption?.code ?? 'base'}
              </p>
            )}
          </div>
        )}

        {/* ── PASO 1: método de pago ── */}
        {step === 1 && (
          <div>
            <label className="label">Método de pago</label>
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-2.5">
              {PAY_METHODS.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pickMethod(m.id)}
                  className={cn(
                    'relative rounded-xl border p-3.5 text-left transition-all active:scale-[0.97]',
                    method === m.id ? 'text-white shadow-lg' : 'hover:brightness-105'
                  )}
                  style={
                    method === m.id
                      ? { backgroundColor: 'var(--brand-600)', borderColor: 'var(--brand-600)', boxShadow: '0 10px 20px -8px color-mix(in srgb, var(--brand-500) 50%, transparent)' }
                      : { backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }
                  }
                >
                  <m.icon className={cn('w-6 h-6 mb-2', method === m.id ? 'text-white' : 'text-brand-400')} />
                  <p className={cn('font-semibold text-sm', method !== m.id && 'text-[var(--text-primary)]')}>{m.label}</p>
                  <p className={cn('text-[10px] mt-0.5', method === m.id ? 'text-white/70' : 'text-[var(--text-tertiary)]')}>{m.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── PASO 2: moneda de pago ── */}
        {step === 2 && (
          stepCurrencies.length > 0 ? (
            <div>
              <label className="label">Moneda de pago</label>
              <p className="text-[10px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
                El cliente puede abonar en cualquiera de las monedas activas. El abono se convierte a la moneda de la deuda.
              </p>
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-2.5">
                {stepCurrencies.map(c => {
                  const value = c.is_base ? '' : c.code;
                  const selected = payCurrency === value;
                  const desc = c.is_base
                    ? 'Moneda base'
                    : c.code === 'USD'
                      ? 'Referencia (dólar)'
                      : c.rate > 0
                        ? `1 USD = ${c.usdRate ?? '—'} ${c.code}`
                        : '';
                  return (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => pickCurrency(value)}
                      className={cn(
                        'relative rounded-xl border p-3.5 text-left transition-all active:scale-[0.97]',
                        selected ? 'text-white shadow-lg' : 'hover:brightness-105'
                      )}
                      style={
                        selected
                          ? { backgroundColor: 'var(--brand-600)', borderColor: 'var(--brand-600)', boxShadow: '0 10px 20px -8px color-mix(in srgb, var(--brand-500) 50%, transparent)' }
                          : { backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }
                      }
                    >
                      <Coins className={cn('w-6 h-6 mb-2', selected ? 'text-white' : 'text-brand-400')} />
                      <p className={cn('font-semibold text-sm', !selected && 'text-[var(--text-primary)]')}>{c.symbol} {c.code}</p>
                      {desc && <p className={cn('text-[10px] mt-0.5', selected ? 'text-white/70' : 'text-[var(--text-tertiary)]')}>{desc}</p>}
                      <span
                        className={cn(
                          'inline-block mt-1.5 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded',
                          selected ? 'bg-white/20 text-white' : 'bg-[var(--bg-muted)] text-[var(--text-tertiary)]'
                        )}
                      >
                        {c.currencyType === 'digital' ? 'Digital' : 'Efectivo'}
                      </span>
                      {selected && (
                        <span className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff' }}>
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {method === 'cash'
                ? 'No hay monedas físicas configuradas: el efectivo se cobra en la moneda base.'
                : method === 'transfer'
                  ? 'No hay monedas digitales configuradas: crea una moneda con tipo "Digital" en Configuración para cobrar por transferencia.'
                  : 'No hay monedas configuradas.'}
            </p>
          )
        )}

        {/* ── PASO 3: monto y efectivo/transferencia recibidos ── */}
        {step === 3 && (
          <>
            <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
              <div className="flex items-center justify-between">
                <label className="label mb-0">Monto a cobrar en {payOption?.code ?? 'base'}</label>
                <button
                  type="button"
                  onClick={() => setAmountInput(null)}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-lg text-white transition-transform active:scale-95"
                  style={{ backgroundColor: 'var(--brand-600)' }}
                >
                  Resto pendiente
                </button>
              </div>
              <input
                type="number"
                min="0"
                step="0.05"
                className="input text-2xl font-bold text-center"
                placeholder="0.00"
                value={chargeAmount || ''}
                onChange={e => setAmountInput(parseFloat(e.target.value) || 0)}
              />
              {payCode !== saleCurrencyCode && (
                <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  ≈ {formatMoney(r2(convertAmount(chargeAmount, payCode, saleCurrencyCode, currencies)), saleCurrency?.symbol, saleCurrency?.code)} de la deuda
                </p>
              )}
            </div>

            {(method === 'cash' || method === 'mixed') && (
              <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
                <div className="flex items-center justify-between">
                  <label className="label mb-0">Efectivo recibido ({payOption?.code ?? 'base'})</label>
                  <button
                    type="button"
                    onClick={() => setCashReceived(cashPart)}
                    className="text-xs font-medium px-2.5 py-1.5 rounded-lg text-white transition-transform active:scale-95"
                    style={{ backgroundColor: 'var(--brand-600)' }}
                  >
                    Exacto
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="input text-2xl font-bold text-center"
                  placeholder="0.00"
                  value={cashReceived || ''}
                  onChange={e => setCashReceived(parseFloat(e.target.value) || 0)}
                />
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const rate = payOption && !payOption.is_base ? payOption.rate : 0;
                    const denoms: number[] = !rate
                      ? [100, 200, 500, 1000, 2000]
                      : [1, 5, 10, 20, 50, 100].map(v => Math.max(1, Math.round((v / rate) * 100) / 100)).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b).slice(0, 6);
                    return denoms.map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setCashReceived(v => Math.round(((v || 0) + d) * 100) / 100)}
                        className="px-3.5 py-2 rounded-lg text-sm font-semibold transition-transform active:scale-95"
                        style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
                      >
                        +{fmtMoney(d)}
                      </button>
                    ));
                  })()}
                </div>
                {(cashReceived > 0 || insufficientCash) && (
                  <p className={cn('text-sm font-semibold', change >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {change >= 0 ? `Cambio: ${fmtMoney(change)}` : `Faltan: ${fmtMoney(-change)}`}
                  </p>
                )}
              </div>
            )}

            {method === 'mixed' && (
              <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
                <label className="label mb-0">Monto por transferencia</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="input text-2xl font-bold text-center"
                  placeholder="0.00"
                  value={amountTransfer || ''}
                  onChange={e => setAmountTransfer(parseFloat(e.target.value) || 0)}
                />
                {amountTransfer > 0 && amountTransfer < chargeAmount && (
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                    El resto ({fmtMoney(cashPart)}) se cobra en efectivo.
                  </p>
                )}
                {amountTransfer >= chargeAmount && (
                  <p className="text-sm font-semibold text-yellow-400">⚠ La transferencia no puede cubrir más del monto a cobrar.</p>
                )}
              </div>
            )}

            {method === 'transfer' && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                Se cobrarán {fmtMoney(chargeAmount)} por transferencia bancaria. El teléfono del cliente es opcional.
              </div>
            )}

            {hasTransfer && (
              <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
                <p className="label mb-0">Datos de la transferencia</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label">Teléfono celular del cliente (opcional)</label>
                    <div className="relative">
                      {transferPhone.trim() ? (
                        transferPhoneValid
                          ? <CheckCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-400" />
                          : <PhoneOff className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400" />
                      ) : (
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
                      )}
                      <input
                        type="tel"
                        inputMode="tel"
                        className={`input pl-10 ${transferPhone.trim() ? (transferPhoneValid ? 'border-green-500/50 focus:border-green-500' : 'border-amber-500/50 focus:border-amber-500') : ''}`}
                        placeholder="Ej: +53 55280263"
                        value={transferPhone}
                        maxLength={20}
                        onChange={e => setTransferPhone(e.target.value)}
                      />
                    </div>
                    {transferPhone.trim() && (
                      <p className={`text-[10px] mt-1 ${transferPhoneValid ? 'text-green-400' : 'text-amber-400'}`}>
                        {transferPhoneValid ? 'Teléfono válido' : 'Formato inválido. Ejemplo: +53 55280263'}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="label">ID de pago</label>
                    <input
                      className="input font-mono uppercase"
                      placeholder="Ej: BHD1234567890"
                      value={transferRef}
                      maxLength={13}
                      onChange={e => setTransferRef(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
                    />
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="label">Notas (opcional)</label>
              <input className="input" placeholder="Observaciones del abono" value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </>
        )}

        {/* ── PASO 4: resumen ── */}
        {step === 4 && (
          <div className="rounded-xl border p-4 space-y-2.5" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
            <p className="label mb-0 flex items-center gap-2"><Receipt className="w-4 h-4" /> Resumen del abono</p>
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: 'var(--text-tertiary)' }}>Método de pago</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{PAY_METHODS.find(m => m.id === method)?.label ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: 'var(--text-tertiary)' }}>Moneda</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{payOption?.symbol} {payOption?.code}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span style={{ color: 'var(--text-tertiary)' }}>Monto a cobrar</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmtMoney(chargeAmount)}</span>
            </div>
            {(method === 'cash' || method === 'mixed') && cashReceived > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: 'var(--text-tertiary)' }}>Efectivo recibido</span>
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmtMoney(cashReceived)}</span>
              </div>
            )}
            {method === 'mixed' && amountTransfer > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: 'var(--text-tertiary)' }}>Por transferencia</span>
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmtMoney(amountTransfer)}</span>
              </div>
            )}
            {(method === 'cash' || method === 'mixed') && (cashReceived > 0 || insufficientCash) && (
              <p className={cn('text-sm font-semibold', change >= 0 ? 'text-green-400' : 'text-red-400')}>
                {change >= 0 ? `Cambio: ${fmtMoney(change)}` : `Faltan: ${fmtMoney(-change)}`}
              </p>
            )}
            <div className="flex items-center justify-between text-sm pt-1.5 border-t" style={{ borderColor: 'var(--border-primary)' }}>
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Deuda pendiente</span>
              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{formatMoney(remainingSale, saleCurrency?.symbol, saleCurrency?.code)}</span>
            </div>
            {(() => {
              const restSale = r2(convertAmount(chargeAmount, payCode, saleCurrencyCode, currencies));
              const left = r2(Math.max(0, remainingSale - restSale));
              return (
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {left <= 0.01
                    ? 'La venta quedaría saldada tras el abono.'
                    : `Quedarían ${formatMoney(left, saleCurrency?.symbol, saleCurrency?.code)} pendientes.`}
                </p>
              );
            })()}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          {step > 1 ? (
            <button onClick={() => setStep(step - 1)} className="btn-secondary flex-1 py-3.5 text-base flex items-center justify-center gap-1">
              <ChevronLeft className="w-5 h-5" /> Atrás
            </button>
          ) : (
            <button onClick={close} className="btn-secondary flex-1 py-3.5 text-base">Volver</button>
          )}
          {step < 4 ? (
            <button onClick={() => requestStep(step + 1)} className="btn-primary flex-1 py-3.5 text-base flex items-center justify-center gap-1">
              Continuar <ChevronRight className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={saving || chargeAmount <= 0 || insufficientCash}
              className="btn-primary flex-1 py-3.5 text-base disabled:opacity-50"
            >
              {saving ? 'Registrando...' : `Confirmar abono — ${fmtMoney(chargeAmount)}`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
