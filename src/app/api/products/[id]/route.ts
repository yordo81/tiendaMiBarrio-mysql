export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute } from '@/lib/db/mysql';
import { logAudit } from '@/lib/db/audit';
import { handle, ok, err, forbidden } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

export const PUT = handle(async (request: Request, ctx) => {
  const { id } = await ctx!.params;
  const sessionUser = await requireAuth();
  const body = await request.json();
  const ts = new Date().toISOString().slice(0,19).replace('T',' ');

  const current = await queryOne<{stock: number}>('SELECT stock FROM products WHERE id=?', [id]);
  const oldStock = current?.stock ?? 0;
  const newStock = Number(body.stock);
  const diff = newStock - oldStock;

  await execute(
    `UPDATE products SET name=?,description=?,category_id=?,sale_price=?,cost=?,stock=?,min_stock=?,unit=?,updated_at=? WHERE id=?`,
    [body.name, body.description??null, body.category_id??null, Number(body.sale_price), Number(body.cost),
     Number(body.stock), Number(body.min_stock), body.unit??'unidad', ts, id]
  );

  if (diff !== 0) {
    const locRows = await query<{location_id: string}>(`
      SELECT location_id FROM location_stock WHERE product_id=? ORDER BY quantity DESC LIMIT 1
    `, [id]);
    let targetLocationId: string | undefined;
    let locationName: string | undefined;
    if (locRows.length > 0) {
      targetLocationId = locRows[0].location_id;
      const loc = await queryOne<{ name: string }>('SELECT name FROM locations WHERE id=?', [targetLocationId]);
      locationName = loc?.name;
    } else if (diff > 0) {
      const locations = await query<{id: string; name: string}>(
        'SELECT id, name FROM locations WHERE active=1 ORDER BY name ASC LIMIT 1'
      );
      if (locations.length > 0) {
        targetLocationId = locations[0].id;
        locationName = locations[0].name;
      }
    }

    if (targetLocationId) {
      if (diff > 0) {
        await execute(
          'INSERT INTO location_stock (id,location_id,product_id,quantity,updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+?,updated_at=?',
          [randomUUID(), targetLocationId, id, diff, ts, diff, ts]
        );
      } else {
        const curLocStock = await queryOne<{quantity: number}>(
          'SELECT quantity FROM location_stock WHERE location_id=? AND product_id=?',
          [targetLocationId, id]
        );
        if (curLocStock && curLocStock.quantity < Math.abs(diff)) {
          return err(`Stock insuficiente en el almacén. Disponible: ${curLocStock.quantity}, necesario: ${Math.abs(diff)}`);
        }
        await execute(
          'UPDATE location_stock SET quantity=quantity+?,updated_at=? WHERE location_id=? AND product_id=?',
          [diff, ts, targetLocationId, id]
        );
      }
      await execute(
        `INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,user_id,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [randomUUID(), targetLocationId, id, 'ajuste', Math.abs(diff),
         `Ajuste por edición de producto`, sessionUser.id, ts]
      );

      // Also record in stock_movements for the product history
      await execute(
        'INSERT INTO stock_movements (id,product_id,type,quantity,reason,user_id,date,created_at) VALUES (?,?,?,?,?,?,?,?)',
        [randomUUID(), id, 'adjust', Math.abs(diff), `Ajuste por edición de producto (${locationName ?? targetLocationId})`, sessionUser.id, ts, ts]
      );
    }

    // ── Auditoría para el ajuste de stock ──
    const productName = body.name ?? current?.name ?? 'Producto';
    const actionType = diff > 0 ? 'adjust_increase' : 'adjust_decrease';
    await logAudit({
      user_id: sessionUser.id,
      user_name: sessionUser.name,
      action: actionType,
      entity_type: 'stock_movement',
      entity_id: id,
      entity_name: productName,
      details: { old_stock: oldStock, new_stock: newStock, diff: Math.abs(diff), location_id: targetLocationId, location_name: locationName },
    });
  }

  if (Array.isArray(body.supplier_ids)) {
    await execute('DELETE FROM product_suppliers WHERE product_id = ?', [id]);
    for (let i = 0; i < body.supplier_ids.length; i++) {
      await execute('INSERT IGNORE INTO product_suppliers (id,product_id,supplier_id,is_preferred) VALUES (?,?,?,?)',
        [randomUUID(), id, body.supplier_ids[i], i === 0 ? 1 : 0]);
    }
  }

  const rows = await query(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?`, [id]);
  return ok(rows[0]);
});

export const DELETE = handle(async (_: Request, ctx) => {
  const { id } = await ctx!.params;
  const sessionUser = await requireAuth();
  if (sessionUser.role !== 'owner' && sessionUser.role !== 'admin') {
    return forbidden('No autorizado — solo administradores');
  }
  const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  const product = await queryOne<{ name: string }>('SELECT name FROM products WHERE id=?', [id]);
  await execute('UPDATE products SET active=0, updated_at=? WHERE id=?', [ts, id]);

  if (product) {
    await logAudit({
      user_id: sessionUser.id,
      user_name: sessionUser.name,
      action: 'delete',
      entity_type: 'product',
      entity_id: id,
      entity_name: product.name,
    });
  }

  return ok({ ok: true });
});
