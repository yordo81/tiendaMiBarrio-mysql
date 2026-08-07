export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute } from '@/lib/db/mysql';
import { handle, ok, err, forbidden, notFound } from '@/lib/api-helpers';
import { utcToLocal, utcToDb, nowLocal, nowUtc } from '@/lib/shift-time';

// ── Cierre de turno con arqueo ─────────────────────────────────────
// Calcula el efectivo esperado del turno (fondo inicial + ingresos en
// efectivo - egresos en efectivo durante la ventana del turno) y la
// diferencia contra el efectivo contado por el usuario.

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
  }>(
    `SELECT s.*, DATE_FORMAT(s.opened_at, '%Y-%m-%d %H:%i:%s') AS opened_at_raw
     FROM shifts s WHERE s.id = ?`,
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

  // Ingresos en efectivo: pagos de ventas del turno (fechas locales), SOLO de la caja del turno
  const salesCash = await query<{ total: number }>(
    `SELECT COALESCE(SUM(p.amount_cash), 0) AS total
     FROM payments p JOIN sales s ON s.id = p.sale_id
     WHERE s.status != 'cancelled' AND p.date BETWEEN ? AND ? AND s.pos_id = ?`,
    [fromLocal, localNow, shift.pos_id]
  );

  // Ingresos en efectivo: abonos de clientes (fechas UTC, mixtos 50/50).
  // Los abonos vinculados a una venta se atribuyen a la caja de esa venta;
  // los abonos sueltos (sin venta) no se pueden atribuir y cuentan en todos.
  const custCash = await query<{ total: number }>(
    `SELECT COALESCE(SUM(CASE WHEN cp.method='cash' THEN cp.amount WHEN cp.method='mixed' THEN cp.amount / 2 ELSE 0 END), 0) AS total
     FROM customer_payments cp
     LEFT JOIN sales s ON s.id = cp.sale_id
     WHERE cp.date BETWEEN ? AND ? AND (cp.sale_id IS NULL OR s.pos_id = ?)`,
    [from, utcNow, shift.pos_id]
  );

  // Egresos en efectivo: gastos del turno (fechas UTC, mixtos 50/50), SOLO de la caja del turno
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

  const expected = r2(
    Number(shift.opening_cash) +
    Number(salesCash[0]?.total ?? 0) +
    Number(custCash[0]?.total ?? 0) +
    Number(registerCash[0]?.total ?? 0) -
    Number(expCash[0]?.total ?? 0)
  );
  const difference = r2(closingCash - expected);

  const notes = body.notes ? String(body.notes).trim().slice(0, 500) : shift.notes ?? null;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  await execute(
    `UPDATE shifts SET status='closed', closed_at=?, closing_cash=?, expected_cash=?, difference=?, notes=?, closed_by=? WHERE id=?`,
    [ts, closingCash, expected, difference, notes, user.id, id]
  );

  return ok({
    id,
    expected_cash: expected,
    closing_cash: closingCash,
    difference,
  });
});
