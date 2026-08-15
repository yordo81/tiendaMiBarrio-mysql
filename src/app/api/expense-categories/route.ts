export const dynamic = 'force-dynamic';
import { requireRole } from '@/lib/api-helpers';
import { query, execute } from '@/lib/db/mysql';
import { handle, ok } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();
export const GET = handle(async () => {
  await requireRole('owner', 'admin'); return ok(await query('SELECT * FROM expense_categories ORDER BY name'));
});
export const POST = handle(async (req) => {
  await requireRole('owner', 'admin'); const { name }=await req.json(); const id=randomUUID(); const ts=new Date().toISOString().slice(0,19).replace('T',' ');
  await execute('INSERT INTO expense_categories (id,name,created_at) VALUES (?,?,?)',[id,name,ts]);
  return ok((await query('SELECT * FROM expense_categories WHERE id=?',[id]))[0], 201);
});
