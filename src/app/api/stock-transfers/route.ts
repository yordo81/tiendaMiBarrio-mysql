export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query, transaction } from '@/lib/db/mysql';
const randomUUID = () => crypto.randomUUID();

export async function GET() {
  try {
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
    return NextResponse.json(rows);
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}

export async function POST(req: Request) {
  try {
    const sessionUser = await requireAuth();
    const { from_location_id, to_location_id, product_id, quantity, notes } = await req.json();
    if (!from_location_id||!to_location_id||!product_id||!quantity||quantity<=0)
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    if (from_location_id === to_location_id)
      return NextResponse.json({ error: 'Origen y destino no pueden ser iguales' }, { status: 400 });

    const id = randomUUID(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');

    await transaction(async (conn) => {
      // Check origin stock
      const [fromRow] = await conn.execute(
        'SELECT id,quantity FROM location_stock WHERE location_id=? AND product_id=?', [from_location_id, product_id]
      );
      const fromStock = (fromRow as unknown as { id:string; quantity:number }[])[0];
      if (!fromStock || fromStock.quantity < quantity)
        throw new Error('Stock insuficiente en almacén origen');

      // Insert transfer record
      await conn.execute(
        'INSERT INTO stock_transfers (id,from_location_id,to_location_id,product_id,quantity,notes,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
        [id, from_location_id, to_location_id, product_id, quantity, notes??null, sessionUser.id, ts]
      );

      // Decrease origin
      await conn.execute('UPDATE location_stock SET quantity=quantity-?,updated_at=? WHERE id=?',[quantity,ts,fromStock.id]);

      // Increase destination (upsert)
      await conn.execute(
        'INSERT INTO location_stock (id,location_id,product_id,quantity,updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+?,updated_at=?',
        [randomUUID(), to_location_id, product_id, quantity, ts, quantity, ts]
      );
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch(e){
    if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401});
    if(e instanceof Error&&e.message==='Stock insuficiente en almacén origen') return NextResponse.json({error:e.message},{status:400});
    console.error(e); return NextResponse.json({error:'Error al realizar traslado'},{status:500});
  }
}
