export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, transaction } from '@/lib/db/mysql';
import { handle, ok, err, notFound } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

export const POST = handle(async (req: Request, ctx) => {
  const { id: saleId } = await ctx!.params;
  const sessionUser = await requireAuth();

  const saleRows = await query('SELECT * FROM sales WHERE id=?', [saleId]);
  const sale = (saleRows as Record<string,unknown>[])[0];
  if (!sale) return notFound('Venta no encontrada');
  if (sale.status === 'cancelled') return err('La venta está cancelada');
  if (sale.status === 'completed') return err('La venta ya está pagada');
  if (!sale.customer_id) return err('La venta no tiene cliente asociado');

  const body = await req.json();
  const amount = body.amount ?? sale.total;
  const method = body.method ?? 'cash';
  const notes = body.notes ?? null;

  if (amount <= 0) return err('El monto debe ser mayor a 0');

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const paymentId = randomUUID();

  await transaction(async (conn) => {
    await conn.execute(
      'INSERT INTO customer_payments (id,customer_id,sale_id,amount,method,date,notes,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [paymentId, sale.customer_id, saleId, amount, method, ts, notes, ts]
    );

    await conn.execute('UPDATE customers SET balance=GREATEST(0,balance-?),updated_at=? WHERE id=?', [amount, ts, sale.customer_id]);

    const [payRows] = await conn.execute(
      'SELECT COALESCE(SUM(amount),0) AS paid FROM customer_payments WHERE sale_id=?',
      [saleId]
    );
    const paid = (payRows as {paid: number}[])[0].paid;

    if (paid >= Number(sale.total)) {
      await conn.execute("UPDATE sales SET status='completed',updated_at=? WHERE id=?", [ts, saleId]);
    } else {
      await conn.execute("UPDATE sales SET status='partial',updated_at=? WHERE id=?", [ts, saleId]);
    }
  });

  return ok({
    success: true,
    payment_id: paymentId,
    amount,
    sale_id: saleId,
  }, 201);
});
