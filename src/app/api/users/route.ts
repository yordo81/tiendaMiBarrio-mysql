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
  // Dueño y administrador pueden listar usuarios (el admin solo para cambiar contraseñas)
  if (me.role !== 'owner' && me.role !== 'admin') return forbidden('Sin permiso');
  const rows = await query<Record<string,unknown>>(
    `SELECT u.id,u.name,u.email,u.role,u.permissions,u.active,u.pos_id,p.name AS pos_name,u.created_at,u.updated_at
     FROM users u LEFT JOIN pos p ON p.id = u.pos_id ORDER BY u.name`
  );
  return ok(rows.map(parseUser));
});

// Valida que la caja exista y esté activa.
// Devuelve { posId } con el id (o null para desvincular) o { error }.
async function resolvePosId(posId: unknown): Promise<{ posId: string | null } | { error: string }> {
  if (posId === undefined) return { posId: null }; // no viene en el payload
  const trimmed = String(posId ?? '').trim();
  if (!trimmed) return { posId: null };
  const pos = await query('SELECT id FROM pos WHERE id = ? AND active = 1', [trimmed]);
  if (!pos.length) return { error: 'La caja seleccionada no existe o está desactivada' };
  return { posId: trimmed };
}

export const POST = handle(async (req: Request) => {
  const me = await requireAuth();
  if (me.role !== 'owner') return forbidden('Sin permiso');
  const { name, email, password, role, pos_id } = await req.json();
  if (!name||!email||!password) return err('Nombre, email y contraseña requeridos');
  const existing = await query('SELECT id FROM users WHERE email=?',[email.toLowerCase().trim()]);
  if (existing.length) return err('El correo ya está registrado', 409);
  const pos = await resolvePosId(pos_id);
  if ('error' in pos) return err(pos.error);
  const id = randomUUID(); const hash = await bcrypt.hash(password, 12); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  const validRole = validateUserRoleOrDefault(role);
  await execute('INSERT INTO users (id,name,email,password_hash,role,pos_id,permissions,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)',
    [id,name,email.toLowerCase().trim(),hash,validRole,pos.posId,'[]',ts,ts]);
  const rows = await query<Record<string,unknown>>(
    `SELECT u.id,u.name,u.email,u.role,u.permissions,u.active,u.pos_id,p.name AS pos_name,u.created_at,u.updated_at
     FROM users u LEFT JOIN pos p ON p.id = u.pos_id WHERE u.id=?`,
    [id]
  );
  return ok(parseUser(rows[0]), 201);
});
