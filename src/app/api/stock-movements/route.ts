export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
const randomUUID = () => crypto.randomUUID();

export async function GET(req: Request) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const pid = searchParams.get('product_id');
    const sql = `SELECT sm.*,u.name AS user_name FROM stock_movements sm LEFT JOIN users u ON u.id=sm.user_id${pid?' WHERE sm.product_id=?':''} ORDER BY sm.date DESC LIMIT 100`;
    return NextResponse.json(await query(sql, pid?[pid]:[]));
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}

export async function POST(req: Request) {
  try {
    const sessionUser = await requireAuth();
    const { product_id, type, quantity, reason } = await req.json();
    if (!product_id||!type||quantity<=0||!reason) return NextResponse.json({error:'Faltan datos'},{status:400});
    const id = randomUUID(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
    if (type==='adjust') {
      await execute('UPDATE products SET stock=?,updated_at=? WHERE id=?',[quantity,ts,product_id]);
    } else if (type==='in') {
      await execute('UPDATE products SET stock=stock+?,updated_at=? WHERE id=?',[quantity,ts,product_id]);
    } else {
      await execute('UPDATE products SET stock=GREATEST(0,stock-?),updated_at=? WHERE id=?',[quantity,ts,product_id]);
    }
    await execute('INSERT INTO stock_movements (id,product_id,type,quantity,reason,user_id,date,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [id,product_id,type,quantity,reason,sessionUser.id,ts,ts]);
    return NextResponse.json({ok:true,id},{status:201});
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); console.error(e); return NextResponse.json({error:'Error interno'},{status:500}); }
}
