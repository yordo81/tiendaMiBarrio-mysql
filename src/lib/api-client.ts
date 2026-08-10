// ── Cliente API tipado para todas las llamadas del frontend ─────────────────
// Proporciona una capa de abstracción sobre fetch con manejo centralizado de
// errores, tipado genérico y detección de sesión expirada.

/**
 * Nombre del evento global que se dispara cuando una llamada API retorna 401.
 * Los componentes pueden escuchar este evento para mostrar notificaciones
 * de sesión expirada sin forzar un redirect.
 */
export const UNAUTHORIZED_EVENT = 'api:unauthorized';

/**
 * Detalle del evento personalizado para errores 401.
 * Incluye la URL que causó el error para facilitar la depuración.
 */
export interface UnauthorizedEventDetail {
  url: string;
  message: string;
}

/** Forma de la configuración del negocio devuelta por /api/settings */
export interface SettingsDto {
  business_name: string;
  logo_url: string | null;
  work_mode: 'daily' | 'shifts';
  receipt_printer_width: '57' | '80';
  receipt_print_method: 'browser' | 'usb';
  receipt_auto_print: boolean;
}

/** Impresora registrada devuelta por /api/printers */
export interface PrinterDto {
  id: string;
  name: string;
  vendor_id: number;
  product_id: number;
  serial_number: string | null;
  is_default: number | boolean;
  created_at?: string;
}

/**
 * Dispara un evento global personalizado para errores 401.
 * Permite que los componentes reaccionen (mostrar toast, limpiar estado de auth)
 * sin ser redirigidos forzosamente al login.
 */
function dispatchUnauthorized(url: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<UnauthorizedEventDetail>(UNAUTHORIZED_EVENT, {
      detail: { url, message: 'Sesión expirada. Por favor, inicia sesión de nuevo.' },
    })
  );
}

export async function apiFetch<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (res.status === 401) {
    dispatchUnauthorized(url);
    throw new Error('Sesión expirada. Inicia sesión de nuevo para continuar.');
  }

  if (!res.ok) {
    let errorMsg = 'Error en la solicitud';
    try {
      const errBody = await res.json() as { error?: string };
      errorMsg = errBody?.error ?? errorMsg;
    } catch {
      // If JSON parsing fails, use status text if available
      errorMsg = res.statusText || `Error ${res.status}`;
    }
    throw new Error(errorMsg);
  }

  // Parse successful response, handling potential JSON parse errors gracefully
  try {
    return await res.json() as Promise<T>;
  } catch {
    throw new Error(`Error al procesar la respuesta del servidor (${url})`);
  }
}

