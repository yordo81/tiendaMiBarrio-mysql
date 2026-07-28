'use client';
import { useState, useEffect } from 'react';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { api } from '@/lib/api-client';
import Modal from '@/components/ui/Modal';
import SearchableSelect from '@/components/ui/SearchableSelect';
import { toast } from '@/components/ui/toaster';
import { ShoppingBag } from 'lucide-react';

type AnyRecord = Record<string, unknown>;

interface PurchaseModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function PurchaseModal({ open, onClose, onSuccess }: PurchaseModalProps) {
  const [products, setProducts] = useState<AnyRecord[]>([]);
  const [suppliers, setSuppliers] = useState<AnyRecord[]>([]);
  const [locations, setLocations] = useState<AnyRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [purchaseLocStockMap, setPurchaseLocStockMap] = useState<Record<string, number>>({});
  const [form, setForm] = useState({
    product_id: '',
    supplier_id: '',
    quantity: 0,
    price: 0,
    location_id: '',
    notes: '',
    is_capital: false,
    expiration_date: '',
  });

  useEffect(() => {
    if (!open) return;
    Promise.all([api.getProducts(), api.getSuppliers(), api.getLocations()])
      .then(([p, s, l]) => {
        setProducts(p);
        setSuppliers(s);
        setLocations(l);
        setForm(f => ({
          ...f,
          location_id: l.length > 0 ? String(l[0].id) : '',
          supplier_id: s.length > 0 ? String(s[0].id) : '',
        }));
      })
      .catch(() => toast.error('Error al cargar datos'));
  }, [open]);

  // Fetch location-specific stock
  useEffect(() => {
    if (form.location_id) {
      api.getLocationStock(form.location_id)
        .then(stock => {
          const map: Record<string, number> = {};
          stock.forEach((s: Record<string, unknown>) => { map[String(s.product_id)] = Number(s.quantity); });
          setPurchaseLocStockMap(map);
        })
        .catch(() => setPurchaseLocStockMap({}));
    } else {
      setPurchaseLocStockMap({});
    }
  }, [form.location_id]);

  function handleClose() {
    setForm({ product_id: '', supplier_id: '', quantity: 0, price: 0, location_id: '', notes: '', is_capital: false, expiration_date: '' });
    onClose();
  }

  async function handleSave() {
    if (!form.product_id || !form.supplier_id || form.quantity <= 0 || form.price < 0) {
      toast.error('Completa todos los campos requeridos');
      return;
    }
    setSaving(true);
    try {
      const res = await api.registerPurchase({
        product_id: form.product_id,
        supplier_id: form.supplier_id,
        quantity: form.quantity,
        price: form.price,
        location_id: form.location_id,
        notes: form.notes,
        is_capital: form.is_capital,
        expiration_date: form.expiration_date || null,
      });
      toast.success(`Compra registrada — costo promedio: $${Number((res as any).cost_after).toFixed(2)}`);
      handleClose();
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al registrar compra');
    } finally {
      setSaving(false);
    }
  }

  const selectedProduct = form.product_id ? products.find(p => String(p.id) === form.product_id) : null;

