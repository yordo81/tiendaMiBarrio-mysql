export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, transaction } from '@/lib/db/mysql';
import { handle, ok, err } from '@/lib/api-helpers';
import { getBusinessSettings } from '@/lib/settings-server';
import { nowUtc } from '@/lib/shift-time';
const randomUUID = () => crypto.randomUUID();

// ── API de Turnos de caja (por punto de venta) ───────────────────
// Solo tiene sentido cuando settings.work_mode = 'shifts'.
// GET:  cajas, turnos abiertos (uno por caja) e historial de cerrados
// POST: abrir un turno con fondo inicial en una caja específica
//
// Validaciones de apertura (dentro de una transacción con candado):
//   A) No puede haber OTRO turno abierto en la misma caja.
//   B) No puede existir ningún turno de la caja con opened_at igual o
//      posterior al nuevo (evita abrir un turno "hacia atrás" cuando
//      se atrasa el reloj del servidor o se reutiliza una fecha vieja).

export const GET = handle(async () => {
  await requireAuth();
  // Solo cajas activas: las desactivadas no pueden abrir turnos ni deben
  // aparecer en los selectores de ventas, gastos y compras.
  const pos = await query(
    `SELECT p.id, p.name, p.active, l.name AS location_name
     FROM pos p
     LEFT JOIN locations l ON l.id = p.location_id
     WHERE p.active = 1
     ORDER BY p.name`
  );
  // Turnos abiertos: puede haber uno por caja (el resto ya está validado)
  const open = await query(
    `SELECT s.*, u.name AS user_name, p.name AS pos_name
     FROM shifts s
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN pos p ON p.id = s.pos_id
     WHERE s.status = 'open'
     ORDER BY s.opened_at DESC`
  );
  // Historial: solo turnos cerrados (los abiertos ya van en `open`)
  const shifts = await query(
    `SELECT s.*, u.name AS user_name, cu.name AS closed_by_name, p.name AS pos_name
     FROM shifts s
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN users cu ON cu.id = s.closed_by
     LEFT JOIN pos p ON p.id = s.pos_id
     WHERE s.status = 'closed'
     ORDER BY s.opened_at DESC LIMIT 20`
  );
  return ok({ pos, open, shifts });
});

export const POST = handle(async (req: Request) => {
  const user = await requireAuth();
  // Cualquier usuario autenticado puede abrir un turno en una caja:
  // el vendedor lo necesita para poder vender en modo turnos.

  const settings = await getBusinessSettings();
  if (settings.work_mode !== 'shifts') {
    return err('El sistema está configurado para trabajar por días. Activa el modo por turnos en Configuración.');
  }

  const body = await req.json();
  const posId = String(body.pos_id ?? '').trim();
  if (!posId) return err('Debes seleccionar la caja (punto de venta) donde abrirás el turno');

  const openingCash = Number(body.opening_cash ?? 0);
  if (isNaN(openingCash) || openingCash < 0) return err('El fondo inicial debe ser un monto válido');

  const id = randomUUID();
  const ts = nowUtc();
  const notes = body.notes ? String(body.notes).trim().slice(0, 500) : null;

  // Transacción con candado sobre la fila de la caja: serializa las
  // aperturas de la MISMA caja (dos peticiones simultáneas no pueden
  // pasar ambas la comprobación) y valida fecha y turno abierto.
  const outcome = await transaction<{ error?: string }>(async (conn) => {
    const [posRows] = await conn.execute('SELECT id, name FROM pos WHERE id = ? AND active = 1 FOR UPDATE', [posId]);
    const pos = (posRows as { id: string; name: string }[])[0];
    if (!pos) return { error: 'La caja seleccionada no existe o está desactivada' };

    // A) No abrir dos turnos a la vez en la misma caja
    const [openRows] = await conn.execute(
      "SELECT id FROM shifts WHERE status = 'open' AND pos_id = ? LIMIT 1",
      [posId]
    );
    if ((openRows as unknown[]).length > 0) {
      return { error: `Ya hay un turno abierto en ${pos.name}. Ciérralo antes de abrir uno nuevo.` };
    }

    // B) No abrir un turno con fecha anterior o igual a otro de la caja
    // (protege contra reloj del servidor atrasado o fechas reutilizadas)
    const [laterRows] = await conn.execute(
      'SELECT id FROM shifts WHERE pos_id = ? AND opened_at >= ? LIMIT 1',
      [posId, ts]
    );
    if ((laterRows as unknown[]).length > 0) {
      return { error: `No se puede abrir un turno con fecha anterior o igual a otro turno de ${pos.name}. Verifica la hora del servidor.` };
    }

    await conn.execute(
      `INSERT INTO shifts (id, user_id, pos_id, opened_at, opening_cash, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      [id, user.id, posId, ts, openingCash, notes, ts]
    );
    return {};
  });

  if (outcome.error) return err(outcome.error);

  return ok({ shift: await queryOne('SELECT * FROM shifts WHERE id = ?', [id]) }, 201);
});
