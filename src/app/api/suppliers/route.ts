export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
const randomUUID = () => crypto.randomUUID();

export async function GET() {
  try { await requireAuth(); return NextResponse.json(await query('SELECT * FROM suppliers WHERE active=1 ORDER BY name')); }
  catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
export async function POST(req: Request) {
  try {
    await requireAuth(); const body=await req.json(); const id=randomUUID(); const ts=new Date().toISOString().slice(0,19).replace('T',' ');
    await execute('INSERT INTO suppliers (id,name,contact,phone,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',[id,body.name,body.contact??null,body.phone??null,body.notes??null,ts,ts]);
    return NextResponse.json((await query('SELECT * FROM suppliers WHERE id=?',[id]))[0],{status:201});
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
export async function PUT(req: Request) {
  try {
    await requireAuth(); const { id,...body }=await req.json(); const ts=new Date().toISOString().slice(0,19).replace('T',' ');
    await execute('UPDATE suppliers SET name=?,contact=?,phone=?,notes=?,updated_at=? WHERE id=?',[body.name,body.contact??null,body.phone??null,body.notes??null,ts,id]);
    return NextResponse.json((await query('SELECT * FROM suppliers WHERE id=?',[id]))[0]);
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
export async function DELETE(req: Request) {
  try {
    await requireAuth(); const { id }=await req.json(); const ts=new Date().toISOString().slice(0,19).replace('T',' ');
    await execute('UPDATE suppliers SET active=0,updated_at=? WHERE id=?',[ts,id]);
    return NextResponse.json({ok:true});
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
