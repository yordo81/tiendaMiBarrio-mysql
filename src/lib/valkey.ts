import Redis from 'ioredis';

// ── Cliente Valkey (Redis-compatible) ─────────────────────────────
// Singleton global para reutilizar la conexiónTCP entre requests.
// Valkey es 100% compatible con el protocolo Redis, así que el
// cliente ioredis funciona sin cambios.
//
// Si VALKEY_URL no está configurado, se desactiva el caché
// y se exporta null para que los consumidores hagan fallback
// a la lógica original (in-memory o sin caché).

declare global {
  var _valkeyClient: Redis | undefined | null;
}

function createValkeyClient(): Redis | null {
  const url = process.env.VALKEY_URL;
  if (!url) return null;

  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 3) return null; // dejar de reintentar
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true, // conectar bajo demanda
    enableReadyCheck: true,
    connectTimeout: 3000,
  });

  // Cerrar silenciosamente si Valkey no está disponible
  client.on('error', (err) => {
    if (process.env.NODE_ENV === 'production') return;
    console.error('[valkey] Error de conexión:', err.message);
  });

  return client;
}

/**
 * Cliente Valkey singleton.
 * Retorna null si VALKEY_URL no está configurado (fallback a in-memory).
 */
export const valkey: Redis | null =
  globalThis._valkeyClient ?? (globalThis._valkeyClient = createValkeyClient());

// ── Helper: obtener con TTL fallback ──────────────────────────────
/**
 * Intenta obtener un valor de Valkey. Si falla o no está configurado,
 * retorna el valor por defecto.
 */
export async function valkeyGet<T>(key: string, fallback: T): Promise<T> {
  if (!valkey) return fallback;
  try {
    const raw = await valkey.get(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Guarda un valor en Valkey con TTL (en segundos).
 * Si Valkey no está disponible, no-op silencioso.
 */
export async function valkeySet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (!valkey) return;
  try {
    await valkey.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // No-op: si Valkey falla, el sistema sigue funcionando sin caché
  }
}

/**
 * Elimina una clave de Valkey (o varias).
 * Si Valkey no está disponible, no-op silencioso.
 */
export async function valkeyDel(...keys: string[]): Promise<void> {
  if (!valkey) return;
  try {
    if (keys.length === 1) {
      await valkey.del(keys[0]);
    } else {
      await valkey.del(...keys);
    }
  } catch {
    // No-op
  }
}
