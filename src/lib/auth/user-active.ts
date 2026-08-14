import { queryOne } from '@/lib/db/mysql';

// ── Usuario activo en BD ───────────────────────────────────────────
// Helper compartido entre el proxy de autenticación y requireAuth()
// para que la semántica de "el usuario existe y está activo" viva en un
// solo lugar (evita que el SQL se duplique y diverga).

export interface ActiveUser {
  id: string;
  name: string;
  email: string;
  role: string;
  pos_id: string | null;
  permissions: string;
  active: boolean;
}

// Retorna el usuario si existe y está activo, o null en caso contrario
export function findActiveUser(id: string): Promise<ActiveUser | null> {
  return queryOne<ActiveUser>(
    'SELECT id, name, email, role, pos_id, permissions, active FROM users WHERE id = ? AND active = 1 LIMIT 1',
    [id]
  );
}

// ── Versión cacheada para el proxy de autenticación ────────────────
// El proxy consulta la BD en cada request a /dashboard y /auth; si la BD
// es remota o lenta, eso añade latencia al TTFB. Este caché en memoria
// (por instancia del proceso) recuerda los resultados POSITIVOS durante
// unos segundos para reducir esa latencia.
//
// Consideraciones:
//  - Solo se cachean los positivos: si un usuario se desactiva, el HTML
//    del dashboard queda bloqueado en cuanto expira el TTL (máx. 30s);
//    la capa de datos (requireAuth, sin caché) sí lo bloquea al
//    instante. Los negativos no se cachean para que una reactivación
//    sea efectiva al instante.
//  - TTL corto por defecto (30s), configurable con USER_ACTIVE_CACHE_TTL_MS
//    (0 = deshabilitar el caché).
//  - Los errores de BD no se cachean: se propagan y el proxy decide
//    cómo fallar (fail-open).

const rawTtl = Number(process.env.USER_ACTIVE_CACHE_TTL_MS);
const USER_ACTIVE_CACHE_TTL_MS = Number.isFinite(rawTtl) && rawTtl >= 0 ? rawTtl : 30_000;
const activeUserCache = new Map<string, { expiresAt: number }>();

/** Retorna true si el usuario existe y está activo, con caché TTL corto. */
export async function findActiveUserCached(id: string): Promise<boolean> {
  const cached = activeUserCache.get(id);
  if (cached && cached.expiresAt > Date.now()) return true;

  const user = await findActiveUser(id);
  if (user) {
    activeUserCache.set(id, { expiresAt: Date.now() + USER_ACTIVE_CACHE_TTL_MS });
    return true;
  }

  // No cachear negativos (reactivación inmediata); limpiar entradas viejas
  activeUserCache.delete(id);
  return false;
}
