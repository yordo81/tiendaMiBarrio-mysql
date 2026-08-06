export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute } from '@/lib/db/mysql';
import { handle, ok, err, forbidden, notFound } from '@/lib/api-helpers';

// ── Cierre de turno con arqueo ─────────────────────────────────────
// Calcula el efectivo esperado del turno (fondo inicial + ingresos en
// efectivo - egresos en efectivo durante la ventana del turno) y la
// diferencia contra el efectivo contado por el usuario.

const r2 = (n: number) => Math.round(n * 100) / 100;

export const POST = handle(async (req: Request, ctx) => {
  const user = await requireAuth();
  if (user.role !== 'owner' && user.role !== 'admin') return forbidden('Solo el dueño o administrador pueden cerrar turnos');

  const { id } = await ctx.params;
  const shift = await queryOne<{
    id: string;
    opened_at: string;
    opening_cash: number;
    status: string;
    notes: string | null;
  }>('SELECT * FROM shifts WHERE id = ?', [id]);

  if (!shift) return notFound('Turno no encontrado');
  if (shift.status !== 'open') return err('Este turno ya está cerrado');

  const body = await req.json();
  const closingCash = Number(body.closing_cash);
  if (isNaN(closingCash) || closingCash < 0) return err('El efectivo contado debe ser un monto válido');

  const from = shift.opened_at;

  // Las fechas se guardan en UTC (toISOString), por eso el límite superior
  // también debe ser UTC_TIMESTAMP() para que la ventana del turno sea correcta.

  // Ingresos en efectivo: pagos de ventas dentro del turno
  const salesCash = await query<{ total: number }>(
    `SELECT COALESCE(SUM(p.amount_cash), 0) AS total
     FROM payments p JOIN sales s ON s.id = p.sale_id
     WHERE s.status != 'cancelled' AND p.date BETWEEN ? AND UTC_TIMESTAMP()`,
    [from]
  );

  // Ingresos en efectivo: abonos de clientes (los mixtos se dividen 50/50)
  const custCash = await query<{ total: number }>(
    `SELECT COALESCE(SUM(CASE WHEN method='cash' THEN amount WHEN method='mixed' THEN amount / 2 ELSE 0 END), 0) AS total
     FROM customer_payments WHERE date BETWEEN ? AND UTC_TIMESTAMP()`,
    [from]
  );

  // Egresos en efectivo: gastos (los mixtos se dividen 50/50)
  const expCash = await query<{ total: number }>(
    `SELECT COALESCE(SUM(CASE WHEN payment_method='cash' THEN amount WHEN payment_method='mixed' THEN amount / 2 ELSE 0 END), 0) AS total
     FROM expenses WHERE date BETWEEN ? AND UTC_TIMESTAMP()`,
    [from]
  );

  // Movimientos de caja: aportes/ajustes/saldo inicial (+), compras (−)
  const registerCash = await query<{ total: number }>(
    `SELECT COALESCE(SUM(cash_amount), 0) AS total
     FROM cash_register WHERE date BETWEEN ? AND UTC_TIMESTAMP()`,
    [from]
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
