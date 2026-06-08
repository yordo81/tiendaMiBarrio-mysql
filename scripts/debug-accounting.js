const mysql = require('mysql2/promise');

async function main() {
  const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'tienda_mi_barrio',
    timezone: 'America/Havana'
  });

  const queries = [
    { name: 'payments (non-cancelled sales)', q: "SELECT COUNT(*) as cnt, MIN(p.date) as min_d, MAX(p.date) as max_d FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.status!='cancelled'" },
    { name: 'customer_payments', q: "SELECT COUNT(*) as cnt, MIN(date) as min_d, MAX(date) as max_d FROM customer_payments" },
    { name: 'expenses', q: "SELECT COUNT(*) as cnt, MIN(date) as min_d, MAX(date) as max_d FROM expenses" },
    { name: 'cash_register', q: "SELECT COUNT(*) as cnt, MIN(date) as min_d, MAX(date) as max_d FROM cash_register" },
  ];

  for (const t of queries) {
    const [rows] = await pool.execute(t.q);
    console.log('=== ' + t.name + ' ===');
    console.log(JSON.stringify(rows));
  }

  const [tz] = await pool.execute("SELECT @@session.time_zone as tz, NOW() as now");
  console.log('=== timezone ===');
  console.log(JSON.stringify(tz));

  const [now] = await pool.execute("SELECT NOW() as n, DATE(NOW()) as today, DATE_SUB(NOW(), INTERVAL 30 DAY) as thirty_days_ago");
  console.log('=== time test ===');
  console.log(JSON.stringify(now));

  const [inflows] = await pool.execute("SELECT DATE(p.date) AS dt, COALESCE(SUM(p.amount_cash),0) AS cash, COALESCE(SUM(p.amount_transfer),0) AS transfer FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.status!='cancelled' AND p.date>=DATE_SUB(NOW(),INTERVAL 30 DAY) GROUP BY DATE(p.date) ORDER BY dt");
  console.log('=== daily inflows (payments) ===');
  console.log(JSON.stringify(inflows));

  const [outflows] = await pool.execute("SELECT DATE(e.date) AS dt, COALESCE(SUM(CASE WHEN e.payment_method='cash' THEN e.amount WHEN e.payment_method='mixed' THEN e.amount/2 ELSE 0 END),0) AS cash, COALESCE(SUM(CASE WHEN e.payment_method='transfer' THEN e.amount WHEN e.payment_method='mixed' THEN e.amount/2 ELSE 0 END),0) AS transfer FROM expenses e WHERE e.date>=DATE_SUB(NOW(),INTERVAL 30 DAY) GROUP BY DATE(e.date) ORDER BY dt");
  console.log('=== daily outflows (expenses) ===');
  console.log(JSON.stringify(outflows));

  const [reg] = await pool.execute("SELECT DATE(date) AS dt, COALESCE(SUM(cash_amount),0) AS cash, COALESCE(SUM(transfer_amount),0) AS transfer FROM cash_register WHERE date>=DATE_SUB(NOW(),INTERVAL 30 DAY) GROUP BY DATE(date) ORDER BY dt");
  console.log('=== register entries last 30d ===');
  console.log(JSON.stringify(reg));

  const [regPrev] = await pool.execute("SELECT COALESCE(SUM(cash_amount),0) AS cash, COALESCE(SUM(transfer_amount),0) AS transfer FROM cash_register WHERE date < DATE_SUB(NOW(), INTERVAL 30 DAY)");
  console.log('=== register before 30d ===');
  console.log(JSON.stringify(regPrev));

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
