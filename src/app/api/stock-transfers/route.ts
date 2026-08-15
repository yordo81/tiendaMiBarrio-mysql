export const dynamic = 'force-dynamic';
import { query, transaction } from '@/lib/db/mysql';
import { handle, ok, err, requireRole } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

export const GET = handle(async () => {
  await requireRole('owner', 'admin', 'warehouse');
  const rows = await query(`
    SELECT st.*,
      fl.name AS from_location_name, tl.name AS to_location_name,
      p.name AS product_name, p.unit, u.name AS user_name
    FROM stock_transfers st
    LEFT JOIN locations fl ON fl.id=st.from_location_id
    LEFT JOIN locations tl ON tl.id=st.to_location_id
    LEFT JOIN products p ON p.id=st.product_id
    LEFT JOIN users u ON u.id=st.user_id
    ORDER BY st.created_at DESC LIMIT 100`);
  return ok(rows);
});

export const POST = handle(async (req: Request) => {
  const sessionUser = await requireRole('owner', 'admin', 'warehouse');
  const body = await req.json();
  const { from_location_id, to_location_id, notes } = body;

  // Soporta el formato múltiple `items: [{ product_id, quantity }]` y el
  // formato previo de un solo producto (product_id + quantity).
  const rawItems = Array.isArray(body.items) && body.items.length > 0
    ? body.items
    : (body.product_id && body.quantity ? [{ product_id: body.product_id, quantity: body.quantity }] : []);

  if (!from_location_id || !to_location_id)
    return err('Datos inválidos');
  if (from_location_id === to_location_id)
    return err('Origen y destino no pueden ser iguales');
  if (rawItems.length === 0)
    return err('Agrega al menos un producto');

  // Normalizar y validar ítems; los productos duplicados se fusionan sumando cantidades
  const itemsMap = new Map<string, number>();
  for (const raw of rawItems) {
    const pid = String(raw?.product_id ?? '');
    const qty = Number(raw?.quantity);
    if (!pid || !isFinite(qty) || qty <= 0)
      return err('Cantidad inválida en uno de los productos');
    itemsMap.set(pid, (itemsMap.get(pid) ?? 0) + qty);
  }
  const items = Array.from(itemsMap.entries()).map(([product_id, quantity]) => ({ product_id, quantity }));

  // Nombres de producto para mensajes de error claros
  const placeholders = items.map(() => '?').join(',');
  const productRows = await query<{ id: string; name: string }>(
    `SELECT id, name FROM products WHERE id IN (${placeholders})`,
    items.map(i => i.product_id)
  );
  const productNames = new Map(productRows.map(r => [String(r.id), String(r.name ?? '')]));

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  // Identificador del lote: todas las líneas de este traslado lo comparten,
  // lo que permite agruparlas de forma definitiva en el historial.
  const batchId = randomUUID();
  const transferIds: string[] = [];

  await transaction(async (conn) => {
    for (const item of items) {
      const [fromRow] = await conn.execute(
        'SELECT id,quantity FROM location_stock WHERE location_id=? AND product_id=?', [from_location_id, item.product_id]
      );
      const fromStock = (fromRow as unknown as { id: string; quantity: number }[])[0];
      if (!fromStock || fromStock.quantity < item.quantity)
        throw new Error(`Stock insuficiente en almacén origen: ${productNames.get(item.product_id) ?? 'producto'}`);

      const id = randomUUID();
      transferIds.push(id);

      await conn.execute(
        'INSERT INTO stock_transfers (id,from_location_id,to_location_id,product_id,quantity,batch_id,notes,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [id, from_location_id, to_location_id, item.product_id, item.quantity, batchId, notes ?? null, sessionUser.id, ts]
      );

      await conn.execute('UPDATE location_stock SET quantity=quantity-?,updated_at=? WHERE id=?', [item.quantity, ts, fromStock.id]);

      // Movimiento de salida del traslado: tipo propio 'traslado_out' para
      // que el módulo de Movimientos lo distinga y filtre correctamente.
      await conn.execute(
        'INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
        [randomUUID(), from_location_id, item.product_id, 'traslado_out', item.quantity, notes ? `Traslado: ${notes}` : 'Traslado a otro almacén', sessionUser.id, ts]
      );

      await conn.execute(
        'INSERT INTO location_stock (id,location_id,product_id,quantity,updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+?,updated_at=?',
        [randomUUID(), to_location_id, item.product_id, item.quantity, ts, item.quantity, ts]
      );

      // Movimiento de entrada del traslado: tipo propio 'traslado_in'
      await conn.execute(
        'INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
        [randomUUID(), to_location_id, item.product_id, 'traslado_in', item.quantity, notes ? `Traslado: ${notes}` : 'Traslado desde otro almacén', sessionUser.id, ts]
      );
    }
  });

  return ok({ id: transferIds[0] ?? null, count: transferIds.length }, 201);
});
