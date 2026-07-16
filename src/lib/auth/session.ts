import { getIronSession, type IronSession } from 'iron-session';
import { cookies } from 'next/headers';
import type { AppUser, Permission } from '@/types';
import { queryOne } from '@/lib/db/mysql';

// ── Gestión de sesiones con iron-session ──────────────────────────
// Las sesiones se almacenan en cookies cifradas del lado del servidor.
// No se usa JWT ni localStorage.

export interface SessionData {
  user?: Pick<AppUser, 'id' | 'name' | 'email' | 'role' | 'permissions' | 'active'>;
}

const sessionOptions = {
  password: process.env.SESSION_SECRET ?? 'fallback_secret_change_in_production_32chars!!',
  cookieName: 'tienda_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,   // No accesible desde JavaScript del navegador
    maxAge: 60 * 60 * 24 * 7,  // 7 días
  },
};

// Obtiene la sesión desde la cookie (servidor)
export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

// Retorna el usuario de la sesión o null si no hay sesión activa
export async function getSessionUser(): Promise<SessionData['user'] | null> {
  const session = await getSession();
  return session.user ?? null;
}

/**
 * Verifica que el usuario esté autenticado **y** que aún exista en la base de datos.
 * Si el usuario fue eliminado después de crear la sesión, lanza UNAUTHORIZED.
 * Esto evita errores de FK constraint (como location_movements.user_id → users.id)
 * y asegura que los permisos estén siempre actualizados.
 */
export async function requireAuth(): Promise<NonNullable<SessionData['user']>> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) throw new Error('UNAUTHORIZED');

  // Verificar que el usuario aún exista y esté activo en la BD
  // Esto previene errores de foreign key al eliminar usuarios
  const dbUser = await queryOne<{ id: string; name: string; email: string; role: string; permissions: string; active: boolean }>(
    'SELECT id, name, email, role, permissions, active FROM users WHERE id = ? AND active = 1 LIMIT 1',
    [sessionUser.id]
  );
  if (!dbUser) {
    // El usuario fue eliminado o desactivado — limpiar sesión y rechazar
    const session = await getSession();
    session.destroy();
    await session.save();
    throw new Error('UNAUTHORIZED');
  }

  // Retornar datos frescos desde la BD (incluyendo rol/permisos actualizados)
  let permissions: Permission[] = [];
  try {
    permissions = typeof dbUser.permissions === 'string' ? JSON.parse(dbUser.permissions) : (dbUser.permissions ?? []);
  } catch {
    permissions = [];
  }
  return {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role as AppUser['role'],
    permissions,
    active: Boolean(dbUser.active),
  };
}
