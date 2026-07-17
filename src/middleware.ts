import { type NextRequest, NextResponse } from 'next/server';

// ── Middleware de autenticación ────────────────────────────────────
// Protege las rutas del dashboard redirigiendo al login si no hay
// sesión activa. También redirige usuarios autenticados desde páginas
// de auth (/auth/*) hacia el dashboard.

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Verificar si existe la cookie de sesión (cifrada por iron-session)
  const sessionCookie = request.cookies.get('tienda_session')?.value;
  const isAuthed = Boolean(sessionCookie);

  // Proteger rutas del dashboard — requieren autenticación
  if (pathname.startsWith('/dashboard')) {
    if (!isAuthed) {
      const url = request.nextUrl.clone();
      url.pathname = '/auth/login';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Redirigir usuarios autenticados desde páginas de auth al dashboard
  if (isAuthed && pathname.startsWith('/auth')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Excluir archivos estáticos, imágenes, favicon, manifest y assets
    '/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|manifest\\.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
