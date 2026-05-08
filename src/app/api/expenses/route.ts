export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, transaction } from '@/lib/db/mysql';
const randomUUID = () => crypto.randomUUID();

export async function GET(req: Request) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from'), to = searchParams.get('to');
    let sql = `SELECT e.*,ec.name AS category_name,p.name AS product_name,u.name AS user_name FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id LEFT JOIN products p ON p.id=e.product_id LEFT JOIN users u ON u.id=e.user_id`;
    const params: unknown[] = []; const where: string[] = [];
    if (from) { where.push('e.date>=?'); params.push(from); }
    if (to)   { where.push('e.date<=?'); params.push(to); }
    if (where.length) sql += ' WHERE '+where.join(' AND ');
    sql += ' ORDER BY e.date DESC LIMIT 200';
    return NextResponse.json(await query(sql, params));
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}

export async function POST(req: Request) {
  try {
    const sessionUser = await requireAuth();
    const body = await req.json();
    const id = randomUUID(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
    const date = body.date ? new Date(body.date).toISOString().slice(0,19).replace('T',' ') : ts;
    await transaction(async (conn) => {
      await conn.execute(
        'INSERT INTO expenses (id,category_id,description,amount,product_id,product_quantity,date,user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id,body.category_id??null,body.description,Number(body.amount??0),body.product_id??null,body.product_quantity??null,date,sessionUser.id,ts,ts]
      );
      if (body.product_id && body.product_quantity) {
        await conn.execute('UPDATE products SET stock=GREATEST(0,stock-?),updated_at=? WHERE id=?',[body.product_quantity,ts,body.product_id]);
        await conn.execute("INSERT INTO stock_movements (id,product_id,type,quantity,reason,reference_id,user_id,date,created_at) VALUES (?,?,'expense',?,?,?,?,?,?)",
          [randomUUID(),body.product_id,body.product_quantity,body.description,id,sessionUser.id,date,ts]);
      }
    });
    return NextResponse.json((await query('SELECT * FROM expenses WHERE id=?',[id]))[0],{status:201});
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); console.error(e); return NextResponse.json({error:'Error interno'},{status:500}); }
}
