import { type NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import { sessionOptions } from '@/lib/auth/config';
import { findActiveUserCached } from '@/lib/auth/user-active';
import { showReservationsEnabled } from '@/lib/settings-server';

// ── Proxy de autenticación (Next.js 16) ────────────────────────────
// En Next.js 16 este archivo se renombró de middleware.ts a proxy.ts y
// corre en el runtime de Node.js por defecto (por eso puede consultar
// la BD directamente con mysql2).
//
// Protege las rutas del dashboard redirigiendo al login si no hay
// sesión activa. También redirige usuarios autenticados desde páginas
// de auth (/auth/*) hacia el dashboard.
//
// La sesión se valida en dos capas:
//   1. Descifrar la cookie con iron-session (mismo password y TTL), para
//      detectar cookies expiradas/corruptas que siguen presentes en el
//      navegador pero ya no son válidas.
//   2. Verificar en la BD que el usuario de la sesión siga existiendo y
//      esté activo, para que un usuario desactivado/eliminado tampoco
//      pueda cargar el HTML del dashboard. Esta verificación usa un
//      caché TTL corto (findActiveUserCached) para no añadir latencia
//      si la BD es remota.
//
// Si la BD está caída se deja pasar la petición (fail-open) y son las
// APIs las que reportan el error (500); así no se bloquea a todos los
// usuarios durante una caída puntual.

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Página de entrada: si el módulo de reservaciones está desactivado en
  // la configuración, se redirige a /inicio sin esperar al cliente. El
  // valor viene cacheado con TTL corto (showReservationsEnabled) y ya es
  // fail-open por defecto (nunca lanza); el try/catch protege al resto de
  // rutas ante cualquier error inesperado aquí.
  if (pathname === '/') {
    try {
      if (!(await showReservationsEnabled())) {
        const url = request.nextUrl.clone();
        url.pathname = '/inicio';
        return NextResponse.redirect(url);
      }
    } catch (err) {
      // Fail-open: no bloquear la entrada si la BD falla
      console.error('[proxy] Error leyendo show_reservations:', err);
    }
  }

  // Solo se valida la sesión cuando la ruta lo requiere (dashboard o
  // auth), para no añadir latencia al resto de rutas (APIs, assets).
  const requiresAuth = pathname.startsWith('/dashboard') || pathname.startsWith('/auth');
  let isAuthed = false;

  if (requiresAuth) {
    try {
      const response = NextResponse.next();
      const session = await getIronSession<{ user?: { id?: string } }>(request, response, sessionOptions);
      const sessionUser = session.user;

      if (!sessionUser?.id) {
        // Cookie ausente, expirada o ilegible → no hay sesión válida
        isAuthed = false;
      } else {
        try {
          // El usuario debe existir y estar activo en la BD
          // (con caché TTL corto para no añadir latencia si la BD es remota)
          isAuthed = await findActiveUserCached(sessionUser.id);
        } catch (err) {
          // Error de BD (servidor caído, etc.): dejar pasar; las APIs
          // manejarán el error y no se bloquea a todos los usuarios.
          console.error('[proxy] Error validando usuario en BD:', err);
          isAuthed = true;
        }
      }
    } catch {
      isAuthed = false;
    }
  }

  // Proteger rutas del dashboard — requieren autenticación
  if (pathname.startsWith('/dashboard')) {
    if (!isAuthed) {
      const url = request.nextUrl.clone();
      url.pathname = '/auth/login';
      const redirect = NextResponse.redirect(url);
      // Eliminar la cookie muerta para que no siga rebotando al login
      redirect.cookies.set(sessionOptions.cookieName, '', { maxAge: 0, path: '/' });
      return redirect;
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
