'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Check, Banknote, Landmark, Wallet, Coins, ChevronLeft, ChevronRight,
  CheckCircle, Phone, PhoneOff, Receipt, Plus, X, Pencil,
} from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { toast } from '@/components/ui/toaster';
import { formatMoney, formatNumber, cn } from '@/lib/utils';
import { normalizePhone } from '@/lib/validate';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/lib/stores/auth-store';
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
  /**
   * Modo deuda de cliente: el abono no va ligado a una venta sino al saldo
   * general del cliente (se ve reflejado en dashboard/clientes).
   */
  customer?: AnyRecord | null;
  /** En modo deuda de cliente: saldo total pendiente del cliente (en moneda base). */
  customerBalance?: number;
  currencies: PayCurrencyOption[];
  /**
   * Detalle de la venta (ítems) para el editor de precios de dueño/admin:
   * mientras se abona una venta a crédito, pueden corregir el precio de
   * venta de cada producto (igual que la oferta). Opcional.
   */
  saleItems?: AnyRecord[] | null;
  /** Tras guardar precios (el padre recarga el detalle y el listado). */
  onPricesSaved?: () => void;
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

/** Venta normal vs deuda general de un cliente (sin venta específica). */
type PayTarget = 'sale' | 'customer';

export default function PaySaleModal({ open, sale, customer = null, customerBalance = 0, currencies, saleItems = null, onPricesSaved, onClose, onPaid }: PaySaleModalProps) {
  const target: PayTarget = customer ? 'customer' : 'sale';
  const { user } = useAuthStore();
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

  // ── Editor de precios (dueño/admin, venta a crédito en curso) ──
  // Igual que la oferta: mientras el cliente abona su deuda, el dueño/admin
  // puede corregir el precio de venta de cada producto. Se edita una copia
  // local y se guarda en el servidor (que recalcula el total y ajusta el
  // saldo del cliente); después el abono sigue con la deuda actualizada.
  const canEditPrices = target === 'sale' && (user?.role === 'owner' || user?.role === 'admin')
    && !!sale && String(sale.status ?? '') !== 'completed' && String(sale.status ?? '') !== 'cancelled'
    && (saleItems?.length ?? 0) > 0;
  const [showPriceEditor, setShowPriceEditor] = useState(false);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [savingPrices, setSavingPrices] = useState(false);
  /** Precio unitario editado (string vacío = sin cambiar). */
  const priceEditsDirty = Object.entries(priceEdits).some(([, v]) => v.trim() !== '');
  const priceEditsTotalDelta = (saleItems ?? []).reduce((a, it) => {
    const raw = priceEdits[String(it.product_id ?? '')] ?? '';
    if (raw.trim() === '') return a;
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return a;
    return a + (v - Number(it.unit_price ?? 0)) * Number(it.quantity ?? 0);
  }, 0);

  /** Al abrir (o cambiar de venta): el editor arranca cerrado y sin cambios. */
  useEffect(() => {
    setShowPriceEditor(false);
    setPriceEdits({});
  }, [open, sale?.id]);

  // ── Abono en varias monedas ─────────────────────────────────────
  // Igual que el POS táctil: con el método mixto y más de una moneda activa,
  // el abono se reparte entre varias monedas (una parte por moneda). El método
  // de cada parte lo fija el tipo de su moneda: física → efectivo, digital →
  // transferencia.
  interface PayPart { currency: string; method: 'cash' | 'transfer'; amount: number }
  const [multiCurrency, setMultiCurrency] = useState(false);
  const [payParts, setPayParts] = useState<PayPart[]>([]);

  const baseCurrency = currencies.find(c => c.is_base) ?? null;
  const saleCurrencyCode = target === 'sale'
    ? (sale?.currency_code ? String(sale.currency_code).toUpperCase() : (baseCurrency?.code ?? ''))
    : (baseCurrency?.code ?? '');
  const saleCurrency = currencies.find(c => c.code === saleCurrencyCode) ?? baseCurrency;

  // Resto pendiente de la venta, en la moneda de la venta. En modo deuda de
  // cliente es el saldo general, siempre en moneda base.
  const remainingSale = target === 'sale'
    ? r2(Math.max(0, Number(sale?.total ?? 0) - Number(sale?.total_paid ?? 0)))
    : r2(Math.max(0, customerBalance));

  const activeCurrencies = useMemo(
    () => currencies.filter(c => c.is_base || Number(c.rate) > 0),
    [currencies]
  );

  const baseCode = baseCurrency?.code ?? '';
  // Con el método mixto y varias monedas activas el abono se cobra en varias
  // monedas, igual que el POS táctil. El resto de métodos cobra en una sola.
  const useMultiCurrencyUI = method === 'mixed' && activeCurrencies.length > 1;
  // Deuda pendiente en moneda base: las partes en varias monedas se suman en
  // base (con las tasas vigentes) para validar que cubren la deuda.
  const remainingBase = r2(convertAmount(remainingSale, saleCurrencyCode, baseCode, currencies));

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
  // montos capturados. En modo deuda de cliente la deuda está en moneda base.
  // Cada apertura parte de cero.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setMethod('cash');
    setPayCurrency(target === 'sale' && sale?.currency_code ? String(sale.currency_code).toUpperCase() : '');
    setAmountInput(null);
    setCashReceived(0);
    setAmountTransfer(0);
    setTransferPhone('');
    setTransferRef('');
    setNotes('');
    setMultiCurrency(false);
    setPayParts([]);
  }, [open, target, sale?.id, sale?.currency_code, customer?.id]);

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

  // ── Abono en varias monedas: cobertura por moneda ──
  /** Monto de una parte expresado en la moneda base. */
  const partBaseAmount = (p: PayPart): number =>
    convertAmount(p.amount, p.currency || baseCode, baseCode, currencies);
  const partialCoveredBase = r2(payParts.reduce((a, p) => a + partBaseAmount(p), 0));
  const partialRemainBase = r2(remainingBase - partialCoveredBase);
  // El abono multi-moneda es válido cuando las partes cubren la deuda (±0.01)
  // y no la sobrepasan (tolerancia por el redondeo al convertir de moneda).
  const partialCovers = partialCoveredBase + 0.01 >= remainingBase;
  const partialOverpay = partialCoveredBase > remainingBase + 0.05;
  // Se cobra una DEUDA (venta pendiente o saldo del cliente): el abono puede
  // ser parcial, igual que al cobrar en una sola moneda. Basta con declarar
  // algún monto (repartido como se quiera entre las monedas) y no pasarse de
  // la deuda; lo que quede se sigue mostrando como pendiente.
  const partialValid = partialCoveredBase > 0 && !partialOverpay;
  /** Resto a cubrir por una parte, expresado en SU moneda (múltiplo de 0.05). */
  function partialPartRemain(idx: number): number {
    const others = r2(payParts.reduce((a, p, i) => a + (i === idx ? 0 : partBaseAmount(p)), 0));
    const code = payParts[idx]?.currency || baseCode;
    return Math.max(0, roundToNickel(convertAmount(r2(remainingBase - others), baseCode, code, currencies)));
  }
  // ¿El cobro incluye transferencia? (para pedir y validar los datos bancarios)
  const usesTransfer = multiCurrency ? payParts.some(p => p.method === 'transfer') : hasTransfer;
  // Monto que este abono cubre de la deuda, en la moneda de la deuda.
  const paidInSale = multiCurrency
    ? r2(convertAmount(partialCoveredBase, baseCode, saleCurrencyCode, currencies))
    : r2(convertAmount(chargeAmount, payCode, saleCurrencyCode, currencies));

  /** Inicializa el abono en varias monedas: la de la deuda y una del tipo opuesto. */
  function initPayParts() {
    const valueOf = (c: PayCurrencyOption) => (c.is_base ? '' : c.code);
    const debtValue = saleCurrencyCode === baseCode ? '' : saleCurrencyCode;
    // Si la moneda de la deuda no está activa, se arranca en la moneda base.
    const primary = activeCurrencies.some(c => valueOf(c) === debtValue) ? debtValue : '';
    const primaryType: 'cash' | 'digital' =
      activeCurrencies.find(c => valueOf(c) === primary)?.currencyType ?? 'cash';
    const methodOf = (t: 'cash' | 'digital'): 'cash' | 'transfer' => (t === 'digital' ? 'transfer' : 'cash');
    // La segunda parte prioriza una moneda del tipo opuesto (efectivo + transferencia).
    const second = activeCurrencies
      .map(c => ({ value: valueOf(c), type: c.currencyType }))
      .filter(c => c.value !== primary)
      .sort((a, b) => (a.type === primaryType ? 1 : 0) - (b.type === primaryType ? 1 : 0))[0];
    setPayParts([
      { currency: primary, method: methodOf(primaryType), amount: 0 },
      { currency: second ? second.value : primary, method: methodOf(second ? second.type : primaryType), amount: 0 },
    ]);
  }

  /** Elige el método y deja la moneda en una válida para ese método. */
  function pickMethod(next: PayMethod) {
    setMethod(next);
    setAmountInput(null);
    setCashReceived(0);
    setAmountTransfer(0);
    // Mixto con varias monedas activas: el abono se cobra en varias monedas,
    // igual que el POS táctil.
    if (next === 'mixed' && activeCurrencies.length > 1) {
      setMultiCurrency(true);
      initPayParts();
    } else {
      setMultiCurrency(false);
      setPayParts([]);
    }
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
      if (multiCurrency) {
        // Abono multi-moneda: al menos una moneda marcada.
        if (payParts.length === 0) { toast.error('Marca al menos una moneda del abono'); return; }
      } else {
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
      }
      // Datos de la transferencia (si el cobro la incluye): el teléfono, si se
      // escribió, debe ser válido y el ID de pago solo letras y números.
      if (usesTransfer && transferPhone.trim() && !transferPhoneValid) {
        toast.error('Ingresa un teléfono celular válido (Ej: +53 55280263)');
        return;
      }
      if (transferRef.trim() && !/^[A-Za-z0-9]{1,13}$/.test(transferRef.trim())) {
        toast.error('El ID de pago solo puede contener letras y números (máximo 13)');
        return;
      }
    }
    if (next > 3) {
      if (multiCurrency) {
        if (partialCoveredBase <= 0) {
          toast.error('Ingresa el monto del abono en al menos una moneda');
          return;
        }
        if (partialOverpay) {
          toast.error(`Los montos superan la deuda pendiente (${formatMoney(remainingBase, baseCurrency?.symbol, baseCurrency?.code)})`);
          return;
        }
      } else {
        if (method === 'mixed' && (amountTransfer <= 0 || amountTransfer >= chargeAmount)) {
          toast.error('Indica un monto de transferencia menor que el monto a cobrar');
          return;
        }
        // El efectivo recibido debe cubrir la parte en efectivo: sin dinero
        // suficiente no se avanza al resumen ni se confirma el abono.
        if (insufficientCash) {
          toast.error(`El efectivo recibido no cubre lo debido. Faltan ${fmtMoney(Math.max(0, r2(cashPart - cashReceived)))}`);
          return;
        }
      }
    }
    setStep(next);
  }

  function close() {
    setStep(1);
    onClose();
  }

  /** Guarda los precios modificados y refresca la deuda mostrada. */
  async function handleSavePrices() {
    if (target !== 'sale' || !sale) return;
    const prices = Object.entries(priceEdits)
      .filter(([, v]) => v.trim() !== '')
      .map(([product_id, v]) => ({ product_id, unit_price: parseFloat(v) }))
      .filter(p => Number.isFinite(p.unit_price) && p.unit_price > 0);
    if (prices.length === 0) {
      toast.error('No hay precios modificados');
      return;
    }
    if (prices.some(p => p.unit_price <= 0)) {
      toast.error('Cada precio debe ser mayor que 0');
      return;
    }
    setSavingPrices(true);
    try {
      const res = await api.updateSalePrices(String(sale.id), { prices }) as AnyRecord;
      toast.success(
        `Precios actualizados — nuevo total: ${formatMoney(Number(res.total ?? 0), saleCurrency?.symbol, saleCurrency?.code)}`
      );
      setPriceEdits({});
      setShowPriceEditor(false);
      // El padre recarga el detalle y el listado: la deuda del paso a paso
      // se refresca con el total nuevo (y el saldo ya ajustado).
      onPricesSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al actualizar los precios');
    } finally {
      setSavingPrices(false);
    }
  }

  async function handleConfirm() {
    if (target === 'sale' ? !sale : !customer) return;
    // Defensa extra: sin efectivo suficiente no se registra el abono.
    if (!multiCurrency && insufficientCash) {
      toast.error(`El efectivo recibido no cubre lo debido. Faltan ${fmtMoney(Math.max(0, r2(cashPart - cashReceived)))}`);
      return;
    }
    if (multiCurrency && partialCoveredBase <= 0) {
      toast.error('Ingresa el monto del abono en al menos una moneda');
      return;
    }
    if (multiCurrency && partialOverpay) {
      toast.error(`Los montos superan la deuda pendiente (${formatMoney(remainingBase, baseCurrency?.symbol, baseCurrency?.code)})`);
      return;
    }
    setSaving(true);
    try {
      const transferNotes: string[] = [];
      if (transferRef.trim()) transferNotes.push(`ID pago: ${transferRef.trim().toUpperCase()}`);
      if (transferPhone.trim()) transferNotes.push(`Tel: ${transferPhone.trim()}`);
      const combinedNotes = [notes.trim(), ...transferNotes].filter(Boolean).join(' · ') || null;

      // Una parte por moneda cuando el abono es multi-moneda; si no, una sola
      // parte con la moneda elegida (igual que antes). El servidor congela la
      // tasa de cada parte y guarda una fila de abono por moneda.
      let parts: { method: PayMethod; amount_cash: number; amount_transfer: number; currency_code: string }[];
      if (multiCurrency) {
        parts = payParts.filter(p => p.amount > 0).map(p => ({
          method: p.method,
          amount_cash: p.method === 'cash' ? p.amount : 0,
          amount_transfer: p.method === 'transfer' ? p.amount : 0,
          currency_code: p.currency || (baseCurrency?.code ?? ''),
        }));
      } else {
        let cash = 0;
        let transfer = 0;
        if (method === 'cash') cash = chargeAmount;
        else if (method === 'transfer') transfer = chargeAmount;
        else { transfer = amountTransfer; cash = cashPart; }
        parts = [{
          method,
          amount_cash: cash,
          amount_transfer: transfer,
          currency_code: payCurrency || (baseCurrency?.code ?? ''),
        }];
      }

      if (target === 'sale') {
        await api.paySale(String(sale!.id), { parts, notes: combinedNotes });
      } else {
        // Abono al saldo general del cliente (multi-moneda, misma tasa congelada).
        await api.addPayment({ customer_id: customer!.id, parts, notes: combinedNotes });
      }
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

  const targetTitle = target === 'sale'
    ? `Cobrar venta — ${String(sale?.customer_name ?? 'Sin cliente')}`
    : `Abonar deuda — ${String(customer?.name ?? '')}`;
  return (
    <Modal open={open} onClose={close} title={targetTitle} size="xl">
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
            <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
              {target === 'sale' ? 'Deuda pendiente' : `Saldo pendiente${customer?.phone ? ` · ${String(customer.phone)}` : ''}`}
            </p>
            <p className="text-2xl font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
              {formatMoney(remainingSale, saleCurrency?.symbol, saleCurrency?.code)}
            </p>
            {!multiCurrency && payCode !== saleCurrencyCode && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                ≈ {formatMoney(amountDue, payOption?.symbol, payOption?.code)} en {payOption?.code ?? 'base'}
              </p>
            )}
          </div>
        )}

        {/* ── Editor de precios (dueño/admin) ──
            Como la oferta: mientras la venta a crédito se abona, el dueño o
            un administrador puede corregir el precio de venta de cada
            producto. El servidor recalcula el total y ajusta el saldo. */}
        {canEditPrices && step === 1 && (
          <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
            <button
              type="button"
              onClick={() => setShowPriceEditor(v => !v)}
              className="w-full flex items-center justify-between gap-2 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                <Pencil className="w-4 h-4 text-brand-400" />
                Modificar precios de la venta
                {priceEditsDirty && <span className="text-[10px] font-medium text-yellow-400">· cambios sin guardar</span>}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {showPriceEditor ? 'Ocultar' : 'Editar'}
              </span>
            </button>
            {showPriceEditor && (
              <>
                <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  Ajusta el precio de venta de cada producto (en {saleCurrency?.code ?? 'moneda base'}), igual que en una oferta. Guardar recalcula el total y la deuda pendiente; los cambios quedan en auditoría.
                </p>
                <div className="space-y-2">
                  {(saleItems ?? []).map(it => {
                    const pid = String(it.product_id ?? '');
                    const edited = priceEdits[pid] ?? '';
                    const current = Number(it.unit_price ?? 0);
                    const qty = Number(it.quantity ?? 0);
                    const changed = edited.trim() !== '' && parseFloat(edited) !== current;
                    return (
                      <div key={pid} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {String(it.product_name ?? 'Producto')}
                          </p>
                          <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                            {formatNumber(qty, 2)} × {formatMoney(current, saleCurrency?.symbol, saleCurrency?.code)}
                            {changed && <span className="text-yellow-400"> → {formatMoney(parseFloat(edited), saleCurrency?.symbol, saleCurrency?.code)}</span>}
                          </p>
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className={cn('input w-28 text-right', changed && 'border-yellow-500/60')}
                          placeholder={current.toFixed(2)}
                          value={edited}
                          onChange={e => setPriceEdits(prev => ({ ...prev, [pid]: e.target.value }))}
                        />
                      </div>
                    );
                  })}
                </div>
                {priceEditsDirty && (
                  <p className={cn('text-xs font-semibold', priceEditsTotalDelta < 0 ? 'text-green-400' : 'text-yellow-400')}>
                    Nuevo total ≈ {formatMoney(r2(Number(sale?.total ?? 0) + priceEditsTotalDelta), saleCurrency?.symbol, saleCurrency?.code)}
                    {priceEditsTotalDelta < 0
                      ? ` (baja ${formatMoney(Math.abs(priceEditsTotalDelta), saleCurrency?.symbol, saleCurrency?.code)})`
                      : ` (sube ${formatMoney(priceEditsTotalDelta, saleCurrency?.symbol, saleCurrency?.code)})`}
                    {priceEditsTotalDelta < 0 && ' · ⚠ si queda por debajo de lo ya abonado, el servidor rechazará el cambio'}
                  </p>
                )}
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setPriceEdits({})}
                    disabled={!priceEditsDirty || savingPrices}
                    className="btn-secondary text-sm px-4 py-2 disabled:opacity-50"
                  >
                    Descartar
                  </button>
                  <button
                    type="button"
                    onClick={handleSavePrices}
                    disabled={!priceEditsDirty || savingPrices}
                    className="btn-primary text-sm px-4 py-2 disabled:opacity-50"
                  >
                    {savingPrices ? 'Guardando...' : 'Guardar precios'}
                  </button>
                </div>
              </>
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
          useMultiCurrencyUI ? (
            <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
              <p className="label mb-0">Monedas del abono</p>
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                Marca en qué monedas se abona. Cada moneda física se cobra en efectivo y cada digital por transferencia; los montos se declaran en el siguiente paso.
              </p>
              <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                {stepCurrencies.map(c => {
                  const value = c.is_base ? '' : c.code;
                  const checked = payParts.some(p => p.currency === value);
                  return (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => {
                        if (checked) {
                          setPayParts(prev => prev.filter(p => p.currency !== value));
                        } else {
                          // El método de cada moneda lo fija su tipo: físicas →
                          // efectivo, digitales → transferencia.
                          setPayParts(prev => [...prev, { currency: value, method: c.currencyType === 'digital' ? 'transfer' : 'cash', amount: 0 }]);
                        }
                      }}
                      className={cn(
                        'rounded-xl border p-3 text-left transition-all active:scale-[0.97]',
                        checked ? 'text-white shadow-lg' : 'hover:brightness-105'
                      )}
                      style={
                        checked
                          ? { backgroundColor: 'var(--brand-600)', borderColor: 'var(--brand-600)' }
                          : { backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className={cn('font-semibold text-sm truncate', !checked && 'text-[var(--text-primary)]')}>{c.symbol} {c.code}</p>
                          <p className={cn('text-[10px] mt-0.5', checked ? 'text-white/70' : 'text-[var(--text-tertiary)]')}>
                            {c.currencyType === 'digital' ? 'Transferencia' : 'Efectivo'}
                          </p>
                        </div>
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                          style={checked
                            ? { backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff' }
                            : { backgroundColor: 'var(--bg-muted)', color: 'var(--text-tertiary)' }}
                        >
                          {checked ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {payParts.length === 0 && (
                <p className="text-[10px] text-yellow-400">Marca al menos una moneda para continuar.</p>
              )}
            </div>
          ) : stepCurrencies.length > 0 ? (
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
            {multiCurrency ? (
              <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
                <p className="label mb-0">Monto por moneda</p>
                <div className="space-y-2">
                  {payParts.map((part, idx) => {
                    const partCur = currencies.find(c => c.code === part.currency) ?? baseCurrency ?? null;
                    const remainCur = partialPartRemain(idx);
                    return (
                      <div key={idx} className="rounded-lg border p-2.5 space-y-2" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Parte {idx + 1}</span>
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {partCur?.symbol ? `${partCur.symbol} ` : ''}{part.currency || baseCurrency?.code || '—'}
                          </span>
                          <span className={cn(
                            'ml-auto text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded',
                            part.method === 'transfer'
                              ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                              : 'bg-[var(--bg-muted)] text-[var(--text-tertiary)] border border-[var(--border-primary)]'
                          )}>
                            {part.method === 'cash' ? 'Efectivo' : 'Transferencia'}
                          </span>
                          {payParts.length > 1 && (
                            <button type="button" onClick={() => setPayParts(prev => prev.filter((_, i) => i !== idx))} className="p-1 rounded-md" style={{ color: 'var(--text-tertiary)' }} aria-label="Quitar parte">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="flex gap-1.5">
                          <input
                            type="number"
                            min="0"
                            step="0.05"
                            className="input text-lg font-semibold"
                            placeholder="0.00"
                            value={part.amount || ''}
                            onChange={e => setPayParts(prev => prev.map((p, i) => i === idx ? { ...p, amount: parseFloat(e.target.value) || 0 } : p))}
                          />
                          {remainCur > 0 && (
                            <button
                              type="button"
                              onClick={() => setPayParts(prev => prev.map((p, i) => i === idx ? { ...p, amount: remainCur } : p))}
                              className="text-[11px] font-medium px-3 rounded-lg text-white whitespace-nowrap"
                              style={{ backgroundColor: 'var(--brand-600)' }}
                            >
                              Resto
                            </button>
                          )}
                        </div>
                        {part.amount > 0 && (
                          <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                            ≈ {formatMoney(partBaseAmount(part), baseCurrency?.symbol, baseCurrency?.code)} en {baseCurrency?.code ?? 'base'}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                {payParts.length < activeCurrencies.length && (
                  <button
                    type="button"
                    onClick={() => {
                      const used = new Set(payParts.map(p => p.currency));
                      const next = activeCurrencies.find(c => !used.has(c.is_base ? '' : c.code));
                      if (next) setPayParts(prev => [...prev, { currency: next.is_base ? '' : next.code, method: next.currencyType === 'digital' ? 'transfer' : 'cash', amount: 0 }]);
                    }}
                    className="text-xs font-medium px-2.5 py-1.5 rounded-lg flex items-center gap-1"
                    style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-primary)' }}
                  >
                    <Plus className="w-3.5 h-3.5" /> Agregar moneda
                  </button>
                )}
                <div className="flex items-center justify-between text-sm pt-1 border-t" style={{ borderColor: 'var(--border-primary)' }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>{partialCovers ? 'Cubierto' : 'Abono parcial'}</span>
                  <span className={cn('font-semibold', partialValid ? 'text-green-400' : 'text-yellow-400')}>
                    {formatMoney(partialCoveredBase, baseCurrency?.symbol, baseCurrency?.code)} de {formatMoney(remainingBase, baseCurrency?.symbol, baseCurrency?.code)}
                  </span>
                </div>
                {!partialCovers && partialCoveredBase > 0 && (
                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                    Puedes abonar solo una parte: quedarían ≈ {formatMoney(Math.max(0, partialRemainBase), baseCurrency?.symbol, baseCurrency?.code)} en {baseCurrency?.code ?? 'base'}.
                  </p>
                )}
                {partialOverpay && (
                  <p className="text-[10px] text-yellow-400">⚠ Los montos superan la deuda pendiente.</p>
                )}
              </div>
            ) : (
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
              </>
            )}

            {usesTransfer && (
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
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{multiCurrency ? 'Mixto · varias monedas' : (PAY_METHODS.find(m => m.id === method)?.label ?? '—')}</span>
            </div>
            {multiCurrency ? (
              <div className="space-y-1.5 pt-0.5">
                {payParts.filter(p => p.amount > 0).map((p, i) => {
                  const cur = currencies.find(c => c.code === p.currency) ?? baseCurrency ?? null;
                  return (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span style={{ color: 'var(--text-tertiary)' }}>
                        {cur?.symbol ? `${cur.symbol} ` : ''}{cur?.code ?? baseCurrency?.code ?? '—'} · {p.method === 'cash' ? 'Efectivo' : 'Transferencia'}
                      </span>
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {formatMoney(p.amount, cur?.symbol, cur?.code)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: 'var(--text-tertiary)' }}>Moneda</span>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{payOption?.symbol} {payOption?.code}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: 'var(--text-tertiary)' }}>Monto a cobrar</span>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmtMoney(chargeAmount)}</span>
                </div>
              </>
            )}
            {!multiCurrency && (method === 'cash' || method === 'mixed') && cashReceived > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: 'var(--text-tertiary)' }}>Efectivo recibido</span>
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmtMoney(cashReceived)}</span>
              </div>
            )}
            {!multiCurrency && method === 'mixed' && amountTransfer > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: 'var(--text-tertiary)' }}>Por transferencia</span>
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{fmtMoney(amountTransfer)}</span>
              </div>
            )}
            {!multiCurrency && (method === 'cash' || method === 'mixed') && (cashReceived > 0 || insufficientCash) && (
              <p className={cn('text-sm font-semibold', change >= 0 ? 'text-green-400' : 'text-red-400')}>
                {change >= 0 ? `Cambio: ${fmtMoney(change)}` : `Faltan: ${fmtMoney(-change)}`}
              </p>
            )}
            <div className="flex items-center justify-between text-sm pt-1.5 border-t" style={{ borderColor: 'var(--border-primary)' }}>
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{target === 'sale' ? 'Deuda pendiente' : 'Saldo pendiente'}</span>
              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{formatMoney(remainingSale, saleCurrency?.symbol, saleCurrency?.code)}</span>
            </div>
            {(() => {
              const left = r2(Math.max(0, remainingSale - paidInSale));
              return (
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {left <= 0.01
                    ? (target === 'sale' ? 'La venta quedaría saldada tras el abono.' : 'El cliente quedaría sin deuda tras el abono.')
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
              disabled={saving || (multiCurrency ? !partialValid : (chargeAmount <= 0 || insufficientCash))}
              className="btn-primary flex-1 py-3.5 text-base disabled:opacity-50"
            >
              {saving
                ? 'Registrando...'
                : multiCurrency
                  ? `${target === 'sale' ? 'Confirmar abono' : 'Abonar'} — ${formatMoney(partialCoveredBase, baseCurrency?.symbol, baseCurrency?.code)}`
                  : `${target === 'sale' ? 'Confirmar abono' : 'Abonar'} — ${fmtMoney(chargeAmount)}`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
