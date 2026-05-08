export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
const randomUUID = () => crypto.randomUUID();

export async function GET(request: Request) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);
    const lowStock = searchParams.get('low_stock') === 'true';

    let sql = `
      SELECT p.*,
        c.name AS category_name,
        GROUP_CONCAT(DISTINCT s.id ORDER BY ps.is_preferred DESC SEPARATOR '||') AS supplier_ids,
        GROUP_CONCAT(DISTINCT s.name ORDER BY ps.is_preferred DESC SEPARATOR '||') AS supplier_names
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN product_suppliers ps ON ps.product_id = p.id
      LEFT JOIN suppliers s ON s.id = ps.supplier_id
      WHERE p.active = 1
    `;
    if (lowStock) sql += ' AND p.stock <= p.min_stock';
    sql += ' GROUP BY p.id ORDER BY p.name ASC';

    const rows = await query(sql);
    return NextResponse.json(rows.map((r: Record<string, unknown>) => ({
      ...r,
      active: Boolean(r.active),
      supplier_ids: r.supplier_ids ? String(r.supplier_ids).split('||') : [],
      supplier_names: r.supplier_names ? String(r.supplier_names).split('||') : [],
    })));
  } catch (e) {
    if (e instanceof Error && e.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    console.error(e); return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAuth();
    const body = await request.json();
    const id = randomUUID();
    const ts = new Date().toISOString().slice(0,19).replace('T',' ');

    await execute(
      `INSERT INTO products (id,name,description,category_id,sale_price,cost,stock,min_stock,unit,image_url,active,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`,
      [id, body.name, body.description??null, body.category_id??null,
       Number(body.sale_price??0), Number(body.cost??0), Number(body.stock??0),
       Number(body.min_stock??0), body.unit??'unidad', null, ts, ts]
    );

    // Link suppliers
    if (Array.isArray(body.supplier_ids)) {
      for (let i = 0; i < body.supplier_ids.length; i++) {
        await execute(
          'INSERT IGNORE INTO product_suppliers (id,product_id,supplier_id,is_preferred) VALUES (?,?,?,?)',
          [randomUUID(), id, body.supplier_ids[i], i === 0 ? 1 : 0]
        );
      }
    }

    const rows = await query(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?`, [id]);
    return NextResponse.json(rows[0], { status: 201 });
  } catch (e) {
    if (e instanceof Error && e.message === 'UNAUTHORIZED') return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    console.error(e); return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
