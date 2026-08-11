export const dynamic = 'force-dynamic';
import * as bcrypt from 'bcryptjs';
import { requireAuth } from '@/lib/auth/session';
import { queryOne, execute } from '@/lib/db/mysql';
import { handle, ok, err } from '@/lib/api-helpers';
import { logAudit } from '@/lib/db/audit';

// ── Cambio de contraseña del propio usuario ────────────────────────
// POST: Cualquier usuario autenticado puede cambiar SU contraseña.
// Verifica la contraseña actual antes de actualizar el hash.
// (El dueño puede cambiar la contraseña de otros usuarios vía PUT /api/users/[id]).

export const POST = handle(async (request: Request) => {
  const me = await requireAuth();
  const { current_password, new_password } = await request.json();

  if (!current_password) return err('Indica tu contraseña actual');
  if (!new_password || String(new_password).length < 6) return err('La nueva contraseña debe tener al menos 6 caracteres');

  const row = await queryOne<{ password_hash: string }>(
    'SELECT password_hash FROM users WHERE id = ? LIMIT 1',
    [me.id]
  );
  if (!row) return err('Usuario no encontrado', 404);

  const valid = await bcrypt.compare(String(current_password), row.password_hash);
  if (!valid) return err('La contraseña actual no es correcta', 400);

  const hash = await bcrypt.hash(String(new_password), 12);
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await execute('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, ts, me.id]);

  // Registro de auditoría: quién cambió la contraseña (en este flujo, el mismo usuario)
  await logAudit({
    user_id: me.id,
    user_name: me.name,
    action: 'password_change',
    entity_type: 'user',
    entity_id: me.id,
    entity_name: me.name,
    details: { changed_by: 'self' },
  });

  return ok({ ok: true });
});
