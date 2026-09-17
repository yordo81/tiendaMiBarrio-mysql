import { query } from '@/lib/db/mysql';
import { utcToLocal, utcToDb, nowLocal, nowUtc } from '@/lib/shift-time';

// ── Resumen en vivo de un turno abierto ───────────────────────────
// Calcula los acumulados del turno (ventas completadas, efectivo
// recibido y efectivo esperado en caja) usando las mismas ventanas y
// convenciones de zona horaria que el cierre/arqueo:
//   - sales/payments se guardan en HORA LOCAL (TIMEZONE)
//   - shifts/expenses/customer_payments/cash_register se guardan en UTC
//
// El "esperado" es el efectivo que debería haber en caja en este
// momento: fondo inicial + ingresos en efectivo − egresos en efectivo.
//
// Arqueo por moneda: cada pago/abono/gasto guarda la moneda en que se
// cobró (currency_code) y su tasa congelada (exchange_rate). El
// efectivo esperado se desglosa por moneda (`expected_cash_by_currency`)
// y el total (`expected_cash`) se expresa en la MONEDA BASE, convirtiendo
// el efectivo de otras monedas con su tasa congelada. NULL = moneda base.

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ShiftLiveSummary {
  total_sales: number;
  /** Cantidad de ventas (tickets) completados en el turno */
  sales_count: number;
  /** Efectivo esperado en caja, en MONEDA BASE (las otras monedas convertidas con su tasa congelada) */
  total_cash: number;
  expected_cash: number;
  /** Efectivo esperado desglosado por moneda: cuánto hay de cada una en caja */
  cash_by_currency: { code: string; amount: number }[];
  /** Igual que expected_cash, en moneda base (compatibilidad con clientes previos) */
  expected_cash_by_currency: { code: string; amount: number }[];
  /** Código de la moneda base del negocio */
  base_currency: string;
}

/** Suma `amount` bajo la clave de moneda dada dentro del mapa acumulado. */
function addToCurrencyMap(map: Record<string, number>, code: string | null, amount: number) {
  const key = code ?? '';
  map[key] = r2((map[key] ?? 0) + amount);
}

/**
 * Resuelve el código de la moneda base activa del negocio.
 * Si no hay configurada, devuelve '' (los montos sin moneda quedan agrupados).
 */
async function getBaseCurrencyCode(): Promise<string> {
  try {
    const rows = await query<{ code: string }>(
      "SELECT code FROM currencies WHERE is_base = 1 AND active = 1 LIMIT 1"
    );
    return rows[0]?.code ?? '';
  } catch {
    return '';
  }
}

/**
 * Combina las contribuciones al efectivo esperado (en sus monedas) con los
 * factores de conversión hacia la moneda base y devuelve el desglose por
 * moneda ordenado (base primero) y el total convertido a base.
 *
 * @param amounts    Mapa { moneda -> monto acumulado en esa moneda }
 * @param rates      Mapa { moneda -> tasa congelada promedio (1 moneda = X base) }
 * @param baseCode   Código de la moneda base
 */
function summarizeCashByCurrency(
  amounts: Record<string, number>,
  rates: Record<string, number>,
  baseCode: string
): { byCurrency: { code: string; amount: number }[]; totalBase: number } {
  const byCurrency = Object.entries(amounts)
    .filter(([, amount]) => amount !== 0)
    .map(([code, amount]) => ({
      code: code || baseCode || 'BASE',
      amount,
      rate: code ? (rates[code] ?? 1) : 1,
    }))
    // La moneda base primero; el resto por monto descendente
    .sort((a, b) => {
      const aIsBase = a.code === baseCode;
      const bIsBase = b.code === baseCode;
      if (aIsBase !== bIsBase) return aIsBase ? -1 : 1;
      return Math.abs(b.amount) - Math.abs(a.amount);
    });

  const totalBase = r2(
    byCurrency.reduce((acc, c) => acc + c.amount * (c.rate || 1), 0)
  );

  return {
    byCurrency: byCurrency.map(({ code, amount }) => ({ code, amount: r2(amount) })),
    totalBase,
  };
}

