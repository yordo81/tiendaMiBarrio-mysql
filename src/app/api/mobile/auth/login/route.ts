export const dynamic = 'force-dynamic';
import * as bcrypt from 'bcryptjs';
import { queryOne } from '@/lib/db/mysql';
import { getSession } from '@/lib/auth/session';
import type { AppUser } from '@/types';
import { handle, ok, err } from '@/lib/api-helpers';

// ── Login para app móvil ─────────────────────────────────────────
// Misma lógica que el login web (iron-session), pero con response
// plano para que la app Flutter maneje la cookie automáticamente.
// La cookie HttpOnly se asigna en la respuesta y el cliente HTTP
// de Flutter (CookieJar) la reenviará en requests subsecuentes.

export const POST = handle(async (request: Request) => {
  const { email, password } = await request.json();
  if (!email || !password) return err('Email y contraseña requeridos');

  const row = await queryOne<{
    id: string; name: string; email: string;
    password_hash: string; role: string; permissions: string; active: boolean
  }>(
    'SELECT * FROM users WHERE email = ? AND active = 1 LIMIT 1',
    [email.toLowerCase().trim()]
  );
  if (!row || !(await bcrypt.compare(password, row.password_hash)))
    return err('Credenciales incorrectas', 401);

  const permissions = typeof row.permissions === 'string'
    ? JSON.parse(row.permissions)
    : (row.permissions ?? []);

  const user: AppUser = {
    id: row.id, name: row.name, email: row.email,
    role: row.role as AppUser['role'], permissions,
    active: Boolean(row.active),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const session = await getSession();
  session.user = { id: user.id, name: user.name, email: user.email, role: user.role, permissions: user.permissions, active: user.active };
  await session.save();

  return ok({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});
