export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, transaction } from '@/lib/db/mysql';
import { handle, ok, err } from '@/lib/api-helpers';
import { getBusinessSettings } from '@/lib/settings-server';
import { nowUtc, utcToLocal } from '@/lib/shift-time';
import { getOpenShiftLiveSummary } from '@/lib/shift-summary';
import { logAudit } from '@/lib/db/audit';
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
    `SELECT p.id, p.name, p.active, p.location_id, l.name AS location_name
     FROM pos p
     LEFT JOIN locations l ON l.id = p.location_id
     WHERE p.active = 1
     ORDER BY p.name`
  );
  // Turnos abiertos: puede haber uno por caja (el resto ya está validado)
  const open = await query(
    `SELECT s.*, u.name AS user_name, p.name AS pos_name,
            DATE_FORMAT(s.opened_at, '%Y-%m-%d %H:%i:%s') AS opened_at_raw
     FROM shifts s
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN pos p ON p.id = s.pos_id
     WHERE s.status = 'open'
     ORDER BY s.opened_at DESC`
  );
  // Acumulado en vivo de cada turno abierto (ventas, efectivo y esperado)
  // para mostrarlo en el Topbar y en los widgets de turnos sin recargar.
  // Un fallo en el resumen no debe romper el listado de turnos abiertos.
  const openWithSummary = await Promise.all(
    open.map(async (s) => {
      try {
        return { ...s, summary: await getOpenShiftLiveSummary(s) };
      } catch {
        return { ...s, summary: null };
      }
    })
  );
  // Hora de apertura en hora local del negocio (las ventas se guardan en
  // hora local, así el historial del vendedor puede filtrar desde la apertura)
  const openLocal = openWithSummary.map((s: Record<string, unknown>) => ({
    ...s,
    opened_at_local: s.opened_at_raw ? utcToLocal(String(s.opened_at_raw)) : null,
  }));
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
  return ok({ pos, open: openLocal, shifts });
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

  // Un vendedor asociado a una caja solo puede abrir turnos en SU caja:
  // trabaja fijo en el punto de venta (almacén) que se le asignó.
  if (user.role === 'seller' && user.pos_id && user.pos_id !== posId) {
    return err('Solo puedes abrir turnos en la caja (punto de venta) a la que estás asociado');
  }

  const openingCash = Number(body.opening_cash ?? 0);
  if (isNaN(openingCash) || openingCash < 0) return err('El fondo inicial debe ser un monto válido');

  const id = randomUUID();
  const ts = nowUtc();
  const notes = body.notes ? String(body.notes).trim().slice(0, 500) : null;

  // Transacción con candado sobre la fila de la caja: serializa las
  // aperturas de la MISMA caja (dos peticiones simultáneas no pueden
  // pasar ambas la comprobación) y valida fecha y turno abierto.
  const outcome = await transaction<{ error?: string }>(async (conn) => {
    // Los turnos solo se abren en cajas vinculadas a un almacén tipo 'store'
    // (punto de venta activo): la caja suelta no puede abrir turnos.
    const [posRows] = await conn.execute(
      `SELECT p.id, p.name FROM pos p
       JOIN locations l ON l.id = p.location_id
       WHERE p.id = ? AND p.active = 1 AND l.type = 'store' AND l.active = 1
       FOR UPDATE`,
      [posId]
    );
    const pos = (posRows as { id: string; name: string }[])[0];
    if (!pos) {
      return { error: 'La caja seleccionada no existe, está desactivada o no pertenece a un punto de venta activo' };
    }

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

  // ── Auditoría: apertura de turno (best-effort: un fallo aquí no debe
  // ── ocultar el éxito de la apertura, que ya no se puede reintentar) ──
  try {
    const posName = (await query<{ name: string }>('SELECT name FROM pos WHERE id = ?', [posId]))[0]?.name ?? posId;
    await logAudit({
      user_id: user.id,
      user_name: user.name,
      action: 'open',
      entity_type: 'shift',
      entity_id: id,
      entity_name: posName,
      details: { pos_id: posId, pos_name: posName, opening_cash: openingCash, notes },
    });
  } catch (e) {
    console.error('[audit] apertura de turno', e);
  }

  return ok({ shift: await queryOne('SELECT * FROM shifts WHERE id = ?', [id]) }, 201);
});
