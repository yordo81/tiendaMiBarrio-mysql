export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';
import { handle, ok, err } from '@/lib/api-helpers';

export const GET = handle(async (req) => {
  await requireAuth();
  const { searchParams } = new URL(req.url);
  const locationId = searchParams.get('location_id');
  if (!locationId) return err('location_id requerido');
  const rows = await query(
    'SELECT ls.*, p.name AS product_name, p.unit FROM location_stock ls LEFT JOIN products p ON p.id=ls.product_id WHERE ls.location_id=? ORDER BY ls.quantity DESC',
    [locationId]
  );
  return ok(rows);
});
