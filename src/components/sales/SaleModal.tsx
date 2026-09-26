'use client';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { formatCurrency, formatMoney, formatNumber, cn, findProductByBarcode } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { notifyShiftSummaryChanged } from '@/lib/shift-events';
import Modal from '@/components/ui/Modal';
import SearchableSelect from '@/components/ui/SearchableSelect';
import Toggle from '@/components/ui/Toggle';
import { toast } from '@/components/ui/toaster';
import { playScanBeep } from '@/lib/scan-beep';
import { usePosSelector } from '@/hooks/use-pos';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { useAuthStore } from '@/lib/stores/auth-store';
import { printReceipt, buildReceiptFromSale, fetchDefaultTicketPrinter } from '@/lib/receipt';
import { convertAmount, roundToNickel } from '@/lib/currency';
import { Search, X, Barcode, Banknote, Landmark, Plus } from 'lucide-react';
import { normalizePhone } from '@/lib/validate';

type AnyRecord = Record<string, unknown>;
type PayMethod = 'cash' | 'transfer' | 'mixed' | 'credit';
// Tipo de moneda: 'cash' = física (solo efectivo), 'digital' = solo transferencia
type CurrencyType = 'cash' | 'digital';
type CurrencyOption = { code: string; name: string; symbol: string; is_base: boolean; currencyType: CurrencyType; rate: number; /** Referencia al dólar: 1 USD = X moneda */ usdRate?: number | null };
// Parte del cobro mixto: efectivo y transferencia de UNA moneda ('' = base)
interface PaymentPart { cash: number; transfer: number; currency: string; }

