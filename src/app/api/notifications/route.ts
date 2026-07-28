export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';
import { handle, ok } from '@/lib/api-helpers';

// ── List Notifications ──────────────────────────────────────────────────────
// Devuelve todas las notificaciones con filtros opcionales.
// Query params:
//   ?dismissed=0|1|all    (defecto: 0 — solo activas)
//   ?severity=critical|warning|info|success  (opcional)
//   ?limit=N              (defecto: 50)
//   ?offset=N             (defecto: 0)

export const GET = handle(async (req: Request) => {
  await requireAuth();
  const url = new URL(req.url);
  const dismissedParam = url.searchParams.get('dismissed') ?? '0';
  const severity = url.searchParams.get('severity') ?? '';
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);

  let whereClause: string;
  const params: (string | number)[] = [];

  if (dismissedParam === 'all') {
    whereClause = '1=1';
  } else if (dismissedParam === '1') {
    whereClause = 'dismissed = 1';
  } else {
    whereClause = 'dismissed = 0';
  }

  if (severity && ['critical', 'warning', 'info', 'success'].includes(severity)) {
    whereClause += ' AND severity = ?';
    params.push(severity);
  }

  // Total count
  const countResult = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM notification_logs WHERE ${whereClause}`,
    params
  );
  const total = countResult[0]?.total ?? 0;

  // Fetch records — LIMIT y OFFSET se interpolan directamente (ya validados como enteros seguros)
  const notifications = await query<{
    id: string; type: string; title: string; message: string;
    severity: string; product_id: string | null;
    created_at: string; read_at: string | null;
  }>(
    `SELECT id, type, title, message, severity, product_id, created_at, read_at
     FROM notification_logs
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return ok({ notifications, total, limit, offset });
});
