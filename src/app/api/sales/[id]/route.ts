export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';
import { handle, ok } from '@/lib/api-helpers';

export const GET = handle(async (_: Request, ctx) => {
  const { id } = await ctx!.params;
  await requireAuth();
  const [items, payments, customerPayments] = await Promise.all([
    query(`SELECT si.*,p.name AS product_name,p.unit FROM sale_items si LEFT JOIN products p ON p.id=si.product_id WHERE si.sale_id=?`,[id]),
    query('SELECT * FROM payments WHERE sale_id=?',[id]),
    query('SELECT * FROM customer_payments WHERE sale_id=? ORDER BY date DESC',[id]),
  ]);
  const totalPaid = (customerPayments as {amount:number}[]).reduce((a,p) => a + Number(p.amount??0), 0);
  return ok({ items, payments, customer_payments: customerPayments, total_paid: totalPaid });
});
