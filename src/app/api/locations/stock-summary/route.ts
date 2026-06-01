export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';
import { handle, ok } from '@/lib/api-helpers';

export const GET = handle(async () => {
  await requireAuth();
  const rows = await query(
    `SELECT
      l.id AS location_id,
      l.name AS location_name,
      l.type AS location_type,
      COUNT(DISTINCT ls.product_id) AS product_count,
      COALESCE(SUM(ls.quantity), 0) AS total_quantity,
      COALESCE(SUM(ls.quantity * p.cost), 0) AS total_value
    FROM locations l
    LEFT JOIN location_stock ls ON ls.location_id = l.id
    LEFT JOIN products p ON p.id = ls.product_id AND p.active = 1
    WHERE l.active = 1
    GROUP BY l.id, l.name, l.type
    ORDER BY l.name`
  );
  return ok(rows);
});
