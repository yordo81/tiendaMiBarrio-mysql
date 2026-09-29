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
  // Lo cobrado incluye los pagos hechos AL CREAR la venta (cobro normal,
  // mixto/oferta en varias monedas) y los abonos posteriores; los montos pueden
  // venir en distintas monedas (cada uno con su tasa congelada). Se convierten a
  // la moneda de la VENTA, que es la moneda en la que se sigue la deuda y en la
  // que la UI calcula el resto pendiente.
  const sale = (saleRows as { currency_code: string | null; exchange_rate: number | null }[])[0];
  const saleRate = sale?.exchange_rate != null && Number(sale.exchange_rate) > 0 ? Number(sale.exchange_rate) : 1;
  const rateOf = (currencyCode: string | null, exchangeRate: number | null): number =>
    currencyCode ? (exchangeRate != null && Number(exchangeRate) > 0 ? Number(exchangeRate) : 1) : 1;
  const paidBase = (customerPayments as { amount: number; currency_code: string | null; exchange_rate: number | null }[])
    .reduce((a, p) => a + Number(p.amount ?? 0) * rateOf(p.currency_code, p.exchange_rate), 0);
  // Pagos registrados al crear la venta (la fila de crédito representa la
  // deuda, no un cobro: se excluye).
  const paidAtSaleBase = (payments as { amount_cash: number; amount_transfer: number; currency_code: string | null; exchange_rate: number | null; method: string }[])
    .filter(p => p.method !== 'credit')
    .reduce((a, p) => a + (Number(p.amount_cash ?? 0) + Number(p.amount_transfer ?? 0)) * rateOf(p.currency_code, p.exchange_rate), 0);
  const totalPaid = r2((paidBase + paidAtSaleBase) / saleRate);
  return ok({ items, payments, customer_payments: customerPayments, total_paid: totalPaid });
});
