export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { pool, query, transaction } from '@/lib/db/mysql';
import { handle, ok, err, notFound } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

export const GET = handle(async (req: Request) => {
  await requireAuth();
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get('product_id');
  const supplierId = searchParams.get('supplier_id');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500);

  let sql = `SELECT p.*, pr.name AS product_name, s.name AS supplier_name, u.name AS user_name, l.name AS location_name
             FROM purchases p
             LEFT JOIN products pr ON pr.id = p.product_id
             LEFT JOIN suppliers s ON s.id = p.supplier_id
             LEFT JOIN users u ON u.id = p.user_id
             LEFT JOIN locations l ON l.id = p.location_id`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (productId) { conditions.push('p.product_id = ?'); params.push(productId); }
  if (supplierId) { conditions.push('p.supplier_id = ?'); params.push(supplierId); }
  if (from) { conditions.push('p.created_at >= ?'); params.push(from); }
  if (to) {
    const toDate = to.length === 10 ? to + ' 23:59:59' : to;
    conditions.push('p.created_at <= ?');
    params.push(toDate);
  }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY p.created_at DESC LIMIT ' + limit;

  return ok(await query(sql, params));
});

export const POST = handle(async (req: Request) => {
  const sessionUser = await requireAuth();
  const { product_id, supplier_id, quantity, price, location_id, notes } = await req.json();

  if (!product_id || !supplier_id || !quantity || quantity <= 0 || price == null || price < 0) {
    return err('Faltan datos: producto, proveedor, cantidad (>0) y precio requeridos');
  }

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const [preCheck] = await pool.execute(
    'SELECT stock, cost FROM products WHERE id=? AND active=1', [product_id]
  ) as unknown as [{ stock: number; cost: number }[], unknown];
  if (!preCheck[0]) {
    return notFound('Producto no encontrado o inactivo');
  }

  const result = await transaction(async (conn) => {
    const product = await conn.execute(
      'SELECT stock, cost FROM products WHERE id=? AND active=1',
      [product_id]
    ) as unknown as [{ stock: number; cost: number }[], unknown];
    const current = product[0][0];

    const currentStock = Number(current.stock ?? 0);
    const currentCost = Number(current.cost ?? 0);
    const purchaseQty = Number(quantity);
    const purchasePrice = Number(price);

    const newStock = currentStock + purchaseQty;
    const newCost = ((currentStock * currentCost) + (purchaseQty * purchasePrice)) / newStock;

    await conn.execute(
      'UPDATE products SET stock=stock+?, cost=?, updated_at=? WHERE id=?',
      [purchaseQty, Math.round(newCost * 100) / 100, ts, product_id]
    );

    const smId = randomUUID();
    await conn.execute(
      "INSERT INTO stock_movements (id,product_id,type,quantity,reason,reference_id,user_id,date,created_at) VALUES (?,?,'in',?,?,?,?,?,?)",
      [smId, product_id, purchaseQty, notes ? `Compra: ${notes}` : 'Compra', null, sessionUser.id, ts, ts]
    );

    const ppId = randomUUID();
    await conn.execute(
      'INSERT INTO purchase_prices (id,product_id,supplier_id,price,date,notes,created_at) VALUES (?,?,?,?,?,?,?)',
      [ppId, product_id, supplier_id, purchasePrice, ts, notes ?? null, ts]
    );

    await conn.execute(
      'INSERT IGNORE INTO product_suppliers (id,product_id,supplier_id,is_preferred) VALUES (?,?,?,0)',
      [randomUUID(), product_id, supplier_id]
    );

    let targetLocationId = location_id;
    if (!targetLocationId) {
      const locs = await conn.execute(
        'SELECT id FROM locations WHERE active=1 ORDER BY name ASC LIMIT 1'
      ) as unknown as [{ id: string }[], unknown];
      if (locs[0].length > 0) targetLocationId = locs[0][0].id;
    }

    const purchaseId = randomUUID();
    await conn.execute(
      'INSERT INTO purchases (id,product_id,supplier_id,quantity,unit_price,total_cost,location_id,notes,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [purchaseId, product_id, supplier_id, purchaseQty, purchasePrice, Math.round(purchaseQty * purchasePrice * 100) / 100, targetLocationId ?? null, notes ?? null, sessionUser.id, ts]
    );

    if (targetLocationId) {
      await conn.execute(
        'INSERT INTO location_stock (id,location_id,product_id,quantity,updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+?,updated_at=?',
        [randomUUID(), targetLocationId, product_id, purchaseQty, ts, purchaseQty, ts]
      );
      await conn.execute(
        "INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,reference_id,user_id,created_at) VALUES (?,?,?,'entrada',?,?,?,?,?)",
        [randomUUID(), targetLocationId, product_id, purchaseQty, notes ? `Compra: ${notes}` : 'Compra', null, sessionUser.id, ts]
      );
    }

    return {
      id: purchaseId,
      stock_before: currentStock,
      stock_after: newStock,
      cost_before: currentCost,
      cost_after: Math.round(newCost * 100) / 100,
      purchase_price: purchasePrice,
      stock_movement_id: smId,
      purchase_price_id: ppId,
    };
  });

  return ok({ ok: true, ...result }, 201);
});
