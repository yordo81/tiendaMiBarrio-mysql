import { valkeyGet, valkeySet, valkeyDel, valkey } from '@/lib/valkey';

// ── Caché de reportes pesados ────────────────────────────────────
// Los reportes ejecutan múltiples queries SQL (hasta 13 en paralelo
// para el dashboard principal). Este módulo cachea los resultados
// en Valkey con TTLs diferenciados según la frecuencia de acceso.
//
// Estrategia de TTLs:
//  - Dashboard principal: 30s (se actualiza con cada venta)
//  - Dashboard vendedor: 30s (mismo razonamiento)
//  - Reportes analíticos (margins, restock, sales_detail, transfers): 5 min
//    (datos históricos que cambian poco)
//  - Expiration: 2 min (productos perecederos cambian con el día)
//
// Clave de caché: report:{type}:{userId}:{locationId}:{days}:{date}
// El componente {date} invalida automáticamente al cambiar de día.

const TTL = {
  dashboard: 30,
  seller: 30,
  margins: 300,      // 5 min
  restock: 300,      // 5 min
  sales_detail: 300, // 5 min
  transfers: 300,    // 5 min
  expiration: 120,   // 2 min
} as const;

type ReportType = keyof typeof TTL;

function todayKey(): string {
  // Invalidación automática al cambiar de día (usa fecha local)
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Construye la clave de caché para un reporte.
 * Incluye tipo, usuario, ubicación, días y fecha para invalidación automática.
 */
function buildCacheKey(
  type: ReportType,
  userId: string,
  locationId: string | null,
  days: number,
  variant = '',
): string {
  const loc = locationId ?? 'all';
  // `variant` distingue filtros extra del mismo reporte (p. ej. la moneda del
  // reporte de transferencias) para no devolver una respuesta cacheada con
  // otro filtro distinto.
  return `report:${type}:${userId}:${loc}:${days}:${variant || 'all'}:${todayKey()}`;
}

/**
 * Intenta obtener un reporte de la caché. Si no existe, ejecuta la
 * función de carga y guarda el resultado.
 */
export async function cachedReport<T>(
  type: ReportType,
  userId: string,
  locationId: string | null,
  days: number,
  loader: () => Promise<T>,
  /** Filtros extra que distinguen la clave de caché (p. ej. la moneda) */
  variant = '',
): Promise<T> {
  // Si Valkey no está disponible, ejecutar directo
  if (!valkey) return loader();

  const key = buildCacheKey(type, userId, locationId, days, variant);

  try {
    // Intentar obtener de caché
    const cached = await valkeyGet<T | null>(key, null);
    if (cached !== null) return cached;
  } catch {
    // Si falla la lectura, ejecutar directo
    return loader();
  }

  // Cache miss → ejecutar query
  const data = await loader();

  // Guardar en caché (no await: fire-and-forget para no bloquear)
  const ttl = TTL[type] ?? 60;
  valkeySet(key, data, ttl).catch(() => {});

  return data;
}

/**
 * Invalida la caché de reportes de un tipo específico.
 * Útil cuando se muta datos (venta, gasto, ajuste de stock).
 */
export async function invalidateReportCache(
  type: ReportType,
  userId: string,
  locationId: string | null,
): Promise<void> {
  if (!valkey) return;

  // Invalidar todas las variaciones de días para este tipo/usuario/ubicación
  const loc = locationId ?? 'all';
  const date = todayKey();
  const pattern = `report:${type}:${userId}:${loc}:*:${date}`;

  try {
    // Usar SCAN en lugar de KEYS para no bloquear Valkey en producción
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, foundKeys] = await valkey!.scan(
        cursor, 'MATCH', pattern, 'COUNT', 100
      );
      cursor = nextCursor;
      keys.push(...foundKeys);
    } while (cursor !== '0');

    if (keys.length > 0) {
      await valkeyDel(...keys);
    }
  } catch {
    // No-op: si falla la invalidación, el TTL se encargará
  }
}

/**
 * Invalida TODOS los reportes de un usuario.
 * Llamar después de operaciones que afectan múltiples reportes
 * (ej: registrar una venta afecta dashboard, seller, margins, etc.)
 */
export async function invalidateAllReportCaches(userId: string): Promise<void> {
  if (!valkey) return;

  const date = todayKey();
  const types: ReportType[] = ['dashboard', 'seller', 'margins', 'restock', 'sales_detail', 'transfers', 'expiration'];

  for (const type of types) {
    try {
      const pattern = `report:${type}:${userId}:*:${date}`;
      // Usar SCAN en lugar de KEYS para no bloquear Valkey en producción
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [nextCursor, foundKeys] = await valkey!.scan(
          cursor, 'MATCH', pattern, 'COUNT', 100
        );
        cursor = nextCursor;
        keys.push(...foundKeys);
      } while (cursor !== '0');

      if (keys.length > 0) {
        await valkeyDel(...keys);
      }
    } catch {
      // No-op
    }
  }
}
