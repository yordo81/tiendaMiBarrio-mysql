export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
import { handle, ok, err, forbidden } from '@/lib/api-helpers';
import { logAudit } from '@/lib/db/audit';
const randomUUID = () => crypto.randomUUID();

// ── API de Impresoras registradas ─────────────────────────────────
// GET  → lista las impresoras registradas (cualquier usuario autenticado,
//        porque el flujo de ventas necesita saber cuál imprime los tickets).
//        Con ?default=1 devuelve solo la impresora asignada a los tickets.
// POST → registra una impresora nueva (solo dueño).

export const GET = handle(async (req: Request) => {
  await requireAuth();
  const url = new URL(req.url);
  const onlyDefault = url.searchParams.get('default') === '1';
  const rows = await query(
    onlyDefault
      ? "SELECT * FROM printers WHERE is_default=1 ORDER BY created_at ASC LIMIT 1"
      : "SELECT * FROM printers ORDER BY is_default DESC, name ASC"
  );
  return ok({ printers: rows });
});

export const POST = handle(async (req: Request) => {
  const user = await requireAuth();
  if (user.role !== 'owner') return forbidden('Solo el dueño puede registrar impresoras');

  const body = await req.json();
  const vendorId = Number(body.vendor_id);
  const productId = Number(body.product_id);
  if (!Number.isInteger(vendorId) || vendorId <= 0 || !Number.isInteger(productId) || productId <= 0) {
    return err('Faltan los identificadores USB de la impresora (vendor/product)');
  }
  const serial = body.serial_number ? String(body.serial_number).slice(0, 255) : '';
  const name = String(body.name ?? 'Impresora térmica').trim().slice(0, 120) || 'Impresora térmica';

  // Ya existe una impresora para este dispositivo USB?
  const existing = await query(
    'SELECT id FROM printers WHERE device_key = CONCAT(?, ":", ?, ":", ?) LIMIT 1',
    [vendorId, productId, serial]
  );
  if (existing.length > 0) {
    return err('Esa impresora ya está registrada');
  }

  const id = randomUUID();
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const count = await query<{ c: number }>('SELECT COUNT(*) AS c FROM printers');
  const isDefault = body.is_default === true || Number(count[0]?.c ?? 0) === 0 ? 1 : 0;

  if (isDefault) {
    await execute('UPDATE printers SET is_default=0, updated_at=?', [ts]);
  }
  try {
    await execute(
      'INSERT INTO printers (id, name, vendor_id, product_id, serial_number, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, name, vendorId, productId, serial || null, isDefault, ts, ts]
    );
  } catch (e: any) {
    // La comprobación previa es solo orientativa: la clave única device_key es
    // la garantía real contra duplicados (carrera entre check e insert).
    if (e?.code === 'ER_DUP_ENTRY' || String(e?.message ?? '').toLowerCase().includes('duplicate')) {
      return err('Esa impresora ya está registrada');
    }
    throw e;
  }

  await logAudit({
    user_id: user.id,
    user_name: user.name,
    action: 'create',
    entity_type: 'printer',
    entity_id: id,
    entity_name: name,
    details: { vendor_id: vendorId, product_id: productId, serial, is_default: isDefault === 1 },
  });

  return ok((await query('SELECT * FROM printers WHERE id=?', [id]))[0], 201);
});
