export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute } from '@/lib/db/mysql';
import { handle, ok, err, forbidden, notFound } from '@/lib/api-helpers';
import { utcToLocal, utcToDb, nowLocal, nowUtc } from '@/lib/shift-time';
import { logAudit } from '@/lib/db/audit';
import { computeExpectedCash } from '@/lib/shift-summary';

// ── Cierre de turno con arqueo ─────────────────────────────────────
// Calcula el efectivo esperado del turno (fondo inicial + ingresos en
// efectivo - egresos en efectivo durante la ventana del turno) y la
// diferencia contra el efectivo contado por el usuario.
//
// Arqueo por moneda: cada pago/abono guarda la moneda en que se cobró
// (currency_code) con su tasa congelada (exchange_rate). El efectivo
// esperado se desglose por moneda (`expected_cash_by_currency`) y el
// total (`expected_cash`, que se guarda en shifts) se expresa en la
// MONEDA BASE convirtiendo el efectivo de otras monedas con su tasa
// congelada. Así el vendedor sabe cuánto hay de cada moneda en caja.
//
// Al cerrar, el usuario debe DECLARAR el efectivo contado de CADA una
// de esas monedas (`closing_cash_by_currency`): el servidor valida que
// estén todas las monedas con efectivo esperado, completa la tasa
// congelada de cada una y recalcula el total del contado en base con
// la misma referencia del arqueo esperado. `closing_cash` sigue siendo
// el total en moneda base (compatible con clientes anteriores: si el
// desglose no viene, se guarda NULL y se usa solo el total).

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

  // ── Contado declarado por moneda (entrada cruda del cliente) ──
  // Formato: [{ code: 'CUP', amount: 9000 }, { code: 'USD', amount: 20 }]
  // Solo se valida la forma; la normalización y la validación contra lo
  // esperado se hace después de calcular el arqueo (necesita la base y
  // las tasas congeladas del turno).
  const rawDeclared = Array.isArray(body.closing_cash_by_currency)
    ? (body.closing_cash_by_currency as { code?: unknown; amount?: unknown }[])
    : null;
  if (rawDeclared && rawDeclared.length === 0) {
    return err('Declara el efectivo contado por moneda');
  }

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

  // El efectivo esperado (por moneda y total en base) se calcula con la
  // implementación compartida de `@/lib/shift-summary` más abajo.

  // Desglose de ventas del turno por método de pago (para el registro de
  // auditoría): tickets, total vendido y partes en efectivo/transferencia.
  // Una venta puede tener VARIAS filas de pago (cobro parcial en varias
  // monedas), por eso primero se agrupa por venta: así el total de cada
  // venta se cuenta UNA sola vez y no se duplica por cada pago. El método de
  // la venta es el único cuando hay uno, o 'mixed' si combina métodos.
  const payBreakdown = await query<{
    method: string;
    count: number;
    total: number;
    amount_cash: number;
    amount_transfer: number;
  }>(
    `SELECT method,
       COUNT(*) AS count,
       COALESCE(SUM(total), 0) AS total,
       COALESCE(SUM(amount_cash), 0) AS amount_cash,
       COALESCE(SUM(amount_transfer), 0) AS amount_transfer
     FROM (
       SELECT s.total AS total,
              CASE WHEN COUNT(DISTINCT p.method) = 1 THEN MAX(p.method) ELSE 'mixed' END AS method,
              SUM(p.amount_cash) AS amount_cash,
              SUM(p.amount_transfer) AS amount_transfer
       FROM payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE s.status != 'cancelled' AND p.date BETWEEN ? AND ? AND s.pos_id = ?
       GROUP BY s.id, s.total
     ) t
     GROUP BY method`,
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
  // Efectivo esperado por moneda + total en base. Es el MISMO cálculo que
  // usa el resumen en vivo y el reporte del turno (una sola implementación).
  const {
    base_currency: baseCurrency,
    total_base: expected,
    by_currency: expectedByCurrency,
  } = await computeExpectedCash({
    posId: shift.pos_id,
    shiftId: shift.id,
    openingCash: Number(shift.opening_cash),
    fromLocal,
    toLocal: localNow,
    fromUtc: from,
    toUtc: utcNow,
  });

  // ── Contado declarado por moneda: normalizar y validar ───────
  /** Desglose final del contado con la tasa congelada de cada moneda. */
  let closingByCurrency: { code: string; amount: number; rate: number }[] | null = null;
  /** Total del contado en moneda base (recalculado o el que envió el cliente). */
  let closingTotal = closingCash;

  if (rawDeclared) {
    /** 'BASE' o vacío = moneda base; se normaliza al código real del negocio. */
    const normCode = (c: string) => {
      const up = String(c ?? '').trim().toUpperCase();
      return !up || up === 'BASE' ? (baseCurrency || 'BASE') : up;
    };
    const declared = rawDeclared.map(e => ({
      code: normCode(String(e?.code ?? '')),
      amount: Number(e?.amount),
    }));

    if (declared.some(d => isNaN(d.amount) || d.amount < 0)) {
      return err('Cada monto contado debe ser un número mayor o igual a 0');
    }
    const seen = new Set<string>();
    for (const d of declared) {
      if (seen.has(d.code)) return err(`Moneda duplicada en el arqueo: ${d.code}`);
      seen.add(d.code);
    }

    // Deben declararse TODAS las monedas con efectivo esperado: si el
    // turno cobró en varias monedas físicas, se cuenta cada una. Las
    // deudas (CREDITO_*) no son efectivo en caja y no se declaran.
    const missing = expectedByCurrency
      .filter(c => !c.code.startsWith('CREDITO_') && c.amount > 0)
      .filter(c => !declared.some(d => d.code === c.code))
      .map(c => c.code);
    if (missing.length > 0) {
      return err(`Falta declarar el efectivo contado de: ${missing.join(', ')}`);
    }

    // Se conservan SOLO las monedas con efectivo esperado (evita filas
    // espurias) y se convierte cada monto a base con la tasa congelada
    // del turno: el mismo factor con el que se calculó lo esperado.
    closingByCurrency = expectedByCurrency
      .filter(c => declared.some(d => d.code === c.code))
      .map(c => ({
        code: c.code,
        amount: r2(declared.find(d => d.code === c.code)!.amount),
        rate: c.rate,
      }));
    closingTotal = r2(closingByCurrency.reduce((a, c) => a + c.amount * (c.rate || 1), 0));
  }

  const difference = r2(closingTotal - expected);

  const notes = body.notes ? String(body.notes).trim().slice(0, 500) : shift.notes ?? null;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  await execute(
    `UPDATE shifts SET status='closed', closed_at=?, closing_cash=?, closing_cash_by_currency=?, expected_cash=?, difference=?, notes=?, closed_by=? WHERE id=?`,
    [ts, closingTotal,
      closingByCurrency ? JSON.stringify(closingByCurrency) : null,
      expected, difference, notes, user.id, id]
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
        closing_cash: closingTotal,
        closing_cash_by_currency: closingByCurrency,
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
    closing_cash: closingTotal,
    // Desglose del contado por moneda (null si el cliente no lo declaró)
    closing_cash_by_currency: closingByCurrency,
    difference,
    base_currency: baseCurrency || null,
    // Desglose del efectivo esperado por moneda (cuánto hay de cada una en caja)
    expected_cash_by_currency: expectedByCurrency,
  });
});
