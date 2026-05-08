export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
const randomUUID = () => crypto.randomUUID();

export async function GET(req: Request) {
  try {
    await requireAuth(); const { searchParams }=new URL(req.url); const pid=searchParams.get('product_id');
    const sql=`SELECT pp.*,s.name AS supplier_name,p.name AS product_name FROM purchase_prices pp LEFT JOIN suppliers s ON s.id=pp.supplier_id LEFT JOIN products p ON p.id=pp.product_id${pid?' WHERE pp.product_id=?':''} ORDER BY pp.date DESC LIMIT 200`;
    return NextResponse.json(await query(sql, pid?[pid]:[]));
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
export async function POST(req: Request) {
  try {
    await requireAuth(); const body=await req.json(); const id=randomUUID(); const ts=new Date().toISOString().slice(0,19).replace('T',' ');
    const date=body.date?new Date(body.date).toISOString().slice(0,19).replace('T',' '):ts;
    await execute('INSERT INTO purchase_prices (id,product_id,supplier_id,price,date,notes,created_at) VALUES (?,?,?,?,?,?,?)',[id,body.product_id,body.supplier_id,body.price,date,body.notes??null,ts]);
    await execute('UPDATE products SET cost=?,updated_at=? WHERE id=?',[body.price,ts,body.product_id]);
    await execute('INSERT IGNORE INTO product_suppliers (id,product_id,supplier_id,is_preferred) VALUES (?,?,?,0)',[randomUUID(),body.product_id,body.supplier_id]);
    return NextResponse.json((await query('SELECT * FROM purchase_prices WHERE id=?',[id]))[0],{status:201});
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
