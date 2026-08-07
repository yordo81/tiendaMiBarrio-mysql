export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute } from '@/lib/db/mysql';
import { handle, ok, err, forbidden } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

// ── API de Puntos de Venta (cajas) ───────────────────────────────
// GET:    listar todas las cajas con su punto de venta asociado
// POST:   crear una caja vinculada a un punto de venta (owner/admin)
// PUT:    editar nombre, punto de venta o activar/desactivar (owner/admin)
// DELETE: desactivar una caja (owner/admin)
//
// Reglas:
//   - Toda caja DEBE estar asociada a un almacén tipo 'store'
//     (punto de venta). No existen cajas sueltas.
//   - No se puede desactivar una caja con un turno abierto.

function canManage(role: string) {
  return role === 'owner' || role === 'admin';
}

const POS_COLS = `
  p.id, p.name, p.location_id, p.active, p.created_at,
  l.name AS location_name, l.type AS location_type`;

async function getPosWithLocation(id: string) {
  return queryOne(
    `SELECT ${POS_COLS} FROM pos p LEFT JOIN locations l ON l.id = p.location_id WHERE p.id = ?`,
    [id]
  );
}

// Valida el punto de venta (almacén tipo store activo) y el nombre; crea o
// actualiza la caja. Devuelve { error } o { pos }.
async function savePos(id: string | null, body: Record<string, unknown>) {
  const locationId = String(body.location_id ?? '').trim();
  if (!locationId) {
    return { error: 'Debes seleccionar el punto de venta (almacén tipo "Punto de venta") al que pertenece la caja' };
  }
  const loc = await queryOne<{ id: string; name: string }>(
    "SELECT id, name FROM locations WHERE id = ? AND type = 'store' AND active = 1",
    [locationId]
  );
  if (!loc) return { error: 'El punto de venta seleccionado no existe o no está activo' };

  // Si no se escribe nombre, se usa el del punto de venta
  const name = String(body.name ?? '').trim() || loc.name;
  if (name.length > 60) return { error: 'El nombre de la caja no puede superar los 60 caracteres' };

  if (id) {
    const existing = await queryOne<{ id: string; active: number }>('SELECT id, active FROM pos WHERE id = ?', [id]);
    if (!existing) return { error: 'La caja no existe' };

    const dup = await queryOne('SELECT id FROM pos WHERE name = ? AND id <> ?', [name, id]);
    if (dup) return { error: 'Ya existe una caja con ese nombre' };

    const newActive = body.active !== undefined ? (body.active ? 1 : 0) : Number(existing.active);
    if (Number(existing.active) === 1 && newActive === 0) {
      const openShift = await queryOne("SELECT id FROM shifts WHERE pos_id = ? AND status = 'open' LIMIT 1", [id]);
      if (openShift) {
        return { error: 'No se puede desactivar la caja porque tiene un turno abierto. Ciérralo antes.' };
      }
    }

    try {
      await execute('UPDATE pos SET name = ?, location_id = ?, active = ? WHERE id = ?', [name, locationId, newActive, id]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Duplicate entry')) return { error: 'Ya existe una caja con ese nombre' };
      throw e;
    }
    return { pos: await getPosWithLocation(id) };
  }

  // Crear
  const dup = await queryOne('SELECT id FROM pos WHERE name = ?', [name]);
  if (dup) return { error: 'Ya existe una caja con ese nombre' };

  const newId = randomUUID();
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const active = body.active !== undefined ? (body.active ? 1 : 0) : 1;
  try {
    await execute('INSERT INTO pos (id, name, location_id, active, created_at) VALUES (?, ?, ?, ?, ?)', [newId, name, locationId, active, ts]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Duplicate entry')) return { error: 'Ya existe una caja con ese nombre' };
    throw e;
  }
  return { pos: await getPosWithLocation(newId) };
}

export const GET = handle(async () => {
  await requireAuth();
  return ok(await query(
    `SELECT ${POS_COLS} FROM pos p LEFT JOIN locations l ON l.id = p.location_id ORDER BY p.active DESC, p.name`
  ));
});

export const POST = handle(async (req: Request) => {
  const user = await requireAuth();
  if (!canManage(user.role)) return forbidden('Solo el dueño o administrador pueden gestionar cajas');

  const body = await req.json();
  const out = await savePos(null, body);
  if (out.error) return err(out.error);
  return ok(out.pos, 201);
});

export const PUT = handle(async (req: Request) => {
  const user = await requireAuth();
  if (!canManage(user.role)) return forbidden('Solo el dueño o administrador pueden gestionar cajas');

  const body = await req.json();
  const id = String(body.id ?? '').trim();
  if (!id) return err('El id de la caja es obligatorio');

  const out = await savePos(id, body);
  if (out.error) return err(out.error);
  return ok(out.pos);
});

export const DELETE = handle(async (req: Request) => {
  const user = await requireAuth();
  if (!canManage(user.role)) return forbidden('Solo el dueño o administrador pueden gestionar cajas');

  const { id } = await req.json();
  if (!id) return err('El id de la caja es obligatorio');

  const existing = await queryOne<{ id: string; name: string }>('SELECT id, name FROM pos WHERE id = ?', [id]);
  if (!existing) return err('La caja no existe');

  const openShift = await queryOne("SELECT id FROM shifts WHERE pos_id = ? AND status = 'open' LIMIT 1", [id]);
  if (openShift) {
    return err(`No se puede desactivar "${existing.name}" porque tiene un turno abierto. Ciérralo antes.`);
  }

  await execute('UPDATE pos SET active = 0 WHERE id = ?', [id]);
  return ok({ ok: true });
});
