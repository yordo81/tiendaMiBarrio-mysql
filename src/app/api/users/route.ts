export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
import { validateUserRoleOrDefault } from '@/lib/validate';
import { handle, ok, err, forbidden } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();
import * as bcrypt from 'bcryptjs';

function parseUser(r: Record<string,unknown>) {
  return { ...r, active: Boolean(r.active), permissions: typeof r.permissions==='string'?JSON.parse(r.permissions as string):(r.permissions??[]) };
}

export const GET = handle(async () => {
  const me = await requireAuth();
  if (me.role !== 'owner') return forbidden('Sin permiso');
  const rows = await query<Record<string,unknown>>('SELECT id,name,email,role,permissions,active,created_at,updated_at FROM users ORDER BY name');
  return ok(rows.map(parseUser));
});

export const POST = handle(async (req: Request) => {
  const me = await requireAuth();
  if (me.role !== 'owner') return forbidden('Sin permiso');
  const { name, email, password, role } = await req.json();
  if (!name||!email||!password) return err('Nombre, email y contraseña requeridos');
  const existing = await query('SELECT id FROM users WHERE email=?',[email.toLowerCase().trim()]);
  if (existing.length) return err('El correo ya está registrado', 409);
  const id = randomUUID(); const hash = await bcrypt.hash(password, 12); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  const validRole = validateUserRoleOrDefault(role);
  await execute('INSERT INTO users (id,name,email,password_hash,role,permissions,active,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)',
    [id,name,email.toLowerCase().trim(),hash,validRole,'[]',ts,ts]);
  const rows = await query<Record<string,unknown>>('SELECT id,name,email,role,permissions,active,created_at FROM users WHERE id=?',[id]);
  return ok(parseUser(rows[0]), 201);
});
