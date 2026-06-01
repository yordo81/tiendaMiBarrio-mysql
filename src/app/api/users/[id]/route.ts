export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
import { validateUserRole } from '@/lib/validate';
import { handle, ok, err, forbidden } from '@/lib/api-helpers';
import * as bcrypt from 'bcryptjs';

export const PUT = handle(async (req: Request, ctx) => {
  const { id } = await ctx!.params;
  const me = await requireAuth();
  if (me.role !== 'owner') return forbidden('Sin permiso');
  const body = await req.json();
  const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  const fields: string[] = []; const values: unknown[] = [];
  if (body.name !== undefined)        { fields.push('name=?');        values.push(body.name); }
  if (body.role !== undefined)        { fields.push('role=?');        values.push(validateUserRole(body.role)); }
  if (body.active !== undefined)      { fields.push('active=?');      values.push(body.active?1:0); }
  if (body.permissions !== undefined) { fields.push('permissions=?'); values.push(JSON.stringify(body.permissions)); }
  if (body.password)                  { fields.push('password_hash=?'); values.push(await bcrypt.hash(body.password,12)); }
  if (!fields.length) return err('Nada que actualizar');
  fields.push('updated_at=?'); values.push(ts); values.push(id);
  await execute(`UPDATE users SET ${fields.join(',')} WHERE id=?`, values);
  const rows = await query<Record<string,unknown>>('SELECT id,name,email,role,permissions,active,created_at,updated_at FROM users WHERE id=?',[id]);
  const r = rows[0];
  return ok({ ...r, active: Boolean(r.active), permissions: typeof r.permissions==='string'?JSON.parse(r.permissions as string):(r.permissions??[]) });
});
