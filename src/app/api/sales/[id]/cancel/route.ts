export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { queryOne, transaction } from '@/lib/db/mysql';
import { logAudit } from '@/lib/db/audit';
import { formatCurrency } from '@/lib/utils';
import { handle, ok, err, notFound, forbidden } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

export const POST = handle(async (_: Request, ctx) => {
  const { id } = await ctx!.params;
  const sessionUser = await requireAuth();
  if (sessionUser.role !== 'owner' && sessionUser.role !== 'admin') {
    return forbidden('No autorizado — solo administradores');
  }

  const sale = await queryOne<{
    id: string; customer_id: string | null; total: number; status: string;
  }>('SELECT id, customer_id, total, status FROM sales WHERE id=?', [id]);

  if (!sale) return notFound('Venta no encontrada');
  if (sale.status === 'cancelled') return err('La venta ya está cancelada');

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  await transaction(async (conn) => {
    const [itemRows] = await conn.execute(
      'SELECT product_id, quantity FROM sale_items WHERE sale_id=?', [id]
    ) as unknown as [{ product_id: string; quantity: number }[], unknown];
    const items = itemRows;

    for (const item of items) {
      await conn.execute(
        'UPDATE products SET stock=stock+?, updated_at=? WHERE id=?',
        [item.quantity, ts, item.product_id]
      );
      await conn.execute(
        "INSERT INTO stock_movements (id,product_id,type,quantity,reason,reference_id,user_id,date,created_at) VALUES (?,?,'in',?,?,?,?,?,?)",
        [randomUUID(), item.product_id, item.quantity, 'Cancelación de venta', id, sessionUser.id, ts, ts]
      );
    }

    const [locMoveRows] = await conn.execute(
      "SELECT location_id, product_id, quantity FROM location_movements WHERE reference_id=? AND type='venta'",
      [id]
    ) as unknown as [{ location_id: string; product_id: string; quantity: number }[], unknown];
    const locMoves = locMoveRows;

    for (const lm of locMoves) {
      await conn.execute(
        'INSERT INTO location_stock (id,location_id,product_id,quantity,updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+?, updated_at=?',
        [randomUUID(), lm.location_id, lm.product_id, lm.quantity, ts, lm.quantity, ts]
      );
      await conn.execute(
        "INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,reference_id,user_id,created_at) VALUES (?,?,?,'entrada',?,?,?,?,?)",
        [randomUUID(), lm.location_id, lm.product_id, lm.quantity, 'Cancelación de venta', id, sessionUser.id, ts]
      );
    }

    if (sale.customer_id) {
      const [payRows] = await conn.execute(
        "SELECT method FROM payments WHERE sale_id=?", [id]
      ) as unknown as [{ method: string }[], unknown];

      const wasCredit = payRows.some(p => p.method === 'credit');
      if (wasCredit) {
        await conn.execute(
          'UPDATE customers SET balance=GREATEST(0,balance-?),updated_at=? WHERE id=?',
          [sale.total, ts, sale.customer_id]
        );
      }
    }

    await conn.execute(
      'UPDATE sales SET status=?,updated_at=? WHERE id=?',
      ['cancelled', ts, id]
    );
  });

  await logAudit({
    user_id: sessionUser.id,
    user_name: sessionUser.name,
    action: 'cancel',
    entity_type: 'sale',
    entity_id: id,
    entity_name: `Venta #${id.slice(0, 8)} — ${formatCurrency(sale.total)}`,
    details: { total: sale.total, customer_id: sale.customer_id },
  });

  return ok({ ok: true, message: 'Venta cancelada correctamente' });
});
