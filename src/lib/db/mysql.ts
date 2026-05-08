import mysql from 'mysql2/promise';

declare global { var _mysqlPool: mysql.Pool | undefined; }

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
    timezone: '+00:00',
    typeCast(field, next) {
      if (field.type === 'DATETIME' || field.type === 'TIMESTAMP') {
        const val = field.string();
        return val ? new Date(val).toISOString() : null;
      }
      if (field.type === 'TINY' && field.length === 1) {
        return field.string() === '1';
      }
      return next();
    },
  });
}

export const pool: mysql.Pool = globalThis._mysqlPool ?? (globalThis._mysqlPool = createPool());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = Record<string, unknown>>(sql: string, params?: any[]): Promise<T[]> {
  const [rows] = await pool.execute(sql, params ?? []);
  return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(sql: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params?: any[]): Promise<mysql.ResultSetHeader> {
  const [result] = await pool.execute(sql, params ?? []);
  return result as mysql.ResultSetHeader;
}

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
