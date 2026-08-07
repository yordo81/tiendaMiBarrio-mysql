export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute } from '@/lib/db/mysql';
import { handle, ok, err, forbidden } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

// ── API de Puntos de Venta (cajas) ───────────────────────────────
// GET:  listar cajas activas
// POST: crear una nueva caja (owner/admin)
// Cada caja puede tener su propio turno de caja abierto (modo turnos).

function canManage(role: string) {
  return role === 'owner' || role === 'admin';
}

export const GET = handle(async () => {
  await requireAuth();
  return ok(await query('SELECT id, name, active FROM pos ORDER BY name'));
});

export const POST = handle(async (req: Request) => {
  const user = await requireAuth();
  if (!canManage(user.role)) return forbidden('Solo el dueño o administrador pueden gestionar cajas');

  const body = await req.json();
  const name = String(body.name ?? '').trim();
  if (!name) return err('El nombre de la caja es obligatorio');
  if (name.length > 60) return err('El nombre de la caja no puede superar los 60 caracteres');

  const existing = await queryOne<{ id: string }>('SELECT id FROM pos WHERE name = ?', [name]);
  if (existing) return err('Ya existe una caja con ese nombre');

  const id = randomUUID();
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  try {
    await execute('INSERT INTO pos (id, name, active, created_at) VALUES (?, ?, 1, ?)', [id, name, ts]);
  } catch (e) {
    // Dos peticiones simultáneas con el mismo nombre: el índice único protege
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Duplicate entry')) return err('Ya existe una caja con ese nombre');
    throw e;
  }

  return ok(await queryOne('SELECT id, name, active FROM pos WHERE id = ?', [id]), 201);
});
