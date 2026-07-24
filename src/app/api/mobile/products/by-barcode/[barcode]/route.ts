export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { queryOne } from '@/lib/db/mysql';
import { handle, ok, notFound } from '@/lib/api-helpers';

// ── Buscar producto por código de barras ─────────────────────────
// Endpoint rápido para la app Flutter: dado un barcode, retorna
// el producto completo con precio y stock.
// Ej: GET /api/mobile/products/by-barcode/7501055300004

export const GET = handle(async (_req: Request, ctx) => {
  await requireAuth();
  const { barcode } = await ctx.params;

  const product = await queryOne<Record<string, unknown>>(
    `SELECT p.id, p.barcode, p.name, p.sale_price, p.stock, p.min_stock, p.unit,
            p.expiration_date, p.is_perishable, p.cost, p.description, p.category_id,
            c.name AS category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.barcode = ? AND p.active = 1
     LIMIT 1`,
    [barcode]
  );

  if (!product) {
    return notFound(`Producto con código ${barcode} no encontrado`);
  }

  return ok({
    id: product.id,
    barcode: product.barcode ?? null,
    name: product.name,
    sale_price: Number(product.sale_price),
    cost: Number(product.cost),
    stock: Number(product.stock),
    min_stock: Number(product.min_stock),
    unit: product.unit,
    expiration_date: product.expiration_date ?? null,
    is_perishable: Boolean(product.is_perishable),
    description: product.description ?? null,
    category_id: product.category_id ?? null,
    category_name: product.category_name ?? null,
  });
});
