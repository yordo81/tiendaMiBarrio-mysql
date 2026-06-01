export const dynamic = 'force-dynamic';
import { getSessionUser } from '@/lib/auth/session';
import { handle, ok, err } from '@/lib/api-helpers';
export const GET = handle(async () => {
  const user = await getSessionUser();
  if (!user) return err('No autenticado', 401);
  return ok({ user });
});
