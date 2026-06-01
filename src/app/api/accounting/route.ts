export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';
import { handle, ok } from '@/lib/api-helpers';

export const GET = handle(async () => {
  await requireAuth();

  // ── 1. Cash inflows from sales payments ──
  const cashFromSales = await query<{ total: number }>(
    `SELECT COALESCE(SUM(p.amount_cash), 0) AS total
     FROM payments p
     JOIN sales s ON s.id = p.sale_id
     WHERE s.status != 'cancelled'`
  );

  // ── 2. Transfer inflows from sales payments ──
  const transferFromSales = await query<{ total: number }>(
    `SELECT COALESCE(SUM(p.amount_transfer), 0) AS total
     FROM payments p
     JOIN sales s ON s.id = p.sale_id
     WHERE s.status != 'cancelled'`
  );

  // ── 3. Cash from customer payments ──
  const cashFromCustomers = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM customer_payments
     WHERE method = 'cash'`
  );

  // ── 4. Transfer from customer payments ──
  const transferFromCustomers = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM customer_payments
     WHERE method = 'transfer'`
  );

  // ── 5. Mixed customer payments (split 50/50 as approximation) ──
  const mixedFromCustomers = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM customer_payments
     WHERE method = 'mixed'`
  );

  // ── 6. Cash outflows from expenses ──
  const cashExpenses = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE payment_method = 'cash'`
  );

  // ── 7. Transfer outflows from expenses ──
  const transferExpenses = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE payment_method = 'transfer'`
  );

  // ── 8. Mixed expenses ──
  const mixedExpenses = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE payment_method = 'mixed'`
  );

  // ── 9. Unclassified expenses (no payment_method set) ──
  const unclassifiedExpenses = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE payment_method IS NULL`
  );

  // ── 10. Cash register entries (initial + adjustments) ──
  const registerEntries = await query<{ cash_total: number; transfer_total: number }>(
    `SELECT
       COALESCE(SUM(cash_amount), 0) AS cash_total,
       COALESCE(SUM(transfer_amount), 0) AS transfer_total
     FROM cash_register`
  );

  // ── Calculate totals ──
  const totalCashIn = Number(cashFromSales[0]?.total ?? 0)
    + Number(cashFromCustomers[0]?.total ?? 0)
    + (Number(mixedFromCustomers[0]?.total ?? 0) / 2);

  const totalTransferIn = Number(transferFromSales[0]?.total ?? 0)
    + Number(transferFromCustomers[0]?.total ?? 0)
    + (Number(mixedFromCustomers[0]?.total ?? 0) / 2);

  const totalCashOut = Number(cashExpenses[0]?.total ?? 0)
    + (Number(mixedExpenses[0]?.total ?? 0) / 2);

  const totalTransferOut = Number(transferExpenses[0]?.total ?? 0)
    + (Number(mixedExpenses[0]?.total ?? 0) / 2);

  const registerCash = Number(registerEntries[0]?.cash_total ?? 0);
  const registerTransfer = Number(registerEntries[0]?.transfer_total ?? 0);

  const cashBalance = registerCash + totalCashIn - totalCashOut;
  const transferBalance = registerTransfer + totalTransferIn - totalTransferOut;

  // ── Today's movements ──
  const todayStr = new Date().toISOString().slice(0, 10);

  const todayCashIn = await query<{ total: number }>(
    `SELECT COALESCE(SUM(p.amount_cash), 0) AS total
     FROM payments p JOIN sales s ON s.id = p.sale_id
     WHERE s.status != 'cancelled' AND DATE(p.date) = ?`,
    [todayStr]
  );
  const todayTransferIn = await query<{ total: number }>(
    `SELECT COALESCE(SUM(p.amount_transfer), 0) AS total
     FROM payments p JOIN sales s ON s.id = p.sale_id
     WHERE s.status != 'cancelled' AND DATE(p.date) = ?`,
    [todayStr]
  );
  const todayCashOut = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE payment_method = 'cash' AND DATE(date) = ?`,
    [todayStr]
  );
  const todayTransferOut = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE payment_method = 'transfer' AND DATE(date) = ?`,
    [todayStr]
  );

  // ── Recent movements (last 50) ──
  const recentMovements = await query<{
    id: string;
    date: string;
    type: string;
    description: string;
    method: string | null;
    cash_amount: number;
    transfer_amount: number;
    total_amount: number;
    reference: string;
  }>(`
    (SELECT
      p.id, p.date, 'Venta' AS type,
      CONCAT('Venta #', LEFT(s.id, 8)) AS description,
      p.method, p.amount_cash AS cash_amount, p.amount_transfer AS transfer_amount,
      (p.amount_cash + p.amount_transfer) AS total_amount,
      s.id AS reference
    FROM payments p JOIN sales s ON s.id = p.sale_id
    WHERE s.status != 'cancelled')
    UNION ALL
    (SELECT
      cp.id, cp.date, 'Abono cliente' AS type,
      CONCAT('Abono de ', c.name) AS description,
      cp.method, cp.amount AS cash_amount, 0 AS transfer_amount,
      cp.amount AS total_amount,
      c.name AS reference
    FROM customer_payments cp JOIN customers c ON c.id = cp.customer_id)
    UNION ALL
    (SELECT
      e.id, e.date,
      IF(e.product_id IS NOT NULL, 'Gasto (con producto)', 'Gasto') AS type,
      e.description,
      e.payment_method AS method,
      CASE WHEN e.payment_method = 'cash' THEN e.amount WHEN e.payment_method = 'mixed' THEN e.amount / 2 ELSE 0 END AS cash_amount,
      CASE WHEN e.payment_method = 'transfer' THEN e.amount WHEN e.payment_method = 'mixed' THEN e.amount / 2 ELSE 0 END AS transfer_amount,
      e.amount AS total_amount,
      ec.name AS reference
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.category_id)
    UNION ALL
    (SELECT
      cr.id, cr.date,
      CASE WHEN cr.type = 'initial' THEN 'Saldo inicial' ELSE 'Ajuste de caja' END AS type,
      cr.notes AS description,
      'register' AS method,
      cr.cash_amount, cr.transfer_amount,
      (cr.cash_amount + cr.transfer_amount) AS total_amount,
      cr.type AS reference
    FROM cash_register cr)
    ORDER BY date DESC
    LIMIT 50
  `);

  // ── Daily evolution (last 30 days) ──
  const dailyInflows = await query<{ date: string; cash: number; transfer: number }>(`
    SELECT
      DATE(p.date) AS date,
      COALESCE(SUM(p.amount_cash), 0) AS cash,
      COALESCE(SUM(p.amount_transfer), 0) AS transfer
    FROM payments p
    JOIN sales s ON s.id = p.sale_id
    WHERE s.status != 'cancelled' AND p.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY DATE(p.date)
    ORDER BY DATE(p.date)
  `);

  const dailyOutflows = await query<{ date: string; cash: number; transfer: number }>(`
    SELECT
      DATE(e.date) AS date,
      COALESCE(SUM(CASE WHEN e.payment_method = 'cash' THEN e.amount WHEN e.payment_method = 'mixed' THEN e.amount / 2 ELSE 0 END), 0) AS cash,
      COALESCE(SUM(CASE WHEN e.payment_method = 'transfer' THEN e.amount WHEN e.payment_method = 'mixed' THEN e.amount / 2 ELSE 0 END), 0) AS transfer
    FROM expenses e
    WHERE e.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY DATE(e.date)
    ORDER BY DATE(e.date)
  `);

  // Build daily evolution with running balances
  const dateMap = new Map<string, { date: string; cash_in: number; transfer_in: number; cash_out: number; transfer_out: number; net_cash: number; net_transfer: number }>();

  // Generate last 30 days
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dateMap.set(key, { date: key, cash_in: 0, transfer_in: 0, cash_out: 0, transfer_out: 0, net_cash: 0, net_transfer: 0 });
  }

  dailyInflows.forEach(row => {
    const key = String(row.date).slice(0, 10);
    if (dateMap.has(key)) {
      const entry = dateMap.get(key)!;
      entry.cash_in = Math.round(Number(row.cash) * 100) / 100;
      entry.transfer_in = Math.round(Number(row.transfer) * 100) / 100;
    }
  });

  dailyOutflows.forEach(row => {
    const key = String(row.date).slice(0, 10);
    if (dateMap.has(key)) {
      const entry = dateMap.get(key)!;
      entry.cash_out = Math.round(Number(row.cash) * 100) / 100;
      entry.transfer_out = Math.round(Number(row.transfer) * 100) / 100;
    }
  });

  // Calculate running net balance for each day
  let runningCash = registerCash;
  let runningTransfer = registerTransfer;
  const dailyEvolution = Array.from(dateMap.values()).map(entry => {
    runningCash += entry.cash_in - entry.cash_out;
    runningTransfer += entry.transfer_in - entry.transfer_out;
    return {
      ...entry,
      running_cash: Math.round(runningCash * 100) / 100,
      running_transfer: Math.round(runningTransfer * 100) / 100,
      net_cash: Math.round((entry.cash_in - entry.cash_out) * 100) / 100,
      net_transfer: Math.round((entry.transfer_in - entry.transfer_out) * 100) / 100,
    };
  });

  return ok({
    // Balances actuales
    cash_balance: Math.round(cashBalance * 100) / 100,
    transfer_balance: Math.round(transferBalance * 100) / 100,
    total_balance: Math.round((cashBalance + transferBalance) * 100) / 100,

    // Ingresos históricos
    total_cash_in: Math.round(totalCashIn * 100) / 100,
    total_transfer_in: Math.round(totalTransferIn * 100) / 100,

    // Egresos históricos
    total_cash_out: Math.round(totalCashOut * 100) / 100,
    total_transfer_out: Math.round(totalTransferOut * 100) / 100,

    // Registros de caja
    register_cash: Math.round(registerCash * 100) / 100,
    register_transfer: Math.round(registerTransfer * 100) / 100,

    // No clasificados
    unclassified_expenses: Math.round(Number(unclassifiedExpenses[0]?.total ?? 0) * 100) / 100,

    // Flujo del día
    today_cash_in: Math.round(Number(todayCashIn[0]?.total ?? 0) * 100) / 100,
    today_transfer_in: Math.round(Number(todayTransferIn[0]?.total ?? 0) * 100) / 100,
    today_cash_out: Math.round(Number(todayCashOut[0]?.total ?? 0) * 100) / 100,
    today_transfer_out: Math.round(Number(todayTransferOut[0]?.total ?? 0) * 100) / 100,

    // Evolución diaria
    daily_evolution: dailyEvolution,

    // Movimientos recientes
    recent_movements: recentMovements,
  });
});
