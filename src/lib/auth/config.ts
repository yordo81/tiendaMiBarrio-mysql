import type { SessionOptions } from 'iron-session';

// ── Opciones de sesión (iron-session) ──────────────────────────────
// Módulo compartido entre el proxy de autenticación, las rutas API y el
// cliente (providers). Se mantiene libre de imports en runtime (solo
// `import type`) para poder importarse desde el cliente sin arrastrar
// dependencias pesadas.

export const SESSION_COOKIE_NAME = 'tienda_session';

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET ?? 'fallback_secret_change_in_production_32chars!!',
  cookieName: SESSION_COOKIE_NAME,
  cookieOptions: {
    // `Secure` solo detrás de HTTPS (COOKIE_SECURE=true). Por defecto se
    // desactiva para que la cookie funcione también sobre HTTP plano (LAN);
    // con NODE_ENV=production + HTTP el navegador descartaría la cookie y
    // el login rebotaría silenciosamente de vuelta al login.
    secure: process.env.COOKIE_SECURE === 'true',
    httpOnly: true,   // No accesible desde JavaScript del navegador
    maxAge: 60 * 60 * 24 * 7,  // 7 días
  },
};
