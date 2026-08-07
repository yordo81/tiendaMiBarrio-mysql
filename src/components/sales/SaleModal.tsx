'use client';
import { useState, useEffect, useRef } from 'react';
import { formatCurrency, formatNumber, cn, findProductByBarcode } from '@/lib/utils';
import { api } from '@/lib/api-client';
import Modal from '@/components/ui/Modal';
import SearchableSelect from '@/components/ui/SearchableSelect';
import { toast } from '@/components/ui/toaster';
import { playScanBeep } from '@/lib/scan-beep';
import { usePosSelector } from '@/hooks/use-pos';
import { Search, X, Barcode } from 'lucide-react';

type AnyRecord = Record<string, unknown>;
type PayMethod = 'cash' | 'transfer' | 'mixed' | 'credit';

interface SaleModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function SaleModal({ open, onClose, onSuccess }: SaleModalProps) {
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
  const [saleNotes, setSaleNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [locationStock, setLocationStock] = useState<Record<string, number>>({});
  const { workMode, posId, setPosId, posOptions, hasOpenShift, resetPos } = usePosSelector(open);

  // Enfocar el campo de código de barras al abrir el modal para escanear de inmediato
  useEffect(() => {
    if (open) barcodeInputRef.current?.focus();
  }, [open]);

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
  }, [open, locationId]);

  const cartTotal = cart.reduce((a, i) => a + i.quantity * i.unit_price, 0);

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
        : [...prev, { product: p, quantity: 1, unit_price: Number(p.sale_price) }];
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
    setSaleNotes('');
    resetPos();
  }

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
    .sort((a, b) => {
      const aOut = getAvailableStock(a) <= 0 ? 1 : 0;
      const bOut = getAvailableStock(b) <= 0 ? 1 : 0;
      return aOut - bOut;
    })
    .slice(0, 8);

  async function handleSave() {
    if (cart.length === 0) return;
    if (payMethod === 'credit' && !customerId) {
      toast.error('Las ventas a crédito requieren cliente');
      return;
    }
    const stockErrors = cart.filter(i => i.quantity > getAvailableStock(i.product));
    if (stockErrors.length > 0) {
      const names = stockErrors.map(i => `${String(i.product.name)} (disponible: ${formatNumber(getAvailableStock(i.product), 1)}, solicitado: ${formatNumber(i.quantity, 1)})`).join(', ');
      toast.error(`Stock insuficiente: ${names}`);
      return;
    }
    setSaving(true);
    try {
      const total = cartTotal;
      await api.createSale({
        items: cart.map(i => ({
          product_id: i.product.id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          cost: Number(i.product.cost ?? 0),
        })),
        payment: {
          method: payMethod,
          amount_cash: payMethod === 'cash' ? total : payMethod === 'mixed' ? amountCash : 0,
          amount_transfer: payMethod === 'transfer' ? total : payMethod === 'mixed' ? amountTransfer : 0,
        },
        customer_id: customerId || null,
        location_id: locationId || null,
        pos_id: workMode === 'shifts' ? posId || null : null,
        notes: saleNotes || null,
      });
      toast.success('Venta registrada');
      resetForm();
      onClose();
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar la venta');
    } finally {
      setSaving(false);
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
                    <span className={cn('font-semibold text-sm', getAvailableStock(p) <= 0 ? 'text-[var(--text-tertiary)] line-through' : 'text-brand-400')}>
                      {formatCurrency(Number(p.sale_price))}
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
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={item.unit_price}
                      onChange={e => setCart(prev => prev.map(i => i.product.id === item.product.id ? { ...i, unit_price: parseFloat(e.target.value) || 0 } : i))}
                      className="w-full sm:w-20 input text-right text-xs py-1.5 sm:py-1"
                    />
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
                <span className="text-lg font-semibold text-[var(--text-primary)]">Total: {formatCurrency(cartTotal)}</span>
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
                  sublabel: hasOpenShift(String(p.id)) ? 'Turno abierto' : undefined,
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
                    onClick={() => setPayMethod(m)}
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
          {payMethod === 'mixed' && (
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
          {payMethod === 'credit' && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-xs text-yellow-400">
              ⚠ Se registrará como deuda. Debes seleccionar un cliente.
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
            {saving ? 'Registrando...' : `Confirmar — ${formatCurrency(cartTotal)}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
