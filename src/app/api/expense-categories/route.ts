export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
const randomUUID = () => crypto.randomUUID();
export async function GET() {
  try { await requireAuth(); return NextResponse.json(await query('SELECT * FROM expense_categories ORDER BY name')); }
  catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
export async function POST(req: Request) {
  try {
    await requireAuth(); const { name }=await req.json(); const id=randomUUID(); const ts=new Date().toISOString().slice(0,19).replace('T',' ');
    await execute('INSERT INTO expense_categories (id,name,created_at) VALUES (?,?,?)',[id,name,ts]);
    return NextResponse.json((await query('SELECT * FROM expense_categories WHERE id=?',[id]))[0],{status:201});
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
