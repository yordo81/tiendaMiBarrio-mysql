// Typed fetch wrapper for all API calls in the MySQL version

/**
 * Dispatched when an API call returns 401 Unauthorized.
 * The detail contains the URL that triggered the error.
 * Components can listen for this event to show session-expired notifications.
 */
export const UNAUTHORIZED_EVENT = 'api:unauthorized';

/**
 * Custom event detail for unauthorized API calls.
 */
export interface UnauthorizedEventDetail {
  url: string;
  message: string;
}

/**
 * Dispatch a global custom event for 401 errors so components can react
 * (e.g. show a toast, clear auth state, etc.) without being forcefully redirected.
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

  getMovementsFiltered: (params?: { location_id?: string; product_id?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.location_id) q.set('location_id', params.location_id);
    if (params?.product_id) q.set('product_id', params.product_id);
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    const qs = q.toString();
    return apiFetch<Record<string,unknown>[]>(`/api/location-movements${qs ? '?' + qs : ''}`);
  },
  createLocationMovement: (data: unknown) => apiFetch('/api/location-movements', { method: 'POST', body: JSON.stringify(data) }),

  // Accounting / Contabilidad
  getAccounting: (params?: string) => apiFetch<Record<string, unknown>>(`/api/accounting${params ? '?' + params : ''}`),
  getCashRegister: () => apiFetch<Record<string, unknown>[]>('/api/cash-register'),
  createCashRegisterEntry: (data: unknown) => apiFetch('/api/cash-register', { method: 'POST', body: JSON.stringify(data) }),

  // Upload
  uploadImage: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return fetch('/api/upload', { method: 'POST', body: formData }).then(async r => {
      if (!r.ok) { const err = await r.json(); throw new Error(err.error ?? 'Error al subir imagen'); }
      return r.json() as Promise<{ url: string; filename: string }>;
    });
  },
};