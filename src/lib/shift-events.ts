// ── Evento global de cambios de turno ─────────────────────────────
// Se dispara cuando un turno se abre o se cierra, para que el Topbar
// actualice el indicador de turno abierto al instante (sin esperar el
// polling de respaldo).

export const SHIFT_CHANGED_EVENT = 'shift:changed';

export function notifyShiftChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SHIFT_CHANGED_EVENT));
}

// ── Evento global de cambios en el resumen en vivo del turno ──────
// Se dispara cuando cambia la data que alimenta el acumulado del turno
// abierto (venta registrada/cancelada/pagada, abono de cliente, gasto
// o movimiento de caja). El Topbar lo escucha para refrescar la píldora
// al instante, sin esperar el polling de respaldo.

export const SHIFT_SUMMARY_CHANGED_EVENT = 'shift:summary-changed';

export function notifyShiftSummaryChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SHIFT_SUMMARY_CHANGED_EVENT));
}
