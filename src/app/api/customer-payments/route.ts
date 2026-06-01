export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, transaction } from '@/lib/db/mysql';
import { validateCustomerPaymentMethodOrDefault } from '@/lib/validate';
import { handle, ok, err } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

export const GET = handle(async (req: Request) => {
  await requireAuth();
  const { searchParams } = new URL(req.url);
  const cid = searchParams.get('customer_id');
  const sql = `SELECT cp.*,c.name AS customer_name FROM customer_payments cp LEFT JOIN customers c ON c.id=cp.customer_id${cid?' WHERE cp.customer_id=?':''} ORDER BY cp.date DESC LIMIT 100`;
  return ok(await query(sql, cid?[cid]:[]));
});

export const POST = handle(async (req: Request) => {
  await requireAuth();
  const { customer_id, amount, method, notes, sale_id } = await req.json();
  if (!customer_id || !amount || amount <= 0) return err('Datos inválidos');
  const id = randomUUID(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  await transaction(async (conn) => {
    const validMethod = validateCustomerPaymentMethodOrDefault(method);
    await conn.execute('INSERT INTO customer_payments (id,customer_id,sale_id,amount,method,date,notes,created_at) VALUES (?,?,?,?,?,?,?,?)',[id,customer_id,sale_id??null,amount,validMethod,ts,notes??null,ts]);
    await conn.execute('UPDATE customers SET balance=GREATEST(0,balance-?),updated_at=? WHERE id=?',[amount,ts,customer_id]);

    if (sale_id) {
      const [saleRows] = await conn.execute('SELECT total,status FROM sales WHERE id=?',[sale_id]);
      const sale = (saleRows as {total:number;status:string}[])[0];
      if (sale && sale.status !== 'cancelled') {
        const [payRows] = await conn.execute('SELECT COALESCE(SUM(amount),0) AS paid FROM customer_payments WHERE sale_id=?',[sale_id]);
        const paid = (payRows as {paid:number}[])[0].paid;
        if (paid >= sale.total) {
          await conn.execute("UPDATE sales SET status='completed',updated_at=? WHERE id=?",[ts,sale_id]);
        } else {
          await conn.execute("UPDATE sales SET status='partial',updated_at=? WHERE id=?",[ts,sale_id]);
        }
      }
    }
  });
  return ok((await query('SELECT * FROM customer_payments WHERE id=?',[id]))[0], 201);
});
