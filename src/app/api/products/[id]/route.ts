export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
const randomUUID = () => crypto.randomUUID();

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireAuth();
    const body = await request.json();
    const ts = new Date().toISOString().slice(0,19).replace('T',' ');

    await execute(
      `UPDATE products SET name=?,description=?,category_id=?,sale_price=?,cost=?,stock=?,min_stock=?,unit=?,updated_at=? WHERE id=?`,
      [body.name, body.description??null, body.category_id??null, Number(body.sale_price), Number(body.cost),
       Number(body.stock), Number(body.min_stock), body.unit??'unidad', ts, id]
    );

    if (Array.isArray(body.supplier_ids)) {
      await execute('DELETE FROM product_suppliers WHERE product_id = ?', [id]);
      for (let i = 0; i < body.supplier_ids.length; i++) {
        await execute('INSERT IGNORE INTO product_suppliers (id,product_id,supplier_id,is_preferred) VALUES (?,?,?,?)',
          [randomUUID(), id, body.supplier_ids[i], i === 0 ? 1 : 0]);
      }
    }

    const rows = await query(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?`, [id]);
    return NextResponse.json(rows[0]);
  } catch (e) {
    if (e instanceof Error && e.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    console.error(e); return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireAuth();
    const ts = new Date().toISOString().slice(0,19).replace('T',' ');
    await execute('UPDATE products SET active=0, updated_at=? WHERE id=?', [ts, id]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
