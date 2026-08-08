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

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ShiftLiveSummary {
  total_sales: number;
  total_cash: number;
  expected_cash: number;
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

  const [sales, salesCash, custCash, expCash, registerCash] = await Promise.all([
    // Ventas completadas del turno (solo las que ya son ingreso)
    query<{ total: number }>(
      `SELECT COALESCE(SUM(s.total),0) AS total FROM sales s
       WHERE s.status='completed' AND s.date BETWEEN ? AND ? AND s.pos_id=?`,
      [fromLocal, localNow, posId]
    ),
    // Efectivo recibido en las ventas (pagos en efectivo / mixto)
    query<{ total: number }>(
      `SELECT COALESCE(SUM(p.amount_cash),0) AS total FROM payments p
       JOIN sales s ON s.id=p.sale_id
       WHERE s.status!='cancelled' AND p.date BETWEEN ? AND ? AND s.pos_id=?`,
      [fromLocal, localNow, posId]
    ),
    // Abonos de clientes en efectivo (mixtos 50/50)
    query<{ total: number }>(
      `SELECT COALESCE(SUM(CASE WHEN cp.method='cash' THEN cp.amount WHEN cp.method='mixed' THEN cp.amount/2 ELSE 0 END),0) AS total
       FROM customer_payments cp LEFT JOIN sales s ON s.id=cp.sale_id
       WHERE cp.date BETWEEN ? AND ? AND (cp.sale_id IS NULL OR s.pos_id=?)`,
      [fromUtc, utcNow, posId]
    ),
    // Egresos en efectivo (gastos, mixtos 50/50)
    query<{ total: number }>(
      `SELECT COALESCE(SUM(CASE WHEN payment_method='cash' THEN amount WHEN payment_method='mixed' THEN amount/2 ELSE 0 END),0) AS total
       FROM expenses WHERE date BETWEEN ? AND ? AND pos_id=?`,
      [fromUtc, utcNow, posId]
    ),
    // Movimientos de caja en efectivo (aportes/ajustes +)
    query<{ total: number }>(
      `SELECT COALESCE(SUM(cr.cash_amount),0) AS total FROM cash_register cr
       WHERE cr.date BETWEEN ? AND ? AND (cr.shift_id IS NULL OR cr.shift_id=?)`,
      [fromUtc, utcNow, shiftId]
    ),
  ]);

  const expectedCash = r2(
    openingCash +
    Number(salesCash[0]?.total ?? 0) +
    Number(custCash[0]?.total ?? 0) +
    Number(registerCash[0]?.total ?? 0) -
    Number(expCash[0]?.total ?? 0)
  );

  return {
    total_sales: r2(Number(sales[0]?.total ?? 0)),
    total_cash: r2(Number(salesCash[0]?.total ?? 0)),
    expected_cash: expectedCash,
  };
}
