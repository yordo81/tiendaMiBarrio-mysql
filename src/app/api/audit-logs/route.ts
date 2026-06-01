export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { query } from '@/lib/db/mysql';
import { handle, ok, forbidden } from '@/lib/api-helpers';

export const GET = handle(async (req) => {
  const sessionUser = await requireAuth();
  if (sessionUser.role !== 'owner' && sessionUser.role !== 'admin') {
    return forbidden('No autorizado — solo administradores');
  }

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get('entity_type');
  const action = searchParams.get('action');
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
