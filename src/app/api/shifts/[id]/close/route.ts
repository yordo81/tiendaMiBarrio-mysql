export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute } from '@/lib/db/mysql';
import { handle, ok, err, forbidden, notFound } from '@/lib/api-helpers';
import { utcToLocal, utcToDb, nowLocal, nowUtc } from '@/lib/shift-time';
import { logAudit } from '@/lib/db/audit';

// ── Cierre de turno con arqueo ─────────────────────────────────────
// Calcula el efectivo esperado del turno (fondo inicial + ingresos en
// efectivo - egresos en efectivo durante la ventana del turno) y la
// diferencia contra el efectivo contado por el usuario.
//
// Arqueo por moneda: cada pago/abono guarda la moneda en que se cobró
// (currency_code) con su tasa congelada (exchange_rate). El efectivo
// esperado se desglosa por moneda (`expected_cash_by_currency`) y el
// total (`expected_cash`, que se guarda en shifts) se expresa en la
// MONEDA BASE convirtiendo el efectivo de otras monedas con su tasa
// congelada. Así el vendedor sabe cuánto hay de cada moneda en caja.

const r2 = (n: number) => Math.round(n * 100) / 100;

export const POST = handle(async (req: Request, ctx) => {
  const user = await requireAuth();

  const { id } = await ctx.params;
  const shift = await queryOne<{
    id: string;
    user_id: string;
    pos_id: string | null;
    opened_at: string;
    opened_at_raw: string;
    opening_cash: number;
    status: string;
    notes: string | null;
    pos_name: string | null;
  }>(
    `SELECT s.*, p.name AS pos_name, DATE_FORMAT(s.opened_at, '%Y-%m-%d %H:%i:%s') AS opened_at_raw
     FROM shifts s
     LEFT JOIN pos p ON p.id = s.pos_id
     WHERE s.id = ?`,
    [id]
  );

  if (!shift) return notFound('Turno no encontrado');
  if (shift.status !== 'open') return err('Este turno ya está cerrado');

  // El dueño/administrador puede cerrar cualquier turno; un vendedor
  // solo puede cerrar el turno que él mismo abrió (arqueo de su jornada).
  if (user.role !== 'owner' && user.role !== 'admin' && shift.user_id !== user.id) {
    return forbidden('Solo puedes cerrar el turno que tú mismo abriste');
  }

  const body = await req.json();
  const closingCash = Number(body.closing_cash);
  if (isNaN(closingCash) || closingCash < 0) return err('El efectivo contado debe ser un monto válido');

  // Convención de fechas por tabla:
  //   - sales/payments se guardan en HORA LOCAL (TIMEZONE)
  //   - shifts/expenses/customer_payments/cash_register se guardan en UTC
  // Por eso cada consulta usa la ventana en la convención correspondiente.
  // El typeCast del driver devuelve fechas ISO interpretadas en la zona local
  // del proceso, así que usamos el valor CRUDO de la BD (opened_at_raw).
  const fromLocal = utcToLocal(shift.opened_at_raw);
  const from = utcToDb(shift.opened_at_raw);
  const localNow = nowLocal();
  const utcNow = nowUtc();

  // Moneda base del negocio (para el total esperado y el desglose)
  const baseRows = await query<{ code: string }>("SELECT code FROM currencies WHERE is_base = 1 AND active = 1 LIMIT 1");
  const baseCurrency = baseRows[0]?.code ?? '';

  // Ingresos en efectivo: pagos de ventas del turno (fechas locales), SOLO de la
  // caja del turno, agrupados por moneda (con su tasa congelada promedio)
  const salesCash = await query<{ currency_code: string | null; total: number; avg_rate: number | null }>(
    `SELECT p.currency_code,
            COALESCE(SUM(p.amount_cash), 0) AS total,
            AVG(p.exchange_rate) AS avg_rate
     FROM payments p JOIN sales s ON s.id = p.sale_id
     WHERE s.status != 'cancelled' AND p.date BETWEEN ? AND ? AND s.pos_id = ?
     GROUP BY p.currency_code`,
    [fromLocal, localNow, shift.pos_id]
  );

  // Ingresos en efectivo: abonos de clientes (fechas UTC, mixtos 50/50), por moneda.
  // Los abonos vinculados a una venta se atribuyen a la caja de esa venta;
  // los abonos sueltos (sin venta) no se pueden atribuir y cuentan en todos.
  const custCash = await query<{ currency_code: string | null; total: number; avg_rate: number | null }>(
    `SELECT cp.currency_code,
            COALESCE(SUM(CASE WHEN cp.method='cash' THEN cp.amount WHEN cp.method='mixed' THEN cp.amount / 2 ELSE 0 END), 0) AS total,
            AVG(cp.exchange_rate) AS avg_rate
     FROM customer_payments cp
     LEFT JOIN sales s ON s.id = cp.sale_id
     WHERE cp.date BETWEEN ? AND ? AND (cp.sale_id IS NULL OR s.pos_id = ?)
     GROUP BY cp.currency_code`,
    [from, utcNow, shift.pos_id]
  );

  // Egresos en efectivo: gastos del turno (fechas UTC, mixtos 50/50), SOLO de la caja del turno.
  // Los gastos no registran moneda: se asumen en la moneda base.
  const expCash = await query<{ total: number }>(
    `SELECT COALESCE(SUM(CASE WHEN payment_method='cash' THEN amount WHEN payment_method='mixed' THEN amount / 2 ELSE 0 END), 0) AS total
     FROM expenses WHERE date BETWEEN ? AND ? AND pos_id = ?`,
    [from, utcNow, shift.pos_id]
  );

  // Movimientos de caja: aportes/ajustes/saldo inicial (+), compras (−).
  // Se atribuyen al turno cuando tienen shift_id (y a ninguno si son de otra caja).
  const registerCash = await query<{ total: number }>(
    `SELECT COALESCE(SUM(cr.cash_amount), 0) AS total
     FROM cash_register cr
     WHERE cr.date BETWEEN ? AND ? AND (cr.shift_id IS NULL OR cr.shift_id = ?)`,
    [from, utcNow, shift.id]
  );

  // Desglose de ventas del turno por método de pago (para el registro de
  // auditoría): tickets, total vendido y partes en efectivo/transferencia.
  const payBreakdown = await query<{
    method: string;
    count: number;
    total: number;
    amount_cash: number;
    amount_transfer: number;
  }>(
    `SELECT p.method,
       COUNT(DISTINCT s.id) AS count,
       COALESCE(SUM(s.total), 0) AS total,
       COALESCE(SUM(p.amount_cash), 0) AS amount_cash,
       COALESCE(SUM(p.amount_transfer), 0) AS amount_transfer
     FROM payments p
     JOIN sales s ON s.id = p.sale_id
     WHERE s.status != 'cancelled' AND p.date BETWEEN ? AND ? AND s.pos_id = ?
     GROUP BY p.method`,
    [fromLocal, localNow, shift.pos_id]
  );
  const paymentBreakdown = Object.fromEntries(
    payBreakdown.map(r => [r.method, {
      count: Number(r.count),
      total: r2(Number(r.total)),
      cash: r2(Number(r.amount_cash)),
      transfer: r2(Number(r.amount_transfer)),
    }])
  );

  // ── Arqueo por moneda ────────────────────────────────────────
  // Acumular el efectivo esperado por moneda y su tasa de conversión.
  const cashAmounts: Record<string, number> = {};
  const cashRates: Record<string, number> = {};
  const addCash = (code: string | null, amount: number) => {
    const key = code ?? '';
    cashAmounts[key] = r2((cashAmounts[key] ?? 0) + amount);
  };
  // Fondo inicial y movimientos de caja: en la moneda base
  addCash(null, Number(shift.opening_cash) + Number(registerCash[0]?.total ?? 0));
  // Efectivo de las ventas, agrupado por su moneda
  for (const row of salesCash) {
    addCash(row.currency_code, Number(row.total ?? 0));
    if (row.currency_code) {
      cashRates[row.currency_code] = row.avg_rate != null && Number(row.avg_rate) > 0 ? Number(row.avg_rate) : 1;
    }
  }
  // Abonos en efectivo, por su moneda
  for (const row of custCash) {
    addCash(row.currency_code, Number(row.total ?? 0));
    if (row.currency_code && cashRates[row.currency_code] === undefined) {
      cashRates[row.currency_code] = row.avg_rate != null && Number(row.avg_rate) > 0 ? Number(row.avg_rate) : 1;
    }
  }
  // Egresos en efectivo (gastos): restan de la moneda base
  addCash(null, -Number(expCash[0]?.total ?? 0));

  // Desglose (base primero) y total esperado en moneda base
  const expectedByCurrency = Object.entries(cashAmounts)
    .filter(([, amount]) => amount !== 0)
    .map(([code, amount]) => ({
      code: code || baseCurrency || 'BASE',
      amount,
      rate: code ? (cashRates[code] ?? 1) : 1,
    }))
    .sort((a, b) => {
      const aIsBase = a.code === baseCurrency;
      const bIsBase = b.code === baseCurrency;
      if (aIsBase !== bIsBase) return aIsBase ? -1 : 1;
      return Math.abs(b.amount) - Math.abs(a.amount);
    })
    .map(({ code, amount }) => ({ code, amount: r2(amount) }));
  const expected = r2(
    expectedByCurrency.reduce((acc, c) => {
      const rate = cashRates[c.code === baseCurrency || c.code === 'BASE' ? '' : c.code] ?? 1;
      return acc + c.amount * (rate || 1);
    }, 0)
  );
  const difference = r2(closingCash - expected);

  const notes = body.notes ? String(body.notes).trim().slice(0, 500) : shift.notes ?? null;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  await execute(
    `UPDATE shifts SET status='closed', closed_at=?, closing_cash=?, expected_cash=?, difference=?, notes=?, closed_by=? WHERE id=?`,
    [ts, closingCash, expected, difference, notes, user.id, id]
  );

  // ── Auditoría: cierre de turno con arqueo (best-effort: el turno ya
  // ── quedó cerrado y no se puede reintentar; un fallo aquí no debe
  // ── ocultar el éxito del cierre) ──
  try {
    await logAudit({
      user_id: user.id,
      user_name: user.name,
      action: 'close',
      entity_type: 'shift',
      entity_id: id,
      entity_name: shift.pos_name ?? 'Turno',
      details: {
        pos_id: shift.pos_id ?? null,
        pos_name: shift.pos_name ?? null,
        base_currency: baseCurrency || null,
        expected_cash: expected,
        closing_cash: closingCash,
        difference,
        expected_cash_by_currency: expectedByCurrency,
        payment_breakdown: paymentBreakdown,
      },
    });
  } catch (e) {
    console.error('[audit] cierre de turno', e);
  }

  return ok({
    id,
    expected_cash: expected,
    closing_cash: closingCash,
    difference,
    base_currency: baseCurrency || null,
    // Desglose del efectivo esperado por moneda (cuánto hay de cada una en caja)
    expected_cash_by_currency: expectedByCurrency,
  });
});
