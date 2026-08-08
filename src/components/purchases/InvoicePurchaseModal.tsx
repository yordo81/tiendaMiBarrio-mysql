'use client';
import { useState, useEffect, useRef } from 'react';
import { formatCurrency, formatNumber, findProductByBarcode } from '@/lib/utils';
import { api } from '@/lib/api-client';
import Modal from '@/components/ui/Modal';
import SearchableSelect from '@/components/ui/SearchableSelect';
import { toast } from '@/components/ui/toaster';
import { notifyShiftSummaryChanged } from '@/lib/shift-events';
import { playScanBeep } from '@/lib/scan-beep';
import { usePosSelector } from '@/hooks/use-pos';
import { Receipt, Plus, Trash2, Barcode } from 'lucide-react';

type AnyRecord = Record<string, unknown>;

interface InvoiceLine {
  product_id: string;
  quantity: number;
  price: number;
  expiration_date: string;
}

interface InvoicePurchaseModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

// ── Entrada de inventario por factura (varios productos a la vez) ──
// Registra en una sola operación la compra de todos los productos de una
// factura: stock, costo promedio, historial de compras y contabilidad.

export default function InvoicePurchaseModal({ open, onClose, onSuccess }: InvoicePurchaseModalProps) {
  const [products, setProducts] = useState<AnyRecord[]>([]);
  const [suppliers, setSuppliers] = useState<AnyRecord[]>([]);
  const [locations, setLocations] = useState<AnyRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [form, setForm] = useState({ invoice_number: '', supplier_id: '', location_id: '', notes: '', is_capital: false });
  const [draft, setDraft] = useState({ product_id: '', quantity: 0, price: 0, expiration_date: '' });
  const [barcodeSearch, setBarcodeSearch] = useState('');
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const { workMode, posId, setPosId, posOptions, hasOpenShift, resetPos } = usePosSelector(open);
  const [locStockMap, setLocStockMap] = useState<Record<string, number>>({});

  // Enfocar el campo de código de barras al abrir el modal
  useEffect(() => {
    if (open) barcodeInputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    Promise.all([api.getProducts(), api.getSuppliers(), api.getLocations()])
      .then(([p, s, l]) => {
        setProducts(p);
        setSuppliers(s);
        setLocations(l);
        setForm(f => ({
          ...f,
          supplier_id: s.length > 0 ? String(s[0].id) : '',
          location_id: l.length > 0 ? String(l[0].id) : '',
        }));
      })
      .catch(() => toast.error('Error al cargar datos'));
  }, [open]);

  // Stock por almacén para mostrar el detalle de cada línea
  useEffect(() => {
    if (!form.location_id) { setLocStockMap({}); return; }
    api.getLocationStock(form.location_id)
      .then(stock => {
        const map: Record<string, number> = {};
        stock.forEach((s: AnyRecord) => { map[String(s.product_id)] = Number(s.quantity); });
        setLocStockMap(map);
      })
      .catch(() => setLocStockMap({}));
  }, [form.location_id]);

  const draftProduct = draft.product_id ? products.find(p => String(p.id) === draft.product_id) ?? null : null;

  function resetAll() {
    setLines([]);
    setDraft({ product_id: '', quantity: 0, price: 0, expiration_date: '' });
    setBarcodeSearch('');
    setForm({ invoice_number: '', supplier_id: '', location_id: '', notes: '', is_capital: false });
    resetPos();
  }

  function handleClose() {
    resetAll();
    onClose();
  }

  // Escaneo rápido: selecciona el producto en la línea en edición
  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = barcodeSearch.trim();
    if (!code) return;
    const found = findProductByBarcode(products, code);
    if (!found) {
      toast.error(`No se encontró producto con el código ${code}`);
      return;
    }
    setDraft(d => ({
      ...d,
      product_id: String(found.id),
      expiration_date: found.expiration_date ? String(found.expiration_date) : '',
    }));
    setBarcodeSearch('');
    playScanBeep();
  }

  function addLine() {
    if (!draft.product_id) { toast.error('Selecciona un producto'); return; }
    if (draft.quantity <= 0) { toast.error('La cantidad debe ser mayor a 0'); return; }
    if (draft.price < 0) { toast.error('El precio no puede ser negativo'); return; }
    // Si el producto ya está en la lista, se suma la cantidad y se promedia el precio
    setLines(prev => {
      const existing = prev.find(l => l.product_id === draft.product_id);
      if (existing) {
        return prev.map(l => {
          if (l.product_id !== draft.product_id) return l;
          const qty = l.quantity + draft.quantity;
          const price = Math.round(((l.price * l.quantity) + (draft.price * draft.quantity)) / qty * 100) / 100;
          return { ...l, quantity: qty, price, expiration_date: draft.expiration_date || l.expiration_date };
        });
      }
      return [...prev, { product_id: draft.product_id, quantity: draft.quantity, price: draft.price, expiration_date: draft.expiration_date }];
    });
    setDraft({ product_id: '', quantity: 0, price: 0, expiration_date: '' });
    setBarcodeSearch('');
    barcodeInputRef.current?.focus();
  }

  const total = lines.reduce((a, l) => a + l.quantity * l.price, 0);

  async function handleSave() {
    if (!form.invoice_number.trim()) { toast.error('Indica el número de factura'); return; }
    if (!form.supplier_id) { toast.error('Selecciona un proveedor'); return; }
    if (lines.length === 0) { toast.error('Agrega al menos un producto de la factura'); return; }
    setSaving(true);
    try {
      const res = await api.registerBulkPurchase({
        items: lines.map(l => ({
          product_id: l.product_id,
          quantity: l.quantity,
          price: l.price,
          expiration_date: l.expiration_date || null,
        })),
        supplier_id: form.supplier_id,
        location_id: form.location_id || null,
        invoice_number: form.invoice_number.trim(),
        notes: form.notes || null,
        is_capital: form.is_capital,
        pos_id: workMode === 'shifts' ? posId || null : null,
      }) as { purchase_count?: number; total_cost?: number };
      toast.success(`Factura registrada: ${res.purchase_count ?? lines.length} producto(s) — total ${formatCurrency(res.total_cost ?? total)}`);
      notifyShiftSummaryChanged();
      handleClose();
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar la factura');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Entrada por factura" size="xl">
      <div className="space-y-4">
        {/* Datos de la factura */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-1">
            <label className="label">Número de factura *</label>
            <input
              className="input"
              placeholder="Ej: F-001234"
              value={form.invoice_number}
              onChange={e => setForm(f => ({ ...f, invoice_number: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Proveedor *</label>
            <SearchableSelect
              options={[
                { value: '', label: 'Seleccionar...' },
                ...suppliers.map(s => ({ value: String(s.id), label: String(s.name) })),
              ]}
              value={form.supplier_id}
              onChange={v => setForm(f => ({ ...f, supplier_id: v }))}
              placeholder="Seleccionar..."
              noResultsMessage="Sin proveedores"
            />
          </div>
          <div>
            <label className="label">Almacén destino</label>
            <SearchableSelect
              options={locations.map(l => ({ value: String(l.id), label: String(l.name) }))}
              value={form.location_id}
              onChange={v => setForm(f => ({ ...f, location_id: v }))}
              placeholder="Seleccionar almacén"
              noResultsMessage="Sin almacenes"
            />
          </div>
        </div>

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
              <p className="text-[10px] text-yellow-400 mt-1">Esta caja no tiene un turno abierto. La compra no se incluirá en ningún arqueo.</p>
            )}
          </div>
        )}

        {/* Escaneo rápido */}
        <div>
          <label className="label">Código de barras</label>
          <form onSubmit={handleBarcodeSubmit} className="relative">
            <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              ref={barcodeInputRef}
              className="input pl-9 font-mono"
              placeholder="Escanear... (selecciona el producto en la línea)"
              value={barcodeSearch}
              onChange={e => setBarcodeSearch(e.target.value)}
              autoComplete="off"
            />
          </form>
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1">Escanea el código y presiona Enter para seleccionar el producto de la línea en edición</p>
        </div>

        {/* Línea en edición */}
        <div className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-secondary)] p-3 space-y-3">
          <p className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">Agregar producto de la factura</p>
          <div>
            <label className="label">Producto *</label>
            <SearchableSelect
              options={products.map(p => {
                const locStock = form.location_id ? (locStockMap[String(p.id)] ?? 0) : Number(p.stock ?? 0);
                const lowS = Number(p.stock) <= Number(p.min_stock);
                const stockLabel = `Stock: ${formatNumber(locStock, 1)} ${String(p.unit ?? '')}`;
                const costLabel = `Costo: ${formatCurrency(Number(p.cost))}`;
                return {
                  value: String(p.id),
                  label: String(p.barcode) ? `${String(p.name)} — ${String(p.barcode)}` : String(p.name),
                  sublabel: lowS ? `${stockLabel} · ${costLabel} ⚠️` : `${stockLabel} · ${costLabel}`,
                };
              })}
              value={draft.product_id}
              onChange={v => {
                const prod = products.find(p => String(p.id) === v);
                setDraft(d => ({
                  ...d,
                  product_id: v,
                  expiration_date: prod?.expiration_date ? String(prod.expiration_date) : '',
                }));
              }}
              placeholder="Buscar producto…"
              noResultsMessage="No se encontraron productos"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="label">Cantidad *</label>
              <input
                type="number"
                min="1"
                step="1"
                className="input"
                value={draft.quantity || ''}
                onChange={e => setDraft(d => ({ ...d, quantity: parseFloat(e.target.value) || 0 }))}
              />
            </div>
            <div>
              <label className="label">Precio unitario *</label>
              <input
                type="number"
                min="0"
                step="1"
                className="input"
                value={draft.price || ''}
                onChange={e => setDraft(d => ({ ...d, price: parseFloat(e.target.value) || 0 }))}
              />
            </div>
            {draftProduct?.is_perishable ? (
              <div>
                <label className="label">Caducidad del lote</label>
                <input
                  type="date"
                  className="input"
                  value={draft.expiration_date}
                  onChange={e => setDraft(d => ({ ...d, expiration_date: e.target.value }))}
                />
              </div>
            ) : (
              <div className="hidden sm:block" />
            )}
          </div>
          <div className="flex justify-end">
            <button onClick={addLine} className="btn-primary flex items-center gap-1.5 text-sm px-4 py-2">
              <Plus className="w-4 h-4" />Agregar línea
            </button>
          </div>
        </div>

        {/* Líneas agregadas */}
        {lines.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
              Líneas de la factura ({lines.length})
            </p>
            <div className="divide-y divide-[var(--border-primary)] border border-[var(--border-primary)] rounded-xl overflow-hidden bg-[var(--bg-primary)]">
              {lines.map((l, i) => {
                const prod = products.find(p => String(p.id) === l.product_id);
                return (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="text-[var(--text-primary)] font-medium truncate">{String(prod?.name ?? 'Producto')}</p>
                      <p className="text-xs text-[var(--text-tertiary)] truncate">
                        {formatNumber(l.quantity, 2)} × {formatCurrency(l.price)}
                        {l.expiration_date ? ` · Vence: ${String(l.expiration_date).split('-').reverse().join('/')}` : ''}
                      </p>
                    </div>
                    <span className="font-semibold text-[var(--text-primary)] shrink-0">{formatCurrency(l.quantity * l.price)}</span>
                    <button
                      onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))}
                      className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                      title="Quitar línea"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between text-sm bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl px-3 py-2.5">
              <span className="text-[var(--text-secondary)]">Total de la factura</span>
              <span className="font-semibold text-brand-400">{formatCurrency(total)}</span>
            </div>
          </div>
        )}

        <div>
          <label className="label">Notas (opcional)</label>
          <input
            className="input"
            placeholder="Ej: Pedido #45, lote 2026..."
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>

        {/* Tipo de inversión */}
        <div className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] p-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={form.is_capital}
                onChange={e => setForm(f => ({ ...f, is_capital: e.target.checked }))}
              />
              <div className="w-10 h-6 bg-[var(--bg-muted)] rounded-full peer-checked:bg-brand-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
            </div>
            <div>
              <p className="text-sm text-[var(--text-primary)] font-medium">¿Es aporte de capital nuevo?</p>
              <p className="text-xs text-[var(--text-tertiary)]">
                {form.is_capital
                  ? 'Se registrará como ingreso de nuevo capital del dueño (incrementa el saldo disponible)'
                  : 'Se registrará como reinversión de ganancias (egreso de caja por compra de inventario)'}
              </p>
            </div>
          </label>
        </div>

        <div className="flex flex-col xs:flex-row gap-2 xs:gap-3 pt-2">
          <button onClick={handleClose} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={saving || lines.length === 0 || !form.invoice_number.trim() || !form.supplier_id}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {saving
              ? 'Registrando...'
              : <span className="flex items-center justify-center gap-2"><Receipt className="w-4 h-4" />Registrar factura</span>}
          </button>
        </div>
      </div>
    </Modal>
  );
}
