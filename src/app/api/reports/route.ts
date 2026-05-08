export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';

export async function GET(req: Request) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type') ?? 'dashboard';
    const days = parseInt(searchParams.get('days') ?? '30');

    if (type === 'dashboard') {
      const [today, week, month, expenses, debt, lowStock, chart, top] = await Promise.all([
        query<{total:number}>(`SELECT COALESCE(SUM(total),0) AS total FROM sales WHERE DATE(date)=CURDATE() AND status!='cancelled'`),
        query<{total:number}>(`SELECT COALESCE(SUM(total),0) AS total FROM sales WHERE date>=DATE_SUB(NOW(),INTERVAL 7 DAY) AND status!='cancelled'`),
        query<{total:number}>(`SELECT COALESCE(SUM(total),0) AS total FROM sales WHERE date>=DATE_SUB(NOW(),INTERVAL 30 DAY) AND status!='cancelled'`),
        query<{total:number}>(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE date>=DATE_SUB(NOW(),INTERVAL 30 DAY)`),
        query<{total:number;count:number}>(`SELECT COALESCE(SUM(balance),0) AS total,COUNT(*) AS count FROM customers WHERE balance>0`),
        query<{count:number}>(`SELECT COUNT(*) AS count FROM products WHERE stock<=min_stock AND active=1`),
        query<{date:string;total:number}>(`SELECT DATE_FORMAT(date,'%d/%m') AS date,COALESCE(SUM(total),0) AS total FROM sales WHERE date>=DATE_SUB(NOW(),INTERVAL ? DAY) AND status!='cancelled' GROUP BY DATE(date),DATE_FORMAT(date,'%d/%m') ORDER BY DATE(date) ASC`,[days]),
        query<{name:string;total:number}>(`SELECT p.name,COALESCE(SUM(si.quantity*si.unit_price),0) AS total FROM sale_items si JOIN products p ON p.id=si.product_id WHERE si.created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) GROUP BY p.id,p.name ORDER BY total DESC LIMIT 5`),
      ]);
      return NextResponse.json({ salesToday: today[0]?.total??0, salesWeek: week[0]?.total??0, salesMonth: month[0]?.total??0, expensesMonth: expenses[0]?.total??0, netProfitMonth: (month[0]?.total??0)-(expenses[0]?.total??0), pendingDebt: debt[0]?.total??0, pendingDebtCount: debt[0]?.count??0, lowStockCount: lowStock[0]?.count??0, salesChart: chart, topProducts: top });
    }

    if (type === 'margins') {
      return NextResponse.json(await query(`SELECT p.name,AVG(si.unit_price) AS sale_price,AVG(si.cost) AS cost,AVG(si.unit_price-si.cost) AS margin,AVG((si.unit_price-si.cost)/NULLIF(si.unit_price,0)*100) AS margin_pct,SUM(si.quantity*si.unit_price) AS total_sold FROM sale_items si JOIN products p ON p.id=si.product_id WHERE si.created_at>=DATE_SUB(NOW(),INTERVAL ? DAY) GROUP BY p.id,p.name ORDER BY margin_pct DESC`,[days]));
    }

    if (type === 'price_history') {
      const pid = searchParams.get('product_id');
      if (!pid) return NextResponse.json([]);
      return NextResponse.json(await query(`SELECT pp.date,pp.price,s.name AS supplier_name FROM purchase_prices pp LEFT JOIN suppliers s ON s.id=pp.supplier_id WHERE pp.product_id=? ORDER BY pp.date ASC`,[pid]));
    }

    if (type === 'restock') {
      const rows = await query<{id:string;name:string;stock:number;min_stock:number;sold:number}>(`SELECT p.id,p.name,p.stock,p.min_stock,COALESCE(SUM(si.quantity),0) AS sold FROM products p LEFT JOIN sale_items si ON si.product_id=p.id AND si.created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) WHERE p.active=1 GROUP BY p.id,p.name,p.stock,p.min_stock ORDER BY (p.stock/GREATEST(COALESCE(SUM(si.quantity),0.001)/30,0.001)) ASC`);
      return NextResponse.json(rows.map(r => {
        const avgDaily = r.sold/30;
        const daysLeft = avgDaily>0?Math.floor(r.stock/avgDaily):9999;
        const urgency = daysLeft<=3?'critical':daysLeft<=7?'soon':'ok';
        const rd = new Date(); rd.setDate(rd.getDate()+Math.min(daysLeft,999));
        return { ...r, avg_daily_sales: avgDaily, days_until_empty: daysLeft, urgency, restock_date: rd.toISOString().slice(0,10) };
      }));
    }

    if (type === 'debts') {
      return NextResponse.json(await query('SELECT id,name,phone,balance FROM customers WHERE balance>0 ORDER BY balance DESC'));
    }

    if (type === 'stock_movements') {
      const pid = searchParams.get('product_id');
      const sql = `SELECT sm.*,p.name AS product_name,u.name AS user_name FROM stock_movements sm LEFT JOIN products p ON p.id=sm.product_id LEFT JOIN users u ON u.id=sm.user_id${pid?' WHERE sm.product_id=?':''} ORDER BY sm.date DESC LIMIT 100`;
      return NextResponse.json(await query(sql, pid?[pid]:[]));
    }

    return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 });
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); console.error(e); return NextResponse.json({error:'Error interno'},{status:500}); }
}
