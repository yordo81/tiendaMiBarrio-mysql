export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import * as bcrypt from 'bcryptjs';
import { queryOne } from '@/lib/db/mysql';
import { getSession } from '@/lib/auth/session';
import type { AppUser } from '@/types';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) return NextResponse.json({ error: 'Email y contraseña requeridos' }, { status: 400 });

    const row = await queryOne<{ id:string; name:string; email:string; password_hash:string; role:string; permissions:string; active:boolean }>(
      'SELECT * FROM users WHERE email = ? AND active = 1 LIMIT 1', [email.toLowerCase().trim()]
    );
    if (!row || !(await bcrypt.compare(password, row.password_hash)))
      return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 });

    const permissions = typeof row.permissions === 'string' ? JSON.parse(row.permissions) : (row.permissions ?? []);
    const user: AppUser = { id: row.id, name: row.name, email: row.email, role: row.role as AppUser['role'], permissions, active: Boolean(row.active), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const session = await getSession();
    session.user = user;
    await session.save();
    return NextResponse.json({ user });
  } catch (e) { console.error(e); return NextResponse.json({ error: 'Error interno' }, { status: 500 }); }
}
