'use client';
import { useEffect, useRef, useState } from 'react';
import { Play, Banknote, Store } from 'lucide-react';
import { api } from '@/lib/api-client';
import { toast } from '@/components/ui/toaster';
import Modal from '@/components/ui/Modal';
import SearchableSelect from '@/components/ui/SearchableSelect';
import { notifyShiftChanged } from '@/lib/shift-events';

interface OpenShiftModalProps {
  open: boolean;
  pos: Record<string, unknown>[];
  openPosIds: Set<string>;
  onClose: () => void;
  /** Se llama tras abrir el turno correctamente para que el padre refresque su estado local */
  onOpened: () => void;
  /**
   * Caja (punto de venta) a la que el usuario está asociado. Si se indica,
   * el modal solo muestra esa caja y la preselecciona: el vendedor asociado
   * no elige caja ni almacén.
   */
  preferredPosId?: string;
}

// ── Modal compartido de apertura de turno ─────────────────────────
// Usado desde el Topbar y el dashboard del vendedor para abrir un turno
// de caja (punto de venta) con fondo inicial y nota opcional.
// Preselecciona la primera caja sin turno abierto cada vez que se abre;
// si el usuario tiene una caja asignada (preferredPosId), solo se ofrece esa.

export default function OpenShiftModal({ open, pos, openPosIds, onClose, onOpened, preferredPosId }: OpenShiftModalProps) {
  const [posId, setPosId] = useState('');
  const [openingCash, setOpeningCash] = useState(0);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(false);

  // Cajas visibles: solo la asignada si el usuario tiene una
  const visiblePos = preferredPosId
    ? pos.filter(p => String(p.id) === preferredPosId)
    : pos;
  const preferredHasOpen = preferredPosId ? openPosIds.has(preferredPosId) : false;
  const preferredName = preferredPosId
    ? (visiblePos[0]?.name ? String(visiblePos[0].name) : preferredPosId)
    : '';

  // Solo al abrir: preseleccionar la caja (la asignada o la primera libre) y limpiar el formulario
  useEffect(() => {
    if (open && !wasOpen.current) {
      const free = preferredPosId
        ? visiblePos[0]
        : pos.find(p => !openPosIds.has(String(p.id)));
      setPosId(free ? String(free.id) : '');
      setOpeningCash(0);
      setNotes('');
    }
    wasOpen.current = open;
  }, [open, pos, visiblePos, openPosIds, preferredPosId]);

  async function handleOpen() {
    if (pos.length === 0) { toast.error('No hay cajas creadas. Créala en Almacenes → Cajas'); return; }
    if (!posId) { toast.error('Selecciona la caja donde abrirás el turno'); return; }
    setBusy(true);
    try {
      await api.openShift({ pos_id: posId, opening_cash: openingCash, notes });
      toast.success('Turno abierto correctamente');
      onClose();
      notifyShiftChanged();
      onOpened();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al abrir el turno');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Abrir turno de caja">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          {preferredPosId
            ? 'Estás asociado a una caja. Registra el efectivo que se entrega como fondo inicial y abre tu turno.'
            : 'Elige la caja, registra el efectivo que se entrega como fondo inicial y abre el turno. Solo puede haber un turno abierto por caja.'}
        </p>
        <div>
          <label className="label">Caja (punto de venta)</label>
          <SearchableSelect
            options={visiblePos.map(p => ({
              value: String(p.id),
              label: String(p.name),
              sublabel: openPosIds.has(String(p.id))
                ? (p.location_name ? `Turno abierto · ${String(p.location_name)}` : 'Turno abierto')
                : (p.location_name ? String(p.location_name) : undefined),
            }))}
            value={posId}
            onChange={setPosId}
            placeholder="Selecciona la caja…"
            noResultsMessage="No hay cajas creadas"
            disabled={visiblePos.length === 0}
          />
          {preferredPosId && (
            <p className="mt-2 text-xs text-[var(--text-tertiary)] flex items-center gap-1.5">
              <Store className="w-3.5 h-3.5 flex-shrink-0" />
              Tu caja asignada: <span className="text-[var(--text-secondary)] font-medium">{preferredName}</span>
            </p>
          )}
          {preferredHasOpen && (
            <p className="mt-2 text-xs text-yellow-400">
              Ya hay un turno abierto en tu caja. Ciérralo antes de abrir uno nuevo.
            </p>
          )}
          {!preferredPosId && (
            <p className="mt-2 text-xs text-[var(--text-tertiary)]">
              ¿Necesitas otra caja? Créala en{' '}
              <a href="/dashboard/almacenes?tab=cajas" className="text-brand-400 hover:text-brand-300 underline underline-offset-2 transition-colors">
                Almacenes → Cajas
              </a>
            </p>
          )}
        </div>
        <div>
          <label className="label">Fondo inicial en efectivo</label>
          <div className="relative">
            <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input type="number" min="0" step="1" className="input pl-9"
              value={openingCash || ''}
              onChange={e => setOpeningCash(parseFloat(e.target.value) || 0)}
            />
          </div>
        </div>
        <div>
          <label className="label">Nota (opcional)</label>
          <input type="text" className="input" placeholder="Ej: Turno mañana"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>
        <div className="flex flex-col xs:flex-row gap-2 justify-end pt-2">
          <button onClick={onClose} className="btn-secondary flex-1 xs:flex-none">Cancelar</button>
          <button onClick={handleOpen} disabled={busy || pos.length === 0 || preferredHasOpen} className="btn-primary flex-1 xs:flex-none gap-2 disabled:opacity-50">
            {busy ? 'Abriendo...' : <><Play className="w-3.5 h-3.5" />Abrir turno</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}
