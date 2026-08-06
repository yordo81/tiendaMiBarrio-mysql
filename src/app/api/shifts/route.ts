export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute } from '@/lib/db/mysql';
import { handle, ok, err, forbidden } from '@/lib/api-helpers';
import { getBusinessSettings } from '@/lib/settings-server';
const randomUUID = () => crypto.randomUUID();

// ── API de Turnos de caja ──────────────────────────────────────────
// Solo tiene sentido cuando settings.work_mode = 'shifts'.
// GET:  turno abierto + historial de turnos cerrados
// POST: abrir un turno con fondo inicial

function canManageShifts(role: string) {
  return role === 'owner' || role === 'admin';
}

export const GET = handle(async () => {
  await requireAuth();
  const current = await queryOne<Record<string, unknown>>(
    "SELECT s.*, u.name AS user_name FROM shifts s LEFT JOIN users u ON u.id = s.user_id WHERE s.status = 'open' ORDER BY s.opened_at DESC LIMIT 1"
  );
  // Historial: solo turnos cerrados (el abierto ya va en `current`)
  const shifts = await query(
    `SELECT s.*, u.name AS user_name, cu.name AS closed_by_name
     FROM shifts s
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN users cu ON cu.id = s.closed_by
     WHERE s.status = 'closed'
     ORDER BY s.opened_at DESC LIMIT 20`
  );
  return ok({ current: current ?? null, shifts });
});

export const POST = handle(async (req: Request) => {
  const user = await requireAuth();
  if (!canManageShifts(user.role)) return forbidden('Solo el dueño o administrador pueden gestionar turnos');

  const settings = await getBusinessSettings();
  if (settings.work_mode !== 'shifts') {
    return err('El sistema está configurado para trabajar por días. Activa el modo por turnos en Configuración.');
  }

  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1"
  );
  if (existing) return err('Ya hay un turno abierto. Ciérralo antes de abrir uno nuevo.');

  const body = await req.json();
  const openingCash = Number(body.opening_cash ?? 0);
  if (isNaN(openingCash) || openingCash < 0) return err('El fondo inicial debe ser un monto válido');

  const id = randomUUID();
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const notes = body.notes ? String(body.notes).trim().slice(0, 500) : null;

  await execute(
    `INSERT INTO shifts (id, user_id, opened_at, opening_cash, notes, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?)`,
    [id, user.id, ts, openingCash, notes, ts]
  );

  return ok({ shift: await queryOne('SELECT * FROM shifts WHERE id = ?', [id]) }, 201);
});