interface SaleModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function SaleModal({ open, onClose, onSuccess }: SaleModalProps) {
  const { user } = useAuthStore();
  // Solo el dueño y el admin pueden modificar el precio de venta
  const canEditPrice = user?.role === 'owner' || user?.role === 'admin';
  const [products, setProducts] = useState<AnyRecord[]>([]);
  const [customers, setCustomers] = useState<AnyRecord[]>([]);
  const [locations, setLocations] = useState<AnyRecord[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [barcodeSearch, setBarcodeSearch] = useState('');
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const [cart, setCart] = useState<{ product: AnyRecord; quantity: number; unit_price: number }[]>([]);
  const [locationId, setLocationId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');
  const [amountCash, setAmountCash] = useState(0);
  const [amountTransfer, setAmountTransfer] = useState(0);
  const [transferPhone, setTransferPhone] = useState('');
  const [splitCurrency, setSplitCurrency] = useState(''); // moneda de la venta ('' = base)
  const [saleNotes, setSaleNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [locationStock, setLocationStock] = useState<Record<string, number>>({});
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  // Cobro dividido: partes [{ método, monto, moneda }] ('' = moneda base)
  const [splitPay, setSplitPay] = useState(false);
  const [payParts, setPayParts] = useState<PaymentPart[]>([]);
  const { workMode, posId, setPosId, posOptions, hasOpenShift, resetPos } = usePosSelector(open);

  // Enfocar el campo de código de barras al abrir el modal para escanear de inmediato
  useEffect(() => {
    if (open) barcodeInputRef.current?.focus();
  }, [open]);

  // El almacén de salida por defecto es el del PUNTO DE VENTA seleccionado:
  // al cambiar la caja, el almacén se sincroniza automáticamente (y puede
  // cambiarse a mano después).
  useEffect(() => {
    if (!open || workMode !== 'shifts' || !posId) return;
    const pos = posOptions.find(p => String(p.id) === String(posId));
    const posLoc = pos?.location_id ? String(pos.location_id) : '';
    if (posLoc && locations.some(l => String(l.id) === posLoc)) setLocationId(posLoc);
  }, [open, workMode, posId, posOptions, locations]);

  useEffect(() => {
    if (!open) return;
    Promise.all([api.getProducts(), api.getCustomers(), api.getLocations()])
      .then(([p, c, l]) => {
        setProducts(p);
        setCustomers(c);
        setLocations(l);
        if (l.length > 0 && !locationId) setLocationId(String(l[0].id));
      })
      .catch(() => toast.error('Error al cargar datos'));
    // Monedas y tasas (para convertir precios y cobrar dividido)
    fetch('/api/currencies').then(r => r.json()).then(d => {
      const raw = (d.currencies ?? []) as { code: string; name: string; symbol: string; is_base: boolean; currency_type?: string; rates: Record<string, number>; usd_rate?: number | null }[];
      const baseCode = raw.find(c => c.is_base)?.code ?? '';
      setCurrencies(raw.map(c => ({
        code: c.code, name: c.name, symbol: c.symbol, is_base: c.is_base,
        currencyType: c.currency_type === 'digital' ? 'digital' : 'cash',
        rate: c.is_base ? 1 : (c.rates?.[baseCode] ?? 0),
        // Referencia al dólar: 1 USD = X moneda (lo que muestra la UI)
        usdRate: c.usd_rate ?? null,
      })));
    }).catch(() => {});
  }, [open, locationId]);

  const cartTotal = cart.reduce((a, i) => a + i.quantity * i.unit_price, 0);
  const activeCurrencies = useMemo(() => currencies.filter(c => c.is_base || Number(c.rate) > 0), [currencies]);
  const baseCurrency = currencies.find(c => c.is_base) ?? null;
  // Monedas admitidas según el método: efectivo → físicas, transferencia →
  // digitales, mixto → ambas. El crédito se registra en la moneda base.
  const currenciesForMethod = useCallback((method: PayMethod): CurrencyOption[] => {
    if (method === 'cash') return activeCurrencies.filter(c => c.currencyType === 'cash');
    if (method === 'transfer') return activeCurrencies.filter(c => c.currencyType === 'digital');
    return activeCurrencies;
  }, [activeCurrencies]);
  const methodCurrencies = payMethod === 'credit' ? activeCurrencies : currenciesForMethod(payMethod);
  const saleCurrency = currencies.find(c => c.code === splitCurrency) ?? null;
  const isForeignSale = !!saleCurrency && !saleCurrency.is_base;
  // Precio del producto convertido a la moneda de la venta y redondeado hacia
  // arriba al múltiplo de 0.05 (no existen monedas de 1 centavo): así el POS
  // muestra exactamente el precio que el servidor registrará.
  function convertedUnitPrice(product: AnyRecord): number {
    const nativeCode = product.sale_currency ? String(product.sale_currency).toUpperCase() : (baseCurrency?.code ?? null);
    return roundToNickel(convertAmount(Number(product.sale_price), nativeCode, splitCurrency || null, currencies));
  }
  // Recalcular los precios del carrito al cambiar la moneda de venta (igual
  // que en el POS táctil): precio convertido + redondeo a 0.05. Solo se dispara
  // con la moneda para no pisar los precios editados a mano por el dueño/admin
  // cuando la lista de monedas se refresca.
  useEffect(() => {
    if (cart.length === 0 || currencies.length === 0) return;
    setCart(prev => prev.map(i => ({ ...i, unit_price: convertedUnitPrice(i.product) })));
  }, [splitCurrency]); // eslint-disable-line react-hooks/exhaustive-deps
  // Total equivalente en moneda base (validación del cobro dividido)
  const cartTotalBase = isForeignSale && saleCurrency && saleCurrency.rate > 0
    ? Math.round(cartTotal * saleCurrency.rate * 100) / 100
    : cartTotal;
  // Partes activas del cobro dividido
  const activeParts = payParts.filter(p => p.cash + p.transfer > 0);
  // Remanente por cobrar (en la moneda indicada) tras descontar las partes
  const remainFor = (toCur: CurrencyOption | null): number => {
    if (activeParts.length === 0) return cartTotal;
    const covered = activeParts.reduce((a, p) => a + convertAmount(p.cash + p.transfer, p.currency || null, toCur?.code ?? null, currencies), 0);
    return Math.round((cartTotal - covered) * 100) / 100;
  };
  // Datos de la transferencia compartidos por las partes (teléfono opcional)
  const transferNotes = (payMethod === 'transfer' || payMethod === 'mixed') && transferPhone.trim() ? `Tel: ${transferPhone.trim()}` : null;

  function getAvailableStock(product: AnyRecord): number {
    if (locationId && locationStock[String(product.id)] !== undefined) {
      return locationStock[String(product.id)];
    }
    return Number(product.stock ?? 0);
  }

  function hasStockIssues(): boolean {
    return cart.some(i => i.quantity > getAvailableStock(i.product));
  }

  function addToCart(p: AnyRecord) {
    setCart(prev => {
      const ex = prev.find(i => i.product.id === p.id);
      return ex
        ? prev.map(i => i.product.id === p.id ? { ...i, quantity: i.quantity + 1 } : i)
        : [...prev, { product: p, quantity: 1, unit_price: convertedUnitPrice(p) }];
    });
    setProductSearch('');
    setBarcodeSearch('');
  }

  // Escaneo rápido: al presionar Enter busca coincidencia exacta y agrega al carrito
  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = barcodeSearch.trim();
    if (!code) return;
    const found = findProductByBarcode(products, code);
    if (!found) {
      toast.error(`No se encontró producto con el código ${code}`);
      return;
    }
    if (getAvailableStock(found) <= 0) {
      toast.error(`${String(found.name)} está agotado`);
      return;
    }
    addToCart(found);
    playScanBeep();
    barcodeInputRef.current?.focus();
  }

  function resetForm() {
    setCart([]);
    setLocationId(locations.length > 0 ? String(locations[0].id) : '');
    setCustomerId('');
    setPayMethod('cash');
    setAmountCash(0);
    setAmountTransfer(0);
    setTransferPhone('');
    setSaleNotes('');
    setSplitCurrency('');
    setSplitPay(false);
    setPayParts([]);
    resetPos();
  }

  // Teléfono celular cubano: +53 opcional + 5 + 7 dígitos (8 en total).
  // Es opcional: solo se valida el formato cuando el usuario ingresa uno.
  const transferPhoneNormalized = transferPhone.trim() ? normalizePhone(transferPhone) : '';
  const transferPhoneValid = !!transferPhoneNormalized && /^(\+?53)?5\d{7}$/.test(transferPhoneNormalized);

  // Fetch location-specific stock when location changes
  useEffect(() => {
    if (!locationId) { setLocationStock({}); return; }
    api.getLocationStock(locationId)
      .then(rows => {
        const map: Record<string, number> = {};
        (rows as { product_id: string; quantity: number }[]).forEach(r => {
          map[r.product_id] = Number(r.quantity);
        });
        setLocationStock(map);
      })
      .catch(() => setLocationStock({}));
  }, [locationId]);

  const filteredProducts = products
    .filter(p => {
      const qName = productSearch.trim().toLowerCase();
      const qBarcode = barcodeSearch.trim().toLowerCase();
      const nameMatch = qName && String(p.name).toLowerCase().includes(qName);
      const barcodeMatch = qBarcode && String(p.barcode ?? '').toLowerCase().includes(qBarcode);
      return nameMatch || barcodeMatch;
    })
    // Solo se listan productos con existencia en el almacén de salida
    // seleccionado (igual que en el módulo de gastos).
    .filter(p => getAvailableStock(p) > 0)
    .slice(0, 8);

  async function handleSave() {
    if (cart.length === 0) return;
    if (payMethod === 'credit' && !customerId) {
      toast.error('Las ventas a crédito requieren cliente');
      return;
    }
    // Teléfono celular cubano opcional para los pagos con transferencia
    const hasTransfer = payMethod === 'transfer' || payMethod === 'mixed';
    if (hasTransfer && transferPhone.trim() && !transferPhoneValid) {
      toast.error('Ingresa un teléfono celular cubano válido para la transferencia (Ej: +53 55280263)');
      return;
    }
    const stockErrors = cart.filter(i => i.quantity > getAvailableStock(i.product));
    if (stockErrors.length > 0) {
      const names = stockErrors.map(i => `${String(i.product.name)} (disponible: ${formatNumber(getAvailableStock(i.product), 1)}, solicitado: ${formatNumber(i.quantity, 1)})`).join(', ');
      toast.error(`Stock insuficiente: ${names}`);
      return;
    }
    // Cobro mixto multi-moneda: validar que las partes cubran el total (en base)
    if (activeParts.length > 0) {
      const covered = activeParts.reduce((a, p) => a + (p.cash + p.transfer) / (p.currency ? (currencies.find(c => c.code === p.currency)?.rate || 1) : 1), 0);
      if (covered + 0.01 < cartTotalBase) {
        toast.error('Las partes no cubren el total de la venta');
        return;
      }
    }
    setSaving(true);
    try {
      const total = cartTotal;
      const res = await api.createSale({
        items: cart.map(i => ({
          product_id: i.product.id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          cost: Number(i.product.cost ?? 0),
        })),
        // Moneda de la venta ('' = moneda base): la tasa se congela en el servidor
        currency_code: splitCurrency || null,
        payment: {
          method: payMethod,
          // Cobro mixto multi-moneda: una parte por moneda (el servidor crea
          // una fila de pago por cada una, con su tasa congelada)
          ...(activeParts.length > 0
            ? { parts: activeParts.map(p => ({ currency_code: p.currency || null, amount_cash: p.cash, amount_transfer: p.transfer, notes: p.transfer > 0 ? transferNotes : null })) }
            : {
                amount_cash: payMethod === 'cash' ? total : payMethod === 'mixed' ? amountCash : 0,
                amount_transfer: payMethod === 'transfer' ? total : payMethod === 'mixed' ? amountTransfer : 0,
                // El teléfono (opcional) se guarda junto al pago, igual que en la ventana touch
                notes: hasTransfer && transferPhone.trim() ? `Tel: ${transferPhone.trim()}` : null,
              }),
        },
        customer_id: customerId || null,
        location_id: locationId || null,
        pos_id: workMode === 'shifts' ? posId || null : null,
        notes: saleNotes || null,
      });
      toast.success('Venta registrada');
      notifyShiftSummaryChanged();
      await printSaleTicket(res, total);
      resetForm();
      onClose();
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar la venta');
    } finally {
      setSaving(false);
    }
  }

  // Imprime el comprobante del cliente según la configuración (método y ancho).
  // La venta ya quedó registrada: si la impresión falla, solo se avisa.
  async function printSaleTicket(res: unknown, total: number) {
    await useSettingsStore.getState().load();
    const settings = useSettingsStore.getState().settings;
    if (settings?.receipt_auto_print === false) return;
    try {
      const r = res as AnyRecord;
      const method = settings?.receipt_print_method ?? 'browser';
      // Con varias impresoras registradas, el ticket va a la impresora
      // asignada en Configuración (is_default).
      const printer = method === 'usb' ? await fetchDefaultTicketPrinter() : null;
      await printReceipt(
        buildReceiptFromSale({
          sale: r,
          items: (r.items ?? []) as AnyRecord[],
          businessName: settings?.business_name ?? 'TiendaMiBarrio',
          logoUrl: settings?.logo_url ?? null,
          payMethod,
          cash: activeParts.length > 0
            ? Number((((res as AnyRecord).payments ?? []) as AnyRecord[]).reduce((a, p) => a + Number(p.amount_cash ?? 0), 0))
            : payMethod === 'cash' ? total : payMethod === 'mixed' ? amountCash : 0,
          transfer: activeParts.length > 0
            ? Number((((res as AnyRecord).payments ?? []) as AnyRecord[]).reduce((a, p) => a + Number(p.amount_transfer ?? 0), 0))
            : payMethod === 'transfer' ? total : payMethod === 'mixed' ? amountTransfer : 0,
          // Cobro dividido: desglose de pagos por moneda en el ticket
          payments: activeParts.length > 0
            ? (((res as AnyRecord).payments ?? []) as AnyRecord[]).map(p => ({
                method: String(p.method ?? 'cash'),
                amount: Number(p.amount_cash ?? 0) + Number(p.amount_transfer ?? 0),
                // NULL = moneda base → se resuelve al código base para el ticket
                currency_code: p.currency_code ? String(p.currency_code) : (baseCurrency?.code ?? null),
                currency_symbol: currencies.find(c => c.code === String(p.currency_code ?? ''))?.symbol ?? null,
              }))
            : undefined,
          // El teléfono de transferencia (opcional) aparece en el ticket, igual que en la ventana touch
          notes: [
            saleNotes.trim(),
            (payMethod === 'transfer' || payMethod === 'mixed') && transferPhone.trim() ? `Tel: ${transferPhone.trim()}` : '',
          ].filter(Boolean).join(' · ') || null,
        }),
        { method, width: settings?.receipt_printer_width ?? '80', printer }
      );
    } catch (e) {
      toast.error(`Venta registrada, pero no se pudo imprimir el ticket: ${e instanceof Error ? e.message : 'error desconocido'}`);
    }
  }

  function handleClose() {
    resetForm();
    setProductSearch('');
    setBarcodeSearch('');
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Nueva venta" size="xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Buscar producto</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
                <input
                  className="input pl-9"
                  placeholder="Nombre..."
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="label">Código de barras</label>
              <form onSubmit={handleBarcodeSubmit} className="relative">
                <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
                <input
                  ref={barcodeInputRef}
                  className="input pl-9 font-mono"
                  placeholder="Escanear..."
                  value={barcodeSearch}
                  onChange={e => setBarcodeSearch(e.target.value)}
                  autoComplete="off"
                />
              </form>
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1">Escanea el código y presiona Enter para agregarlo al carrito</p>
            </div>
          </div>
          <p className="text-[10px] text-[var(--text-tertiary)]">Solo se muestran productos con existencia en el almacén de salida.</p>
          {(productSearch.trim() || barcodeSearch.trim()) && (
            <div className="border border-[var(--border-secondary)] rounded-xl overflow-hidden bg-[var(--bg-primary)]">
              {filteredProducts.length === 0 ? (
                <p className="text-center text-[var(--text-tertiary)] py-4 text-sm">Sin resultados</p>
              ) : (
                filteredProducts.map(p => (
                  <button
                    key={String(p.id)}
                    onClick={() => addToCart(p)}
                    disabled={getAvailableStock(p) <= 0}
                    title={getAvailableStock(p) <= 0 ? 'Producto agotado' : undefined}
                    className={cn(
                      'w-full flex items-center justify-between px-4 py-2.5 hover:bg-[var(--bg-secondary)] text-left border-b border-[var(--border-primary)] last:border-0 transition-colors',
                      getAvailableStock(p) <= 0 && 'opacity-40 cursor-not-allowed'
                    )}
                  >
                    <div>
                      <p className={cn('text-sm', getAvailableStock(p) <= 0 ? 'text-[var(--text-tertiary)] line-through' : 'text-[var(--text-primary)]')}>
                        {String(p.name)}
                      </p>
                      {(() => {
                        const avail = getAvailableStock(p);
                        const min = Number(p.min_stock ?? 0);
                        const low = avail > 0 && avail <= min;
                        const out = avail <= 0;
                        const cls = out ? 'text-red-400' : low ? 'text-yellow-400' : 'text-[var(--text-tertiary)]';
                        return <p className={`text-xs ${cls}`}>{out ? 'Sin stock — Producto agotado' : `Stock: ${formatNumber(avail, 1)}`}</p>;
                      })()}
                    </div>
                    <span className="flex flex-col items-end">
                      {/* Precio nativo del producto (su moneda de venta; NULL = base) */}
                      <span className={cn('font-semibold text-sm', getAvailableStock(p) <= 0 ? 'text-[var(--text-tertiary)] line-through' : 'text-brand-400')}>
                        {(() => {
                          const native = currencies.find(c => c.code === (p.sale_currency ? String(p.sale_currency).toUpperCase() : baseCurrency?.code));
                          return formatMoney(Number(p.sale_price), native?.symbol ?? undefined, native?.code ?? (p.sale_currency ? String(p.sale_currency) : undefined));
                        })()}
                      </span>
                      {(() => {
                        // Equivalente en la moneda de la venta cuando difiere
                        const nativeCode = p.sale_currency ? String(p.sale_currency).toUpperCase() : baseCurrency?.code ?? null;
                        const conv = convertedUnitPrice(p);
                        if (!splitCurrency || nativeCode === splitCurrency) return null;
                        return <span className="text-[10px] text-[var(--text-tertiary)]">≈ {formatMoney(conv, saleCurrency?.symbol, saleCurrency?.code)}</span>;
                      })()}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
          {cart.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">Carrito</p>
              {cart.map(item => (
                <div key={String(item.product.id)} className="flex flex-col xs:flex-row items-stretch xs:items-center gap-2 bg-[var(--bg-primary)] rounded-xl px-3 py-2.5 border border-[var(--border-primary)]">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--text-primary)] truncate">{String(item.product.name)}</p>
                    {(() => {
                      const avail = getAvailableStock(item.product);
                      const exceeds = item.quantity > avail;
                      return exceeds
                        ? <p className="text-xs text-red-400 mt-0.5">Stock disponible: {formatNumber(avail, 1)} — excede!</p>
                        : <p className="text-xs text-[var(--text-tertiary)]">Stock: {formatNumber(avail, 1)}</p>;
                    })()}
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap justify-end">
                    <button
                      onClick={() => setCart(prev => prev.map(i => i.product.id === item.product.id ? { ...i, quantity: Math.max(0.01, i.quantity - 1) } : i))}
                      className="w-7 h-7 sm:w-6 sm:h-6 rounded-md bg-[var(--bg-muted)] text-[var(--text-primary)] hover:bg-[#30363d] flex items-center justify-center text-xs"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={item.quantity}
                      onChange={e => setCart(prev => prev.map(i => i.product.id === item.product.id ? { ...i, quantity: parseFloat(e.target.value) || 0.01 } : i))}
                      className="w-16 sm:w-14 input text-center text-xs py-1.5 sm:py-1"
                    />
                    <button
                      onClick={() => setCart(prev => prev.map(i => i.product.id === item.product.id ? { ...i, quantity: i.quantity + 1 } : i))}
                      className="w-7 h-7 sm:w-6 sm:h-6 rounded-md bg-[var(--bg-muted)] text-[var(--text-primary)] hover:bg-[#30363d] flex items-center justify-center text-xs"
                    >
                      +
                    </button>
                    <div className="flex flex-col items-end">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={item.unit_price}
                        onChange={canEditPrice ? e => setCart(prev => prev.map(i => i.product.id === item.product.id ? { ...i, unit_price: parseFloat(e.target.value) || 0 } : i)) : undefined}
                        readOnly={!canEditPrice}
                        className={`w-full sm:w-20 input text-right text-xs py-1.5 sm:py-1 ${!canEditPrice ? 'opacity-60 cursor-not-allowed' : ''}`}
                        title={!canEditPrice ? 'Solo el dueño o admin pueden modificar el precio' : undefined}
                      />
                      {(() => {
                        // Precio nativo del producto (referencia cuando difiere)
                        const nativeCode = item.product.sale_currency ? String(item.product.sale_currency).toUpperCase() : baseCurrency?.code ?? null;
                        if (!nativeCode || nativeCode === (saleCurrency?.code ?? null)) return null;
                        const native = currencies.find(c => c.code === nativeCode);
                        return <span className="text-[10px] text-[var(--text-tertiary)]">Lista: {formatMoney(Number(item.product.sale_price), native?.symbol, nativeCode)}</span>;
                      })()}
                    </div>
                    <button
                      onClick={() => setCart(prev => prev.filter(i => i.product.id !== item.product.id))}
                      className="text-[var(--text-tertiary)] hover:text-red-400 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex justify-end pt-1">
                <span className="text-lg font-semibold text-[var(--text-primary)]">Total: {formatMoney(cartTotal, saleCurrency?.symbol ?? baseCurrency?.symbol, saleCurrency?.code ?? baseCurrency?.code)}</span>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-4">
          {workMode === 'shifts' && (
            <div>
              <label className="label">Caja (punto de venta)</label>
              <SearchableSelect
                options={posOptions.map(p => ({
                  value: String(p.id),
                  label: String(p.name),
                  sublabel: hasOpenShift(String(p.id))
                  ? (p.location_name ? `Turno abierto · ${String(p.location_name)}` : 'Turno abierto')
                  : (p.location_name ? String(p.location_name) : undefined),
                }))}
                value={posId}
                onChange={setPosId}
                placeholder="Selecciona la caja…"
                noResultsMessage="No hay cajas creadas"
              />
              {posId && !hasOpenShift(posId) && (
                <p className="text-[10px] text-yellow-400 mt-1">Esta caja no tiene un turno abierto. La venta no se incluirá en ningún arqueo.</p>
              )}
            </div>
          )}
          <div>
            <label className="label">Almacén de salida *</label>
            <SearchableSelect
              options={locations.map(l => ({ value: String(l.id), label: String(l.name) }))}
              value={locationId}
              onChange={v => setLocationId(v)}
              placeholder={locations.length === 0 ? 'Cargando ubicaciones...' : 'Seleccionar almacén'}
              noResultsMessage="Sin almacenes"
            />
          </div>
          <div>
            <label className="label">Cliente (opcional)</label>
            <SearchableSelect
              options={[
                { value: '', label: 'Sin cliente' },
                ...customers.map(c => ({
                  value: String(c.id),
                  label: String(c.name),
                  sublabel: Number(c.balance) > 0 ? `Debe ${formatCurrency(Number(c.balance))}` : undefined,
                })),
              ]}
              value={customerId}
              onChange={v => setCustomerId(v)}
              placeholder="Sin cliente"
              noResultsMessage="Sin clientes"
            />
          </div>
          <div>
            <label className="label">Método de pago</label>
            <div className="grid grid-cols-2 gap-2">
              {(['cash', 'transfer', 'mixed', 'credit'] as PayMethod[]).map(m => {
                const labels: Record<PayMethod, string> = { cash: 'Efectivo', transfer: 'Transferencia', mixed: 'Mixto', credit: 'Crédito' };
                return (
                  <button
                    key={m}
                    onClick={() => {
                      setPayMethod(m);
                      if (m === 'credit') { setSplitCurrency(''); return; }
                      // El método restringe las monedas: si la elegida deja de
                      // ser válida, cae a la primera permitida.
                      const allowed = currenciesForMethod(m).map(c => (c.is_base ? '' : c.code));
                      if (!allowed.includes(splitCurrency)) setSplitCurrency(allowed[0] ?? '');
                    }}
                    className={cn(
                      'px-3 py-2 rounded-lg text-sm border transition-colors',
                      payMethod === m
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'border-[var(--border-secondary)] text-[var(--text-secondary)] hover:border-[#6e7681] hover:text-[var(--text-primary)]'
                    )}
                  >
                    {labels[m]}
                  </button>
                );
              })}
            </div>
          </div>
          {payMethod === 'mixed' && activeParts.length === 0 && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)]">
              <div>
                <label className="label">Efectivo</label>
                <input type="number" min="0" step="1" className="input" value={amountCash || ''} onChange={e => setAmountCash(parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <label className="label">Transferencia</label>
                <input type="number" min="0" step="1" className="input" value={amountTransfer || ''} onChange={e => setAmountTransfer(parseFloat(e.target.value) || 0)} />
              </div>
              {(amountCash + amountTransfer) !== cartTotal && cartTotal > 0 ? (
                <p className="col-span-2 text-xs text-yellow-400">⚠ La suma no coincide con el total</p>
              ) : null}
            </div>
          )}
          {(payMethod === 'transfer' || payMethod === 'mixed') && (
            <div>
              <label className="label">Teléfono celular del cliente (opcional)</label>
              <input
                type="tel"
                inputMode="tel"
                className={`input ${transferPhone.trim() ? (transferPhoneValid ? 'border-green-500/50 focus:border-green-500' : 'border-amber-500/50 focus:border-amber-500') : ''}`}
                placeholder="Ej: +53 55280263"
                value={transferPhone}
                maxLength={20}
                onChange={e => setTransferPhone(e.target.value)}
              />
              {transferPhone.trim() && (
                <p className={`text-xs mt-1 ${transferPhoneValid ? 'text-green-400' : 'text-amber-400'}`}>
                  {transferPhoneValid ? 'Teléfono válido' : 'Formato inválido. Ejemplo: +53 55280263'}
                </p>
              )}
            </div>
          )}
          {payMethod === 'credit' && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-xs text-yellow-400">
              ⚠ Se registrará como deuda. Debes seleccionar un cliente.
            </div>
          )}
          {/* Moneda de venta (siempre visible que haya monedas para el método;
              crédito = base). Con una sola moneda digital muestra igualmente
              en qué moneda se cobra la transferencia. */}
          {payMethod !== 'credit' && methodCurrencies.length > 0 && (
            <div>
              <label className="label">Moneda de venta</label>
              <SearchableSelect
                options={methodCurrencies.map(c => ({
                  value: c.is_base ? '' : c.code,
                  label: `${c.symbol} ${c.code}`, sublabel: `${c.currencyType === 'digital' ? 'Digital' : 'Efectivo'}${c.is_base ? ' · Moneda base' : (c.rate > 0 ? (c.code === 'USD' ? ' · Referencia (dólar)' : ` · 1 USD = ${c.usdRate ?? '—'} ${c.code}`) : '')}`,
                }))}
                value={splitCurrency}
                onChange={v => setSplitCurrency(v)}
                placeholder="Seleccionar moneda"
                noResultsMessage="Sin monedas"
              />
            </div>
          )}
          {/* Cobro mixto en varias monedas: cada parte agrupa el efectivo y la
              transferencia de UNA moneda. Los importes se convierten con la tasa
              de cada moneda y se registran como pagos separados. */}
          {payMethod !== 'credit' && methodCurrencies.length > 1 && (
            <div className="rounded-xl border p-3 space-y-2.5" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
              <Toggle
                checked={splitPay}
                onChange={checked => { setSplitPay(checked); setPayParts(checked ? [{ cash: 0, transfer: 0, currency: splitCurrency }] : []); }}
                label="Cobrar en varias monedas (mixto)"
              />
              {splitPay && (
                <div className="space-y-2">
                  {payParts.map((part, idx) => {
                    const partCur = currencies.find(c => c.code === part.currency) ?? null;
                    // Tipo de moneda de la parte: física → solo efectivo; digital → solo transferencia.
                    const partType: CurrencyType = partCur ? partCur.currencyType : (baseCurrency?.currencyType ?? 'cash');
                    const coveredBase = payParts.reduce((a, p) => a + (p.cash + p.transfer > 0 ? (p.cash + p.transfer) / (p.currency ? (currencies.find(c => c.code === p.currency)?.rate || 1) : 1) : 0), 0);
                    const coveredDiff = Math.round((coveredBase - cartTotalBase) * 100) / 100;
                    const partTotal = part.cash + part.transfer;
                    const partRemain = Math.max(0, Math.round((remainFor(partCur) - part.transfer / (partCur?.rate || 1)) * 100) / 100);
                    return (
                      <div key={idx} className="rounded-lg border p-2.5 space-y-2" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Parte {idx + 1}{partCur ? ` · ${partCur.code}` : ''}</span>
                          {payParts.length > 1 && (
                            <button onClick={() => setPayParts(prev => prev.filter((_, i) => i !== idx))} className="ml-auto p-1 rounded-md hover:text-red-400 text-[var(--text-tertiary)]" aria-label="Quitar parte">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <div>
                          <label className="label">Moneda</label>
                          <SearchableSelect
                            options={activeCurrencies.map(c => ({ value: c.code, label: `${c.symbol} ${c.code}`, sublabel: `${c.currencyType === 'digital' ? 'Digital' : 'Efectivo'}${c.is_base ? ' · Moneda base' : (c.rate > 0 ? (c.code === 'USD' ? ' · Referencia (dólar)' : ` · 1 USD = ${c.usdRate ?? '—'} ${c.code}`) : '')}` }))}
                            value={part.currency}
                            onChange={v => {
                              // Al cambiar la moneda se limpia el monto que su tipo no admite
                              const t: CurrencyType = currencies.find(c => c.code === v)?.currencyType ?? (baseCurrency?.currencyType ?? 'cash');
                              setPayParts(prev => prev.map((p, i) => i === idx ? { ...p, currency: v, cash: t === 'digital' ? 0 : p.cash, transfer: t === 'cash' ? 0 : p.transfer } : p));
                            }}
                            placeholder="Seleccionar moneda"
                            noResultsMessage="Sin monedas"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <label className="label flex items-center gap-1"><Banknote className="w-3.5 h-3.5" /> Efectivo</label>
                            <div className="flex gap-1.5">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                className="input text-xs font-semibold disabled:opacity-40"
                                placeholder={partType === 'digital' ? 'No aplica' : '0.00'}
                                disabled={partType === 'digital'}
                                value={part.cash || ''}
                                onChange={e => setPayParts(prev => prev.map((p, i) => i === idx ? { ...p, cash: parseFloat(e.target.value) || 0 } : p))}
                              />
                              {partRemain > 0 && partType !== 'digital' && (
                                <button
                                  onClick={() => setPayParts(prev => prev.map((p, i) => i === idx ? { ...p, cash: partRemain } : p))}
                                  className="text-[11px] font-medium px-2.5 rounded-lg text-white transition-transform active:scale-95 whitespace-nowrap"
                                  style={{ backgroundColor: 'var(--brand-600)' }}
                                >
                                  Resto
                                </button>
                              )}
                            </div>
                          </div>
                          <div>
                            <label className="label flex items-center gap-1"><Landmark className="w-3.5 h-3.5" /> Transferencia</label>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              className="input text-xs font-semibold disabled:opacity-40"
                              placeholder={partType === 'cash' ? 'No aplica' : '0.00'}
                              disabled={partType === 'cash'}
                              value={part.transfer || ''}
                              onChange={e => setPayParts(prev => prev.map((p, i) => i === idx ? { ...p, transfer: parseFloat(e.target.value) || 0 } : p))}
                            />
                          </div>
                        </div>
                        {(partTotal > 0 || (partCur && !partCur.is_base && partCur.rate > 0)) && (
                          <p className="text-[10px] text-[var(--text-tertiary)]">
                            {partTotal > 0 && <>Equivale a ≈ {formatMoney(partTotal * (partCur?.rate || 1), baseCurrency?.symbol, baseCurrency?.code)}{partCur && !partCur.is_base && partCur.usdRate != null && partCur.usdRate !== 1 ? ` · Tasa: 1 USD = ${partCur.usdRate} ${partCur.code}` : ''}</>}
                            {partTotal <= 0 && partCur && !partCur.is_base && partCur.usdRate != null && partCur.usdRate !== 1 && <>Tasa: 1 USD = {partCur.usdRate} {partCur.code}</>}
                          </p>
                        )}
                        {idx === payParts.length - 1 && coveredBase > 0 && (
                          <p className={cn('text-[11px] font-medium', coveredDiff >= -0.01 ? 'text-green-400' : 'text-yellow-400')}>
                            {coveredDiff >= -0.01 ? '✓ Cubre el total' : <>Falta cubrir ≈ {formatMoney(-coveredDiff, baseCurrency?.symbol, baseCurrency?.code)}</>}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {payParts.length < 4 && (
                    <button
                      onClick={() => setPayParts(prev => [...prev, { cash: 0, transfer: 0, currency: '' }])}
                      className="w-full rounded-lg border border-dashed py-2 text-xs font-medium transition-colors hover:brightness-105 flex items-center justify-center gap-1.5"
                      style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
                    >
                      <Plus className="w-3.5 h-3.5" /> Agregar otra moneda
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <div>
            <label className="label">Notas</label>
            <input className="input" placeholder="Notas opcionales..." value={saleNotes} onChange={e => setSaleNotes(e.target.value)} />
          </div>
          {hasStockIssues() && !saving && (
            <p className="text-xs text-red-400 text-center">⚠ Algunos productos exceden el stock disponible. Revisa el carrito.</p>
          )}
          <button
            onClick={handleSave}
            disabled={saving || cart.length === 0 || hasStockIssues()}
            className="btn-primary w-full py-3 text-base disabled:opacity-50"
          >
            {saving ? 'Registrando...' : `Confirmar — ${formatMoney(cartTotal, saleCurrency?.symbol ?? baseCurrency?.symbol, saleCurrency?.code ?? baseCurrency?.code)}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
