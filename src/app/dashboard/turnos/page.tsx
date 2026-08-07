'use client';
import { useEffect, useState, useCallback } from 'react';
import { formatCurrency, formatDateTime, cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { toast } from '@/components/ui/toaster';
import Modal from '@/components/ui/Modal';
import EmptyState from '@/components/ui/EmptyState';
import SearchableSelect from '@/components/ui/SearchableSelect';
import { useSettingsStore } from '@/lib/stores/settings-store';
import ShiftReportModal from '@/components/shifts/ShiftReportModal';
import { Clock3, Play, Square, FileText, Banknote, Settings } from 'lucide-react';

type R = Record<string, unknown>;

// ── Módulo de Turnos de caja (modo por turnos) ────────────────────
// Módulo independiente de Contabilidad. Solo tiene sentido cuando
// settings.work_mode = 'shifts' (se configura en Configuración).
// Si el modo es 'daily', se muestra un aviso en lugar del módulo.

export default function TurnosPage() {
  const workMode = useSettingsStore(s => s.settings?.work_mode ?? 'daily');
  const settingsLoaded = useSettingsStore(s => s.loaded);
  const loadSettings = useSettingsStore(s => s.load);
  const [shiftsData, setShiftsData] = useState<{ open: R[]; shifts: R[]; pos: R[] }>({ open: [], shifts: [], pos: [] });
  const [loading, setLoading] = useState(true);
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [openForm, setOpenForm] = useState({ pos_id: '', opening_cash: 0, notes: '' });
  const [closeShift, setCloseShift] = useState<R | null>(null);
  const [closeForm, setCloseForm] = useState({ closing_cash: 0, notes: '' });
  const [shiftBusy, setShiftBusy] = useState(false);
  const [reportShiftId, setReportShiftId] = useState<string | null>(null);

  // Cargar la configuración para saber si el sistema trabaja por turnos
  useEffect(() => { loadSettings(); }, [loadSettings]);

  const load = useCallback(async () => {
    try {
      const d = await api.getShifts();
      setShiftsData({
        open: (d.open ?? []) as R[],
        shifts: (d.shifts ?? []) as R[],
        pos: (d.pos ?? []) as R[],
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cargar los turnos');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleOpenShift() {
    if (!openForm.pos_id) {
      toast.error('Selecciona la caja donde abrirás el turno');
      return;
    }
    setShiftBusy(true);
    try {
      await api.openShift({ pos_id: openForm.pos_id, opening_cash: openForm.opening_cash, notes: openForm.notes });
      toast.success('Turno abierto correctamente');
      setShowOpenModal(false);
      setOpenForm({ pos_id: '', opening_cash: 0, notes: '' });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al abrir el turno');
    } finally {
      setShiftBusy(false);
    }
  }

  async function handleCloseShift() {
    if (!closeShift) return;
    setShiftBusy(true);
    try {
      await api.closeShift(String(closeShift.id), { closing_cash: closeForm.closing_cash, notes: closeForm.notes });
      toast.success('Turno cerrado con arqueo');
      setShowCloseModal(false);
      setCloseShift(null);
      setCloseForm({ closing_cash: 0, notes: '' });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al cerrar el turno');
    } finally {
      setShiftBusy(false);
    }
  }

  // Cajas que ya tienen un turno abierto (para marcarlas al abrir uno nuevo)
  const openPosIds = new Set(shiftsData.open.map(s => String(s.pos_id)));

  if (!settingsLoaded || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (workMode !== 'shifts') {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-500/15 rounded-xl flex items-center justify-center">
            <Clock3 className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">Turnos de caja</h1>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">Apertura, cierre y arqueo de turnos por punto de venta</p>
          </div>
        </div>
        <EmptyState
          icon={Clock3}
          title="Módulo de turnos inactivo"
          description="El sistema está configurado para trabajar por días. Activa el modo por turnos en Configuración para gestionar turnos de caja."
          action={
            <a href="/dashboard/configuracion" className="btn-primary flex items-center gap-1.5">
              <Settings className="w-4 h-4" />Ir a Configuración
            </a>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-brand-500/15 rounded-xl flex items-center justify-center">
          <Clock3 className="w-5 h-5 text-brand-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Turnos de caja</h1>
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">Apertura, cierre y arqueo de turnos por punto de venta</p>
        </div>
      </div>

      {/* ── Turnos de caja por punto de venta ── */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-500/15 border border-brand-500/20 flex items-center justify-center">
              <Clock3 className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Turnos de caja por punto de venta</h3>
              <p className="text-xs text-[var(--text-tertiary)]">
                {shiftsData.open.length > 0 ? (
                  <span className="text-green-400">{shiftsData.open.length} caja(s) con turno abierto</span>
                ) : 'No hay turnos abiertos'}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              const freePos = shiftsData.pos.find(p => !openPosIds.has(String(p.id)));
              setOpenForm({ pos_id: freePos ? String(freePos.id) : '', opening_cash: 0, notes: '' });
              setShowOpenModal(true);
            }}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            <Play className="w-3.5 h-3.5" />Abrir turno
          </button>
        </div>

        {/* Turnos abiertos: uno por caja */}
        {shiftsData.open.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            {shiftsData.open.map(s => (
              <div key={String(s.id)} className="bg-[var(--bg-primary)] border border-green-500/20 rounded-xl p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-brand-500/15 text-brand-400 border border-brand-500/25 truncate">
                      {String(s.pos_name ?? 'Caja')}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />Abierto
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => setReportShiftId(String(s.id))}
                      className="p-2 rounded-lg border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-brand-400 hover:border-brand-500/40 transition-colors"
                      title="Ver reporte del turno"
                    >
                      <FileText className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => { setCloseShift(s); setCloseForm({ closing_cash: 0, notes: '' }); setShowCloseModal(true); }}
                      className="btn-primary flex items-center gap-1.5 text-xs px-3 py-2"
                    >
                      <Square className="w-3 h-3" />Cerrar turno
                    </button>
                  </div>
                </div>
                <p className="text-xs text-[var(--text-tertiary)] truncate">
                  Abierto por <span className="text-[var(--text-secondary)] font-medium">{String(s.user_name ?? '—')}</span> desde {formatDateTime(String(s.opened_at))}
                </p>
                <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-[var(--border-primary)]">
                  <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide font-medium">Fondo inicial</span>
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{formatCurrency(Number(s.opening_cash ?? 0))}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[var(--bg-primary)] border border-dashed border-[var(--border-secondary)] rounded-xl px-4 py-5 text-center mb-4">
            <p className="text-sm text-[var(--text-tertiary)]">
              Sin turnos abiertos. Abre un turno en una de tus cajas para operar en modo turnos.
            </p>
          </div>
        )}

        {shiftsData.shifts.length > 0 && (
          <div>
            <p className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide mb-2">Últimos turnos cerrados</p>
            <div className="space-y-2">
              {shiftsData.shifts.slice(0, 4).map(s => {
                const hasArqueo = s.closing_cash != null;
                const diff = Number(s.difference ?? 0);
                return (
                  <div key={String(s.id)} className="flex items-center justify-between gap-3 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl px-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="text-[var(--text-primary)] font-medium truncate">
                        {formatDateTime(String(s.opened_at))} → {s.closed_at ? formatDateTime(String(s.closed_at)) : '—'}
                      </p>
                      <p className="text-xs text-[var(--text-tertiary)] truncate">
                        {String(s.pos_name ?? 'Caja')}{' · '}Abierto por {String(s.user_name ?? '—')}{s.closed_by_name ? ` · Cerrado por ${String(s.closed_by_name)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-right shrink-0">
                      <div>
                        <p className="text-xs text-[var(--text-tertiary)]">
                          Esperado: {s.expected_cash != null ? formatCurrency(Number(s.expected_cash)) : '—'}
                        </p>
                        <p className={cn('text-xs font-medium', !hasArqueo ? 'text-[var(--text-tertiary)]' : diff === 0 ? 'text-[var(--text-tertiary)]' : diff > 0 ? 'text-green-400' : 'text-red-400')}>
                          {hasArqueo ? (
                            <>Contado: {formatCurrency(Number(s.closing_cash))} · Dif: {diff > 0 ? '+' : ''}{formatCurrency(diff)}</>
                          ) : (
                            'Sin arqueo (cerrado automáticamente)'
                          )}
                        </p>
                      </div>
                      <button
                        onClick={() => setReportShiftId(String(s.id))}
                        className="p-2 rounded-lg border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-brand-400 hover:border-brand-500/40 transition-colors"
                        title="Ver reporte del turno"
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal: Abrir turno */}
      <Modal open={showOpenModal} onClose={() => setShowOpenModal(false)} title="Abrir turno de caja">
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Elige la caja, registra el efectivo que se entrega como fondo inicial y abre el turno.
            Solo puede haber un turno abierto por caja.
          </p>
          <div>
            <label className="label">Caja (punto de venta)</label>
            <SearchableSelect
              options={shiftsData.pos.map(p => ({
                value: String(p.id),
                label: String(p.name),
                sublabel: openPosIds.has(String(p.id))
                  ? (p.location_name ? `Turno abierto · ${String(p.location_name)}` : 'Turno abierto')
                  : (p.location_name ? String(p.location_name) : undefined),
              }))}
              value={openForm.pos_id}
              onChange={v => setOpenForm(f => ({ ...f, pos_id: v }))}
              placeholder="Selecciona la caja…"
              noResultsMessage="No hay cajas creadas"
              disabled={shiftsData.pos.length === 0}
            />
            <p className="mt-2 text-xs text-[var(--text-tertiary)]">
              ¿Necesitas otra caja? Créala en{' '}
              <a href="/dashboard/almacenes?tab=cajas" className="text-brand-400 hover:text-brand-300 underline underline-offset-2 transition-colors">
                Almacenes → Cajas
              </a>
            </p>
          </div>
          <div>
            <label className="label">Fondo inicial en efectivo</label>
            <div className="relative">
              <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
              <input type="number" min="0" step="1" className="input pl-9"
                value={openForm.opening_cash || ''}
                onChange={e => setOpenForm(f => ({ ...f, opening_cash: parseFloat(e.target.value) || 0 }))}
              />
            </div>
          </div>
          <div>
            <label className="label">Nota (opcional)</label>
            <input type="text" className="input" placeholder="Ej: Turno mañana"
              value={openForm.notes}
              onChange={e => setOpenForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="flex flex-col xs:flex-row gap-2 justify-end pt-2">
            <button onClick={() => setShowOpenModal(false)} className="btn-secondary flex-1 xs:flex-none">Cancelar</button>
            <button onClick={handleOpenShift} disabled={shiftBusy} className="btn-primary flex-1 xs:flex-none disabled:opacity-50">
              {shiftBusy ? 'Abriendo...' : 'Abrir turno'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Cerrar turno */}
      <Modal open={showCloseModal} onClose={() => setShowCloseModal(false)} title="Cerrar turno — arqueo de caja">
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Cuenta el efectivo en caja y regístralo. El sistema calculará el efectivo esperado según los
            movimientos del turno y la diferencia.
          </p>
          <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl p-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-[var(--text-tertiary)]">Caja</p>
              <p className="font-medium text-[var(--text-primary)] truncate">{String(closeShift?.pos_name ?? '—')}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-tertiary)]">Abierto por</p>
              <p className="font-medium text-[var(--text-primary)] truncate">{String(closeShift?.user_name ?? '—')}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-tertiary)]">Fondo inicial</p>
              <p className="font-medium text-[var(--text-primary)]">{formatCurrency(Number(closeShift?.opening_cash ?? 0))}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-tertiary)]">Abierto desde</p>
              <p className="font-medium text-[var(--text-primary)] truncate">{closeShift?.opened_at ? formatDateTime(String(closeShift.opened_at)) : '—'}</p>
            </div>
          </div>
          <div>
            <label className="label">Efectivo contado en caja *</label>
            <div className="relative">
              <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
              <input type="number" min="0" step="1" className="input pl-9"
                value={closeForm.closing_cash || ''}
                onChange={e => setCloseForm(f => ({ ...f, closing_cash: parseFloat(e.target.value) || 0 }))}
              />
            </div>
          </div>
          <div>
            <label className="label">Nota (opcional)</label>
            <input type="text" className="input" placeholder="Ej: Turno cerrado sin novedades"
              value={closeForm.notes}
              onChange={e => setCloseForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="flex flex-col xs:flex-row gap-2 justify-end pt-2">
            <button onClick={() => setShowCloseModal(false)} className="btn-secondary flex-1 xs:flex-none">Cancelar</button>
            <button
              onClick={handleCloseShift}
              disabled={shiftBusy || closeForm.closing_cash < 0}
              className="btn-primary flex-1 xs:flex-none disabled:opacity-50"
            >
              {shiftBusy ? 'Cerrando...' : 'Cerrar turno'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Reporte del turno */}
      <ShiftReportModal
        open={reportShiftId !== null}
        shiftId={reportShiftId}
        onClose={() => setReportShiftId(null)}
      />
    </div>
  );
}
