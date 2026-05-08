export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';

export async function GET(req: Request) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const locationId = searchParams.get('location_id');
    if (!locationId) return NextResponse.json({ error: 'location_id requerido' }, { status: 400 });
    const rows = await query(
      'SELECT ls.*, p.name AS product_name, p.unit FROM location_stock ls LEFT JOIN products p ON p.id=ls.product_id WHERE ls.location_id=? ORDER BY ls.quantity DESC',
      [locationId]
    );
    return NextResponse.json(rows);
  } catch(e) {
    if (e instanceof Error && e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401});
    return NextResponse.json({error:'Error interno'},{status:500});
  }
}
