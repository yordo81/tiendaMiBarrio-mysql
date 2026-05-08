export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireAuth();
    const [items, payments] = await Promise.all([
      query(`SELECT si.*,p.name AS product_name,p.unit FROM sale_items si LEFT JOIN products p ON p.id=si.product_id WHERE si.sale_id=?`,[id]),
      query('SELECT * FROM payments WHERE sale_id=?',[id]),
    ]);
    return NextResponse.json({ items, payments });
  } catch(e){ if(e instanceof Error&&e.message==='UNAUTHORIZED') return NextResponse.json({error:'No autorizado'},{status:401}); return NextResponse.json({error:'Error interno'},{status:500}); }
}
