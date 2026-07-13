export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';
import { handle, ok } from '@/lib/api-helpers';

function fmtDateInTz(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export const GET = handle(async (req) => {
  await requireAuth();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const hasCustomRange = !!(from && to);

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

  // ── 9b. Purchase outflows (inventory reinvestment) ──
  const purchaseOutflows = await query<{ total: number }>(
    `SELECT COALESCE(SUM(cash_amount + transfer_amount), 0) AS total
     FROM cash_register
     WHERE type = 'purchase'`
  );

  // ── 9c. Capital injections (new capital from owner) ──
  const capitalInjections = await query<{ total_cash: number; total_transfer: number }>(
    `SELECT
       COALESCE(SUM(cash_amount), 0) AS total_cash,
       COALESCE(SUM(transfer_amount), 0) AS total_transfer
     FROM cash_register
     WHERE type = 'capital'`
  );

  // ── Period-filtered inflows (sales payments) ──
  const periodSalesInflows = await query<{ cash: number; transfer: number; period: string }>(`
    SELECT
      'week' AS period,
      COALESCE(SUM(p.amount_cash), 0) AS cash,
      COALESCE(SUM(p.amount_transfer), 0) AS transfer
    FROM payments p
    JOIN sales s ON s.id = p.sale_id
    WHERE s.status != 'cancelled' AND p.date >= DATE_SUB(NOW(), INTERVAL 7 DAY)

    UNION ALL

    SELECT
      'month' AS period,
      COALESCE(SUM(p.amount_cash), 0) AS cash,
      COALESCE(SUM(p.amount_transfer), 0) AS transfer
    FROM payments p
    JOIN sales s ON s.id = p.sale_id
    WHERE s.status != 'cancelled' AND p.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)

    UNION ALL

    SELECT
      '90days' AS period,
      COALESCE(SUM(p.amount_cash), 0) AS cash,
      COALESCE(SUM(p.amount_transfer), 0) AS transfer
    FROM payments p
    JOIN sales s ON s.id = p.sale_id
    WHERE s.status != 'cancelled' AND p.date >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  `);

  // ── Period-filtered inflows (customer payments) ──
  const periodCustomerInflows = await query<{ cash: number; transfer: number; mixed: number; period: string }>(`
    SELECT
      'week' AS period,
      COALESCE(SUM(CASE WHEN method='cash' THEN amount ELSE 0 END), 0) AS cash,
      COALESCE(SUM(CASE WHEN method='transfer' THEN amount ELSE 0 END), 0) AS transfer,
      COALESCE(SUM(CASE WHEN method='mixed' THEN amount ELSE 0 END), 0) AS mixed
    FROM customer_payments
    WHERE date >= DATE_SUB(NOW(), INTERVAL 7 DAY)

    UNION ALL

    SELECT
      'month' AS period,
      COALESCE(SUM(CASE WHEN method='cash' THEN amount ELSE 0 END), 0) AS cash,
      COALESCE(SUM(CASE WHEN method='transfer' THEN amount ELSE 0 END), 0) AS transfer,
      COALESCE(SUM(CASE WHEN method='mixed' THEN amount ELSE 0 END), 0) AS mixed
    FROM customer_payments
    WHERE date >= DATE_SUB(NOW(), INTERVAL 30 DAY)

    UNION ALL

    SELECT
      '90days' AS period,
      COALESCE(SUM(CASE WHEN method='cash' THEN amount ELSE 0 END), 0) AS cash,
      COALESCE(SUM(CASE WHEN method='transfer' THEN amount ELSE 0 END), 0) AS transfer,
      COALESCE(SUM(CASE WHEN method='mixed' THEN amount ELSE 0 END), 0) AS mixed
    FROM customer_payments
    WHERE date >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  `);

  // ── Period-filtered outflows (expenses) ──
  const periodExpenses = await query<{ cash: number; transfer: number; mixed: number; unclassified: number; period: string }>(`
    SELECT
      'week' AS period,
      COALESCE(SUM(CASE WHEN payment_method='cash' THEN amount ELSE 0 END), 0) AS cash,
      COALESCE(SUM(CASE WHEN payment_method='transfer' THEN amount ELSE 0 END), 0) AS transfer,
      COALESCE(SUM(CASE WHEN payment_method='mixed' THEN amount ELSE 0 END), 0) AS mixed,
      COALESCE(SUM(CASE WHEN payment_method IS NULL THEN amount ELSE 0 END), 0) AS unclassified
    FROM expenses
    WHERE date >= DATE_SUB(NOW(), INTERVAL 7 DAY)

    UNION ALL

    SELECT
      'month' AS period,
      COALESCE(SUM(CASE WHEN payment_method='cash' THEN amount ELSE 0 END), 0) AS cash,
      COALESCE(SUM(CASE WHEN payment_method='transfer' THEN amount ELSE 0 END), 0) AS transfer,
      COALESCE(SUM(CASE WHEN payment_method='mixed' THEN amount ELSE 0 END), 0) AS mixed,
      COALESCE(SUM(CASE WHEN payment_method IS NULL THEN amount ELSE 0 END), 0) AS unclassified
    FROM expenses
    WHERE date >= DATE_SUB(NOW(), INTERVAL 30 DAY)

    UNION ALL

    SELECT
      '90days' AS period,
      COALESCE(SUM(CASE WHEN payment_method='cash' THEN amount ELSE 0 END), 0) AS cash,
      COALESCE(SUM(CASE WHEN payment_method='transfer' THEN amount ELSE 0 END), 0) AS transfer,
      COALESCE(SUM(CASE WHEN payment_method='mixed' THEN amount ELSE 0 END), 0) AS mixed,
      COALESCE(SUM(CASE WHEN payment_method IS NULL THEN amount ELSE 0 END), 0) AS unclassified
    FROM expenses
    WHERE date >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  `);

  // ── 10. Cash register entries (initial + adjustments only, not purchases/capital) ──
  const registerEntries = await query<{ cash_total: number; transfer_total: number }>(
    `SELECT
       COALESCE(SUM(cash_amount), 0) AS cash_total,
       COALESCE(SUM(transfer_amount), 0) AS transfer_total
     FROM cash_register
     WHERE type IN ('initial', 'adjustment')`
  );

  // ── Calculate totals ──
  const totalCashIn = Number(cashFromSales[0]?.total ?? 0)
    + Number(cashFromCustomers[0]?.total ?? 0)
    + (Number(mixedFromCustomers[0]?.total ?? 0) / 2);

  const totalTransferIn = Number(transferFromSales[0]?.total ?? 0)
    + Number(transferFromCustomers[0]?.total ?? 0)
    + (Number(mixedFromCustomers[0]?.total ?? 0) / 2);

  const totalCashOut = Number(cashExpenses[0]?.total ?? 0)
    + (Number(mixedExpenses[0]?.total ?? 0) / 2)
    + Math.abs(Number(purchaseOutflows[0]?.total ?? 0));

  const totalTransferOut = Number(transferExpenses[0]?.total ?? 0)
    + (Number(mixedExpenses[0]?.total ?? 0) / 2);

  const registerCash = Number(registerEntries[0]?.cash_total ?? 0)
    + Number(capitalInjections[0]?.total_cash ?? 0);
  const registerTransfer = Number(registerEntries[0]?.transfer_total ?? 0)
    + Number(capitalInjections[0]?.total_transfer ?? 0);

  // Purchases stored as negative in cash_register; Math.abs converts to positive outflow below

  const cashBalance = registerCash + totalCashIn - totalCashOut;
  const transferBalance = registerTransfer + totalTransferIn - totalTransferOut;

  const timezone = process.env.TIMEZONE ?? 'America/Havana';

  // ── Today's movements ──
  const todayStr = fmtDateInTz(new Date(), timezone);

  // ── Today's inflows: sales payments ──
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

  // ── Today's inflows: customer payments ──
  const todayCashFromCust = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM customer_payments
     WHERE method = 'cash' AND DATE(date) = ?`,
    [todayStr]
  );
  const todayTransferFromCust = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM customer_payments
     WHERE method = 'transfer' AND DATE(date) = ?`,
    [todayStr]
  );
  const todayMixedFromCust = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM customer_payments
     WHERE method = 'mixed' AND DATE(date) = ?`,
    [todayStr]
  );

  // ── Today's outflows: expenses ──
  const todayCashExpenses = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE payment_method = 'cash' AND DATE(date) = ?`,
    [todayStr]
  );
  const todayTransferExpenses = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE payment_method = 'transfer' AND DATE(date) = ?`,
    [todayStr]
  );
  const todayMixedExpenses = await query<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM expenses
     WHERE payment_method = 'mixed' AND DATE(date) = ?`,
    [todayStr]
  );

  // ── Recent movements ──
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
      COALESCE(
        (SELECT GROUP_CONCAT(CONCAT(si.quantity, 'x ', pr.name) SEPARATOR ', ')
         FROM sale_items si
         JOIN products pr ON pr.id = si.product_id
         WHERE si.sale_id = s.id),
        CONCAT('Venta #', LEFT(s.id, 8))
      ) AS description,
      p.method, p.amount_cash AS cash_amount, p.amount_transfer AS transfer_amount,
      (p.amount_cash + p.amount_transfer) AS total_amount,
      s.id AS reference
    FROM payments p JOIN sales s ON s.id = p.sale_id
    WHERE s.status != 'cancelled' ${hasCustomRange ? 'AND p.date >= ? AND p.date <= ?' : ''})
    UNION ALL
    (SELECT
      cp.id, cp.date, 'Abono cliente' AS type,
      CONCAT('Abono de ', c.name) AS description,
      cp.method, cp.amount AS cash_amount, 0 AS transfer_amount,
      cp.amount AS total_amount,
      c.name AS reference
    FROM customer_payments cp JOIN customers c ON c.id = cp.customer_id
    ${hasCustomRange ? 'WHERE cp.date >= ? AND cp.date <= ?' : ''})
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
    LEFT JOIN expense_categories ec ON ec.id = e.category_id
    ${hasCustomRange ? 'WHERE e.date >= ? AND e.date <= ?' : ''})
    UNION ALL
    (SELECT
      cr.id, cr.date,
      CASE
        WHEN cr.type = 'initial' THEN 'Saldo inicial'
        WHEN cr.type = 'purchase' THEN 'Compra inventario'
        WHEN cr.type = 'capital' THEN 'Aporte de capital'
        ELSE 'Ajuste de caja'
      END AS type,
      cr.notes AS description,
      'register' AS method,
      cr.cash_amount, cr.transfer_amount,
      (cr.cash_amount + cr.transfer_amount) AS total_amount,
      cr.type AS reference
    FROM cash_register cr
    ${hasCustomRange ? 'WHERE cr.date >= ? AND cr.date <= ?' : ''})
    ORDER BY date DESC
    LIMIT 50
  `, hasCustomRange ? [from!, to! + ' 23:59:59', from!, to! + ' 23:59:59', from!, to! + ' 23:59:59', from!, to! + ' 23:59:59'] : []);

  // ── Daily evolution ──
  const evoDays = hasCustomRange
    ? Math.max(1, Math.min(90, Math.ceil((new Date(to!).getTime() - new Date(from!).getTime()) / (1000 * 60 * 60 * 24)) + 1))
    : 30;
  const evoStartDate = hasCustomRange ? from! : `DATE_SUB(NOW(), INTERVAL ${evoDays} DAY)`;

  // 1. Daily inflows: sales payments + customer payments
  const dailyInflows = await query<{ date: string; cash: number; transfer: number }>(`
    SELECT
      DATE(date) AS date,
      COALESCE(SUM(cash), 0) AS cash,
      COALESCE(SUM(transfer), 0) AS transfer
    FROM (
      SELECT
        p.date AS date,
        p.amount_cash AS cash,
        p.amount_transfer AS transfer
      FROM payments p
      JOIN sales s ON s.id = p.sale_id
      WHERE s.status != 'cancelled' ${hasCustomRange ? 'AND p.date >= ? AND p.date <= ?' : `AND p.date >= DATE_SUB(NOW(), INTERVAL ${evoDays} DAY)`}

      UNION ALL

      SELECT
        cp.date AS date,
        CASE WHEN cp.method = 'cash' THEN cp.amount
             WHEN cp.method = 'mixed' THEN cp.amount / 2
             ELSE 0 END AS cash,
        CASE WHEN cp.method = 'transfer' THEN cp.amount
             WHEN cp.method = 'mixed' THEN cp.amount / 2
             ELSE 0 END AS transfer
      FROM customer_payments cp
      ${hasCustomRange ? 'WHERE cp.date >= ? AND cp.date <= ?' : `WHERE cp.date >= DATE_SUB(NOW(), INTERVAL ${evoDays} DAY)`}
    ) AS combined
    GROUP BY DATE(date)
    ORDER BY DATE(date)
  `, hasCustomRange ? [from!, to! + ' 23:59:59', from!, to! + ' 23:59:59'] : []);

  // 2. Daily outflows: expenses
  const dailyOutflows = await query<{ date: string; cash: number; transfer: number }>(`
    SELECT
      DATE(e.date) AS date,
      COALESCE(SUM(CASE WHEN e.payment_method = 'cash' THEN e.amount WHEN e.payment_method = 'mixed' THEN e.amount / 2 ELSE 0 END), 0) AS cash,
      COALESCE(SUM(CASE WHEN e.payment_method = 'transfer' THEN e.amount WHEN e.payment_method = 'mixed' THEN e.amount / 2 ELSE 0 END), 0) AS transfer
    FROM expenses e
    ${hasCustomRange ? 'WHERE e.date >= ? AND e.date <= ?' : `WHERE e.date >= DATE_SUB(NOW(), INTERVAL ${evoDays} DAY)`}
    GROUP BY DATE(e.date)
    ORDER BY DATE(e.date)
  `, hasCustomRange ? [from!, to! + ' 23:59:59'] : []);

  // 3. Cash register entries within date range (distributed by date)
  const registerByDate = await query<{ date: string; cash: number; transfer: number }>(`
    SELECT
      DATE(date) AS date,
      COALESCE(SUM(cash_amount), 0) AS cash,
      COALESCE(SUM(transfer_amount), 0) AS transfer
    FROM cash_register
    ${hasCustomRange ? 'WHERE date >= ? AND date <= ?' : `WHERE date >= DATE_SUB(NOW(), INTERVAL ${evoDays} DAY)`}
    GROUP BY DATE(date)
    ORDER BY DATE(date)
  `, hasCustomRange ? [from!, to! + ' 23:59:59'] : []);

  // 4. Register balance BEFORE the date window (starting point)
  const registerBeforeWindow = await query<{ cash: number; transfer: number }>(`
    SELECT
      COALESCE(SUM(cash_amount), 0) AS cash,
      COALESCE(SUM(transfer_amount), 0) AS transfer
    FROM cash_register
    ${hasCustomRange ? 'WHERE date < ?' : 'WHERE date < DATE_SUB(NOW(), INTERVAL ' + evoDays + ' DAY)'}
  `, hasCustomRange ? [from!] : []);

  // ── Compute totals from daily data to align chart with balance cards ──
  const registerWithinDaysCash = registerByDate.reduce((s, r) => s + Number(r.cash), 0);
  const registerWithinDaysTransfer = registerByDate.reduce((s, r) => s + Number(r.transfer), 0);
  const cashInDaysTotal = dailyInflows.reduce((s, r) => s + Number(r.cash), 0);
  const transferInDaysTotal = dailyInflows.reduce((s, r) => s + Number(r.transfer), 0);
  const cashOutDaysTotal = dailyOutflows.reduce((s, r) => s + Number(r.cash), 0);
  const transferOutDaysTotal = dailyOutflows.reduce((s, r) => s + Number(r.transfer), 0);

  // Offset needed so the chart's last day equals the balance cards
  // This accounts for any operational flows (sales, expenses, customer payments)
  // that occurred before the date window and aren't in the register entries.
  const chartUnadjustedCash = Number(registerBeforeWindow[0]?.cash ?? 0)
    + registerWithinDaysCash + cashInDaysTotal - cashOutDaysTotal;
  const chartUnadjustedTransfer = Number(registerBeforeWindow[0]?.transfer ?? 0)
    + registerWithinDaysTransfer + transferInDaysTotal - transferOutDaysTotal;
  const preWindowOffsetCash = cashBalance - chartUnadjustedCash;
  const preWindowOffsetTransfer = transferBalance - chartUnadjustedTransfer;

  // Build daily evolution with running balances
  const dateMap = new Map<string, { date: string; cash_in: number; transfer_in: number; cash_out: number; transfer_out: number; register_cash: number; register_transfer: number; net_cash: number; net_transfer: number }>();

  // Generate date range
  if (hasCustomRange) {
    const start = new Date(from!);
    const end = new Date(to!);
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    for (let i = 0; i <= diffDays && i < 90; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const key = fmtDateInTz(d, timezone);
      dateMap.set(key, { date: key, cash_in: 0, transfer_in: 0, cash_out: 0, transfer_out: 0, register_cash: 0, register_transfer: 0, net_cash: 0, net_transfer: 0 });
    }
  } else {
    const today = new Date();
    for (let i = evoDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = fmtDateInTz(d, timezone);
      dateMap.set(key, { date: key, cash_in: 0, transfer_in: 0, cash_out: 0, transfer_out: 0, register_cash: 0, register_transfer: 0, net_cash: 0, net_transfer: 0 });
    }
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

  registerByDate.forEach(row => {
    const key = String(row.date).slice(0, 10);
    if (dateMap.has(key)) {
      const entry = dateMap.get(key)!;
      entry.register_cash = Math.round(Number(row.cash) * 100) / 100;
      entry.register_transfer = Math.round(Number(row.transfer) * 100) / 100;
    }
  });

  // Calculate running net balance for each day
  // Starting running balance = register entries before window + pre-window operational offset
  // so the chart's final point matches the balance cards exactly.
  let runningCash = Math.round((Number(registerBeforeWindow[0]?.cash ?? 0) + preWindowOffsetCash) * 100) / 100;
  let runningTransfer = Math.round((Number(registerBeforeWindow[0]?.transfer ?? 0) + preWindowOffsetTransfer) * 100) / 100;

  const dailyEvolution = Array.from(dateMap.values()).map(entry => {
    // Apply register entries on their specific date, then add inflows/outflows
    runningCash += entry.register_cash + entry.cash_in - entry.cash_out;
    runningTransfer += entry.register_transfer + entry.transfer_in - entry.transfer_out;

    return {
      date: entry.date,
      cash_in: entry.cash_in,
      transfer_in: entry.transfer_in,
      cash_out: entry.cash_out,
      transfer_out: entry.transfer_out,
      register_cash: entry.register_cash,
      register_transfer: entry.register_transfer,
      running_cash: Math.round(runningCash * 100) / 100,
      running_transfer: Math.round(runningTransfer * 100) / 100,
      net_cash: Math.round((entry.cash_in - entry.cash_out) * 100) / 100,
      net_transfer: Math.round((entry.transfer_in - entry.transfer_out) * 100) / 100,
    };
  });

  // ── Custom-range totals ──
  let customIncomeTotal = 0;
  let customIncomeCash = 0;
  let customIncomeTransfer = 0;
  let customExpensesTotal = 0;
  let customExpensesCash = 0;
  let customExpensesTransfer = 0;

  if (hasCustomRange) {
    const cSales = await query<{ total_cash: number; total_transfer: number }>(
      `SELECT
         COALESCE(SUM(p.amount_cash), 0) AS total_cash,
         COALESCE(SUM(p.amount_transfer), 0) AS total_transfer
       FROM payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE s.status != 'cancelled' AND p.date >= ? AND p.date <= ?`,
      [from!, to! + ' 23:59:59']
    );
    const cCust = await query<{ cash: number; transfer: number; mixed: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN method='cash' THEN amount ELSE 0 END), 0) AS cash,
         COALESCE(SUM(CASE WHEN method='transfer' THEN amount ELSE 0 END), 0) AS transfer,
         COALESCE(SUM(CASE WHEN method='mixed' THEN amount ELSE 0 END), 0) AS mixed
       FROM customer_payments
       WHERE date >= ? AND date <= ?`,
      [from!, to! + ' 23:59:59']
    );
    const cExp = await query<{ cash: number; transfer: number; mixed: number }>(
      `SELECT
         COALESCE(SUM(CASE WHEN payment_method='cash' THEN amount ELSE 0 END), 0) AS cash,
         COALESCE(SUM(CASE WHEN payment_method='transfer' THEN amount ELSE 0 END), 0) AS transfer,
         COALESCE(SUM(CASE WHEN payment_method='mixed' THEN amount ELSE 0 END), 0) AS mixed
       FROM expenses
       WHERE date >= ? AND date <= ?`,
      [from!, to! + ' 23:59:59']
    );
    const cPurch = await query<{ total: number }>(
      `SELECT COALESCE(SUM(cash_amount + transfer_amount), 0) AS total
       FROM cash_register
       WHERE type = 'purchase' AND date >= ? AND date <= ?`,
      [from!, to! + ' 23:59:59']
    );

    const salesCash = Number(cSales[0]?.total_cash ?? 0);
    const salesTransfer = Number(cSales[0]?.total_transfer ?? 0);
    const custCash = Number(cCust[0]?.cash ?? 0);
    const custTransfer = Number(cCust[0]?.transfer ?? 0);
    const custMixed = Number(cCust[0]?.mixed ?? 0);
    const expCash = Number(cExp[0]?.cash ?? 0);
    const expTransfer = Number(cExp[0]?.transfer ?? 0);
    const expMixed = Number(cExp[0]?.mixed ?? 0);
    const purchases = Math.abs(Number(cPurch[0]?.total ?? 0));

    customIncomeCash = salesCash + custCash + (custMixed / 2);
    customIncomeTransfer = salesTransfer + custTransfer + (custMixed / 2);
    customIncomeTotal = customIncomeCash + customIncomeTransfer;
    customExpensesCash = expCash + (expMixed / 2);
    customExpensesTransfer = expTransfer + (expMixed / 2);
    customExpensesTotal = customExpensesCash + customExpensesTransfer + purchases;
  }

  // ── Calculate period-filtered totals ──
  function extractPeriod(rows: { period: string; cash: number; transfer: number; mixed?: number; unclassified?: number }[], periodKey: string) {
    const row = rows.find(r => r.period === periodKey);
    if (!row) return { cash: 0, transfer: 0, mixed: 0, unclassified: 0 };
    return {
      cash: Number(row.cash ?? 0),
      transfer: Number(row.transfer ?? 0),
      mixed: Number(row.mixed ?? 0),
      unclassified: Number(row.unclassified ?? 0),
    };
  }

  function calcPeriodInflows(periodKey: string) {
    const sales = extractPeriod(periodSalesInflows, periodKey);
    const cust = extractPeriod(periodCustomerInflows, periodKey);
    const totalCash = sales.cash + cust.cash + (cust.mixed / 2);
    const totalTransfer = sales.transfer + cust.transfer + (cust.mixed / 2);
    return { cash: totalCash, transfer: totalTransfer, total: totalCash + totalTransfer };
  }

  function calcPeriodOutflows(periodKey: string) {
    const exp = extractPeriod(periodExpenses, periodKey);
    const totalCash = exp.cash + (exp.mixed / 2);
    const totalTransfer = exp.transfer + (exp.mixed / 2);
    return { cash: totalCash, transfer: totalTransfer, total: totalCash + totalTransfer };
  }

  const weekIn = calcPeriodInflows('week');
  const monthIn = calcPeriodInflows('month');
  const days90In = calcPeriodInflows('90days');
  const weekOut = calcPeriodOutflows('week');
  const monthOut = calcPeriodOutflows('month');
  const days90Out = calcPeriodOutflows('90days');

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

    // Periodos
    week_income: Math.round(weekIn.total * 100) / 100,
    week_income_cash: Math.round(weekIn.cash * 100) / 100,
    week_income_transfer: Math.round(weekIn.transfer * 100) / 100,
    week_expenses: Math.round(weekOut.total * 100) / 100,
    week_expenses_cash: Math.round(weekOut.cash * 100) / 100,
    week_expenses_transfer: Math.round(weekOut.transfer * 100) / 100,

    month_income: Math.round(monthIn.total * 100) / 100,
    month_income_cash: Math.round(monthIn.cash * 100) / 100,
    month_income_transfer: Math.round(monthIn.transfer * 100) / 100,
    month_expenses: Math.round(monthOut.total * 100) / 100,
    month_expenses_cash: Math.round(monthOut.cash * 100) / 100,
    month_expenses_transfer: Math.round(monthOut.transfer * 100) / 100,

    '90days_income': Math.round(days90In.total * 100) / 100,
    '90days_income_cash': Math.round(days90In.cash * 100) / 100,
    '90days_income_transfer': Math.round(days90In.transfer * 100) / 100,
    '90days_expenses': Math.round(days90Out.total * 100) / 100,
    '90days_expenses_cash': Math.round(days90Out.cash * 100) / 100,
    '90days_expenses_transfer': Math.round(days90Out.transfer * 100) / 100,

    // Registros de caja
    register_cash: Math.round(registerCash * 100) / 100,
    register_transfer: Math.round(registerTransfer * 100) / 100,

    // Inversiones en inventario
    total_purchases: Math.round(Math.abs(Number(purchaseOutflows[0]?.total ?? 0)) * 100) / 100,
    total_capital_injected: Math.round((Number(capitalInjections[0]?.total_cash ?? 0) + Number(capitalInjections[0]?.total_transfer ?? 0)) * 100) / 100,
    capital_injected_cash: Math.round(Number(capitalInjections[0]?.total_cash ?? 0) * 100) / 100,
    capital_injected_transfer: Math.round(Number(capitalInjections[0]?.total_transfer ?? 0) * 100) / 100,

    // No clasificados
    unclassified_expenses: Math.round(Number(unclassifiedExpenses[0]?.total ?? 0) * 100) / 100,

    // Flujo del día (incluye customer payments y mixed)
    today_cash_in: Math.round((Number(todayCashIn[0]?.total ?? 0) + Number(todayCashFromCust[0]?.total ?? 0) + (Number(todayMixedFromCust[0]?.total ?? 0) / 2)) * 100) / 100,
    today_transfer_in: Math.round((Number(todayTransferIn[0]?.total ?? 0) + Number(todayTransferFromCust[0]?.total ?? 0) + (Number(todayMixedFromCust[0]?.total ?? 0) / 2)) * 100) / 100,
    today_cash_out: Math.round((Number(todayCashExpenses[0]?.total ?? 0) + (Number(todayMixedExpenses[0]?.total ?? 0) / 2)) * 100) / 100,
    today_transfer_out: Math.round((Number(todayTransferExpenses[0]?.total ?? 0) + (Number(todayMixedExpenses[0]?.total ?? 0) / 2)) * 100) / 100,

    // Evolución diaria
    daily_evolution: dailyEvolution,

    // Movimientos recientes
    recent_movements: recentMovements,

    // Rango personalizado
    ...(hasCustomRange ? {
      custom_from: from!,
      custom_to: to!,
      custom_income: Math.round(customIncomeTotal * 100) / 100,
      custom_income_cash: Math.round(customIncomeCash * 100) / 100,
      custom_income_transfer: Math.round(customIncomeTransfer * 100) / 100,
      custom_expenses: Math.round(customExpensesTotal * 100) / 100,
      custom_expenses_cash: Math.round(customExpensesCash * 100) / 100,
      custom_expenses_transfer: Math.round(customExpensesTransfer * 100) / 100,
    } : {}),
  });
});
