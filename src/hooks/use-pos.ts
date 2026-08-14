'use client';
import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { useWorkMode } from '@/lib/stores/settings-store';

// ── Selector de caja (punto de venta) en modales ──────────────────
// En modo turnos, carga las cajas y preselecciona la que tenga un turno
// abierto (o la primera). Expone posId, las opciones con su estado de
// turno abierto y un reset. Fuera del modo turnos no hace nada.

export function usePosSelector(active: boolean) {
  const workMode = useWorkMode();
  const [posId, setPosId] = useState('');
  const [posOptions, setPosOptions] = useState<Record<string, unknown>[]>([]);
  const [openShifts, setOpenShifts] = useState<Record<string, unknown>[]>([]);

  // Carga cajas y turnos abiertos. Conserva la caja ya seleccionada si sigue
  // existiendo (para refrescar el estado de los turnos sin perder la elección).
  const loadPos = useCallback(() => {
    if (!active || workMode !== 'shifts') return;
    api.getShifts()
      .then(d => {
        const pos = (d.pos ?? []) as Record<string, unknown>[];
        const openS = (d.open ?? []) as Record<string, unknown>[];
        setPosOptions(pos);
        setOpenShifts(openS);
        // Selección determinista: conservar la caja actual si existe; si no,
        // la primera caja con turno abierto; si no, la primera caja.
        setPosId(prev => {
          if (prev && pos.some(p => String(p.id) === prev)) return prev;
          const openIds = new Set(openS.map(s => String(s.pos_id)));
          const firstOpen = pos.find(p => openIds.has(String(p.id)));
          return firstOpen ? String(firstOpen.id) : pos.length > 0 ? String(pos[0].id) : '';
        });
      })
      .catch(() => {
        // Sin cajas o error transitorio: el selector queda vacío
        setPosOptions([]);
        setOpenShifts([]);
      });
  }, [active, workMode]);

  // Carga inicial (y al cambiar el modo de trabajo). Evita conservar una
  // caja vieja cuyo turno ya se cerró o que ya no exista.
  useEffect(() => {
    if (!active || workMode !== 'shifts') return;
    setPosId('');
    setPosOptions([]);
    setOpenShifts([]);
    loadPos();
  }, [loadPos]);

  const resetPos = useCallback(() => setPosId(''), []);
  // Refresca cajas/turnos sin perder la selección (p. ej. al abrir el cobro)
  const refreshPos = loadPos;

  const openPosIds = new Set(openShifts.map(s => String(s.pos_id)));
  const hasOpenShift = (id: string) => openPosIds.has(id);

  return {
    workMode,
    posId,
    setPosId,
    posOptions,
    openShifts,
    hasOpenShift,
    resetPos,
    refreshPos,
  };
}
