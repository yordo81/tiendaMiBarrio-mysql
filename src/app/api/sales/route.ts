export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, transaction } from '@/lib/db/mysql';
import { validatePaymentMethodOrDefault } from '@/lib/validate';
import { handle, ok, err } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

export const GET = handle(async (req: Request) => {
  await requireAuth();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'), to = searchParams.get('to');
  const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') ?? '50') || 50));

  let sql = `SELECT s.*,c.name AS customer_name,u.name AS user_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.user_id`;
  const params: unknown[] = [];
  const where: string[] = [];
  if (from) { where.push('s.date>=?'); params.push(from); }
  if (to)   { where.push('s.date<=?'); params.push(to); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY s.date DESC LIMIT ' + Math.floor(limit);
  return ok(await query(sql, params));
});

export const POST = handle(async (req: Request) => {
  const sessionUser = await requireAuth();
  const { items, payment, customer_id, location_id, notes, date } = await req.json();
  if (!items?.length) return err('La venta debe tener al menos un producto');
  if (payment?.method === 'credit' && !customer_id) return err('Las ventas a crédito requieren cliente');

  const saleId = randomUUID();
  const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  const tz = process.env.TIMEZONE ?? 'America/Havana';
  const saleDate = date
    ? new Date(date).toISOString().slice(0,19).replace('T',' ')
    : new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      }).format(new Date()).replace(', ', ' ');
  const total = items.reduce((a: number, i: { quantity: number; unit_price: number }) => a + i.quantity * i.unit_price, 0);
  const status = payment?.method === 'credit' ? 'pending' : 'completed';

  // ── Validar stock antes de iniciar la transaccion (pre-check rapido) ──
  for (const item of items) {
    let available: number;
    if (location_id) {
      // Validar stock en el almacén específico seleccionado
      const locStock = await queryOne<{ quantity: number }>(
        'SELECT quantity FROM location_stock WHERE location_id=? AND product_id=?',
        [location_id, item.product_id]
      );
      available = locStock?.quantity ?? 0;
    } else {
      // Validar stock global cuando no hay almacén
      const prod = await queryOne<{ stock: number }>(
        'SELECT stock FROM products WHERE id=?',
        [item.product_id]
      );
      available = prod?.stock ?? 0;
    }
    if (available < item.quantity) {
      return err(`Stock insuficiente${location_id?' en el almacén seleccionado':''}. Disponible: ${available}, solicitado: ${item.quantity}`);
    }
  }

  await transaction(async (conn) => {
    await conn.execute(
      'INSERT INTO sales (id,customer_id,user_id,date,total,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [saleId, customer_id??null, sessionUser.id, saleDate, total, status, notes??null, ts, ts]
    );
    for (const item of items) {
      await conn.execute(
        'INSERT INTO sale_items (id,sale_id,product_id,quantity,unit_price,cost,created_at) VALUES (?,?,?,?,?,?,?)',
        [randomUUID(), saleId, item.product_id, item.quantity, item.unit_price, item.cost??0, ts]
      );
      // Validar stock dentro de la transaccion con bloqueo de fila (race-condition safe)
      const [lockRows] = await conn.execute(
        'SELECT stock FROM products WHERE id=? FOR UPDATE',
        [item.product_id]
      );
      const lockedStock = (lockRows as { stock: number }[])[0]?.stock ?? 0;
      if (lockedStock < item.quantity) {
        throw new Error(`Stock insuficiente del producto. Disponible: ${lockedStock}, solicitado: ${item.quantity}`);
      }
      await conn.execute('UPDATE products SET stock=stock-?,updated_at=? WHERE id=?',[item.quantity, ts, item.product_id]);
      await conn.execute(
        "INSERT INTO stock_movements (id,product_id,type,quantity,reason,reference_id,user_id,date,created_at) VALUES (?,?,'out',?,?,?,?,?,?)",
        [randomUUID(), item.product_id, item.quantity, 'Venta', saleId, sessionUser.id, saleDate, ts]
      );

      let targetLocationId = location_id;
      if (!targetLocationId) {
        const [locRows] = await conn.execute(
          'SELECT location_id FROM location_stock WHERE product_id=? AND quantity>0 ORDER BY quantity DESC LIMIT 1',
          [item.product_id]
        );
        const locs = locRows as { location_id: string }[];
        if (locs.length > 0) targetLocationId = locs[0].location_id;
      }

      if (targetLocationId) {
        const [locRows] = await conn.execute(
          'SELECT id, quantity FROM location_stock WHERE location_id=? AND product_id=?',
          [targetLocationId, item.product_id]
        );
        const existing = (locRows as { id: string; quantity: number }[])[0];
        const curQty = existing?.quantity ?? 0;

        // Validar stock en la ubicacion
        if (curQty < item.quantity) {
          throw new Error(`Stock insuficiente en el almacen. Disponible: ${curQty}, solicitado: ${item.quantity}`);
        }

        const remaining = curQty - item.quantity;

        if (remaining <= 0) {
          if (existing) {
            await conn.execute('DELETE FROM location_stock WHERE location_id=? AND product_id=?', [targetLocationId, item.product_id]);
          }
        } else {
          await conn.execute('UPDATE location_stock SET quantity=?, updated_at=? WHERE location_id=? AND product_id=?',
            [remaining, ts, targetLocationId, item.product_id]);
        }

        await conn.execute(
          'INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,reference_id,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          [randomUUID(), targetLocationId, item.product_id, 'venta', item.quantity, 'Venta registrada', saleId, sessionUser.id, ts]
        );
      }
    }

    const method = validatePaymentMethodOrDefault(payment?.method);
    const amountCash = method === 'cash' ? total : (payment?.amount_cash ?? 0);
    const amountTransfer = method === 'transfer' ? total : (payment?.amount_transfer ?? 0);
    await conn.execute(
      'INSERT INTO payments (id,sale_id,method,amount_cash,amount_transfer,date,notes,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [randomUUID(), saleId, method, amountCash, amountTransfer, saleDate, payment?.notes??null, ts]
    );

    if (method === 'credit' && customer_id) {
      await conn.execute('UPDATE customers SET balance=balance+?,updated_at=? WHERE id=?',[total, ts, customer_id]);
    }
  });
  return ok({ id: saleId, total, status }, 201);
});