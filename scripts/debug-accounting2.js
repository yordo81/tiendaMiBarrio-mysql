const mysql = require('mysql2/promise');

// Replicates the fmtDateInTz helper
function fmtDateInTz(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function main() {
  const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'tienda_mi_barrio',
    timezone: 'America/Havana',
    typeCast(field, next) {
      if (field.type === 'DATETIME' || field.type === 'TIMESTAMP') {
        const val = field.string();
        return val ? new Date(val).toISOString() : null;
      }
      if (field.type === 'DATE') {
        return field.string();
      }
      if (field.type === 'TINY' && field.length === 1) {
        return field.string() === '1';
      }
      return next();
    },
  });

  const timezone = 'America/Havana';

  // 1. Daily inflows (same query as API)
  const [dailyInflows] = await pool.execute(`
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
      WHERE s.status != 'cancelled' AND p.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      UNION ALL
      SELECT
        cp.date AS date,
        CASE WHEN cp.method = 'cash' THEN cp.amount WHEN cp.method = 'mixed' THEN cp.amount / 2 ELSE 0 END AS cash,
        CASE WHEN cp.method = 'transfer' THEN cp.amount WHEN cp.method = 'mixed' THEN cp.amount / 2 ELSE 0 END AS transfer
      FROM customer_payments cp
      WHERE cp.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    ) AS combined
    GROUP BY DATE(date)
    ORDER BY DATE(date)
  `);
  console.log('=== dailyInflows raw ===');
  console.log(JSON.stringify(dailyInflows));

  // 2. Daily outflows
  const [dailyOutflows] = await pool.execute(`
    SELECT
      DATE(e.date) AS date,
      COALESCE(SUM(CASE WHEN e.payment_method = 'cash' THEN e.amount WHEN e.payment_method = 'mixed' THEN e.amount / 2 ELSE 0 END), 0) AS cash,
      COALESCE(SUM(CASE WHEN e.payment_method = 'transfer' THEN e.amount WHEN e.payment_method = 'mixed' THEN e.amount / 2 ELSE 0 END), 0) AS transfer
    FROM expenses e
    WHERE e.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY DATE(e.date)
    ORDER BY DATE(e.date)
  `);
  console.log('=== dailyOutflows raw ===');
  console.log(JSON.stringify(dailyOutflows));

  // 3. Register by date
  const [registerByDate] = await pool.execute(`
    SELECT
      DATE(date) AS date,
      COALESCE(SUM(cash_amount), 0) AS cash,
      COALESCE(SUM(transfer_amount), 0) AS transfer
    FROM cash_register
    WHERE date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY DATE(date)
    ORDER BY DATE(date)
  `);
  console.log('=== registerByDate raw ===');
  console.log(JSON.stringify(registerByDate));

  // 4. Register before window
  const [registerBeforeWindow] = await pool.execute(`
    SELECT
      COALESCE(SUM(cash_amount), 0) AS cash,
      COALESCE(SUM(transfer_amount), 0) AS transfer
    FROM cash_register
    WHERE date < DATE_SUB(NOW(), INTERVAL 30 DAY)
  `);
  console.log('=== registerBeforeWindow raw ===');
  console.log(JSON.stringify(registerBeforeWindow));

  // NOW replicate the exact same processing as the API
  const dateMap = new Map();

  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = fmtDateInTz(d, timezone);
    dateMap.set(key, { date: key, cash_in: 0, transfer_in: 0, cash_out: 0, transfer_out: 0, register_cash: 0, register_transfer: 0, net_cash: 0, net_transfer: 0 });
  }

  console.log('\n=== dateMap keys (first 5, last 5) ===');
  const keys = Array.from(dateMap.keys());
  console.log('First 5:', JSON.stringify(keys.slice(0, 5)));
  console.log('Last 5:', JSON.stringify(keys.slice(-5)));

  // Check if DATE values from SQL match dateMap keys
  console.log('\n=== Checking DATE format from SQL ===');
  dailyInflows.forEach(row => {
    const key = String(row.date).slice(0, 10);
    const exists = dateMap.has(key);
    console.log(`SQL date raw: ${JSON.stringify(row.date)}, String: "${String(row.date)}", slice: "${key}", in map: ${exists}, cash: ${row.cash}`);
  });

  dailyOutflows.forEach(row => {
    const key = String(row.date).slice(0, 10);
    const exists = dateMap.has(key);
    console.log(`OUTFLOW SQL date raw: ${JSON.stringify(row.date)}, String: "${String(row.date)}", slice: "${key}", in map: ${exists}, cash: ${row.cash}`);
  });

  registerByDate.forEach(row => {
    const key = String(row.date).slice(0, 10);
    const exists = dateMap.has(key);
    console.log(`REGISTER SQL date raw: ${JSON.stringify(row.date)}, String: "${String(row.date)}", slice: "${key}", in map: ${exists}, cash: ${row.cash}`);
  });

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