  return (
    <Modal open={open} onClose={handleClose} title="Registrar compra" size="md">
      <div className="space-y-4">
        <div>
          <label className="label">Producto *</label>
          <SearchableSelect
            options={products.map(p => {
              const locStock = form.location_id ? (purchaseLocStockMap[String(p.id)] ?? 0) : Number(p.stock ?? 0);
              const lowS = Number(p.stock) <= Number(p.min_stock);
              const stockLabel = `Stock: ${formatNumber(locStock, 1)} ${String(p.unit ?? '')}`;
              const costLabel = `Costo: ${formatCurrency(Number(p.cost))}`;
              return {
                value: String(p.id),
                label: String(p.name),
                sublabel: lowS ? `${stockLabel} · ${costLabel} ⚠️` : `${stockLabel} · ${costLabel}`,
              };
            })}
            value={form.product_id}
            onChange={v => {
              const prod = products.find(p => String(p.id) === v);
              setForm(f => ({
                ...f,
                product_id: v,
                expiration_date: prod?.expiration_date ? String(prod.expiration_date) : '',
              }));
            }}
            placeholder="Buscar producto…"
            noResultsMessage="No se encontraron productos"
          />
          {/* Expiration date for perishable products */}
          {Boolean(selectedProduct?.is_perishable) && (
            <div className="mt-3">
              <label className="label">Fecha de caducidad del lote</label>
              <input
                type="date"
                className="input"
                value={form.expiration_date}
                onChange={e => setForm(f => ({ ...f, expiration_date: e.target.value }))}
              />
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                {selectedProduct?.expiration_date
                  ? `Fecha actual del producto: ${String(selectedProduct.expiration_date).split('-').reverse().join('/')}. Cámbiala si este lote tiene una fecha diferente.`
                  : 'Asigna la fecha de vencimiento de este lote'}
              </p>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
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
          <div>
            <label className="label">Cantidad *</label>
            <input
              type="number"
              min="1"
              step="1"
              className="input"
              value={form.quantity || ''}
              onChange={e => setForm(f => ({ ...f, quantity: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <div>
            <label className="label">Precio unitario *</label>
            <input
              type="number"
              min="0"
              step="1"
              className="input"
              value={form.price || ''}
              onChange={e => setForm(f => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
            />
          </div>
        </div>
        <div>
          <label className="label">Notas</label>
          <input
            className="input"
            placeholder="Ej: Factura #123, lote..."
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>

        {/* Capital investment toggle */}
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

        {/* Cost average summary */}
        {form.product_id !== '' && form.quantity > 0 && form.price >= 0 && (() => {
          const prod = products.find(p => String(p.id) === form.product_id);
          if (!prod) return null;
          const currentStock = Number(prod.stock ?? 0);
          const currentCost = Number(prod.cost ?? 0);
          const newStock = currentStock + form.quantity;
          const newCost = ((currentStock * currentCost) + (form.quantity * form.price)) / newStock;
          const totalCost = form.quantity * form.price;
          return (
            <div className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] p-3 text-sm space-y-1.5">
              <p className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">Resumen de la compra</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <p className="text-[var(--text-tertiary)]">Stock actual (global):</p>
                <p className="text-[var(--text-primary)] text-right">{formatNumber(currentStock, 1)}</p>
                {form.location_id && <p className="text-[var(--text-tertiary)]">Stock en este almacén:</p>}
                {form.location_id && (
                  <p className="text-brand-400 text-right font-medium">
                    {formatNumber(purchaseLocStockMap[String(prod.id)] ?? 0, 1)}
                  </p>
                )}
                <p className="text-[var(--text-tertiary)]">Stock después:</p>
                <p className="text-green-400 text-right font-medium">{formatNumber(newStock, 1)}</p>
                <p className="text-[var(--text-tertiary)]">Costo actual:</p>
                <p className="text-[var(--text-primary)] text-right">{formatCurrency(currentCost)}</p>
                <p className="text-[var(--text-tertiary)]">Nuevo costo promedio:</p>
                <p className="text-brand-400 text-right font-semibold">{formatCurrency(Math.round(newCost * 100) / 100)}</p>
                <p className="text-[var(--text-tertiary)]">Total compra:</p>
                <p className="text-[var(--text-primary)] text-right font-medium">{formatCurrency(totalCost)}</p>
              </div>
            </div>
          );
        })()}

        <div className="flex flex-col xs:flex-row gap-2 xs:gap-3 pt-2">
          <button onClick={handleClose} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={saving || !form.product_id || !form.supplier_id || form.quantity <= 0}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {saving
              ? 'Registrando...'
              : <span className="flex items-center justify-center gap-2"><ShoppingBag className="w-4 h-4" />Registrar compra</span>}
          </button>
        </div>
      </div>
    </Modal>
  );
}
