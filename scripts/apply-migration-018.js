/**
 * Aplica la migración 018: columna batch_id en stock_transfers
 * (agrupación de traslados por lote).
 *
 * Uso: node scripts/apply-migration-018.js
 *
 * Lee las credenciales de .env.local (o variables de entorno ya cargadas) y
 * ejecuta las sentencias de mysql/migration-018-stock-transfers-batch.sql.
 * Es idempotente: si la columna ya existe, lo reporta y termina.
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Cargar .env.local si existe (sin pisar variables ya definidas)
try {
  const env = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf-8');
  env.split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length && !key.startsWith('#') && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  });
} catch {}

async function main() {
  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || '3306', 10);
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const dbName = process.env.DB_NAME || 'tienda_mi_barrio';

  console.log(`🔌  Conectando a MySQL ${host}:${port}/${dbName}...`);
  const conn = await mysql.createConnection({ host, port, user, password });
  await conn.query(`USE \`${dbName}\``);
  console.log(`✅  Conectado a '${dbName}'.`);

  // Leer las sentencias de la migración 018 (fuente única de verdad).
  const migrationPath = path.join(__dirname, '../mysql/migration-018-stock-transfers-batch.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');
  const statements = sql.split(';')
    .map(s => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim())
    .filter(s => s.length > 0);

  let ok = 0, skipped = 0;
  for (const stmt of statements) {
    try {
      await conn.query(stmt);
      ok++;
    } catch (e) {
      const msg = e.message || String(e);
      // Ya aplicado: 'Duplicate column name' (ALTER ADD COLUMN),
      // 'Duplicate key name' (ADD KEY), 'Duplicate foreign key constraint name' (ADD CONSTRAINT)
      if (msg.includes('Duplicate column name') || msg.includes('Duplicate key name') || msg.includes('Duplicate foreign key constraint name')) {
        skipped++;
      } else {
        throw e;
      }
    }
  }
  console.log(`✅  Migración 018 aplicada (${ok} sentencias, ${skipped} ya existían).`);
  await conn.end();
  console.log('\n🎉  Campo batch_id disponible en stock_transfers.');
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
