export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
import { handle, ok } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();
export const GET = handle(async () => {
  await requireAuth(); return ok(await query('SELECT * FROM expense_categories ORDER BY name'));
});
export const POST = handle(async (req) => {
  await requireAuth(); const { name }=await req.json(); const id=randomUUID(); const ts=new Date().toISOString().slice(0,19).replace('T',' ');
  await execute('INSERT INTO expense_categories (id,name,created_at) VALUES (?,?,?)',[id,name,ts]);
  return ok((await query('SELECT * FROM expense_categories WHERE id=?',[id]))[0], 201);
});
