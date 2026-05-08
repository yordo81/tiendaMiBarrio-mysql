export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, execute, transaction } from '@/lib/db/mysql';
import { randomUUID } from 'crypto';

export async function GET(req: Request) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const locationId = searchParams.get('location_id');
    if (!locationId) return NextResponse.json({ error: 'location_id requerido' }, { status: 400 });

    const rows = await query(`
      SELECT lm.*, p.name AS product_name, u.name AS user_name
      FROM location_movements lm
      LEFT JOIN products p ON p.id = lm.product_id
      LEFT JOIN users u ON u.id = lm.user_id
      WHERE lm.location_id = ?
      ORDER BY lm.created_at DESC LIMIT 50
    `, [locationId]);
    return NextResponse.json(rows);
  } catch(e) {
    if (e instanceof Error && e.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const sessionUser = await requireAuth();
    const { location_id, product_id, type, quantity, notes } = await req.json();

    if (!location_id || !product_id || !type || quantity <= 0) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 });
    }
    if (!['entrada', 'salida', 'ajuste'].includes(type)) {
      return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 });
    }

    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

    await transaction(async (conn) => {
      // Get current location stock
      const [rows] = await conn.execute(
        'SELECT id, quantity FROM location_stock WHERE location_id=? AND product_id=? LIMIT 1',
        [location_id, product_id]
      );
      const existing = (rows as { id: string; quantity: number }[])[0];
      const curQty = existing?.quantity ?? 0;

      let newQty: number;
      if (type === 'ajuste') {
        newQty = quantity;
      } else if (type === 'entrada') {
        newQty = curQty + quantity;
      } else {
        // salida
        if (curQty < quantity) throw new Error(`Stock insuficiente. Disponible: ${curQty}`);
        newQty = curQty - quantity;
      }

      // Upsert location_stock
      if (existing) {
        await conn.execute('UPDATE location_stock SET quantity=?, updated_at=? WHERE id=?', [newQty, ts, existing.id]);
      } else {
        if (type === 'salida') throw new Error('Este producto no tiene stock en este almacén');
        await conn.execute(
          'INSERT INTO location_stock (id,location_id,product_id,quantity,updated_at) VALUES (?,?,?,?,?)',
          [randomUUID(), location_id, product_id, newQty, ts]
        );
      }

      // Record movement
      await conn.execute(
        'INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
        [randomUUID(), location_id, product_id, type, quantity, notes || null, sessionUser.id, ts]
      );

      // If entrada: also deduct from global product stock
      if (type === 'entrada') {
        await conn.execute('UPDATE products SET stock=GREATEST(0,stock-?),updated_at=? WHERE id=?', [quantity, ts, product_id]);
        // Also log a global stock movement
        const [locRows] = await conn.execute('SELECT name FROM locations WHERE id=?', [location_id]);
        const locName = ((locRows as {name:string}[])[0])?.name ?? location_id;
        await conn.execute(
          "INSERT INTO stock_movements (id,product_id,type,quantity,reason,user_id,date,created_at) VALUES (?,?,'out',?,?,?,?,?)",
          [randomUUID(), product_id, quantity, `Carga a almacén: ${locName}`, sessionUser.id, ts, ts]
        );
      }
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch(e) {
    if (e instanceof Error && e.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (e instanceof Error && e.message.startsWith('Stock insuficiente')) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof Error && e.message.startsWith('Este producto')) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
