export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';
import { r2 } from '@/lib/currency';
import { handle, ok } from '@/lib/api-helpers';

export const GET = handle(async (_: Request, ctx) => {
  const { id } = await ctx!.params;
  await requireAuth();
  const [items, payments, customerPayments, saleRows] = await Promise.all([
    query(`SELECT si.*,p.name AS product_name,p.unit,p.sale_price AS current_sale_price FROM sale_items si LEFT JOIN products p ON p.id=si.product_id WHERE si.sale_id=?`,[id]),
    query('SELECT * FROM payments WHERE sale_id=?',[id]),
    query('SELECT * FROM customer_payments WHERE sale_id=? ORDER BY date DESC',[id]),
    query('SELECT currency_code, exchange_rate FROM sales WHERE id=?',[id]),
  ]);
  // Los abonos pueden venir en distintas monedas (cada uno con su tasa
  // congelada). Se convierten a la moneda de la VENTA, que es la moneda en la
  // que se sigue la deuda y en la que la UI calcula el resto pendiente.
  const sale = (saleRows as { currency_code: string | null; exchange_rate: number | null }[])[0];
  const saleRate = sale?.exchange_rate != null && Number(sale.exchange_rate) > 0 ? Number(sale.exchange_rate) : 1;
  const paidBase = (customerPayments as { amount: number; currency_code: string | null; exchange_rate: number | null }[])
    .reduce((a, p) => {
      const amount = Number(p.amount ?? 0);
      const rate = p.currency_code ? (p.exchange_rate != null && Number(p.exchange_rate) > 0 ? Number(p.exchange_rate) : 1) : 1;
      return a + amount * rate;
    }, 0);
  const totalPaid = r2(paidBase / saleRate);
  return ok({ items, payments, customer_payments: customerPayments, total_paid: totalPaid });
});
