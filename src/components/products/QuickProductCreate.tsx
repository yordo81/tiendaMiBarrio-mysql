'use client';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import Modal from '@/components/ui/Modal';
import SearchableSelect from '@/components/ui/SearchableSelect';
import { toast } from '@/components/ui/toaster';
import { Barcode, Package } from 'lucide-react';

type AnyRecord = Record<string, unknown>;

interface QuickProductCreateProps {
  open: boolean;
  onClose: () => void;
  categories: AnyRecord[];
  /** Código de barras precargado (p. ej. el escaneado que no existía) */
  initialBarcode?: string;
  /** Costo precargado (p. ej. el precio unitario de la línea en edición) */
  initialCost?: number;
  /** Se llama con el producto recién creado para seleccionarlo en el flujo */
  onCreated: (product: AnyRecord) => void;
}

// ── Creación rápida de producto ──────────────────────────────────────
// Permite crear un producto nuevo en el momento (sin salir del modal de
// factura/compra) cuando el producto no existe todavía. El stock no se
// registra aquí: se agregará con la línea de compra que lo seleccione.

export default function QuickProductCreate({
  open, onClose, categories, initialBarcode, initialCost, onCreated,
}: QuickProductCreateProps) {
  const [form, setForm] = useState({
    name: '', barcode: '', category_id: '', unit: 'unidad',
    sale_price: 0, cost: 0, is_perishable: false, expiration_date: '',
  });
  const [saving, setSaving] = useState(false);

  // Reiniciar el formulario cada vez que se abre, precargando barcode/costo
  useEffect(() => {
    if (open) {
      setForm({
        name: '',
        barcode: initialBarcode ?? '',
        category_id: '',
        unit: 'unidad',
        sale_price: 0,
        cost: initialCost ?? 0,
        is_perishable: false,
        expiration_date: '',
      });
    }
  }, [open, initialBarcode, initialCost]);

  async function handleSave() {
    if (!String(form.name ?? '').trim()) { toast.error('Indica el nombre del producto'); return; }
    setSaving(true);
    try {
      const created = await api.createProduct({
        name: String(form.name).trim(),
        barcode: String(form.barcode ?? '').trim() || null,
        category_id: form.category_id || null,
        unit: String(form.unit || 'unidad').trim() || 'unidad',
        sale_price: Number(form.sale_price ?? 0),
        cost: Number(form.cost ?? 0),
        stock: 0,
        min_stock: 0,
        is_perishable: form.is_perishable,
        expiration_date: form.expiration_date || null,
        is_capital: false,
      });
      toast.success(`Producto "${String(form.name).trim()}" creado`);
      onCreated(created as AnyRecord);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al crear el producto');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nuevo producto (creación rápida)" size="md">
      <div className="space-y-4">
        <div>
          <label className="label">Nombre *</label>
          <input
            className="input"
            autoFocus
            placeholder="Ej: Detergente Xtra 1L"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div>
          <label className="label flex items-center gap-1.5">
            <Barcode className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            Código de barras
          </label>
          <input
            className="input font-mono"
            placeholder="Opcional — para escanearlo en el punto de venta"
            value={form.barcode}
            onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))}
            autoComplete="off"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Categoría</label>
            <SearchableSelect
              options={[
                { value: '', label: 'Sin categoría' },
                ...categories.map(c => ({ value: String(c.id), label: String(c.name) })),
              ]}
              value={form.category_id}
              onChange={v => setForm(f => ({ ...f, category_id: v }))}
              placeholder="Sin categoría"
              noResultsMessage="Sin categorías"
            />
          </div>
          <div>
            <label className="label">Unidad</label>
            <input
              className="input"
              value={form.unit}
              onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Precio de venta</label>
            <input
              type="number"
              min="0"
              step="1"
              className="input"
              value={form.sale_price || ''}
              onChange={e => setForm(f => ({ ...f, sale_price: parseFloat(e.target.value) || 0 }))}
            />
          </div>
          <div>
            <label className="label">Costo</label>
            <input
              type="number"
              min="0"
              step="1"
              className="input"
              value={form.cost || ''}
              onChange={e => setForm(f => ({ ...f, cost: parseFloat(e.target.value) || 0 }))}
            />
          </div>
        </div>

        {/* ¿Es perecedero? */}
        <div className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] p-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={form.is_perishable}
                onChange={e => setForm(f => ({ ...f, is_perishable: e.target.checked }))}
              />
              <div className="w-10 h-6 bg-[var(--bg-muted)] rounded-full peer-checked:bg-brand-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4" />
            </div>
            <div>
              <p className="text-sm text-[var(--text-primary)] font-medium">¿Es un producto perecedero?</p>
              <p className="text-xs text-[var(--text-tertiary)]">
                {form.is_perishable
                  ? 'Se solicitará fecha de caducidad en la línea de compra'
                  : 'Actívalo si tiene fecha de vencimiento (alimentos, lácteos, carnes…)'}
              </p>
            </div>
          </label>
          {form.is_perishable && (
            <div className="mt-3">
              <label className="label">Fecha de caducidad</label>
              <input
                type="date"
                className="input"
                value={form.expiration_date}
                onChange={e => setForm(f => ({ ...f, expiration_date: e.target.value }))}
              />
              <p className="text-[10px] text-[var(--text-tertiary)] mt-1">Opcional — puedes dejarlo vacío y asignarla en la línea de compra</p>
            </div>
          )}
        </div>

        <div className="flex flex-col xs:flex-row gap-2 xs:gap-3 pt-2">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={saving || !String(form.name ?? '').trim()}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {saving
              ? 'Creando...'
              : <span className="flex items-center justify-center gap-2"><Package className="w-4 h-4" />Crear producto</span>}
          </button>
        </div>
      </div>
    </Modal>
  );
}
