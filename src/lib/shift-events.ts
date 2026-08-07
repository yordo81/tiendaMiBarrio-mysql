// ── Evento global de cambios de turno ─────────────────────────────
// Se dispara cuando un turno se abre o se cierra, para que el Topbar
// actualice el indicador de turno abierto al instante (sin esperar el
// polling de respaldo).

export const SHIFT_CHANGED_EVENT = 'shift:changed';

export function notifyShiftChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SHIFT_CHANGED_EVENT));
}
