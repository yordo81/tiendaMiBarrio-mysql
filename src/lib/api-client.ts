// Typed fetch wrapper for all API calls in the MySQL version

export async function apiFetch<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Error en la solicitud');
  }
  return res.json() as Promise<T>;
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

  // Purchase prices
  getPurchasePrices: (productId?: string) => apiFetch<Record<string,unknown>[]>(`/api/purchase-prices${productId ? '?product_id=' + productId : ''}`),
  createPurchasePrice: (data: unknown) => apiFetch('/api/purchase-prices', { method: 'POST', body: JSON.stringify(data) }),

  // Customers
  getCustomers: (withDebt?: boolean) => apiFetch<Record<string,unknown>[]>(`/api/customers${withDebt ? '?with_debt=true' : ''}`),
  createCustomer: (data: unknown) => apiFetch('/api/customers', { method: 'POST', body: JSON.stringify(data) }),
  updateCustomer: (data: unknown) => apiFetch('/api/customers', { method: 'PUT', body: JSON.stringify(data) }),
  addPayment: (data: unknown) => apiFetch('/api/customer-payments', { method: 'POST', body: JSON.stringify(data) }),
  getPayments: (customerId?: string) => apiFetch<Record<string,unknown>[]>(`/api/customer-payments${customerId ? '?customer_id=' + customerId : ''}`),

  // Sales
  getSales: (params?: string) => apiFetch<Record<string,unknown>[]>(`/api/sales${params ? '?' + params : ''}`),
  getSaleDetail: (id: string) => apiFetch<{items: Record<string,unknown>[]; payments: Record<string,unknown>[]}>(`/api/sales/${id}`),
  createSale: (data: unknown) => apiFetch('/api/sales', { method: 'POST', body: JSON.stringify(data) }),

  // Expenses
  getExpenses: (params?: string) => apiFetch<Record<string,unknown>[]>(`/api/expenses${params ? '?' + params : ''}`),
  createExpense: (data: unknown) => apiFetch('/api/expenses', { method: 'POST', body: JSON.stringify(data) }),
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
  getLocationStock: (locationId: string) => apiFetch<Record<string,unknown>[]>(`/api/locations/stock?location_id=${locationId}`),
  getLocationMovements: (locationId: string) => apiFetch<Record<string,unknown>[]>(`/api/location-movements?location_id=${locationId}`),
  createLocationMovement: (data: unknown) => apiFetch('/api/location-movements', { method: 'POST', body: JSON.stringify(data) }),
};
