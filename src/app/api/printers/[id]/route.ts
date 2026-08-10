export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
import { handle, ok, err, forbidden, notFound } from '@/lib/api-helpers';
import { logAudit } from '@/lib/db/audit';

// ── API de Impresoras por ID ──────────────────────────────────────
// PUT   → renombra o asigna/desasigna la impresora de tickets (solo dueño)
// DELETE → elimina la impresora registrada (solo dueño)

export const PUT = handle(async (req: Request, ctx) => {
  const { id } = await ctx!.params;
  const user = await requireAuth();
  if (user.role !== 'owner') return forbidden('Solo el dueño puede modificar impresoras');

  const printer = await query<{ id: string; name: string; is_default: number }>('SELECT id, name, is_default FROM printers WHERE id=?', [id]);
  if (printer.length === 0) return notFound('Impresora no encontrada');

  const body = await req.json();
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const name = body.name !== undefined
    ? String(body.name).trim().slice(0, 120) || printer[0].name
    : printer[0].name;

  const makeDefault = body.is_default === true;
  const unsetDefault = body.is_default === false;

  if (makeDefault) {
    // Solo una impresora puede ser la de tickets
    await execute('UPDATE printers SET is_default=0, updated_at=?', [ts]);
    await execute('UPDATE printers SET name=?, is_default=1, updated_at=? WHERE id=?', [name, ts, id]);
  } else if (unsetDefault) {
    // Al desmarcar la impresora de tickets, otra pasa a ser la predeterminada
    // (mismo criterio que el DELETE). Si es la única, se rechaza para que el
    // sistema siempre tenga una impresora que emita los comprobantes.
    if (printer[0].is_default) {
      const others = await query<{ id: string }>('SELECT id FROM printers WHERE id<>? ORDER BY created_at ASC LIMIT 1', [id]);
      if (others.length === 0) return err('Al menos una impresora debe quedar como la de tickets');
      await execute('UPDATE printers SET is_default=1, updated_at=? WHERE id=?', [ts, others[0].id]);
    }
    await execute('UPDATE printers SET name=?, is_default=0, updated_at=? WHERE id=?', [name, ts, id]);
  } else {
    await execute('UPDATE printers SET name=?, updated_at=? WHERE id=?', [name, ts, id]);
  }

  await logAudit({
    user_id: user.id,
    user_name: user.name,
    action: 'update',
    entity_type: 'printer',
    entity_id: id,
    entity_name: name,
    details: { name, is_default: makeDefault },
  });

  return ok((await query('SELECT * FROM printers WHERE id=?', [id]))[0]);
});

export const DELETE = handle(async (_req: Request, ctx) => {
  const { id } = await ctx!.params;
  const user = await requireAuth();
  if (user.role !== 'owner') return forbidden('Solo el dueño puede eliminar impresoras');

  const printer = await query<{ id: string; name: string; is_default: number }>(
    'SELECT id, name, is_default FROM printers WHERE id=?', [id]
  );
  if (printer.length === 0) return notFound('Impresora no encontrada');

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await execute('DELETE FROM printers WHERE id=?', [id]);

  // Si se eliminó la impresora de tickets y quedan otras, promover la más antigua
  if (printer[0].is_default) {
    await execute(
      `UPDATE printers SET is_default=1, updated_at=? WHERE id=(
         SELECT id FROM (SELECT id FROM printers ORDER BY created_at ASC LIMIT 1) t
       )`,
      [ts]
    );
  }

  await logAudit({
    user_id: user.id,
    user_name: user.name,
    action: 'delete',
    entity_type: 'printer',
    entity_id: id,
    entity_name: printer[0].name,
  });

  return ok({ ok: true });
});
