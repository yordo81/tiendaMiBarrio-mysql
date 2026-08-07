export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute } from '@/lib/db/mysql';
import { validateLocationTypeOrDefault } from '@/lib/validate';
import { handle, ok, err } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

export const GET = handle(async () => {
  await requireAuth(); return ok(await query('SELECT * FROM locations WHERE active=1 ORDER BY name'));
});

export const POST = handle(async (req: Request) => {
  await requireAuth(); const body = await req.json(); const id = randomUUID(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  const validType = validateLocationTypeOrDefault(body.type);
  await execute('INSERT INTO locations (id,name,type,address,notes,active,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)',
    [id,body.name,validType,body.address??null,body.notes??null,ts,ts]);
  return ok((await query('SELECT * FROM locations WHERE id=?',[id]))[0], 201);
});

export const PUT = handle(async (req: Request) => {
  await requireAuth(); const { id,...body } = await req.json(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  const validType = validateLocationTypeOrDefault(body.type);
  await execute('UPDATE locations SET name=?,type=?,address=?,notes=?,updated_at=? WHERE id=?',
    [body.name,validType,body.address??null,body.notes??null,ts,id]);
  return ok((await query('SELECT * FROM locations WHERE id=?',[id]))[0]);
});

export const DELETE = handle(async (req: Request) => {
  await requireAuth(); const { id } = await req.json(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  // No se puede desactivar un punto de venta que tiene cajas asociadas:
  // primero hay que reasignar o desactivar sus cajas.
  const loc = await queryOne<{ id: string; name: string }>('SELECT id, name FROM locations WHERE id=?', [id]);
  if (loc) {
    const linked = await queryOne<{ id: string }>('SELECT id FROM pos WHERE location_id = ? LIMIT 1', [id]);
    if (linked) {
      return err(`No se puede desactivar "${loc.name}" porque tiene caja(s) asociada(s). Reasigna o desactiva sus cajas en la pestaña Cajas primero.`);
    }
  }
  await execute('UPDATE locations SET active=0,updated_at=? WHERE id=?',[ts,id]);
  return ok({ok:true});
});
