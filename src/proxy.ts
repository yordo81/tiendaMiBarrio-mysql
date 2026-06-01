import { type NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthed = Boolean(request.cookies.get('tienda_session')?.value);
  if (pathname.startsWith('/api')) return NextResponse.next();
  if (!isAuthed && !pathname.startsWith('/auth')) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/login';
    return NextResponse.redirect(url);
  }
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
