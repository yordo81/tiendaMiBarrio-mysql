export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute, transaction } from '@/lib/db/mysql';
import { logAudit } from '@/lib/db/audit';
import { handle, ok, err } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

export const GET = handle(async (req: Request) => {
  await requireAuth();
  const { searchParams } = new URL(req.url);
  const locationId = searchParams.get('location_id');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const productId = searchParams.get('product_id');

  let sql = `
    SELECT lm.*, p.name AS product_name, u.name AS user_name, l.name AS location_name
    FROM location_movements lm
    LEFT JOIN products p ON p.id = lm.product_id
    LEFT JOIN users u ON u.id = lm.user_id
    LEFT JOIN locations l ON l.id = lm.location_id
  `;
  const params: unknown[] = [];
  const where: string[] = [];

  if (locationId) { where.push('lm.location_id = ?'); params.push(locationId); }
  if (from)      { where.push('lm.created_at >= ?');  params.push(from); }
  if (to)        { where.push('lm.created_at <= ?');  params.push(to); }
  if (productId) { where.push('lm.product_id = ?');   params.push(productId); }

  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY lm.created_at DESC LIMIT 200';

  return ok(await query(sql, params));
});

export const POST = handle(async (req: Request) => {
  const sessionUser = await requireAuth();
  const { location_id, product_id, type, quantity, notes } = await req.json();

  if (!location_id || !product_id || !type || quantity <= 0) {
    return err('Faltan campos requeridos');
  }
  if (!['entrada', 'salida', 'ajuste'].includes(type)) {
    return err('Tipo inválido');
  }

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  await transaction(async (conn) => {
    const [rows] = await conn.execute(
      'SELECT id, quantity FROM location_stock WHERE location_id=? AND product_id=? LIMIT 1',
      [location_id, product_id]
    );
    const existing = (rows as { id: string; quantity: number }[])[0];
    const curQty = existing?.quantity ?? 0;

    let newQty: number;
    let delta = 0;
    if (type === 'ajuste') {
      newQty = quantity;
      delta = newQty - curQty;
    } else if (type === 'entrada') {
      newQty = curQty + quantity;
    } else {
      if (curQty < quantity) throw new Error(`Stock insuficiente. Disponible: ${curQty}`);
      newQty = curQty - quantity;
    }

    if (existing) {
      await conn.execute('UPDATE location_stock SET quantity=?, updated_at=? WHERE id=?', [newQty, ts, existing.id]);
    } else {
      if (type === 'salida') throw new Error('Este producto no tiene stock en este almacén');
      await conn.execute(
        'INSERT INTO location_stock (id,location_id,product_id,quantity,updated_at) VALUES (?,?,?,?,?)',
        [randomUUID(), location_id, product_id, newQty, ts]
      );
    }

    await conn.execute(
      'INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [randomUUID(), location_id, product_id, type, quantity, notes || null, sessionUser.id, ts]
    );

    if (type === 'ajuste' && delta !== 0) {
      await conn.execute('UPDATE products SET stock=GREATEST(0,stock+?),updated_at=? WHERE id=?', [delta, ts, product_id]);
      const [locRows] = await conn.execute('SELECT name FROM locations WHERE id=?', [location_id]);
      const locName = ((locRows as {name:string}[])[0])?.name ?? location_id;
      await conn.execute(
        "INSERT INTO stock_movements (id,product_id,type,quantity,reason,user_id,date,created_at) VALUES (?,?,'adjust',?,?,?,?,?)",
        [randomUUID(), product_id, Math.abs(delta), `Ajuste en ${locName}: ${notes || 'Conteo físico'}`, sessionUser.id, ts, ts]
      );
    }

    if (type === 'salida') {
      // Salida = retiro del sistema (merma, devolución, etc.) → disminuye stock global
      await conn.execute('UPDATE products SET stock=GREATEST(0,stock-?),updated_at=? WHERE id=?', [quantity, ts, product_id]);
      const [locRows] = await conn.execute('SELECT name FROM locations WHERE id=?', [location_id]);
      const locName = ((locRows as {name:string}[])[0])?.name ?? location_id;
      await conn.execute(
        "INSERT INTO stock_movements (id,product_id,type,quantity,reason,user_id,date,created_at) VALUES (?,?,'out',?,?,?,?,?)",
        [randomUUID(), product_id, quantity, `Salida de ${locName}: ${notes || 'Merma/Devolución'}`, sessionUser.id, ts, ts]
      );
    }

    if (type === 'entrada') {
      await conn.execute('UPDATE products SET stock=GREATEST(0,stock-?),updated_at=? WHERE id=?', [quantity, ts, product_id]);
      const [locRows] = await conn.execute('SELECT name FROM locations WHERE id=?', [location_id]);
      const locName = ((locRows as {name:string}[])[0])?.name ?? location_id;
      await conn.execute(
        "INSERT INTO stock_movements (id,product_id,type,quantity,reason,user_id,date,created_at) VALUES (?,?,'out',?,?,?,?,?)",
        [randomUUID(), product_id, quantity, `Carga a almacén: ${locName}`, sessionUser.id, ts, ts]
      );
    }
  });

  if (type === 'ajuste') {
    const product = await queryOne<{ name: string }>('SELECT name FROM products WHERE id=?', [product_id]);
    const location = await queryOne<{ name: string }>('SELECT name FROM locations WHERE id=?', [location_id]);
    await logAudit({
      user_id: sessionUser.id,
      user_name: sessionUser.name,
      action: 'adjust',
      entity_type: 'stock_movement',
      entity_id: product_id,
      entity_name: product?.name ?? 'Producto',
      details: { type, quantity, notes, location_id, location_name: location?.name },
    });
  }

  return ok({ ok: true }, 201);
});
