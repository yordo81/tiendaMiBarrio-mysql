export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';
import { handle, ok } from '@/lib/api-helpers';

// ── API Móvil de Productos ───────────────────────────────────────
// Versión simplificada para la app Flutter. Retorna solo los campos
// necesarios para el POS móvil: identificación, precio y stock.

export const GET = handle(async (request: Request) => {
  await requireAuth();
  const { searchParams } = new URL(request.url);
  const locationId = searchParams.get('location_id');

  const params: unknown[] = [];

  const locationStockSelect = locationId
    ? '(SELECT quantity FROM location_stock WHERE product_id = p.id AND location_id = ?) AS location_stock,'
    : '';
  if (locationId) params.push(locationId);

  let whereClause = 'WHERE p.active = 1';
  if (locationId) {
    whereClause += ' AND p.id IN (SELECT product_id FROM location_stock WHERE location_id=?)';
    params.push(locationId);
  }

  const sql = `
    SELECT p.id, p.barcode, p.name, p.sale_price, p.stock, p.unit,
      p.expiration_date, p.is_perishable,
      ${locationStockSelect}
      c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereClause}
    ORDER BY p.name ASC
  `;

  const rows = await query(sql, params);

  // Mapear resultados: si se filtró por almacén, usar location_stock
  const products = rows.map((r: Record<string, unknown>) => {
    const { location_stock, ...rest } = r;
    return {
      id: rest.id,
      barcode: rest.barcode ?? null,
      name: rest.name,
      sale_price: Number(rest.sale_price),
      stock: location_stock !== undefined ? Number(location_stock) : Number(rest.stock),
      unit: rest.unit,
      expiration_date: rest.expiration_date ?? null,
      is_perishable: Boolean(rest.is_perishable),
      category_name: rest.category_name ?? null,
    };
  });

  return ok({ products });
});