export const api = {
  // Products
  getProducts: (params?: string) => apiFetch<Record<string,unknown>[]>(`/api/products${params ? '?' + params : ''}`),
  createProduct: (data: unknown) => apiFetch('/api/products', { method: 'POST', body: JSON.stringify(data) }),
  updateProduct: (id: string, data: unknown) => apiFetch(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProduct: (id: string) => apiFetch(`/api/products/${id}`, { method: 'DELETE' }),

  // Categories
  getCategories: () => apiFetch<Record<string,unknown>[]>('/api/categories'),
  createCategory: (data: unknown) => apiFetch('/api/categories', { method: 'POST', body: JSON.stringify(data) }),
  updateCategory: (data: unknown) => apiFetch('/api/categories', { method: 'PUT', body: JSON.stringify(data) }),
  deleteCategory: (id: string) => apiFetch('/api/categories', { method: 'DELETE', body: JSON.stringify({ id }) }),

  // Suppliers
  getSuppliers: () => apiFetch<Record<string,unknown>[]>('/api/suppliers'),
  createSupplier: (data: unknown) => apiFetch('/api/suppliers', { method: 'POST', body: JSON.stringify(data) }),
  updateSupplier: (data: unknown) => apiFetch('/api/suppliers', { method: 'PUT', body: JSON.stringify(data) }),
  deleteSupplier: (id: string) => apiFetch('/api/suppliers', { method: 'DELETE', body: JSON.stringify({ id }) }),

  // Audit logs
  getAuditLogs: (params?: string) => apiFetch<Record<string,unknown>[]>(`/api/audit-logs${params ? '?' + params : ''}`),

  // Purchase prices
  getPurchasePrices: (productId?: string) => apiFetch<Record<string,unknown>[]>(`/api/purchase-prices${productId ? '?product_id=' + productId : ''}`),
  createPurchasePrice: (data: unknown) => apiFetch('/api/purchase-prices', { method: 'POST', body: JSON.stringify(data) }),

  // Customers
  getCustomers: (withDebt?: boolean) => apiFetch<Record<string,unknown>[]>(`/api/customers${withDebt ? '?with_debt=true' : ''}`),
  createCustomer: (data: unknown) => apiFetch('/api/customers', { method: 'POST', body: JSON.stringify(data) }),
  updateCustomer: (data: unknown) => apiFetch('/api/customers', { method: 'PUT', body: JSON.stringify(data) }),
  deleteCustomer: (id: string) => apiFetch('/api/customers', { method: 'DELETE', body: JSON.stringify({ id }) }),
  addPayment: (data: unknown) => apiFetch('/api/customer-payments', { method: 'POST', body: JSON.stringify(data) }),
  getPayments: (customerId?: string) => apiFetch<Record<string,unknown>[]>(`/api/customer-payments${customerId ? '?customer_id=' + customerId : ''}`),
  paySale: (id: string, data: unknown) => apiFetch(`/api/sales/${id}/pay`, { method: 'POST', body: JSON.stringify(data) }),

  // Sales
  getSales: (params?: string) => apiFetch<Record<string,unknown>[]>(`/api/sales${params ? '?' + params : ''}`),
  getSaleDetail: (id: string) => apiFetch<{items: Record<string,unknown>[]; payments: Record<string,unknown>[]; customer_payments?: Record<string,unknown>[]; total_paid?: number}>(`/api/sales/${id}`),
  createSale: (data: unknown) => apiFetch('/api/sales', { method: 'POST', body: JSON.stringify(data) }),
  cancelSale: (id: string) => apiFetch(`/api/sales/${id}/cancel`, { method: 'POST' }),

  // Expenses
  getExpenses: (params?: string) => apiFetch<Record<string,unknown>[]>(`/api/expenses${params ? '?' + params : ''}`),
  createExpense: (data: unknown) => apiFetch('/api/expenses', { method: 'POST', body: JSON.stringify(data) }),
  deleteExpense: (id: string) => apiFetch('/api/expenses', { method: 'DELETE', body: JSON.stringify({ id }) }),
  getExpenseCategories: () => apiFetch<Record<string,unknown>[]>('/api/expense-categories'),
  createExpenseCategory: (data: unknown) => apiFetch('/api/expense-categories', { method: 'POST', body: JSON.stringify(data) }),

  // Users
  getUsers: () => apiFetch<Record<string,unknown>[]>('/api/users'),
  createUser: (data: unknown) => apiFetch('/api/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: unknown) => apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Reports
  getReport: (type: string, params?: Record<string, string>) => {
    const q = new URLSearchParams({ type, ...params }).toString();
    return apiFetch<unknown>(`/api/reports?${q}`);
  },

  // Locations / Almacenes
  getLocations: () => apiFetch<Record<string,unknown>[]>('/api/locations'),
  createLocation: (data: unknown) => apiFetch('/api/locations', { method: 'POST', body: JSON.stringify(data) }),
  updateLocation: (data: unknown) => apiFetch('/api/locations', { method: 'PUT', body: JSON.stringify(data) }),
  deleteLocation: (id: string) => apiFetch('/api/locations', { method: 'DELETE', body: JSON.stringify({ id }) }),

  // Stock transfers
  getTransfers: () => apiFetch<Record<string,unknown>[]>('/api/stock-transfers'),
  createTransfer: (data: unknown) => apiFetch('/api/stock-transfers', { method: 'POST', body: JSON.stringify(data) }),

  // Stock movements via reports
  getMovements: (productId: string) => apiFetch<Record<string,unknown>[]>(`/api/reports?type=stock_movements&product_id=${productId}`),

  // Location stock and movements
  getLocationStockSummary: () => apiFetch<Record<string,unknown>[]>(`/api/locations/stock-summary`),
  getLocationStock: (locationId: string) => apiFetch<Record<string,unknown>[]>(`/api/locations/stock?location_id=${locationId}`),
  getLocationMovements: (locationId: string) => apiFetch<Record<string,unknown>[]>(`/api/location-movements?location_id=${locationId}`),
  // Purchases
  getPurchases: (params?: string) => apiFetch<Record<string,unknown>[]>(`/api/purchases${params ? '?' + params : ''}`),
  registerPurchase: (data: unknown) => apiFetch('/api/purchases', { method: 'POST', body: JSON.stringify(data) }),
  registerBulkPurchase: (data: unknown) => apiFetch('/api/purchases/bulk', { method: 'POST', body: JSON.stringify(data) }),

  getMovementsFiltered: (params?: { location_id?: string; product_id?: string; from?: string; to?: string; q?: string }) => {
    const qp = new URLSearchParams();
    if (params?.location_id) qp.set('location_id', params.location_id);
    if (params?.product_id) qp.set('product_id', params.product_id);
    if (params?.from) qp.set('from', params.from);
    if (params?.to) qp.set('to', params.to);
    if (params?.q) qp.set('q', params.q);
    const qs = qp.toString();
    return apiFetch<Record<string,unknown>[]>(`/api/location-movements${qs ? '?' + qs : ''}`);
  },
  createLocationMovement: (data: unknown) => apiFetch('/api/location-movements', { method: 'POST', body: JSON.stringify(data) }),

  // Accounting / Contabilidad
  getAccounting: (params?: string) => apiFetch<Record<string, unknown>>(`/api/accounting${params ? '?' + params : ''}`),
  getCashRegister: () => apiFetch<Record<string, unknown>[]>('/api/cash-register'),
  createCashRegisterEntry: (data: unknown) => apiFetch('/api/cash-register', { method: 'POST', body: JSON.stringify(data) }),

  // Upload
  uploadImage: (file: File, folder: 'products' | 'logo' = 'products') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', folder);
    return fetch('/api/upload', { method: 'POST', body: formData }).then(async r => {
      if (!r.ok) { const err = await r.json(); throw new Error(err.error ?? 'Error al subir imagen'); }
      return r.json() as Promise<{ url: string; filename: string }>;
    });
  },

  // Settings / Configuración
  getSettings: () => apiFetch<{ settings: SettingsDto }>('/api/settings'),
  updateSettings: (data: unknown) => apiFetch<{ settings: SettingsDto }>('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),

  // Printers / Impresoras registradas
  getPrinters: (onlyDefault?: boolean) => apiFetch<{ printers: PrinterDto[] }>(`/api/printers${onlyDefault ? '?default=1' : ''}`),
  registerPrinter: (data: { name: string; vendor_id: number; product_id: number; serial_number?: string; is_default?: boolean }) => apiFetch<PrinterDto>('/api/printers', { method: 'POST', body: JSON.stringify(data) }),
  updatePrinter: (id: string, data: { name?: string; is_default?: boolean }) => apiFetch<PrinterDto>(`/api/printers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePrinter: (id: string) => apiFetch(`/api/printers/${id}`, { method: 'DELETE' }),

  // Shifts / Turnos de caja
  getShifts: () => apiFetch<{ pos: Record<string, unknown>[]; open: Record<string, unknown>[]; shifts: Record<string, unknown>[] }>('/api/shifts'),
  openShift: (data: unknown) => apiFetch('/api/shifts', { method: 'POST', body: JSON.stringify(data) }),
  closeShift: (id: string, data: unknown) => apiFetch(`/api/shifts/${id}/close`, { method: 'POST', body: JSON.stringify(data) }),
  getShiftReport: (id: string) => apiFetch<Record<string, unknown>>(`/api/shifts/${id}/report`),

  // POS / Cajas (puntos de venta, asociadas a almacenes tipo 'store')
  getPos: () => apiFetch<Record<string, unknown>[]>('/api/pos'),
  createPos: (data: unknown) => apiFetch<Record<string, unknown>>('/api/pos', { method: 'POST', body: JSON.stringify(data) }),
  updatePos: (data: unknown) => apiFetch<Record<string, unknown>>('/api/pos', { method: 'PUT', body: JSON.stringify(data) }),
  deletePos: (id: string) => apiFetch('/api/pos', { method: 'DELETE', body: JSON.stringify({ id }) }),
};