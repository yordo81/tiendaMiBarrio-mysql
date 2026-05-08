export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
const randomUUID = () => crypto.randomUUID();

export async function GET() {
  try { await requireAuth(); return NextResponse.json(await query('SELECT * FROM categories ORDER BY name')); }
  catch(e) { if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
export async function POST(req: Request) {
  try {
    await requireAuth();
    const { name, parent_id } = await req.json();
    const id = randomUUID(), ts = new Date().toISOString().slice(0,19).replace('T',' ');
    await execute('INSERT INTO categories (id,name,parent_id,created_at) VALUES (?,?,?,?)', [id, name, parent_id??null, ts]);
    return NextResponse.json((await query('SELECT * FROM categories WHERE id=?',[id]))[0], {status:201});
  } catch(e) { if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
export async function PUT(req: Request) {
  try {
    await requireAuth();
    const { id, name, parent_id } = await req.json();
    const ts = new Date().toISOString().slice(0,19).replace('T',' ');
    await execute('UPDATE categories SET name=?, parent_id=?, updated_at=? WHERE id=?', [name, parent_id??null, ts, id]);
    return NextResponse.json((await query('SELECT * FROM categories WHERE id=?',[id]))[0]);
  } catch(e) { if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
export async function DELETE(req: Request) {
  try {
    await requireAuth();
    const { id } = await req.json();
    await execute('UPDATE products SET category_id=NULL WHERE category_id=?',[id]);
    await execute('DELETE FROM categories WHERE id=?',[id]);
    return NextResponse.json({ok:true});
  } catch(e) { if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
