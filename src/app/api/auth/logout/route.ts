export const dynamic = 'force-dynamic';
import { getSession } from '@/lib/auth/session';
import { handle, ok } from '@/lib/api-helpers';
export const POST = handle(async () => { const s = await getSession(); s.destroy(); return ok({ ok: true }); });
