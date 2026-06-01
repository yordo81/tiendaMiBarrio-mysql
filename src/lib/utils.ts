import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

// Currency — configurable, defaults to DOP
export function formatCurrency(n: number, currency = 'DOP') {
  return `$${new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2 }).format(n)}`;
}

export function formatNumber(n: number, d = 2) {
  return new Intl.NumberFormat('es-DO', {
    minimumFractionDigits: 0, maximumFractionDigits: d,
  }).format(n);
}

export function formatDate(d: string | Date, fmt = 'dd/MM/yyyy') {
  return format(new Date(d), fmt, { locale: es });
}

export function formatDateTime(d: string | Date) {
  return format(new Date(d), 'dd/MM/yyyy HH:mm', { locale: es });
}

export function timeAgo(d: string | Date) {
  return formatDistanceToNow(new Date(d), { addSuffix: true, locale: es });
}

export function generateId() { return crypto.randomUUID(); }

export function calcMargin(sale: number, cost: number) {
  return sale > 0 ? ((sale - cost) / sale) * 100 : 0;
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
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
