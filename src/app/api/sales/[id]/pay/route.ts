export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, transaction } from '@/lib/db/mysql';
import {
  validateCustomerPaymentMethodOrDefault,
  requireNonNegativeNumber,
} from '@/lib/validate';
import { r2, type CurrencyLike } from '@/lib/currency';
import { invalidateAllReportCaches } from '@/lib/report-cache';
import { handle, ok, err, notFound } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

// ── Cobro de una venta pendiente/parcial ───────────────────────────
// Formato nuevo: `parts` = [{ method, amount_cash, amount_transfer, currency_code }]
// donde los montos están en la moneda de cada parte ('' = moneda base). El
// servidor congela la tasa de cada parte y guarda UNA fila de abono por parte,
// en SU moneda: así el arqueo por moneda del turno cuenta exactamente el
// efectivo/digital que entró de cada una. La deuda de la venta se sigue en su
// moneda (sale.currency_code) y el saldo del cliente en moneda base.
//
// Formato legacy: { amount, method, notes } con `amount` en la moneda de la
// venta (compatibilidad con llamadas antiguas).
export const POST = handle(async (req: Request, ctx) => {
  const { id: saleId } = await ctx!.params;
  const sessionUser = await requireAuth();

  const saleRows = await query('SELECT * FROM sales WHERE id=?', [saleId]);
  const sale = (saleRows as Record<string, unknown>[])[0];
  if (!sale) return notFound('Venta no encontrada');
  if (sale.status === 'cancelled') return err('La venta está cancelada');
  if (sale.status === 'completed') return err('La venta ya está pagada');
  if (!sale.customer_id) return err('La venta no tiene cliente asociado');

  // ── Monedas y tasas vigentes (el servidor congela la tasa) ──
  // Convención: las tasas se guardan SIEMPRE contra el dólar (USD → moneda).
  const currencyRows = await query<{ code: string; is_base: number; currency_type: string }>(
    'SELECT code, is_base, currency_type FROM currencies WHERE active = 1'
  );
  const usdRows = await query<{ to_currency: string; rate: number }>(
    "SELECT to_currency, rate FROM currency_rates WHERE from_currency = 'USD'"
  );
  const usdMap = new Map<string, number>();
  for (const r of usdRows) {
    const v = Number(r.rate);
    if (v > 0) usdMap.set(r.to_currency, v);
  }
  const baseCode = currencyRows.find(c => Number(c.is_base) === 1)?.code ?? '';
  const usdRateFor = (code: string | null): number | null => {
    if (!code) return null;
    return code === 'USD' ? 1 : (usdMap.get(code) ?? null);
  };
  const usdInBase = usdRateFor(baseCode);
  /** Tasa hacia la base derivada de la referencia USD (1 moneda = X base). */
  const rateToBase = (code: string | null): number | null => {
    if (!code || !baseCode) return null;
    if (code === baseCode) return 1;
    const usd = usdRateFor(code);
    return usdInBase != null && usd ? usdInBase / usd : null;
  };
  const currencies: CurrencyLike[] = currencyRows.map(c => ({
    code: c.code,
    rate: rateToBase(c.code) ?? 1,
    is_base: Boolean(c.is_base),
  }));
  const typeByCode = new Map<string, string>();
  for (const c of currencyRows) typeByCode.set(c.code, c.currency_type === 'digital' ? 'digital' : 'cash');

  // La deuda se sigue en la moneda de la venta (NULL = moneda base).
  const saleCurrency = sale.currency_code ? String(sale.currency_code).toUpperCase() : baseCode;
  const saleRateToBase = rateToBase(saleCurrency) ?? 1;
  // Deuda total de la venta en moneda base, para saber si queda saldada.
  const saleTotalBase = r2(Number(sale.total) * saleRateToBase);

  const body = await req.json();
  const notes = body.notes ?? null;

  interface PartRow {
    method: 'cash' | 'transfer' | 'mixed';
    amount_cash: number;
    amount_transfer: number;
    currency_code: string | null;
    exchange_rate: number | null;
    base_amount: number;
  }
  const partRows: PartRow[] = [];

  if (Array.isArray(body.parts) && body.parts.length > 0) {
    // Cobro (múltiples monedas y/o mixto): una parte por moneda cobrada.
    for (const part of body.parts) {
      const partCash = requireNonNegativeNumber(part?.amount_cash ?? 0, 'Efectivo de la parte');
      const partTransfer = requireNonNegativeNumber(part?.amount_transfer ?? 0, 'Transferencia de la parte');
      if (partCash + partTransfer <= 0) return err('Cada parte del pago debe tener un monto mayor que 0');
      const partCurrency = part?.currency_code ? String(part.currency_code).trim().toUpperCase() : baseCode;
      if (!partCurrency) return err('No hay moneda base configurada para registrar el pago');
      const cur = currencyRows.find(c => c.code === partCurrency);
      if (!cur) return err(`La moneda "${partCurrency}" no existe o está inactiva`);
      // Tipo de moneda vs método: las físicas solo en efectivo y las digitales
      // solo por transferencia. El mixto (ambos montos) no se restringe.
      const t = typeByCode.get(partCurrency) ?? 'cash';
      if (partCash > 0 && partTransfer <= 0 && t !== 'cash') {
        return err(`La moneda ${partCurrency} es digital: solo se puede cobrar por transferencia`);
      }
      if (partTransfer > 0 && partCash <= 0 && t !== 'digital') {
        return err(`La moneda ${partCurrency} es física: solo se puede cobrar en efectivo`);
      }
      const rate = partCurrency === baseCode ? 1 : (rateToBase(partCurrency) ?? 1);
      partRows.push({
        method: partCash > 0 && partTransfer > 0 ? 'mixed' : partCash > 0 ? 'cash' : 'transfer',
        amount_cash: partCash,
        amount_transfer: partTransfer,
        currency_code: partCurrency === baseCode ? null : partCurrency,
        exchange_rate: partCurrency === baseCode ? null : rate,
        base_amount: r2((partCash + partTransfer) * rate),
      });
    }
  } else {
    // Legacy: un solo monto expresado en la moneda de la venta. Sin monto
    // explícito se abona el RESTO pendiente (la venta puede tener abonos
    // previos: no se vuelve a cobrar el total).
    let amount = Number(body.amount ?? 0);
    if (!(amount > 0)) {
      const prevRows = await query<{ paid: number }>(
        `SELECT COALESCE(SUM(CASE WHEN currency_code IS NOT NULL AND currency_code<>'' THEN amount*COALESCE(exchange_rate,1) ELSE amount END),0) AS paid
         FROM customer_payments WHERE sale_id=?`,
        [saleId]
      );
      amount = r2((saleTotalBase - Number((prevRows as { paid: number }[])[0]?.paid ?? 0)) / saleRateToBase);
    }
    const method = validateCustomerPaymentMethodOrDefault(body.method);
    if (!(amount > 0)) return err('El monto debe ser mayor a 0');
    const rate = saleCurrency === baseCode ? 1 : saleRateToBase;
    partRows.push({
      method,
      amount_cash: method === 'transfer' ? 0 : amount,
      amount_transfer: method === 'transfer' ? amount : 0,
      currency_code: saleCurrency === baseCode ? null : saleCurrency,
      exchange_rate: saleCurrency === baseCode ? null : rate,
      base_amount: r2(amount * rate),
    });
  }

  const paidNewBase = r2(partRows.reduce((a, p) => a + p.base_amount, 0));
  if (paidNewBase <= 0) return err('El monto debe ser mayor a 0');

  const customerId = String(sale.customer_id);
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const paymentIds: string[] = [];

  await transaction(async (conn) => {
    for (const p of partRows) {
      const id = randomUUID();
      paymentIds.push(id);
      await conn.execute(
        'INSERT INTO customer_payments (id,customer_id,sale_id,amount,currency_code,exchange_rate,method,date,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id, customerId, saleId, r2(p.amount_cash + p.amount_transfer), p.currency_code, p.exchange_rate, p.method, ts, notes, ts]
      );
    }

    // El saldo del cliente se lleva en moneda base: se descuenta el equivalente
    // del abono (los pagos en otra moneda se convierten con su tasa congelada).
    await conn.execute('UPDATE customers SET balance=GREATEST(0,balance-?),updated_at=? WHERE id=?', [paidNewBase, ts, customerId]);

    // Total abonado a la venta, convertido a moneda base (mezcla abonos en
    // distintas monedas con sus tasas congeladas).
    const [payRows] = await conn.execute(
      `SELECT COALESCE(SUM(CASE WHEN currency_code IS NOT NULL AND currency_code<>'' THEN amount*COALESCE(exchange_rate,1) ELSE amount END),0) AS paid
       FROM customer_payments WHERE sale_id=?`,
      [saleId]
    );
    const paid = Number((payRows as { paid: number }[])[0].paid);

    if (paid + 0.01 >= saleTotalBase) {
      await conn.execute("UPDATE sales SET status='completed',updated_at=? WHERE id=?", [ts, saleId]);
    } else {
      await conn.execute("UPDATE sales SET status='partial',updated_at=? WHERE id=?", [ts, saleId]);
    }
  });

  // El abono cambia las deudas de clientes: invalidar los reportes cacheados
  // (dashboard "Por cobrar", cuentas, etc.) para que se refresquen de inmediato.
  invalidateAllReportCaches(sessionUser.id).catch(() => {});

  return ok({
    success: true,
    payment_ids: paymentIds,
    amount: paidNewBase,
    currency_code: baseCode || null,
    sale_id: saleId,
  }, 201);
});
