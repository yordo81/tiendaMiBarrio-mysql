export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { execute } from '@/lib/db/mysql';
import { handle, ok, err } from '@/lib/api-helpers';

// ── Dismiss Notification ──────────────────────────────────────────
// Marca una notificación como leída/descartada.
// POST: { id: string } o { all: true } para descartar todas

export const POST = handle(async (req: Request) => {
  await requireAuth();
  const { id, all } = await req.json();
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  if (all === true) {
    await execute(
      'UPDATE notification_logs SET dismissed = 1, read_at = ? WHERE dismissed = 0',
      [ts]
    );
    return ok({ dismissed: 'all' });
  }

  if (!id) {
    return err('Se requiere id o all: true');
  }

  await execute(
    'UPDATE notification_logs SET dismissed = 1, read_at = ? WHERE id = ?',
    [ts, id]
  );

  return ok({ dismissed: id });
});

// ── Delete Notification (permanente) ──────────────────────────────
// Elimina físicamente notificaciones de la base de datos.
// DELETE: { id: string } o { all: true } para eliminar todas las descartadas

export const DELETE = handle(async (req: Request) => {
  await requireAuth();
  const { id, all } = await req.json();

  if (all === true) {
    await execute('DELETE FROM notification_logs WHERE dismissed = 1');
    return ok({ deleted: 'all' });
  }

  if (!id) {
    return err('Se requiere id o all: true');
  }

  await execute('DELETE FROM notification_logs WHERE id = ?', [id]);

  return ok({ deleted: id });
});
