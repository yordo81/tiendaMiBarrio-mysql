export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, execute, queryOne } from '@/lib/db/mysql';
import { logAudit } from '@/lib/db/audit';
import { normalizePhone } from '@/lib/validate';
import { handle, ok, err, notFound, forbidden } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

export const GET = handle(async (req: Request) => {
  await requireAuth();
  const { searchParams } = new URL(req.url);
  const withDebt = searchParams.get('with_debt') === 'true';
  const includeInactive = searchParams.get('include_inactive') === 'true';
  const conditions: string[] = [];
  if (!includeInactive) conditions.push('active=1');
  if (withDebt) conditions.push('balance>0');
  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const sql = `SELECT * FROM customers ${where} ORDER BY active DESC, name`;
  return ok(await query(sql));
});

export const POST = handle(async (req: Request) => {
  await requireAuth(); const body=await req.json(); const id=randomUUID(); const ts=new Date().toISOString().slice(0,19).replace('T',' ');
  await execute('INSERT INTO customers (id,name,phone,notes,balance,active,created_at,updated_at) VALUES (?,?,?,?,0,1,?,?)',[id,body.name,normalizePhone(body.phone),body.notes??null,ts,ts]);
  return ok((await query('SELECT * FROM customers WHERE id=?',[id]))[0], 201);
});

export const PUT = handle(async (req: Request) => {
  await requireAuth(); const { id,...body }=await req.json(); const ts=new Date().toISOString().slice(0,19).replace('T',' ');
  const fields: string[] = [];
  const values: unknown[] = [];
  if (body.name !== undefined) { fields.push('name=?'); values.push(body.name); }
  if (body.phone !== undefined) { fields.push('phone=?'); values.push(normalizePhone(body.phone)); }
  if (body.notes !== undefined) { fields.push('notes=?'); values.push(body.notes ?? null); }
  if (body.active !== undefined) { fields.push('active=?'); values.push(body.active ? 1 : 0); }
  if (fields.length === 0) return ok((await query('SELECT * FROM customers WHERE id=?',[id]))[0]);
  fields.push('updated_at=?'); values.push(ts); values.push(id);
  await execute(`UPDATE customers SET ${fields.join(',')} WHERE id=?`, values);
  return ok((await query('SELECT * FROM customers WHERE id=?',[id]))[0]);
});

export const DELETE = handle(async (req: Request) => {
  const sessionUser = await requireAuth();
  if (sessionUser.role !== 'owner' && sessionUser.role !== 'admin') {
    return forbidden('No autorizado — solo administradores');
  }
  const { id } = await req.json();
  const customer = await queryOne<{ name: string; balance: number }>('SELECT name, balance FROM customers WHERE id=?', [id]);
  if (!customer) return notFound('Cliente no encontrado');
  const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  await execute('UPDATE customers SET active=0,updated_at=? WHERE id=?',[ts,id]);

  await logAudit({
    user_id: sessionUser.id,
    user_name: sessionUser.name,
    action: 'delete',
    entity_type: 'customer',
    entity_id: id,
    entity_name: customer.name,
    details: { balance: customer.balance },
  });

  return ok({ ok: true });
});