export async function getOpenShiftLiveSummary(shift: Record<string, unknown>): Promise<ShiftLiveSummary> {
  const shiftId = String(shift.id ?? '');
  const posId = shift.pos_id ? String(shift.pos_id) : null;
  const openingCash = Number(shift.opening_cash ?? 0);
  const openedAtRaw = String(shift.opened_at_raw ?? '');

  const fromLocal = utcToLocal(openedAtRaw);
  const fromUtc = utcToDb(openedAtRaw);
  const localNow = nowLocal();
  const utcNow = nowUtc();

  const [baseCode, sales, salesCash, custCash, expCash, registerCash] = await Promise.all([
    getBaseCurrencyCode(),
    // Ventas completadas del turno (solo las que ya son ingreso)
    query<{ total: number; count: number }>(
      `SELECT COALESCE(SUM(s.total),0) AS total, COUNT(*) AS count FROM sales s
       WHERE s.status='completed' AND s.date BETWEEN ? AND ? AND s.pos_id=?`,
      [fromLocal, localNow, posId]
    ),
    // Efectivo recibido en las ventas (pagos en efectivo / mixto), por moneda.
    // La tasa congelada del pago permite convertir su efectivo a moneda base.
    query<{ currency_code: string | null; total: number; avg_rate: number | null }>(
      `SELECT p.currency_code,
              COALESCE(SUM(p.amount_cash),0) AS total,
              AVG(p.exchange_rate) AS avg_rate
       FROM payments p
       JOIN sales s ON s.id=p.sale_id
       WHERE s.status!='cancelled' AND p.date BETWEEN ? AND ? AND s.pos_id=?
       GROUP BY p.currency_code`,
      [fromLocal, localNow, posId]
    ),
    // Abonos de clientes en efectivo (mixtos 50/50), por moneda
    query<{ currency_code: string | null; total: number; avg_rate: number | null }>(
      `SELECT cp.currency_code,
              COALESCE(SUM(CASE WHEN cp.method='cash' THEN cp.amount WHEN cp.method='mixed' THEN cp.amount/2 ELSE 0 END),0) AS total,
              AVG(cp.exchange_rate) AS avg_rate
       FROM customer_payments cp LEFT JOIN sales s ON s.id=cp.sale_id
       WHERE cp.date BETWEEN ? AND ? AND (cp.sale_id IS NULL OR s.pos_id=?)
       GROUP BY cp.currency_code`,
      [fromUtc, utcNow, posId]
    ),
    // Egresos en efectivo (gastos, mixtos 50/50). Los gastos no registran
    // moneda: se asumen en la moneda base (como siempre se hicieron).
    query<{ total: number }>(
      `SELECT COALESCE(SUM(CASE WHEN payment_method='cash' THEN amount WHEN payment_method='mixed' THEN amount/2 ELSE 0 END),0) AS total
       FROM expenses WHERE date BETWEEN ? AND ? AND pos_id=?`,
      [fromUtc, utcNow, posId]
    ),
    // Movimientos de caja en efectivo (aportes/ajustes +). Tampoco registran
    // moneda: se asumen en la moneda base.
    query<{ total: number }>(
      `SELECT COALESCE(SUM(cr.cash_amount),0) AS total FROM cash_register cr
       WHERE cr.date BETWEEN ? AND ? AND (cr.shift_id IS NULL OR cr.shift_id=?)`,
      [fromUtc, utcNow, shiftId]
    ),
  ]);

  // Acumular el efectivo esperado por moneda
  const amounts: Record<string, number> = {};
  const rates: Record<string, number> = {};
  // El fondo inicial y los movimientos de caja se cuentan en la moneda base
  addToCurrencyMap(amounts, null, openingCash + Number(registerCash[0]?.total ?? 0));
  // Efectivo de las ventas de la caja, agrupado por su moneda
  for (const row of salesCash) {
    addToCurrencyMap(amounts, row.currency_code, Number(row.total ?? 0));
    if (row.currency_code) rates[row.currency_code] = row.avg_rate != null && Number(row.avg_rate) > 0 ? Number(row.avg_rate) : 1;
  }
  // Abonos en efectivo (los sueltos, sin venta, cuentan en todas las cajas)
  for (const row of custCash) {
    addToCurrencyMap(amounts, row.currency_code, Number(row.total ?? 0));
    if (row.currency_code && rates[row.currency_code] === undefined) {
      rates[row.currency_code] = row.avg_rate != null && Number(row.avg_rate) > 0 ? Number(row.avg_rate) : 1;
    }
  }
  // Los egresos en efectivo (gastos) restan de la moneda base
  addToCurrencyMap(amounts, null, -Number(expCash[0]?.total ?? 0));

  const { byCurrency, totalBase } = summarizeCashByCurrency(amounts, rates, baseCode);

  return {
    total_sales: r2(Number(sales[0]?.total ?? 0)),
    sales_count: Number(sales[0]?.count ?? 0),
    // Total esperado en moneda base + desglose por moneda
    total_cash: totalBase,
    expected_cash: totalBase,
    cash_by_currency: byCurrency,
    expected_cash_by_currency: byCurrency,
    base_currency: baseCode,
  };
}
