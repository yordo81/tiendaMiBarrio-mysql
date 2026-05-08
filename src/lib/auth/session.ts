import { getIronSession, type IronSession } from 'iron-session';
import { cookies } from 'next/headers';
import type { AppUser } from '@/types';

export interface SessionData {
  user?: Pick<AppUser, 'id' | 'name' | 'email' | 'role' | 'permissions' | 'active'>;
}

const sessionOptions = {
  password: process.env.SESSION_SECRET ?? 'fallback_secret_change_in_production_32chars!!',
  cookieName: 'tienda_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7,
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export async function getSessionUser(): Promise<SessionData['user'] | null> {
  const session = await getSession();
  return session.user ?? null;
}

export async function requireAuth(): Promise<NonNullable<SessionData['user']>> {
  const user = await getSessionUser();
  if (!user) throw new Error('UNAUTHORIZED');
  return user;
}
