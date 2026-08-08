export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';
import { handle, ok, forbidden } from '@/lib/api-helpers';

// ── API de Auditoría ───────────────────────────────────────────────
// GET: Listar logs de auditoría con filtros por tipo de entidad y acción
// Solo accesible para dueños y administradores

export const GET = handle(async (req) => {
  const sessionUser = await requireAuth();
  // Solo administradores y dueños pueden ver la auditoría
  if (sessionUser.role !== 'owner' && sessionUser.role !== 'admin') {
    return forbidden('No autorizado — solo administradores');
  }

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get('entity_type');  // expense | product | sale | customer | supplier | stock_movement | shift
  const action = searchParams.get('action');           // delete | cancel | adjust | open | close
  const from = searchParams.get('from');               // YYYY-MM-DD (inclusive)
  const to = searchParams.get('to');                   // YYYY-MM-DD (inclusive, día completo)
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500);

  let sql = 'SELECT * FROM audit_logs';
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (entityType) { conditions.push('entity_type = ?'); params.push(entityType); }
  if (action) { conditions.push('action = ?'); params.push(action); }
  if (from) { conditions.push('created_at >= ?'); params.push(localDayToUtc(from, false)); }
  if (to) { conditions.push('created_at <= ?'); params.push(localDayToUtc(to, true)); }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC LIMIT ' + limit;

  const rows = await query(sql, params);
  return ok(rows);
});

// ── Conversión de rango de fechas ─────────────────────────────────
// El calendario del usuario y la columna Fecha del módulo se muestran
// en hora LOCAL, pero created_at se guarda en UTC (logAudit usa
// toISOString). Convertimos el día local a su rango UTC equivalente
// (inicio del día / fin del día) para que el filtro coincida con lo
// que el usuario ve. Asume que el servidor corre en la zona horaria
// del negocio (instalación self-hosted), igual que el resto del sistema.
function localDayToUtc(dateStr: string, endOfDay: boolean): string {
  if (dateStr.length !== 10) return dateStr; // Ya viene con hora
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  return dt.toISOString().slice(0, 19).replace('T', ' ');
}
