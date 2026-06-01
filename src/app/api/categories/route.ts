export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
import { handle, ok } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

export const GET = handle(async () => {
  await requireAuth(); return ok(await query('SELECT * FROM categories ORDER BY name'));
});
export const POST = handle(async (req) => {
  await requireAuth();
  const { name, parent_id } = await req.json();
  const id = randomUUID(), ts = new Date().toISOString().slice(0,19).replace('T',' ');
  await execute('INSERT INTO categories (id,name,parent_id,created_at) VALUES (?,?,?,?)', [id, name, parent_id??null, ts]);
  return ok((await query('SELECT * FROM categories WHERE id=?',[id]))[0], 201);
});
export const PUT = handle(async (req) => {
  await requireAuth();
  const { id, name, parent_id } = await req.json();
  const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  await execute('UPDATE categories SET name=?, parent_id=?, updated_at=? WHERE id=?', [name, parent_id??null, ts, id]);
  return ok((await query('SELECT * FROM categories WHERE id=?',[id]))[0]);
});
export const DELETE = handle(async (req) => {
  await requireAuth();
  const { id } = await req.json();
  await execute('UPDATE products SET category_id=NULL WHERE category_id=?',[id]);
  await execute('DELETE FROM categories WHERE id=?',[id]);
  return ok({ok:true});
});
