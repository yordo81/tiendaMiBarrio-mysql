export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, transaction } from '@/lib/db/mysql';
import { handle, ok, err } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

export const GET = handle(async () => {
  await requireAuth();
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
  const sessionUser = await requireAuth();
  const { from_location_id, to_location_id, product_id, quantity, notes } = await req.json();
  if (!from_location_id||!to_location_id||!product_id||!quantity||quantity<=0)
    return err('Datos inválidos');
  if (from_location_id === to_location_id)
    return err('Origen y destino no pueden ser iguales');

  const id = randomUUID(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');

  await transaction(async (conn) => {
    const [fromRow] = await conn.execute(
      'SELECT id,quantity FROM location_stock WHERE location_id=? AND product_id=?', [from_location_id, product_id]
    );
    const fromStock = (fromRow as unknown as { id:string; quantity:number }[])[0];
    if (!fromStock || fromStock.quantity < quantity)
      throw new Error('Stock insuficiente en almacén origen');

    await conn.execute(
      'INSERT INTO stock_transfers (id,from_location_id,to_location_id,product_id,quantity,notes,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, from_location_id, to_location_id, product_id, quantity, notes??null, sessionUser.id, ts]
    );

    await conn.execute('UPDATE location_stock SET quantity=quantity-?,updated_at=? WHERE id=?',[quantity,ts,fromStock.id]);

    await conn.execute(
      'INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [randomUUID(), from_location_id, product_id, 'salida', quantity, notes ? `Traslado: ${notes}` : 'Traslado a otro almacén', sessionUser.id, ts]
    );

    await conn.execute(
      'INSERT INTO location_stock (id,location_id,product_id,quantity,updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+?,updated_at=?',
      [randomUUID(), to_location_id, product_id, quantity, ts, quantity, ts]
    );

    await conn.execute(
      'INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [randomUUID(), to_location_id, product_id, 'entrada', quantity, notes ? `Traslado: ${notes}` : 'Traslado desde otro almacén', sessionUser.id, ts]
    );
  });

  return ok({ id }, 201);
});
