export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne } from '@/lib/db/mysql';
import { handle, ok, notFound, forbidden } from '@/lib/api-helpers';
import { utcToLocal, utcToDb, nowLocal, nowUtc } from '@/lib/shift-time';

// ── Reporte del turno de caja ───────────────────────────────────────
// Genera un reporte detallado de un turno (abierto o cerrado) con:
//   - Datos del turno y del vendedor que lo abrió/cerró
//   - Ingresos (ventas, abonos de clientes y movimientos de caja +)
//   - Egresos (gastos y compras de inventario)
//   - Ajustes de inventario (stock_movements tipo 'adjust')
//   - Productos vendidos agrupados durante el turno
//
// Zonas horarias: las ventas se guardan en HORA LOCAL (TIMEZONE) y el
// resto de tablas en UTC. Cada consulta usa la ventana correspondiente.

const r2 = (n: number) => Math.round(n * 100) / 100;

export const GET = handle(async (_req: Request, ctx) => {
  const user = await requireAuth();
  if (user.role !== 'owner' && user.role !== 'admin') {
    return forbidden('Solo el dueño o administrador pueden ver reportes de turnos');
  }

  const { id } = await ctx.params;
  const shift = await queryOne<{
    id: string;
    pos_id: string | null;
    opened_at: string;
    closed_at: string | null;
    opened_at_raw: string;
    closed_at_raw: string | null;
    opening_cash: number;
    closing_cash: number | null;
    expected_cash: number | null;
    difference: number | null;
    notes: string | null;
    status: string;
    user_name: string | null;
    closed_by_name: string | null;
    pos_name: string | null;
  }>(
    `SELECT s.*, u.name AS user_name, cu.name AS closed_by_name, p.name AS pos_name,
            DATE_FORMAT(s.opened_at, '%Y-%m-%d %H:%i:%s') AS opened_at_raw,
            DATE_FORMAT(s.closed_at, '%Y-%m-%d %H:%i:%s') AS closed_at_raw
     FROM shifts s
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN users cu ON cu.id = s.closed_by
     LEFT JOIN pos p ON p.id = s.pos_id
     WHERE s.id = ?`,
    [id]
  );

  if (!shift) return notFound('Turno no encontrado');

  const closed = shift.closed_at != null;
  // El typeCast del driver devuelve las fechas como ISO interpretadas en la
  // zona local del proceso, por lo que para calcular las ventanas correctas
  // y devolver fechas exactas usamos los valores CRUDOS de la BD
  // (opened_at_raw / closed_at_raw) que guardan UTC.
  // Ventana en hora LOCAL (ventas/abonos se guardan locales)
  const fromLocal = utcToLocal(shift.opened_at_raw);
  const toLocal = closed ? utcToLocal(shift.closed_at_raw) : nowLocal();
  // Ventana en UTC (shifts/expenses/cash_register se guardan UTC)
  const fromUtc = utcToDb(shift.opened_at_raw);
  const toUtc = closed ? utcToDb(shift.closed_at_raw) : nowUtc();
  // Instantes UTC corregidos para mostrar en el frontend (el typeCast del
  // driver los desplaza por la zona horaria local del proceso)
  const openedAtIso = new Date(shift.opened_at_raw.replace(' ', 'T') + 'Z').toISOString();
  const closedAtIso = closed ? new Date(shift.closed_at_raw!.replace(' ', 'T') + 'Z').toISOString() : null;

  // ── Ingresos: ventas con sus pagos (no canceladas), SOLO de la caja del turno ──
  const sales = await query<Record<string, unknown>>(
    `SELECT s.id, s.date, s.total, s.status, p.method, p.amount_cash, p.amount_transfer, c.name AS customer_name
     FROM sales s
     JOIN payments p ON p.sale_id = s.id
     LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.status != 'cancelled' AND s.date BETWEEN ? AND ? AND s.pos_id = ?`,
    [fromLocal, toLocal, shift.pos_id]
  );

  // ── Ingresos: abonos de clientes (guardados en UTC) ──
  // Vinculados a una venta → se atribuyen a la caja de esa venta;
  // abonos sueltos (sin venta) cuentan en todos los turnos.
  const customerPayments = await query<Record<string, unknown>>(
    `SELECT cp.id, cp.amount, cp.method, cp.date, cp.notes, c.name AS customer_name
     FROM customer_payments cp
     LEFT JOIN customers c ON c.id = cp.customer_id
     LEFT JOIN sales s ON s.id = cp.sale_id
     WHERE cp.date BETWEEN ? AND ? AND (cp.sale_id IS NULL OR s.pos_id = ?)`,
    [fromUtc, toUtc, shift.pos_id]
  );

  // ── Egresos: gastos (guardados en UTC), SOLO de la caja del turno ──
  const expenses = await query<Record<string, unknown>>(
    `SELECT e.id, e.description, e.amount, e.payment_method, e.date, ec.name AS category_name
     FROM expenses e
     LEFT JOIN expense_categories ec ON ec.id = e.category_id
     WHERE e.date BETWEEN ? AND ? AND e.pos_id = ?`,
    [fromUtc, toUtc, shift.pos_id]
  );

  // ── Egresos: compras de inventario (movimientos de caja tipo purchase) ──
  // Se atribuyen al turno cuando tienen shift_id (y a ninguno si son de otra caja).
  const purchases = await query<Record<string, unknown>>(
    `SELECT cr.id, cr.type, cr.cash_amount, cr.transfer_amount, cr.notes, cr.date
     FROM cash_register cr
     WHERE cr.type = 'purchase' AND cr.date BETWEEN ? AND ? AND (cr.shift_id IS NULL OR cr.shift_id = ?)`,
    [fromUtc, toUtc, shift.id]
  );

  // ── Movimientos de caja (saldo inicial, ajustes, aportes de capital) ──
  const registerMovements = await query<Record<string, unknown>>(
    `SELECT cr.id, cr.type, cr.cash_amount, cr.transfer_amount, cr.notes, cr.date
     FROM cash_register cr
     WHERE cr.type != 'purchase' AND cr.date BETWEEN ? AND ? AND (cr.shift_id IS NULL OR cr.shift_id = ?)`,
    [fromUtc, toUtc, shift.id]
  );

  // ── Ajustes de inventario ──
  const stockAdjustments = await query<Record<string, unknown>>(
    `SELECT sm.id, sm.quantity, sm.reason, sm.date, p.name AS product_name, u.name AS user_name
     FROM stock_movements sm
     LEFT JOIN products p ON p.id = sm.product_id
     LEFT JOIN users u ON u.id = sm.user_id
     WHERE sm.type = 'adjust' AND sm.date BETWEEN ? AND ?`,
    [fromUtc, toUtc]
  );

  // ── Productos vendidos durante el turno (agrupados) ──
  // Solo ventas completadas: las de crédito no aportaron dinero aún
  const soldProducts = await query<Record<string, unknown>>(
    `SELECT p.id, p.name AS product_name, p.unit,
            SUM(si.quantity) AS quantity,
            SUM(si.quantity * si.unit_price) AS total_sold,
            SUM(si.quantity * si.cost) AS total_cost
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN products p ON p.id = si.product_id
     WHERE s.status = 'completed' AND s.date BETWEEN ? AND ? AND s.pos_id = ?
     GROUP BY p.id, p.name, p.unit
     ORDER BY total_sold DESC`,
    [fromLocal, toLocal, shift.pos_id]
  );

  // ── Desglose de ventas por método de pago (misma definición que el
  // registro de auditoría del cierre: ventas no canceladas de la caja) ──
  const paymentBreakdown: Record<string, { count: number; total: number; cash: number; transfer: number }> = {};
  for (const s of sales) {
    const method = String(s.method ?? 'unknown');
    const b = paymentBreakdown[method] ?? { count: 0, total: 0, cash: 0, transfer: 0 };
    b.count += 1;
    b.total = r2(b.total + Number(s.total ?? 0));
    b.cash = r2(b.cash + Number(s.amount_cash ?? 0));
    b.transfer = r2(b.transfer + Number(s.amount_transfer ?? 0));
    paymentBreakdown[method] = b;
  }

  // ── Totales ──
  // Solo ventas completadas (las de crédito pendiente no son ingreso aún)
  const completedSales = sales.filter(s => String(s.status) === 'completed');
  const totalSalesCash = completedSales.reduce((acc, s) => acc + Number(s.amount_cash ?? 0), 0);
  const totalSalesTransfer = completedSales.reduce((acc, s) => acc + Number(s.amount_transfer ?? 0), 0);
  const totalSales = completedSales.reduce((acc, s) => acc + Number(s.total ?? 0), 0);
  const totalCustomerPayments = customerPayments.reduce((acc, cp) => acc + Number(cp.amount ?? 0), 0);
  const totalExpenses = expenses.reduce((acc, e) => acc + Number(e.amount ?? 0), 0);
  // Las compras se almacenan como negativas en cash_register; Math.abs las
  // convierte en egresos positivos (misma convención que la API de contabilidad).
  const totalPurchases = Math.abs(purchases.reduce((acc, p) => acc + Number(p.cash_amount ?? 0) + Number(p.transfer_amount ?? 0), 0));
  const registerNet = registerMovements.reduce((acc, m) => acc + Number(m.cash_amount ?? 0) + Number(m.transfer_amount ?? 0), 0);

  // Costo de lo vendido (COGS) y ganancia del turno
  const totalCogs = r2(soldProducts.reduce((acc, p) => acc + Number(p.total_cost ?? 0), 0));
  const totalProfit = r2(totalSales - totalCogs);

  const totalIncome = r2(totalSales + totalCustomerPayments + (registerNet > 0 ? registerNet : 0));
  const totalOutcome = r2(totalExpenses + totalPurchases);

  return ok({
    shift: {
      id: shift.id,
      pos_id: shift.pos_id,
      pos_name: shift.pos_name,
      opened_at: openedAtIso,
      closed_at: closedAtIso,
      opening_cash: Number(shift.opening_cash),
      closing_cash: shift.closing_cash != null ? Number(shift.closing_cash) : null,
      expected_cash: shift.expected_cash != null ? Number(shift.expected_cash) : null,
      difference: shift.difference != null ? Number(shift.difference) : null,
      notes: shift.notes,
      status: shift.status,
      user_name: shift.user_name,
      closed_by_name: shift.closed_by_name,
    },
    totals: {
      total_sales: r2(totalSales),
      total_sales_cash: r2(totalSalesCash),
      total_sales_transfer: r2(totalSalesTransfer),
      total_cogs: r2(totalCogs),
      total_profit: totalProfit,
      total_customer_payments: r2(totalCustomerPayments),
      total_expenses: r2(totalExpenses),
      total_purchases: r2(totalPurchases),
      register_net: r2(registerNet),
      total_income: totalIncome,
      total_outcome: totalOutcome,
      net: r2(totalIncome - totalOutcome),
    },
    sales,
    customer_payments: customerPayments,
    expenses,
    purchases,
    register_movements: registerMovements,
    stock_adjustments: stockAdjustments,
    sold_products: soldProducts,
    payment_breakdown: paymentBreakdown,
  });
});
