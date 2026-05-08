export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, execute, transaction } from '@/lib/db/mysql';
const randomUUID = () => crypto.randomUUID();

export async function GET(req: Request) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const withDebt = searchParams.get('with_debt') === 'true';
    const sql = `SELECT * FROM customers WHERE active=1${withDebt?' AND balance>0':''} ORDER BY name`;
    return NextResponse.json(await query(sql));
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}

export async function POST(req: Request) {
  try {
    await requireAuth(); const body=await req.json(); const id=randomUUID(); const ts=new Date().toISOString().slice(0,19).replace('T',' ');
    await execute('INSERT INTO customers (id,name,phone,notes,balance,active,created_at,updated_at) VALUES (?,?,?,?,0,1,?,?)',[id,body.name,body.phone??null,body.notes??null,ts,ts]);
    return NextResponse.json((await query('SELECT * FROM customers WHERE id=?',[id]))[0],{status:201});
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}

export async function PUT(req: Request) {
  try {
    await requireAuth(); const { id,...body }=await req.json(); const ts=new Date().toISOString().slice(0,19).replace('T',' ');
    await execute('UPDATE customers SET name=?,phone=?,notes=?,updated_at=? WHERE id=?',[body.name,body.phone??null,body.notes??null,ts,id]);
    return NextResponse.json((await query('SELECT * FROM customers WHERE id=?',[id]))[0]);
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
