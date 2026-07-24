export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';
import { handle, ok } from '@/lib/api-helpers';

// ── Sync para App Móvil ─────────────────────────────────────────
// Endpoint que retorna todos los datos necesarios para sincronizar
// la app Flutter: productos activos, categorías y clientes.
// La app puede llamar este endpoint al iniciar sesión o con
// Pull-to-Refresh para mantener los datos actualizados.

export const GET = handle(async () => {
  const user = await requireAuth();

  const [products, categories, customers] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT id, barcode, name, sale_price, stock, min_stock, unit,
              expiration_date, is_perishable, cost, description, category_id, image_url
       FROM products
       WHERE active = 1
       ORDER BY name ASC`
    ),
    query<Record<string, unknown>>(
      'SELECT id, name, parent_id FROM categories ORDER BY name ASC'
    ),
    query<Record<string, unknown>>(
      `SELECT id, name, phone, balance
       FROM customers
       WHERE active = 1
       ORDER BY name ASC`
    ),
  ]);

  return ok({
    synced_at: new Date().toISOString(),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    products: products.map((p) => ({
      id: p.id,
      barcode: p.barcode ?? null,
      name: p.name,
      sale_price: Number(p.sale_price),
      cost: Number(p.cost),
      stock: Number(p.stock),
      min_stock: Number(p.min_stock),
      unit: p.unit,
      expiration_date: p.expiration_date ?? null,
      is_perishable: Boolean(p.is_perishable),
      description: p.description ?? null,
      category_id: p.category_id ?? null,
      image_url: p.image_url ?? null,
    })),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      parent_id: c.parent_id ?? null,
    })),
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone ?? null,
      balance: Number(c.balance),
    })),
  });
});
