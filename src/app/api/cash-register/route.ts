export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
import { handle, ok, err } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

// ── API de Caja (Contabilidad) ─────────────────────────────────────
// GET: Listar últimos 50 movimientos de caja
// POST: Registrar saldo inicial, ajuste o aporte de capital

// ── GET: Listar movimientos de caja ──
export const GET = handle(async () => {
  await requireAuth();
  const rows = await query(
    'SELECT * FROM cash_register ORDER BY date DESC LIMIT 50'
  );
  return ok(rows);
});

// ── POST: Registrar entrada en caja ──
// type puede ser: 'initial' (saldo inicial), 'adjustment' (ajuste manual),
// o 'capital' (aporte de capital del dueño)
export const POST = handle(async (req: Request) => {
  const sessionUser = await requireAuth();
  const { type, cash_amount, transfer_amount, notes, date } = await req.json();

  if (!type || !['initial', 'adjustment', 'capital'].includes(type)) {
    return err('Tipo inválido. Use: initial, adjustment o capital');
  }
  if (cash_amount == null || transfer_amount == null) {
    return err('Se requieren cash_amount y transfer_amount');
  }

  const id = randomUUID();
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const entryDate = date
    ? new Date(date).toISOString().slice(0, 19).replace('T', ' ')
    : ts;

  await execute(
    `INSERT INTO cash_register (id, type, cash_amount, transfer_amount, notes, date, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, type, Number(cash_amount), Number(transfer_amount), notes ?? null, entryDate, sessionUser.id, ts]
  );

  return ok(
    (await query('SELECT * FROM cash_register WHERE id=?', [id]))[0],
    201
  );
});
