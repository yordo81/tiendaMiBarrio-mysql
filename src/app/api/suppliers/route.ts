export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, execute, queryOne } from '@/lib/db/mysql';
import { logAudit } from '@/lib/db/audit';
import { handle, ok, notFound, forbidden } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

export const GET = handle(async () => {
  await requireAuth(); return ok(await query('SELECT * FROM suppliers WHERE active=1 ORDER BY name'));
});
export const POST = handle(async (req: Request) => {
  await requireAuth(); const body=await req.json(); const id=randomUUID(); const ts=new Date().toISOString().slice(0,19).replace('T',' ');
  await execute('INSERT INTO suppliers (id,name,contact,phone,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',[id,body.name,body.contact??null,body.phone??null,body.notes??null,ts,ts]);
  return ok((await query('SELECT * FROM suppliers WHERE id=?',[id]))[0], 201);
});
export const PUT = handle(async (req: Request) => {
  await requireAuth(); const { id,...body }=await req.json(); const ts=new Date().toISOString().slice(0,19).replace('T',' ');
  await execute('UPDATE suppliers SET name=?,contact=?,phone=?,notes=?,updated_at=? WHERE id=?',[body.name,body.contact??null,body.phone??null,body.notes??null,ts,id]);
  return ok((await query('SELECT * FROM suppliers WHERE id=?',[id]))[0]);
});
export const DELETE = handle(async (req: Request) => {
  const sessionUser = await requireAuth();
  if (sessionUser.role !== 'owner' && sessionUser.role !== 'admin') {
    return forbidden('No autorizado — solo administradores');
  }
  const { id }=await req.json();
  const supplier = await queryOne<{ name: string }>('SELECT name FROM suppliers WHERE id=?', [id]);
  if (!supplier) return notFound('Proveedor no encontrado');
  const ts=new Date().toISOString().slice(0,19).replace('T',' ');
  await execute('UPDATE suppliers SET active=0,updated_at=? WHERE id=?',[ts,id]);

  await logAudit({
    user_id: sessionUser.id,
    user_name: sessionUser.name,
    action: 'delete',
    entity_type: 'supplier',
    entity_id: id,
    entity_name: supplier.name,
  });

  return ok({ok:true});
});
