#!/usr/bin/env node
/**
 * TiendaMiBarrio - Aplica la migración 029 (tasas de cambio con referencia
 * al dólar) de forma segura.
 *
 * Uso: node scripts/apply-migration-029.js
 *
 * Lee las credenciales de .env (o variables de entorno ya cargadas) y
 * ejecuta las sentencias de mysql/migration-029-usd-reference-rates.sql:
 *   - currency_rates pasa a guardar SOLO filas USD → moneda (1 USD = X),
 *     derivando las tasas existentes y borrando los pares antiguos.
 *   - Agrega sales.usd_rate (tasa USD congelada por venta) y rellena las
 *     ventas antiguas.
 * Es idempotente: si la columna ya existe se reporta y continúa.
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Cargar .env si existe (sin pisar variables ya definidas)
try {
  const env = fs.readFileSync(path.join(__dirname, '../.env'), 'utf-8');
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

  const migrationPath = path.join(__dirname, '../mysql/migration-029-usd-reference-rates.sql');
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
      // Ya aplicada: si la columna ya existe se reporta y continúa.
      if (e.message.includes('Duplicate column')) {
        skipped++;
        console.log('ℹ️   Columna sales.usd_rate ya existente.');
      } else {
        throw e;
      }
    }
  }
  console.log(`✅  Migración 029 aplicada (${ok} sentencias, ${skipped} ya existían).`);

  // Verificación: toda tasa debe estar referida al dólar (1 USD = X moneda)
  const [rates] = await conn.query(
    'SELECT from_currency, to_currency, rate FROM currency_rates ORDER BY to_currency'
  );
  console.log('\n💱  currency_rates (solo referencia USD):');
  console.table(rates);

  const [bad] = await conn.query(
    "SELECT COUNT(*) AS n FROM currency_rates WHERE from_currency <> 'USD'"
  );
  if (Number(bad[0].n) > 0) {
    throw new Error(`Quedaron ${bad[0].n} filas sin referencia USD`);
  }

  const [sales] = await conn.query(
    'SELECT COUNT(*) AS ventas, SUM(usd_rate IS NOT NULL) AS con_tasa_usd FROM sales'
  );
  console.log('🧾  sales.usd_rate:', sales[0]);

  await conn.end();
  console.log('\n🎉  Base de datos al día: todas las tasas van contra el dólar.');
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
