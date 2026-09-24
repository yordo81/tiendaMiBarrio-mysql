export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';
import { handle, ok, err, forbidden, requireRole } from '@/lib/api-helpers';
import { cachedReport } from '@/lib/report-cache';

export const GET = handle(async (req: Request) => {
  const user = await requireAuth();
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

  // ── Conversión a moneda base ─────────────────────────────────────
  // SQL que devuelve el monto de una columna de venta ajustado a la moneda
  // base: si la venta tiene moneda distinta de la base, multiplica por la
  // tasa congelada (1 moneda = X base). Los NULL se tratan como base.
  const baseExpr = (col: string, alias = 's') =>
    `CASE WHEN ${alias}.currency_code IS NOT NULL AND ${alias}.currency_code!='' AND ${alias}.currency_code!=(SELECT code FROM currencies WHERE is_base=1 AND active=1 LIMIT 1) THEN ${alias}.${col}*COALESCE(${alias}.exchange_rate,1) ELSE ${alias}.${col} END`;

  if (type === 'dashboard') {
    // El reporte general (ganancia neta, gastos, deudas) es solo para roles de gestión
    if (user.role === 'seller') return forbidden('Este reporte no está disponible para vendedores');

    const data = await cachedReport('dashboard', user.id, locationId, days, async () => {
      const lw = (base: string, lp: unknown[] = []) => {
        if (!locationId) return { sql: base, params: lp };
        return {
          sql: base.replace('FROM sales', 'FROM sales s').replace('WHERE ', `WHERE s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND `),
          params: [locationId, ...lp],
        };
      };

      // NOTA: Todos los totales se convierten a la moneda base usando la
      // tasa congelada en cada venta/abono, para que ventas en USD y en la
      // moneda base se sumen de forma consistente.
      // Filtro opcional por almacén (locationId): subquery reutilizable.
      const locFilter = locationId ? `s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND ` : '';
      const [today, week, month, expenses, cogs, debt, lowStock, chart, top, expensesToday, expensesWeek, cogsToday, cogsWeek] = await Promise.all([
        query<{total:number}>(`SELECT COALESCE(SUM(${baseExpr('total')}),0) AS total FROM sales s WHERE ${locFilter}DATE(s.date)=CURDATE() AND s.status!='cancelled'`,locParams()),
        query<{total:number}>(`SELECT COALESCE(SUM(${baseExpr('total')}),0) AS total FROM sales s WHERE ${locFilter}s.date>=DATE_SUB(CURDATE(), INTERVAL DAYOFWEEK(CURDATE())-1 DAY) AND s.status!='cancelled'`,locParams()),
        query<{total:number}>(`SELECT COALESCE(SUM(${baseExpr('total')}),0) AS total FROM sales s WHERE ${locFilter}s.date>=DATE_FORMAT(CURDATE(), '%Y-%m-01') AND s.status!='cancelled'`,locParams()),
        query<{total:number}>(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE date>=DATE_FORMAT(CURDATE(), '%Y-%m-01')`),
        query<{total:number}>(`SELECT COALESCE(SUM(si.quantity*${baseExpr('cost','si')}),0) AS total FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE${locationId?` s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND`:''} si.created_at>=DATE_FORMAT(CURDATE(), '%Y-%m-01') AND s.status!='cancelled'`,locParams()),
        query<{total:number;count:number}>(`SELECT COALESCE(SUM(balance),0) AS total,COUNT(*) AS count FROM customers WHERE balance>0`),
        query<{count:number}>(`SELECT COUNT(*) AS count FROM products p WHERE p.active=1${locationId?' AND p.id IN (SELECT product_id FROM location_stock WHERE location_id=?)':''} AND (SELECT COALESCE(${locationId?'quantity,0':'SUM(quantity),0'}) FROM location_stock WHERE product_id=p.id${locationId?' AND location_id=?':''}) <= p.min_stock`, (locationId ? [locationId, locationId] : []) as unknown[]),
        query<{date:string;total:number}>(`SELECT DATE_FORMAT(s.date,'%d/%m') AS date,COALESCE(SUM(${baseExpr('total')}),0) AS total FROM sales s WHERE ${locFilter}s.date>=DATE_SUB(NOW(),INTERVAL ? DAY) AND s.status!='cancelled' GROUP BY DATE(s.date),DATE_FORMAT(s.date,'%d/%m') ORDER BY DATE(s.date) ASC`, locationId ? [locationId, days] : [days]),
        query<{name:string;total:number}>(`SELECT p.name,COALESCE(SUM(si.quantity*${baseExpr('unit_price','si')}),0) AS total FROM sale_items si JOIN products p ON p.id=si.product_id JOIN sales s ON s.id=si.sale_id WHERE${locationId?` s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND`:''} si.created_at>=DATE_FORMAT(CURDATE(), '%Y-%m-01') AND s.status!='cancelled' GROUP BY p.id,p.name ORDER BY total DESC LIMIT 5`,locParams()),
        query<{total:number}>(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE${locationId?` id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='gasto' AND DATE(date)=CURDATE()) AND`:''} DATE(date)=CURDATE()`,locParams()),
        query<{total:number}>(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE${locationId?` id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='gasto') AND`:''} date>=DATE_SUB(CURDATE(), INTERVAL DAYOFWEEK(CURDATE())-1 DAY)`,locParams()),
        query<{total:number}>(`SELECT COALESCE(SUM(si.quantity*${baseExpr('cost','si')}),0) AS total FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE${locationId?` s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND`:''} DATE(${locationId?'s.':''}date)=CURDATE() AND s.status!='cancelled'`,locParams()),
        query<{total:number}>(`SELECT COALESCE(SUM(si.quantity*${baseExpr('cost','si')}),0) AS total FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE${locationId?` s.id IN (SELECT reference_id FROM location_movements WHERE location_id=? AND type='venta') AND`:''} ${locationId?'s.':''}date>=DATE_SUB(CURDATE(), INTERVAL DAYOFWEEK(CURDATE())-1 DAY) AND s.status!='cancelled'`,locParams()),
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
      return {
        salesToday: salesTodayVal, salesWeek: salesWeekVal,
        salesMonth: salesMonthVal,
        netProfitToday, netProfitWeek, netProfitMonth,
        cogsMonth, cogsToday: cogsTodayVal, cogsWeek: cogsWeekVal,
        expensesMonth: expensesMonthVal, expensesToday: expensesTodayVal, expensesWeek: expensesWeekVal,
        pendingDebt: debt[0]?.total??0, pendingDebtCount: debt[0]?.count??0,
        lowStockCount: lowStock[0]?.count??0,
        salesChart: chart, topProducts: top,
        timezone,
      };
    });

    return ok(data);
  }

  // ── Guard de roles para el resto de reportes ────────────────────
  // El módulo Reportes es de owner/admin en la UI; aquí se refuerza en la
  // API para que un vendedor no consulte datos financieros directamente.
  // Excepciones operativas: 'seller' (dashboard del vendedor) y
  // 'stock_movements' (historial de un producto, usado por bodegueros).
  if (type !== 'seller' && type !== 'stock_movements') {
    await requireRole('owner', 'admin');
  }

  // ── Dashboard del vendedor ──────────────────────────────────────
  // Métricas personalizadas: lo que el vendedor necesita para su jornada
  // (sus propias ventas, reservas pendientes, deudores, stock bajo y
  // productos más vendidos). No incluye datos financieros sensibles como
  // ganancia neta o gastos.
  if (type === 'seller') {
    const uid = user.id;

    const data = await cachedReport('seller', uid, locationId, days, async () => {
      const [myToday, myCountToday, myWeek, myMonth, chart, top, debtors, lowStock] = await Promise.all([
        query<{ total: number }>(`SELECT COALESCE(SUM(${baseExpr('total')}),0) AS total FROM sales s WHERE s.user_id=? AND DATE(s.date)=CURDATE() AND s.status!='cancelled'`, [uid]),
        query<{ count: number }>(`SELECT COUNT(*) AS count FROM sales s WHERE s.user_id=? AND DATE(s.date)=CURDATE() AND s.status!='cancelled'`, [uid]),
        query<{ total: number }>(`SELECT COALESCE(SUM(${baseExpr('total')}),0) AS total FROM sales s WHERE s.user_id=? AND s.date>=DATE_SUB(CURDATE(), INTERVAL DAYOFWEEK(CURDATE())-1 DAY) AND s.status!='cancelled'`, [uid]),
        query<{ total: number }>(`SELECT COALESCE(SUM(${baseExpr('total')}),0) AS total FROM sales s WHERE s.user_id=? AND s.date>=DATE_FORMAT(CURDATE(),'%Y-%m-01') AND s.status!='cancelled'`, [uid]),
        query<{ date: string; total: number }>(`SELECT DATE_FORMAT(s.date,'%d/%m') AS date,COALESCE(SUM(${baseExpr('total')}),0) AS total FROM sales s WHERE s.user_id=? AND s.date>=DATE_SUB(NOW(),INTERVAL ? DAY) AND s.status!='cancelled' GROUP BY DATE(s.date),DATE_FORMAT(s.date,'%d/%m') ORDER BY DATE(s.date) ASC`, [uid, days]),
        query<{ name: string; total: number }>(`SELECT p.name,COALESCE(SUM(si.quantity*${baseExpr('unit_price','si')}),0) AS total FROM sale_items si JOIN products p ON p.id=si.product_id JOIN sales s ON s.id=si.sale_id WHERE si.created_at>=DATE_FORMAT(CURDATE(),'%Y-%m-01') AND s.status!='cancelled' GROUP BY p.id,p.name ORDER BY total DESC LIMIT 5`),
        query<{ count: number }>(`SELECT COUNT(*) AS count FROM customers WHERE balance>0`),
        query<{ count: number }>(`SELECT COUNT(*) AS count FROM products p WHERE p.active=1 AND (SELECT COALESCE(SUM(quantity),0) FROM location_stock WHERE product_id=p.id) <= p.min_stock`),
      ]);
      const recent = await query<{ id: string; total: number; date: string; payment_method: string; customer_name: string | null }>(`
        SELECT s.id,s.total,s.date,
          (SELECT p.method FROM payments p WHERE p.sale_id=s.id ORDER BY p.created_at ASC LIMIT 1) AS payment_method,
          c.name AS customer_name
        FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
        WHERE s.user_id=? AND s.status!='cancelled'
        ORDER BY s.date DESC LIMIT 8`, [uid]);
      return {
        mySalesToday: myToday[0]?.total ?? 0,
        mySalesCountToday: myCountToday[0]?.count ?? 0,
        mySalesWeek: myWeek[0]?.total ?? 0,
        mySalesMonth: myMonth[0]?.total ?? 0,
        salesChart: chart,
        topProducts: top,
        debtorsCount: debtors[0]?.count ?? 0,
        lowStockCount: lowStock[0]?.count ?? 0,
        recentSales: recent,
        timezone: process.env.TIMEZONE ?? 'America/Havana',
      };
    });

    return ok(data);
  }

  if (type === 'margins') {
    const data = await cachedReport('margins', user.id, locationId, days, async () => {
      // Montos convertidos a moneda base (venta y costo) para que el reporte
      // sea consistente aunque haya ventas en moneda extranjera.
      const px = baseExpr('unit_price', 'si');
      const cx = baseExpr('cost', 'si');
      let sql = `SELECT p.name,AVG(${px}) AS sale_price,AVG(${cx}) AS cost,AVG(${px}-${cx}) AS margin,AVG((${px}-${cx})/NULLIF(${px},0)*100) AS margin_pct,SUM(si.quantity*${px}) AS total_sold,SUM(si.quantity*${cx}) AS total_cost,SUM(si.quantity*(${px}-${cx})) AS gross_profit FROM sale_items si JOIN products p ON p.id=si.product_id JOIN sales s ON s.id=si.sale_id`;
      const mp: unknown[] = [];
      if (locationId) {
        sql += ` JOIN location_movements lm ON lm.reference_id=s.id AND lm.type='venta' AND lm.location_id=?`;
        mp.push(locationId);
      }
      sql += ` WHERE si.created_at>=DATE_SUB(NOW(),INTERVAL ? DAY) AND s.status!='cancelled' GROUP BY p.id,p.name ORDER BY margin_pct DESC`;
      mp.push(days);
      return query(sql, mp);
    });
    return ok(data);
  }

  if (type === 'price_history') {
    const pid = searchParams.get('product_id');
    if (!pid) return ok([]);
    return ok(await query(`SELECT pp.date,pp.price,s.name AS supplier_name FROM purchase_prices pp LEFT JOIN suppliers s ON s.id=pp.supplier_id WHERE pp.product_id=? ORDER BY pp.date ASC`,[pid]));
  }

  if (type === 'restock') {
    const data = await cachedReport('restock', user.id, locationId, days, async () => {
      // Usamos el stock real de location_stock en lugar de p.stock,
      // porque p.stock puede desincronizarse del stock real en las ubicaciones.
      // Cuando se proporciona location_id, filtra por ese almacén específico.
      const stockSubquery = locationId
        ? '(SELECT quantity FROM location_stock WHERE product_id=p.id AND location_id=?)'
        : '(SELECT COALESCE(SUM(quantity),0) FROM location_stock WHERE product_id=p.id)';
      // NOTA: con locationId hay 3 placeholders (subquery de stock en SELECT,
      // filtro en WHERE y subquery de stock en ORDER BY), por lo que se
      // pasan 3 parámetros. Sin locationId no hay placeholders en la subquery.
      const restockParams: unknown[] = locationId ? [locationId, locationId, locationId] : [];
      const locationFilter = locationId ? ' AND p.id IN (SELECT product_id FROM location_stock WHERE location_id=?)' : '';
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
      // Se ocultan los productos sin existencia (stock 0 o negativo) para que el
      // reporte de reabastecimiento solo muestre productos disponibles.
      return rows.filter(r => Number(r.stock) > 0).map(r => {
        const avgDaily = r.sold/30;
        const daysLeft = avgDaily>0?Math.floor(r.stock/avgDaily):9999;
        const urgency = daysLeft<=3?'critical':daysLeft<=7?'soon':'ok';
        const rd = new Date(); rd.setDate(rd.getDate()+Math.min(daysLeft,999));
        return { ...r, avg_daily_sales: avgDaily, days_until_empty: daysLeft, urgency, restock_date: rd.toISOString().slice(0,10) };
      });
    });
    return ok(data);
  }

  if (type === 'debts') {
    return ok(await query('SELECT id,name,phone,balance FROM customers WHERE balance>0 ORDER BY balance DESC'));
  }

  if (type === 'sales_detail') {
    const fromDate = searchParams.get('from');
    const toDate = searchParams.get('to');
    const data = await cachedReport('sales_detail', user.id, locationId, days, async () => {
      // 1) Totales diarios generales (efectivo, transferencia, total)
      let baseSql = `
        FROM sales s
        LEFT JOIN (
          SELECT sale_id,
                 SUM(CASE WHEN method='cash' THEN CASE WHEN p.currency_code IS NOT NULL AND p.currency_code!='' AND p.currency_code!=(SELECT code FROM currencies WHERE is_base=1 AND active=1 LIMIT 1) THEN amount_cash*COALESCE(p.exchange_rate,1) ELSE amount_cash END ELSE 0 END) AS cash_amount,
                 SUM(CASE WHEN method IN ('transfer','mixed') THEN CASE WHEN p.currency_code IS NOT NULL AND p.currency_code!='' AND p.currency_code!=(SELECT code FROM currencies WHERE is_base=1 AND active=1 LIMIT 1) THEN amount_transfer*COALESCE(p.exchange_rate,1) ELSE amount_transfer END ELSE 0 END) AS transfer_amount
          FROM payments p GROUP BY sale_id
        ) pay ON pay.sale_id=s.id`;
      const bp: unknown[] = [];
      if (locationId) {
        baseSql += ` JOIN location_movements lm ON lm.reference_id=s.id AND lm.type='venta' AND lm.location_id=?`;
        bp.push(locationId);
      }
      const whereBase = fromDate && toDate
        ? ` WHERE s.date>=? AND s.date<=? AND s.status!='cancelled'`
        : ` WHERE s.date>=DATE_SUB(NOW(),INTERVAL ? DAY) AND s.status!='cancelled'`;
      const whereParams = fromDate && toDate ? [fromDate, toDate + ' 23:59:59'] : [days];

      const rowsSql = `
        SELECT DATE(s.date) AS date,
               COUNT(*) AS count,
               COALESCE(SUM(${baseExpr('total')}),0) AS total,
               COALESCE(SUM(${baseExpr('total')}),0) AS total_base,
               COALESCE(SUM(s.total),0) AS total_original,
               COALESCE(SUM(${baseExpr('total')}),0) - COALESCE(SUM(s.total),0) AS currency_diff,
               COALESCE(SUM(pay.cash_amount),0) AS cash_total,
               COALESCE(SUM(pay.transfer_amount),0) AS transfer_total
        ${baseSql}${whereBase}
        GROUP BY DATE(s.date) ORDER BY DATE(s.date) ASC`;
      const rows = await query<Record<string, unknown>>(rowsSql, [...bp, ...whereParams]);

      // 2) Totales diarios por moneda de pago (payments.currency_code)
      let curSql = `
        SELECT DATE(s.date) AS date,
               COALESCE(pay.currency_code, '') AS pay_currency,
               SUM(pay.amount_cash + pay.amount_transfer) AS currency_total
        FROM sales s
        JOIN (
          SELECT sale_id, currency_code,
                 SUM(amount_cash) AS amount_cash, SUM(amount_transfer) AS amount_transfer
          FROM payments GROUP BY sale_id, currency_code
        ) pay ON pay.sale_id=s.id`;
      const cp: unknown[] = [];
      if (locationId) {
        curSql += ` JOIN location_movements lm ON lm.reference_id=s.id AND lm.type='venta' AND lm.location_id=?`;
        cp.push(locationId);
      }
      curSql += whereBase + ` GROUP BY DATE(s.date), pay.currency_code ORDER BY DATE(s.date) ASC, pay.currency_code`;
      const curRows = await query<{ date: string; pay_currency: string; currency_total: number }>(curSql, [...cp, ...whereParams]);

      // 3) Obtener nombres de monedas
      const curNames = await query<{ code: string; name: string; symbol: string }>('SELECT code, name, symbol FROM currencies WHERE active=1');
      const curNameMap: Record<string, { name: string; symbol: string }> = {};
      for (const c of curNames) curNameMap[c.code] = { name: c.name, symbol: c.symbol };

      // 4) Enriquecir filas con montos por moneda
      const curByDate = new Map<string, Record<string, number>>();
      for (const cr of curRows) {
        if (!curByDate.has(cr.date)) curByDate.set(cr.date, {});
        curByDate.get(cr.date)![cr.pay_currency] = Number(cr.currency_total);
      }

      return rows.map(r => {
        const dateStr = String(r.date);
        const curMap = curByDate.get(dateStr) ?? {};
        return { ...r, currency_breakdown: curMap, currency_names: curNameMap };
      });
    });
    return ok(data);
  }

  if (type === 'stock_movements') {
    const pid = searchParams.get('product_id');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1);
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') ?? '20') || 20));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (pid) { conditions.push('sm.product_id = ?'); params.push(pid); }
    if (from) { conditions.push('sm.date >= ?'); params.push(from); }
    if (to) { conditions.push('sm.date <= ?'); params.push(to + ' 23:59:59'); }
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Contar total para paginación
    const countResult = await query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM stock_movements sm ${where}`,
      params
    );
    const total = countResult[0]?.total ?? 0;

    // Obtener página actual
    const data = await query(
      `SELECT sm.*,p.name AS product_name,u.name AS user_name FROM stock_movements sm LEFT JOIN products p ON p.id=sm.product_id LEFT JOIN users u ON u.id=sm.user_id ${where} ORDER BY sm.date DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return ok({ data, total, page, limit });
  }

  if (type === 'transfers') {
    // Filtro opcional por moneda de la transferencia ('' = todas)
    const currency = (searchParams.get('currency') ?? '').trim().toUpperCase();
    const data = await cachedReport('transfers', user.id, locationId, days, async () => {
      // Moneda base (NULL en la BD = base): sirve para mostrar la moneda de
      // cada transferencia y para filtrar por la moneda base.
      const baseRows = await query<{ code: string }>(
        "SELECT code FROM currencies WHERE is_base = 1 AND active = 1 LIMIT 1"
      );
      const baseCode = baseRows[0]?.code ?? '';
      // Reporte de pagos por transferencia: cada fila es una línea de producto
      // de una venta pagada (total o parcialmente) por transferencia. El
      // teléfono del cliente y la referencia bancaria se extraen de las notas
      // del pago (formato del POS táctil: "ID pago: XXX · Tel: XXX") o del
      // teléfono del cliente asociado a la venta.
      let sql = `
        SELECT p.id AS payment_id, p.method, p.amount_transfer,
               CASE WHEN p.currency_code IS NOT NULL AND p.currency_code!='' AND p.currency_code!=(SELECT code FROM currencies WHERE is_base=1 AND active=1 LIMIT 1) THEN p.amount_transfer*COALESCE(p.exchange_rate,1) ELSE p.amount_transfer END AS amount_transfer_base,
               p.currency_code, p.notes AS payment_notes,
               p.date AS payment_date, s.id AS sale_id, s.date AS sale_date,
               pr.name AS product_name, si.quantity, si.unit_price,
               c.name AS customer_name, c.phone AS customer_phone
        FROM payments p
        JOIN sales s ON s.id = p.sale_id
        JOIN sale_items si ON si.sale_id = s.id
        JOIN products pr ON pr.id = si.product_id
        LEFT JOIN customers c ON c.id = s.customer_id`;
      const tp: unknown[] = [];
      if (locationId) {
        sql += ` JOIN location_movements lm ON lm.reference_id = s.id AND lm.type='venta' AND lm.location_id=?`;
        tp.push(locationId);
      }
      sql += ` WHERE p.method IN ('transfer','mixed') AND p.amount_transfer > 0
              AND s.status != 'cancelled' AND p.date >= DATE_SUB(NOW(), INTERVAL ? DAY)`;
      tp.push(days);
      // Filtro por moneda: en la BD la moneda base se guarda como NULL/''
      if (currency) {
        if (baseCode && currency === baseCode) {
          sql += ` AND (p.currency_code IS NULL OR p.currency_code = '')`;
        } else {
          sql += ` AND p.currency_code = ?`;
          tp.push(currency);
        }
      }
      sql += ` ORDER BY p.date DESC, p.id DESC`;
      const rows = await query<Record<string, unknown>>(sql, tp);
      return rows.map(r => {
        const notes = String(r.payment_notes ?? '');
        const phoneFromNotes = notes.match(/Tel:\s*([^·\n]+)/i)?.[1]?.trim() ?? null;
        const refFromNotes = notes.match(/ID pago:\s*([^·\n]+)/i)?.[1]?.trim() ?? null;
        const phone = String(r.customer_phone ?? '').trim() || phoneFromNotes;
        return {
          payment_id: r.payment_id,
          sale_id: r.sale_id,
          date: r.payment_date,
          product_name: r.product_name,
          quantity: Number(r.quantity ?? 0),
          unit_price: Number(r.unit_price ?? 0),
          subtotal: Number(r.quantity ?? 0) * Number(r.unit_price ?? 0),
          amount_transfer: Number(r.amount_transfer ?? 0),
          // Monto convertido a la moneda base con la tasa congelada del pago
          amount_transfer_base: Number(r.amount_transfer_base ?? 0),
          // Moneda en la que se hizo la transferencia (null en la BD = moneda base)
          currency_code: r.currency_code ? String(r.currency_code) : (baseCode || null),
          method: r.method,
          customer_name: r.customer_name ?? null,
          phone: phone || null,
          bank_ref: refFromNotes,
        };
      });
    }, currency || '');
    return ok(data);
  }

  if (type === 'expiration') {
    const data = await cachedReport('expiration', user.id, locationId, days, async () => {
      const rows = await query<Record<string, unknown>>(`
        SELECT p.id, p.name, p.expiration_date, p.is_perishable, p.stock, p.unit,
          c.name AS category_name,
          DATEDIFF(p.expiration_date, CURDATE()) AS days_left
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.active = 1
          AND p.is_perishable = 1
          AND p.expiration_date IS NOT NULL
        ORDER BY p.expiration_date ASC
      `);
      return rows.map(r => ({
        id: r.id,
        name: r.name,
        expiration_date: r.expiration_date,
        is_perishable: Boolean(r.is_perishable),
        stock: Number(r.stock),
        unit: r.unit,
        category_name: r.category_name ?? null,
        days_left: Number(r.days_left),
        status: Number(r.days_left) < 0 ? 'expired'
          : Number(r.days_left) <= 5 ? 'critical'
          : Number(r.days_left) <= 15 ? 'warning'
          : Number(r.days_left) <= 30 ? 'info'
          : 'future',
      }));
    });
    return ok(data);
  }

  return err('Tipo inválido');
});
