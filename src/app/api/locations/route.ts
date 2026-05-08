export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
const randomUUID = () => crypto.randomUUID();

export async function GET() {
  try { await requireAuth(); return NextResponse.json(await query('SELECT * FROM locations WHERE active=1 ORDER BY name')); }
  catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}

export async function POST(req: Request) {
  try {
    await requireAuth(); const body = await req.json(); const id = randomUUID(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
    await execute('INSERT INTO locations (id,name,type,address,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',
      [id,body.name,body.type??'warehouse',body.address??null,body.notes??null,ts,ts]);
    return NextResponse.json((await query('SELECT * FROM locations WHERE id=?',[id]))[0],{status:201});
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}

export async function PUT(req: Request) {
  try {
    await requireAuth(); const { id,...body } = await req.json(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
    await execute('UPDATE locations SET name=?,type=?,address=?,notes=?,updated_at=? WHERE id=?',
      [body.name,body.type??'warehouse',body.address??null,body.notes??null,ts,id]);
    return NextResponse.json((await query('SELECT * FROM locations WHERE id=?',[id]))[0]);
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}

export async function DELETE(req: Request) {
  try {
    await requireAuth(); const { id } = await req.json(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
    await execute('UPDATE locations SET active=0,updated_at=? WHERE id=?',[ts,id]);
    return NextResponse.json({ok:true});
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
