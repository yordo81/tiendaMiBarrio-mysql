export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { handle, ok } from '@/lib/api-helpers';

// ── Perfil del usuario autenticado ───────────────────────────────
// Se resuelve desde la base de datos (requireAuth) para que los datos
// devueltos estén siempre frescos: rol, permisos y pos_id (caja asociada)
// reflejan la última actualización aunque la cookie de sesión sea anterior.

export const GET = handle(async () => {
  const user = await requireAuth();
  return ok({ user });
});
