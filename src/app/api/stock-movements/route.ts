export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute } from '@/lib/db/mysql';
import { logAudit } from '@/lib/db/audit';
import { validateStockMovementType } from '@/lib/validate';
import { handle, ok, err } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

export const GET = handle(async (req: Request) => {
  await requireAuth();
  const { searchParams } = new URL(req.url);
  const pid = searchParams.get('product_id');
  const sql = `SELECT sm.*,u.name AS user_name FROM stock_movements sm LEFT JOIN users u ON u.id=sm.user_id${pid?' WHERE sm.product_id=?':''} ORDER BY sm.date DESC LIMIT 100`;
  return ok(await query(sql, pid?[pid]:[]));
});

export const POST = handle(async (req: Request) => {
  const sessionUser = await requireAuth();
  const { product_id, type: rawType, quantity, reason, location_id } = await req.json();
  if (!product_id||!rawType||quantity<=0||!reason) return err('Faltan datos');
  const type = validateStockMovementType(rawType);
  const id = randomUUID(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');

  if (type==='adjust') {
    await execute('UPDATE products SET stock=?,updated_at=? WHERE id=?',[quantity,ts,product_id]);
  } else if (type==='in') {
    await execute('UPDATE products SET stock=stock+?,updated_at=? WHERE id=?',[quantity,ts,product_id]);
  } else {
    await execute('UPDATE products SET stock=GREATEST(0,stock-?),updated_at=? WHERE id=?',[quantity,ts,product_id]);
  }

  await execute('INSERT INTO stock_movements (id,product_id,type,quantity,reason,user_id,date,created_at) VALUES (?,?,?,?,?,?,?,?)',
    [id,product_id,type,quantity,reason,sessionUser.id,ts,ts]);

  let targetLocationId = location_id;
  if (!targetLocationId) {
    const locs = await query<{id:string}>('SELECT id FROM locations WHERE active=1 ORDER BY name ASC LIMIT 1');
    if (locs.length > 0) targetLocationId = locs[0].id;
  }

  if (targetLocationId) {
    if (type === 'in') {
      await execute(
        'INSERT INTO location_stock (id,location_id,product_id,quantity,updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+?,updated_at=?',
        [randomUUID(), targetLocationId, product_id, quantity, ts, quantity, ts]
      );
      await execute(
        'INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
        [randomUUID(), targetLocationId, product_id, 'entrada', quantity, reason, sessionUser.id, ts]
      );
    } else if (type === 'out') {
      const curLocStock = await queryOne<{quantity: number}>(
        'SELECT quantity FROM location_stock WHERE location_id=? AND product_id=?',
        [targetLocationId, product_id]
      );
      const available = curLocStock?.quantity ?? 0;
      if (available < quantity) {
        return err(`Stock insuficiente en el almacén. Disponible: ${available}, solicitado: ${quantity}`);
      }
      await execute(
        'UPDATE location_stock SET quantity=quantity-?,updated_at=? WHERE location_id=? AND product_id=?',
        [quantity, ts, targetLocationId, product_id]
      );
      await execute(
        'INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
        [randomUUID(), targetLocationId, product_id, 'salida', quantity, reason, sessionUser.id, ts]
      );
    } else if (type === 'adjust') {
      await execute(
        'INSERT INTO location_stock (id,location_id,product_id,quantity,updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE quantity=?,updated_at=?',
        [randomUUID(), targetLocationId, product_id, quantity, ts, quantity, ts]
      );
      await execute(
        'INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
        [randomUUID(), targetLocationId, product_id, 'ajuste', quantity, reason, sessionUser.id, ts]
      );
    }
  }

  // ── Auditoría ──
  if (type === 'adjust') {
    const product = await queryOne<{ name: string }>('SELECT name FROM products WHERE id=?', [product_id]);
    await logAudit({
      user_id: sessionUser.id,
      user_name: sessionUser.name,
      action: 'adjust',
      entity_type: 'stock_movement',
      entity_id: id,
      entity_name: product?.name ?? 'Producto',
      details: { type, quantity, reason, product_id, location_id: targetLocationId },
    });
  }

  return ok({ok:true,id}, 201);
});
