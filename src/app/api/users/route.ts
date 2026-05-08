export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
const randomUUID = () => crypto.randomUUID();
import * as bcrypt from 'bcryptjs';

function parseUser(r: Record<string,unknown>) {
  return { ...r, active: Boolean(r.active), permissions: typeof r.permissions==='string'?JSON.parse(r.permissions as string):(r.permissions??[]) };
}

export async function GET() {
  try {
    const me = await requireAuth();
    if (me.role !== 'owner') return NextResponse.json({ error: 'Sin permiso' }, { status: 403 });
    const rows = await query<Record<string,unknown>>('SELECT id,name,email,role,permissions,active,created_at,updated_at FROM users ORDER BY name');
    return NextResponse.json(rows.map(parseUser));
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}

export async function POST(req: Request) {
  try {
    const me = await requireAuth();
    if (me.role !== 'owner') return NextResponse.json({ error: 'Sin permiso' }, { status: 403 });
    const { name, email, password, role } = await req.json();
    if (!name||!email||!password) return NextResponse.json({ error: 'Nombre, email y contraseña requeridos' }, { status: 400 });
    const existing = await query('SELECT id FROM users WHERE email=?',[email.toLowerCase().trim()]);
    if (existing.length) return NextResponse.json({ error: 'El correo ya está registrado' }, { status: 409 });
    const id = randomUUID(); const hash = await bcrypt.hash(password, 12); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
    await execute('INSERT INTO users (id,name,email,password_hash,role,permissions,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)',
      [id,name,email.toLowerCase().trim(),hash,role??'seller','[]',ts,ts]);
    const rows = await query<Record<string,unknown>>('SELECT id,name,email,role,permissions,active,created_at FROM users WHERE id=?',[id]);
    return NextResponse.json(parseUser(rows[0]),{status:201});
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); console.error(e); return NextResponse.json({error:'Error interno'},{status:500}); }
}
