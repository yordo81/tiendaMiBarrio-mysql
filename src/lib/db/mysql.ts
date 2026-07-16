import mysql from 'mysql2/promise';

// ── Pool de conexiones MySQL ───────────────────────────────────────
// Usa una pool global (singleton) para reutilizar conexiones de forma
// eficiente. Declaración global para evitar múltiples pools en hot-reload.

declare global { var _mysqlPool: mysql.Pool | undefined; }

/**
 * Crea y configura el pool de conexiones MySQL.
 * Las opciones se leen de variables de entorno con defaults seguros.
 * typeCast personalizado para normalizar fechas y booleanos.
 */
function createPool(): mysql.Pool {
  return mysql.createPool({
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     parseInt(process.env.DB_PORT ?? '3306'),
    user:     process.env.DB_USER     ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME     ?? 'tienda_mi_barrio',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    decimalNumbers: true,  // Devuelve DECIMAL como número, no string
    timezone: '+00:00',
    typeCast(field, next) {
      if (field.type === 'DATETIME' || field.type === 'TIMESTAMP') {
        const val = field.string();
        return val ? new Date(val).toISOString() : null;
      }
      if (field.type === 'DATE') {
        return field.string(); // "YYYY-MM-DD" en zona horaria de MySQL
      }
      if (field.type === 'TINY' && field.length === 1) {
        return field.string() === '1'; // TINYINT(1) → boolean
      }
      return next();
    },
  });
}

export const pool: mysql.Pool = globalThis._mysqlPool ?? (globalThis._mysqlPool = createPool());

// Configura la zona horaria de la sesión MySQL en cada nueva conexión
// para que CURDATE()/NOW() reflejen la zona horaria de la aplicación.
pool.on('connection', (conn) => {
  try {
    conn.execute("SET time_zone = 'America/Havana'")
      .catch((err: Error) => console.error('[mysql] Error al configurar timezone:', err.message));
  } catch (err) {
    console.error('[mysql] Error inesperado en connection handler:', err);
  }
});

// ── Funciones de acceso a datos ─────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = Record<string, unknown>>(sql: string, params?: any[]): Promise<T[]> {
  const [rows] = await pool.execute(sql, params ?? []);
  return rows as T[];
}

// Retorna un solo registro o null si no hay resultados
export async function queryOne<T = Record<string, unknown>>(sql: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

// Ejecuta INSERT/UPDATE/DELETE y retorna el ResultSetHeader
export async function execute(sql: string, params?: any[]): Promise<mysql.ResultSetHeader> {
  const [result] = await pool.execute(sql, params ?? []);
  return result as mysql.ResultSetHeader;
}

// ── Transacciones ───────────────────────────────────────────────────
// Wrapper seguro: inicia transacción, ejecuta la función, y hace
// commit/rollback automáticamente. Libera la conexión al final.
export async function transaction<T>(fn: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
