import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';
import { tz } from '@date-fns/tz';
import { es } from 'date-fns/locale';

// ── Funciones utilitarias compartidas ──────────────────────────

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

// Formato de moneda — configurable, por defecto DOP (pesos dominicanos)
export function formatCurrency(n: number, currency = 'DOP') {
  if (typeof n !== 'number' || isNaN(n)) return '$0.00';
  return `$${new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2 }).format(n)}`;
}

/**
 * Formatea un monto con el símbolo de la moneda en que fue cobrado.
 * A diferencia de formatCurrency (que siempre antepone "$"), usa el
 * símbolo real guardado en la tabla currencies (ej: "€", "₱", "$"),
 * y acepta el código como respaldo cuando no hay símbolo.
 * Ej: formatMoney(1200, '$', 'CUP') → "$1,200.00"
 *     formatMoney(20, null, 'USD') → "USD 20.00"
 */
export function formatMoney(n: number, symbol?: string | null, code?: string | null): string {
  if (typeof n !== 'number' || isNaN(n)) n = 0;
  const formatted = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const sym = (symbol ?? '').trim();
  if (sym) return `${sym}${formatted}`;
  const c = (code ?? '').trim().toUpperCase();
  return c ? `${c} ${formatted}` : `$${formatted}`;
}

export function formatNumber(n: number, d = 2) {
  return new Intl.NumberFormat('es-DO', {
    minimumFractionDigits: 0, maximumFractionDigits: d,
  }).format(n);
}

const getTz = () => process.env.TIMEZONE ?? 'America/Havana';

export function formatDate(d: string | Date, fmt = 'dd/MM/yyyy') {
  return format(d, fmt, { in: tz(getTz()), locale: es });
}

export function formatDateTime(d: string | Date) {
  return format(d, 'dd/MM/yyyy HH:mm', { in: tz(getTz()), locale: es });
}

export function timeAgo(d: string | Date) {
  return formatDistanceToNow(d, { in: tz(getTz()), addSuffix: true, locale: es });
}

/**
 * Genera un UUID v4 con soporte para contextos no seguros (HTTP).
 * crypto.randomUUID() solo existe en contextos seguros (HTTPS/localhost);
 * al acceder por HTTP desde la red local (ej: despliegue Docker en LAN),
 * caemos a crypto.getRandomValues, que sí está disponible sin HTTPS.
 */
export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Último recurso (navegadores muy antiguos): valores aleatorios con Math.random
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function generateId() { return randomUUID(); }

export function calcMargin(sale: number, cost: number) {
  return sale > 0 ? ((sale - cost) / sale) * 100 : 0;
}

// Busca un producto por coincidencia exacta de código de barras (ignorando mayúsculas)
export function findProductByBarcode<T extends { barcode?: unknown }>(products: T[], code: string): T | undefined {
  const normalized = code.trim().toLowerCase();
  if (!normalized) return undefined;
  return products.find(p => String(p.barcode ?? '').toLowerCase() === normalized);
}

export function calcDaysUntilEmpty(stock: number, avgDaily: number) {
  return avgDaily > 0 ? Math.floor(stock / avgDaily) : Infinity;
}

export function getUrgency(days: number): 'critical' | 'soon' | 'ok' {
  return days <= 3 ? 'critical' : days <= 7 ? 'soon' : 'ok';
}

export function classifyRole(role: string) {
  return ({ owner: 'Dueño', admin: 'Administrador', seller: 'Vendedor', warehouse: 'Bodeguero' })[role] ?? role;
}

export function now() {
  return format(new Date(), 'yyyy-MM-dd HH:mm:ss', { in: tz(getTz()) });
}
