// ── Helpers de zona horaria para turnos de caja (lado servidor) ──
// Las ventas se guardan en HORA LOCAL del negocio (TIMEZONE), mientras
// que shifts, expenses, cash_register, customer_payments y stock_movements
// se guardan en UTC (toISOString). Estas funciones convierten entre ambos
// formatos para que las ventanas de los turnos se comparen correctamente.
//
// IMPORTANTE: el driver de BD devuelve las columnas DATETIME como strings
// ISO 8601 (ej: "2026-08-06T05:00:36.000Z"), por lo que estas funciones
// aceptan tanto ISO como el formato BD "YYYY-MM-DD HH:MM:SS" y nunca lanzan.

const getTz = () => process.env.TIMEZONE ?? 'America/Havana';

/**
 * Parsea un timestamp (ISO 8601 o 'YYYY-MM-DD HH:MM:SS' tratado como UTC)
 * a un Date válido. Nunca lanza: devuelve null si no puede parsearlo.
 */
export function parseUtc(s: string | Date | null | undefined): Date | null {
  if (s == null || s === '') return null;
  if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
  const str = String(s).trim();
  if (!str) return null;
  const d = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)
    ? new Date(str)                        // ISO completo (ej: 2026-08-06T05:00:36.000Z)
    : new Date(str.replace(' ', 'T') + 'Z'); // 'YYYY-MM-DD HH:MM:SS' como UTC
  return isNaN(d.getTime()) ? null : d;
}

// Formatea un Date en la hora local del negocio ('YYYY-MM-DD HH:MM:SS').
// Devuelve '' si el Date es inválido (en lugar de lanzar RangeError).
export function fmtLocal(d: Date): string {
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: getTz(),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(d).replace(', ', ' ');
}

// Timestamp UTC (ISO o formato BD) → hora local del negocio
export function utcToLocal(s: string | Date | null | undefined): string {
  const d = parseUtc(s);
  return d ? fmtLocal(d) : '';
}

// Timestamp UTC (ISO o formato BD) → formato BD 'YYYY-MM-DD HH:MM:SS'
// (para comparar con columnas que se guardan en UTC)
export function utcToDb(s: string | Date | null | undefined): string {
  const d = parseUtc(s);
  return d ? d.toISOString().slice(0, 19).replace('T', ' ') : '';
}

// Hora local actual en el formato de BD
export function nowLocal(): string {
  return fmtLocal(new Date());
}

// Hora UTC actual en el formato de BD
export function nowUtc(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
