export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';
import { handle, ok, err } from '@/lib/api-helpers';

export const GET = handle(async (req: Request) => {
  await requireAuth();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') ?? 'dashboard';
  const days = parseInt(searchParams.get('days') ?? '30');
  const locationId = searchParams.get('location_id');

  function locSubquery(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
    if (!locationId) return { sql, params };
    return {
      sql: sql.replace('WHERE s.', `WHERE s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND s.`),
      params: [locationId, ...params],
    };
  }
  function locParams(): unknown[] { return locationId ? [locationId] : []; }

  if (type === 'dashboard') {
    const lw = (base: string, lp: unknown[] = []) => {
      if (!locationId) return { sql: base, params: lp };
      return {
        sql: base.replace('FROM sales', 'FROM sales s').replace('WHERE ', `WHERE s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND `),
        params: [locationId, ...lp],
      };
    };

    const [today, week, month, expenses, cogs, debt, lowStock, chart, top, expensesToday, expensesWeek, cogsToday, cogsWeek] = await Promise.all([
      query<{total:number}>(`SELECT COALESCE(SUM(total),0) AS total FROM sales${locationId?' s':''} WHERE${locationId?` s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND`:''} DATE(${locationId?'s.':''}date)=CURDATE() AND${locationId?' s.':' '}status!='cancelled'`,locParams()),
      query<{total:number}>(`SELECT COALESCE(SUM(total),0) AS total FROM sales${locationId?' s':''} WHERE${locationId?` s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND`:''} ${locationId?'s.':''}date>=DATE_SUB(NOW(),INTERVAL 7 DAY) AND${locationId?' s.':' '}status!='cancelled'`,locParams()),
      query<{total:number}>(`SELECT COALESCE(SUM(total),0) AS total FROM sales${locationId?' s':''} WHERE${locationId?` s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND`:''} ${locationId?'s.':''}date>=DATE_SUB(NOW(),INTERVAL 30 DAY) AND${locationId?' s.':' '}status!='cancelled'`,locParams()),
      query<{total:number}>(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE date>=DATE_SUB(NOW(),INTERVAL 30 DAY)`),
      query<{total:number}>(`SELECT COALESCE(SUM(si.quantity*si.cost),0) AS total FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE${locationId?` s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND`:''} si.created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) AND s.status!='cancelled'`,locParams()),
      query<{total:number;count:number}>(`SELECT COALESCE(SUM(balance),0) AS total,COUNT(*) AS count FROM customers WHERE balance>0`),
      query<{count:number}>(`SELECT COUNT(*) AS count FROM products p WHERE p.active=1${locationId?' AND p.id IN (SELECT product_id FROM location_stock WHERE location_id=?)':''} AND (SELECT COALESCE(${locationId?'quantity,0':'SUM(quantity),0'}) FROM location_stock WHERE product_id=p.id${locationId?' AND location_id=?':''}) <= p.min_stock`, (locationId ? [locationId, locationId] : []) as unknown[]),
      query<{date:string;total:number}>(`SELECT DATE_FORMAT(${locationId?'s.':''}date,'%d/%m') AS date,COALESCE(SUM(${locationId?'s.':''}total),0) AS total FROM sales${locationId?' s':''} WHERE${locationId?` s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND`:''} ${locationId?'s.':''}date>=DATE_SUB(NOW(),INTERVAL ? DAY) AND${locationId?' s.':' '}status!='cancelled' GROUP BY DATE(${locationId?'s.':''}date),DATE_FORMAT(${locationId?'s.':''}date,'%d/%m') ORDER BY DATE(${locationId?'s.':''}date) ASC`, locationId ? [locationId, days] : [days]),
      query<{name:string;total:number}>(`SELECT p.name,COALESCE(SUM(si.quantity*si.unit_price),0) AS total FROM sale_items si JOIN products p ON p.id=si.product_id JOIN sales s ON s.id=si.sale_id WHERE${locationId?` s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND`:''} si.created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) AND s.status!='cancelled' GROUP BY p.id,p.name ORDER BY total DESC LIMIT 5`,locParams()),
      query<{total:number}>(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE${locationId?` id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='gasto' AND DATE(date)=CURDATE()) AND`:''} DATE(date)=CURDATE()`,locParams()),
      query<{total:number}>(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE${locationId?` id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='gasto') AND`:''} date>=DATE_SUB(NOW(),INTERVAL 7 DAY)`,locParams()),
      query<{total:number}>(`SELECT COALESCE(SUM(si.quantity*si.cost),0) AS total FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE${locationId?` s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND`:''} DATE(${locationId?'s.':''}date)=CURDATE() AND s.status!='cancelled'`,locParams()),
      query<{total:number}>(`SELECT COALESCE(SUM(si.quantity*si.cost),0) AS total FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE${locationId?` s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND`:''} ${locationId?'s.':''}date>=DATE_SUB(NOW(),INTERVAL 7 DAY) AND s.status!='cancelled'`,locParams()),
    ]);
    const salesTodayVal = today[0]?.total ?? 0;
    const salesWeekVal = week[0]?.total ?? 0;
    const salesMonthVal = month[0]?.total ?? 0;
    const cogsMonth = cogs[0]?.total ?? 0;
    const cogsTodayVal = cogsToday[0]?.total ?? 0;
    const cogsWeekVal = cogsWeek[0]?.total ?? 0;
    const expensesMonthVal = expenses[0]?.total ?? 0;
    const expensesTodayVal = expensesToday[0]?.total ?? 0;
    const expensesWeekVal = expensesWeek[0]?.total ?? 0;
    const netProfitToday = salesTodayVal - cogsTodayVal - expensesTodayVal;
    const netProfitWeek = salesWeekVal - cogsWeekVal - expensesWeekVal;
    const netProfitMonth = salesMonthVal - cogsMonth - expensesMonthVal;
    const timezone = process.env.TIMEZONE ?? 'America/Havana';
    return ok({
      salesToday: salesTodayVal, salesWeek: salesWeekVal,
      salesMonth: salesMonthVal,
      netProfitToday, netProfitWeek, netProfitMonth,
      cogsMonth, cogsToday: cogsTodayVal, cogsWeek: cogsWeekVal,
      expensesMonth: expensesMonthVal, expensesToday: expensesTodayVal, expensesWeek: expensesWeekVal,
      pendingDebt: debt[0]?.total??0, pendingDebtCount: debt[0]?.count??0,
      lowStockCount: lowStock[0]?.count??0,
      salesChart: chart, topProducts: top,
      timezone,
    });
  }

  if (type === 'margins') {
    let sql = `SELECT p.name,AVG(si.unit_price) AS sale_price,AVG(si.cost) AS cost,AVG(si.unit_price-si.cost) AS margin,AVG((si.unit_price-si.cost)/NULLIF(si.unit_price,0)*100) AS margin_pct,SUM(si.quantity*si.unit_price) AS total_sold,SUM(si.quantity*si.cost) AS total_cost,SUM(si.quantity*(si.unit_price-si.cost)) AS gross_profit FROM sale_items si JOIN products p ON p.id=si.product_id JOIN sales s ON s.id=si.sale_id`;
    const mp: unknown[] = [];
    if (locationId) {
      sql += ` JOIN location_movements lm ON lm.reference_id=s.id AND lm.type='venta' AND lm.location_id=?`;
      mp.push(locationId);
    }
    sql += ` WHERE si.created_at>=DATE_SUB(NOW(),INTERVAL ? DAY) AND s.status!='cancelled' GROUP BY p.id,p.name ORDER BY margin_pct DESC`;
    mp.push(days);
    return ok(await query(sql, mp));
  }

  if (type === 'price_history') {
    const pid = searchParams.get('product_id');
    if (!pid) return ok([]);
    return ok(await query(`SELECT pp.date,pp.price,s.name AS supplier_name FROM purchase_prices pp LEFT JOIN suppliers s ON s.id=pp.supplier_id WHERE pp.product_id=? ORDER BY pp.date ASC`,[pid]));
  }

  if (type === 'restock') {
    // Usamos el stock real de location_stock en lugar de p.stock,
    // porque p.stock puede desincronizarse del stock real en las ubicaciones.
    // Cuando se proporciona location_id, filtra por ese almacén específico.
    const stockSubquery = locationId
      ? '(SELECT quantity FROM location_stock WHERE product_id=p.id AND location_id=?)'
      : '(SELECT COALESCE(SUM(quantity),0) FROM location_stock WHERE product_id=p.id)';
    const restockParams: unknown[] = [];
    if (locationId) restockParams.push(locationId);
    const locationFilter = locationId ? ' AND p.id IN (SELECT product_id FROM location_stock WHERE location_id=?)' : '';
    if (locationId) restockParams.push(locationId);
    const rows = await query<{id:string;name:string;stock:number;min_stock:number;sold:number}>(`
      SELECT p.id,p.name,
        COALESCE(${stockSubquery}, p.stock) AS stock,
        p.min_stock,
        COALESCE(SUM(si.quantity),0) AS sold
      FROM products p
      LEFT JOIN sale_items si ON si.product_id=p.id AND si.created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY)
      WHERE p.active=1${locationFilter}
      GROUP BY p.id,p.name,p.min_stock
      ORDER BY COALESCE(
        ${stockSubquery} / GREATEST(COALESCE(SUM(si.quantity),0.001)/30, 0.001),
        p.stock / GREATEST(COALESCE(SUM(si.quantity),0.001)/30, 0.001)
      ) ASC
    `, restockParams);
    return ok(rows.map(r => {
      const avgDaily = r.sold/30;
      const daysLeft = avgDaily>0?Math.floor(r.stock/avgDaily):9999;
      const urgency = daysLeft<=3?'critical':daysLeft<=7?'soon':'ok';
      const rd = new Date(); rd.setDate(rd.getDate()+Math.min(daysLeft,999));
      return { ...r, avg_daily_sales: avgDaily, days_until_empty: daysLeft, urgency, restock_date: rd.toISOString().slice(0,10) };
    }));
  }

  if (type === 'debts') {
    return ok(await query('SELECT id,name,phone,balance FROM customers WHERE balance>0 ORDER BY balance DESC'));
  }

  if (type === 'sales_detail') {
    let sql = `SELECT DATE(s.date) AS date,COUNT(*) AS count,COALESCE(SUM(s.total),0) AS total FROM sales s`;
    const sp: unknown[] = [];
    if (locationId) {
      sql += ` JOIN location_movements lm ON lm.reference_id=s.id AND lm.type='venta' AND lm.location_id=?`;
      sp.push(locationId);
    }
    sql += ` WHERE s.date>=DATE_SUB(NOW(),INTERVAL ? DAY) AND s.status!='cancelled' GROUP BY DATE(s.date) ORDER BY DATE(s.date) ASC`;
    sp.push(days);
    return ok(await query(sql, sp));
  }

  if (type === 'stock_movements') {
    const pid = searchParams.get('product_id');
    const sql = `SELECT sm.*,p.name AS product_name,u.name AS user_name FROM stock_movements sm LEFT JOIN products p ON p.id=sm.product_id LEFT JOIN users u ON u.id=sm.user_id${pid?' WHERE sm.product_id=?':''} ORDER BY sm.date DESC LIMIT 100`;
    return ok(await query(sql, pid?[pid]:[]));
  }

  return err('Tipo inválido');
});
