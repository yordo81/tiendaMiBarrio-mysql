export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, transaction } from '@/lib/db/mysql';
import { logAudit } from '@/lib/db/audit';
import { handle, ok, err, notFound, forbidden } from '@/lib/api-helpers';
import { validateExpensePaymentMethodOrDefault } from '@/lib/validate';
const randomUUID = () => crypto.randomUUID();

export const GET = handle(async (req: Request) => {
  await requireAuth();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'), to = searchParams.get('to');
  let sql = `SELECT e.*,ec.name AS category_name,p.name AS product_name,u.name AS user_name FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id LEFT JOIN products p ON p.id=e.product_id LEFT JOIN users u ON u.id=e.user_id`;
  const params: unknown[] = []; const where: string[] = [];
  if (from) { where.push('e.date>=?'); params.push(from); }
  if (to)   { where.push('e.date<=?'); params.push(to + ' 23:59:59'); }
  if (where.length) sql += ' WHERE '+where.join(' AND ');
  sql += ' ORDER BY e.date DESC LIMIT 200';
  return ok(await query(sql, params));
});

export const POST = handle(async (req: Request) => {
  const sessionUser = await requireAuth();
  const body = await req.json();
  const id = randomUUID(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  const date = body.date ? new Date(body.date).toISOString().slice(0,19).replace('T',' ') : ts;

  await transaction(async (conn) => {
    const paymentMethod = body.payment_method
      ? validateExpensePaymentMethodOrDefault(body.payment_method)
      : null;
    await conn.execute(
      'INSERT INTO expenses (id,category_id,description,amount,payment_method,product_id,product_quantity,date,user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [id,body.category_id??null,body.description,Number(body.amount??0),paymentMethod,body.product_id??null,body.product_quantity??null,date,sessionUser.id,ts,ts]
    );
    if (body.product_id && body.product_quantity) {
      const productId = body.product_id;
      const qty = Number(body.product_quantity);

      await conn.execute('UPDATE products SET stock=GREATEST(0,stock-?),updated_at=? WHERE id=?',[qty,ts,productId]);

      await conn.execute("INSERT INTO stock_movements (id,product_id,type,quantity,reason,reference_id,user_id,date,created_at) VALUES (?,?,'expense',?,?,?,?,?,?)",
        [randomUUID(),productId,qty,body.description,id,sessionUser.id,date,ts]);

      const locationId = body.location_id;
      if (locationId) {
        const [locRows] = await conn.execute(
          'SELECT id, quantity FROM location_stock WHERE location_id=? AND product_id=? LIMIT 1',
          [locationId, productId]
        );
        const existing = (locRows as { id: string; quantity: number }[])[0];
        const available = existing?.quantity ?? 0;

        if (available < qty) {
          throw new Error(`Stock insuficiente en el almacén. Disponible: ${available}, solicitado: ${qty}`);
        }

        await conn.execute(
          'UPDATE location_stock SET quantity=quantity-?, updated_at=? WHERE location_id=? AND product_id=?',
          [qty, ts, locationId, productId]
        );

        await conn.execute(
          'INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
          [randomUUID(), locationId, productId, 'salida', qty, `Gasto: ${body.description}`, sessionUser.id, ts]
        );
      }
    }
  });
  return ok((await query('SELECT * FROM expenses WHERE id=?',[id]))[0], 201);
});

export const DELETE = handle(async (req: Request) => {
  const sessionUser = await requireAuth();
  if (sessionUser.role !== 'owner' && sessionUser.role !== 'admin') {
    return forbidden('No autorizado — solo administradores');
  }

  const { id } = await req.json();
  if (!id) return err('ID requerido');

  const expense = await queryOne<{
    product_id: string | null;
    product_quantity: number | null;
    description: string;
  }>('SELECT product_id, product_quantity, description FROM expenses WHERE id=?', [id]);

  if (!expense) return notFound('Gasto no encontrado');

  const ts = new Date().toISOString().slice(0,19).replace('T',' ');

  await transaction(async (conn) => {
    if (expense.product_id && expense.product_quantity) {
      const qty = Number(expense.product_quantity);

      await conn.execute('UPDATE products SET stock=stock+?, updated_at=? WHERE id=?', [qty, ts, expense.product_id]);

      await conn.execute("DELETE FROM stock_movements WHERE reference_id=? AND type='expense'", [id]);

      const [locMoveRows] = await conn.execute(
        "SELECT id, location_id FROM location_movements WHERE reference_id IS NULL AND notes LIKE ? AND type='salida'",
        [`%Gasto: ${expense.description}%`]
      ) as unknown as [{ id: string; location_id: string }[], unknown];

      if (locMoveRows.length > 0) {
        for (const lm of locMoveRows) {
          await conn.execute(
            'UPDATE location_stock SET quantity=quantity+?, updated_at=? WHERE location_id=? AND product_id=?',
            [qty, ts, lm.location_id, expense.product_id]
          );
          await conn.execute('DELETE FROM location_movements WHERE id=?', [lm.id]);
        }
      }
    }

    await conn.execute('DELETE FROM expenses WHERE id=?', [id]);
  });

  await logAudit({
    user_id: sessionUser.id,
    user_name: sessionUser.name,
    action: 'delete',
    entity_type: 'expense',
    entity_id: id,
    entity_name: expense.description,
    details: { amount: expense.product_quantity ? Number(expense.product_quantity) : null },
  });

  return ok({ ok: true });
});
