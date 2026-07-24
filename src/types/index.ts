// ─── Roles & Permissions ────────────────────────────────────────────────────

export type UserRole = 'owner' | 'admin' | 'seller' | 'warehouse';

export interface Permission {
  module: string;
  actions: ('read' | 'create' | 'update' | 'delete')[];
}

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  permissions: Permission[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Categories ─────────────────────────────────────────────────────────────

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
}

// ─── Products ────────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  barcode: string | null;
  name: string;
  description: string | null;
  category_id: string | null;
  category?: Category;
  sale_price: number;
  cost: number;
  stock: number;
  min_stock: number;
  unit: string;
  expiration_date: string | null;
  is_perishable: boolean;
  image_url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockMovement {
  id: string;
  product_id: string;
  product?: Product;
  type: 'in' | 'out' | 'adjust' | 'expense';
  quantity: number;
  reason: string;
  reference_id: string | null;
  user_id: string;
  user?: AppUser;
  date: string;
  created_at: string;
}

// ─── Suppliers ───────────────────────────────────────────────────────────────

export interface Supplier {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductSupplier {
  id: string;
  product_id: string;
  supplier_id: string;
  supplier?: Supplier;
  is_preferred: boolean;
}

export interface PurchasePrice {
  id: string;
  product_id: string;
  product?: Product;
  supplier_id: string;
  supplier?: Supplier;
  price: number;
  date: string;
  notes: string | null;
  created_at: string;
}

// ─── Customers ───────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  balance: number; // positive = owes money
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerPayment {
  id: string;
  customer_id: string;
  customer?: Customer;
  amount: number;
  method: PaymentMethod;
  date: string;
  notes: string | null;
  created_at: string;
}

// ─── Sales ───────────────────────────────────────────────────────────────────

export type PaymentMethod = 'cash' | 'transfer' | 'mixed' | 'credit';
export type SaleStatus = 'completed' | 'partial' | 'pending' | 'cancelled';

export interface Sale {
  id: string;
  customer_id: string | null;
  customer?: Customer;
  user_id: string;
  user?: AppUser;
  date: string;
  total: number;
  status: SaleStatus;
  notes: string | null;
  items?: SaleItem[];
  payments?: Payment[];
  created_at: string;
  updated_at: string;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  product?: Product;
  quantity: number;
  unit_price: number;
  cost: number;
}

export interface Payment {
  id: string;
  sale_id: string;
  method: PaymentMethod;
  amount_cash: number;
  amount_transfer: number;
  date: string;
  notes: string | null;
  created_at: string;
}

// ─── Expenses ────────────────────────────────────────────────────────────────

export interface ExpenseCategory {
  id: string;
  name: string;
  created_at: string;
}

export interface Expense {
  id: string;
  category_id: string;
  category?: ExpenseCategory;
  description: string;
  amount: number;
  product_id: string | null;
  product?: Product;
  product_quantity: number | null;
  date: string;
  user_id: string;
  user?: AppUser;
  created_at: string;
  updated_at: string;
}

// ─── Sync Log ────────────────────────────────────────────────────────────────

export interface SyncLog {
  id: string;
  table_name: string;
  record_id: string;
  action: 'insert' | 'update' | 'delete';
  payload: Record<string, unknown>;
  synced_at: string | null;
  created_offline_at: string;
}

// ─── Dashboard / Reports ─────────────────────────────────────────────────────

export interface DashboardMetrics {
  totalSalesToday: number;
  totalSalesWeek: number;
  totalSalesMonth: number;
  totalExpensesMonth: number;
  netProfitMonth: number;
  lowStockCount: number;
  pendingAccountsTotal: number;
}

export interface SalesByDay {
  date: string;
  total: number;
  count: number;
}

export interface TopProduct {
  product_id: string;
  name: string;
  total_sold: number;
  total_revenue: number;
}

// ─── Reservations ───────────────────────────────────────────────────────────

export interface Reservation {
  id: string;
  product_id: string;
  product_name?: string;
  customer_name: string;
  customer_phone: string | null;
  quantity: number;
  status: 'pending' | 'confirmed' | 'cancelled';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RestockForecast {
  product_id: string;
  name: string;
  current_stock: number;
  avg_daily_sales: number;
  days_until_empty: number;
  restock_date: string;
  urgency: 'critical' | 'soon' | 'ok';
}
