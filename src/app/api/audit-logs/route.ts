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
  const entityType = searchParams.get('entity_type');  // expense | product | sale | customer | supplier | stock_movement
  const action = searchParams.get('action');           // delete | cancel | adjust
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500);

  let sql = 'SELECT * FROM audit_logs';
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (entityType) { conditions.push('entity_type = ?'); params.push(entityType); }
  if (action) { conditions.push('action = ?'); params.push(action); }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC LIMIT ' + limit;

  const rows = await query(sql, params);
  return ok(rows);
});
