import { type NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // API routes are protected server-side by requireAuth() — no redirect needed here
  if (pathname.startsWith('/api')) return NextResponse.next();

  // Only redirect authenticated users from /auth/* pages to /dashboard
  // Do NOT redirect unauthenticated users to login — let them stay on the page
  // so they can continue working if their session expired due to inactivity.
  // API calls will gracefully handle 401 errors.
  const isAuthed = Boolean(request.cookies.get('tienda_session')?.value);
  if (isAuthed && pathname.startsWith('/auth')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|manifest\\.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
