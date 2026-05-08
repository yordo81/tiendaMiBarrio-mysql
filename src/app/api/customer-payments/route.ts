export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, transaction } from '@/lib/db/mysql';
const randomUUID = () => crypto.randomUUID();

export async function GET(req: Request) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const cid = searchParams.get('customer_id');
    const sql = `SELECT cp.*,c.name AS customer_name FROM customer_payments cp LEFT JOIN customers c ON c.id=cp.customer_id${cid?' WHERE cp.customer_id=?':''} ORDER BY cp.date DESC LIMIT 100`;
    return NextResponse.json(await query(sql, cid?[cid]:[]));
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}

export async function POST(req: Request) {
  try {
    await requireAuth();
    const { customer_id, amount, method, notes } = await req.json();
    if (!customer_id || !amount || amount <= 0) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    const id = randomUUID(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
    await transaction(async (conn) => {
      await conn.execute('INSERT INTO customer_payments (id,customer_id,amount,method,date,notes,created_at) VALUES (?,?,?,?,?,?,?)',[id,customer_id,amount,method??'cash',ts,notes??null,ts]);
      await conn.execute('UPDATE customers SET balance=GREATEST(0,balance-?),updated_at=? WHERE id=?',[amount,ts,customer_id]);
    });
    return NextResponse.json((await query('SELECT * FROM customer_payments WHERE id=?',[id]))[0],{status:201});
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); console.error(e); return NextResponse.json({error:'Error interno'},{status:500}); }
}
