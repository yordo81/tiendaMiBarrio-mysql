export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, transaction } from '@/lib/db/mysql';
import {
  validateCustomerPaymentMethodOrDefault,
  requireNonNegativeNumber,
} from '@/lib/validate';
import { r2, type CurrencyLike } from '@/lib/currency';
import { invalidateAllReportCaches } from '@/lib/report-cache';
import { handle, ok, err } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

// ── Abonos a la deuda de un cliente ─────────────────────────────────
// Formato nuevo: `parts` = [{ method, amount_cash, amount_transfer, currency_code }]
// (el mismo formato del cobro de ventas en /api/sales/[id]/pay). Los montos
// están en la moneda de cada parte ('' = moneda base). El servidor congela la
// tasa de cada parte y guarda UNA fila de abono por parte, en SU moneda: así
// el arqueo por moneda del turno cuenta exactamente el efectivo/digital que
// entró de cada una. Sin venta vinculada (sale_id = null) el abono se aplica
// al saldo general del cliente; con venta vinculada, además actualiza el
// estado de esa venta.
//
// Formato legacy: { amount, method, notes } con monto único (compatibilidad
// con llamadas antiguas).

interface PartRow {
  method: 'cash' | 'transfer' | 'mixed';
  amount: number;
  currency_code: string | null;
  exchange_rate: number | null;
  base_amount: number;
}

/** Monedas activas y tasas vigentes (el servidor congela la tasa). */
async function loadCurrencies() {
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
  return { currencyRows, baseCode, rateToBase, currencies, typeByCode };
}

export const POST = handle(async (req: Request, ctx) => {
  const sessionUser = await requireAuth();
  const body = await req.json();
  const { customer_id, sale_id, notes } = body;
  if (!customer_id) return err('Datos inválidos');

  const { currencyRows, baseCode, rateToBase, typeByCode } = await loadCurrencies();
  if (!baseCode) return err('No hay moneda base configurada');

  const partRows: PartRow[] = [];

  if (Array.isArray(body.parts) && body.parts.length > 0) {
    // Abono multi-moneda / mixto: una parte por moneda cobrada.
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
        amount: r2(partCash + partTransfer),
        currency_code: partCurrency === baseCode ? null : partCurrency,
        exchange_rate: partCurrency === baseCode ? null : rate,
        base_amount: r2((partCash + partTransfer) * rate),
      });
    }
  } else {
    // Legacy: un solo monto (sin convertir: el saldo del cliente está en base).
    const amount = Number(body.amount ?? 0);
    if (!(amount > 0)) return err('Datos inválidos');
    const method = validateCustomerPaymentMethodOrDefault(body.method);
    partRows.push({
      method,
      amount: r2(amount),
      currency_code: null,
      exchange_rate: null,
      base_amount: r2(amount),
    });
  }

  const paidNewBase = r2(partRows.reduce((a, p) => a + p.base_amount, 0));
  if (paidNewBase <= 0) return err('El monto debe ser mayor a 0');

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const paymentIds: string[] = [];

  await transaction(async (conn) => {
    for (const p of partRows) {
      const id = randomUUID();
      paymentIds.push(id);
      await conn.execute(
        'INSERT INTO customer_payments (id,customer_id,sale_id,amount,currency_code,exchange_rate,method,date,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id, customer_id, sale_id ?? null, p.amount, p.currency_code, p.exchange_rate, p.method, ts, notes ?? null, ts]
      );
    }

    // El saldo del cliente se lleva en moneda base: se descuenta el equivalente
    // del abono (los pagos en otra moneda se convierten con su tasa congelada).
    await conn.execute('UPDATE customers SET balance=GREATEST(0,balance-?),updated_at=? WHERE id=?', [paidNewBase, ts, customer_id]);

    if (sale_id) {
      const [saleRows] = await conn.execute('SELECT total,status,currency_code FROM sales WHERE id=?', [sale_id]);
      const sale = (saleRows as { total: number; status: string; currency_code: string | null }[])[0];
      if (sale && sale.status !== 'cancelled') {
        // Total abonado a la venta, convertido a moneda base (mezcla abonos en
        // distintas monedas con sus tasas congeladas). Se incluyen TAMBIÉN los
        // pagos registrados al crear la venta (tabla payments, method<>'credit'):
        // sin esto, una venta crédito/oferta-parcial con pago inicial quedaría en
        // 'partial' aunque el abono cubra todo el resto pendiente.
        const [payRows] = await conn.execute(
          `SELECT COALESCE(SUM(CASE WHEN currency_code IS NOT NULL AND currency_code<>'' THEN amount*COALESCE(exchange_rate,1) ELSE amount END),0) AS paid
           FROM customer_payments WHERE sale_id=?`,
          [sale_id]
        );
        const [salePayRows] = await conn.execute(
          `SELECT COALESCE(SUM(CASE WHEN currency_code IS NOT NULL AND currency_code<>'' THEN (amount_cash+amount_transfer)*COALESCE(exchange_rate,1) ELSE (amount_cash+amount_transfer) END),0) AS paid
           FROM payments WHERE sale_id=? AND method<>'credit'`,
          [sale_id]
        );
        const paid = r2(Number((payRows as { paid: number }[])[0].paid)
          + Number((salePayRows as { paid: number }[])[0].paid));
        const saleCurrency = sale.currency_code ? String(sale.currency_code).toUpperCase() : baseCode;
        const saleRateToBase = rateToBase(saleCurrency) ?? 1;
        const saleTotalBase = r2(Number(sale.total) * saleRateToBase);
        if (paid + 0.01 >= saleTotalBase) {
          await conn.execute("UPDATE sales SET status='completed',updated_at=? WHERE id=?", [ts, sale_id]);
        } else {
          await conn.execute("UPDATE sales SET status='partial',updated_at=? WHERE id=?", [ts, sale_id]);
        }
      }
    }
  });

  // El abono cambia las deudas de clientes: invalidar los reportes cacheados
  // (dashboard "Por cobrar", cuentas, etc.) para que se refresquen de inmediato.
  invalidateAllReportCaches(sessionUser.id).catch(() => {});

  return ok((await query('SELECT * FROM customer_payments WHERE id=?', [paymentIds[0]]))[0], 201);
});
