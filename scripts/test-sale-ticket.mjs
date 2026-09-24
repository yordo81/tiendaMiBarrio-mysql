#!/usr/bin/env node
/**
 * TiendaMiBarrio - Prueba de venta + ticket (referencia USD)
 *
 * Uso: node scripts/test-sale-ticket.mjs
 *
 * 1. Crea una venta de prueba en EUR contra la API real (localhost:3001)
 *    con una sesión iron-session sellada (no toca la BD de la venta a mano).
 * 2. Renderiza el ticket con el MISMO código de producción
 *    (src/lib/receipt.ts: HTML de navegador y flujo ESC/POS).
 * 3. Verifica que el ticket muestre la tasa SIEMPRE contra el dólar:
 *        Tasa: 1 USD = 0.92 EUR
 * 4. Cancela la venta al final (restaura el stock) para no dejar datos
 *    de prueba en el histórico.
 */
import { register } from 'node:module';
register('./ts-alias-loader.mjs', import.meta.url);

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { sealData } from 'iron-session';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cargar .env (sin pisar variables ya definidas)
try {
  fs.readFileSync(path.join(__dirname, '../.env'), 'utf-8').split('\n').forEach(line => {
    const [key, ...rest] = line.split('=');
    if (key && rest.length && !key.startsWith('#') && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  });
} catch {}

const APP_URL = process.env.APP_URL || 'http://localhost:3001';
const PRODUCT_ID = process.env.TEST_PRODUCT_ID || 'e89e8014-610f-4c14-9086-9e4484531ed3'; // Jumbo (400 CUP)
const TEST_CURRENCY = 'EUR'; // moneda extranjera NO base → el ticket debe mostrar "1 USD = X EUR"

async function main() {
  // ── Datos de la BD: usuario, moneda base y ajustes del negocio ──
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'tienda_mi_barrio',
  });
  const [users] = await conn.query(
    "SELECT id, name, email, role FROM users WHERE active = 1 AND role = 'owner' LIMIT 1"
  );
  const owner = users[0];
  if (!owner) throw new Error('No hay usuario owner activo');
  const [curs] = await conn.query('SELECT code, symbol FROM currencies WHERE is_base = 1 AND active = 1 LIMIT 1');
  const base = curs[0];
  const [setRows] = await conn.query('SELECT business_name, logo_url FROM settings LIMIT 1');
  const settings = setRows[0] ?? {};
  const [stockRows] = await conn.query('SELECT stock FROM products WHERE id = ?', [PRODUCT_ID]);
  const stockAntes = Number(stockRows[0]?.stock ?? 0);

  // ── Sesión: sellar la cookie igual que iron-session en el servidor ──
  const sealed = await sealData(
    { user: { id: owner.id, name: owner.name, email: owner.email, role: owner.role, pos_id: null, permissions: [], active: true } },
    { password: process.env.SESSION_SECRET ?? 'fallback_secret_change_in_production_32chars!!', ttl: 60 * 60 * 24 * 7 }
  );
  const cookie = `tienda_session=${encodeURIComponent(sealed)}`;

  // ── 1) Crear la venta contra la API real ──
  console.log(`🛒  POST ${APP_URL}/api/sales — 1 × Jumbo cobrada en ${TEST_CURRENCY} (stock antes: ${stockAntes})`);
  const res = await fetch(`${APP_URL}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      items: [{ product_id: PRODUCT_ID, quantity: 1, unit_price: 0 }],
      payment: { method: 'cash' },
      currency_code: TEST_CURRENCY,
      notes: 'Venta de prueba — tasa contra USD',
    }),
  });
  const sale = await res.json();
  if (!res.ok) throw new Error(`La API devolvió ${res.status}: ${JSON.stringify(sale)}`);
  console.log('✅  Venta creada:', {
    id: sale.id,
    moneda: sale.currency_code,
    exchange_rate_hacia_base: sale.exchange_rate,
    usd_rate: sale.usd_rate,
    total: sale.total,
  });

  // ── 2) Renderizar el ticket con el código de producción ──
  const { buildReceiptFromSale, buildReceiptHtml, encodeEscPos } = await import('../src/lib/receipt.ts');
  const data = buildReceiptFromSale({
    sale,
    items: sale.items ?? [],
    businessName: settings.business_name ?? 'TiendaMiBarrio',
    logoUrl: settings.logo_url ?? null,
    payMethod: 'cash',
    cash: Number(sale.total ?? 0),
    transfer: 0,
    notes: 'Venta de prueba — tasa contra USD',
    baseCurrencyCode: base?.code ?? null,
    baseCurrencySymbol: base?.symbol ?? null,
  });
  const html = buildReceiptHtml(data, '80');
  const esc = new TextDecoder().decode(encodeEscPos(data, '80'));

  const tasaEsperada = `1 USD = ${Number(sale.usd_rate)} ${sale.currency_code}`;
  const limpiar = s => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  console.log('\n🎫  TICKET HTML (navegador) — líneas de tasa/equivalente:');
  for (const line of html.split('\n')) {
    if (line.includes('Tasa') || line.includes('Equiv')) console.log('   ', limpiar(line));
  }
  console.log('\n🎫  TICKET ESC/POS (impresora USB) — líneas de tasa/equivalente:');
  for (const line of esc.split(/\r?\n/)) {
    if (line.includes('Tasa') || line.includes('Equiv')) console.log('   ', line.trim());
  }

  const okHtml = html.includes(tasaEsperada);
  const okEsc = esc.includes(`Tasa: ${tasaEsperada}`);
  console.log(`\nASSERT HTML contiene "${tasaEsperada}": ${okHtml ? '✅' : '❌'}`);
  console.log(`ASSERT ESC/POS contiene "Tasa: ${tasaEsperada}": ${okEsc ? '✅' : '❌'}`);

  // ── 3) Limpieza: cancelar la venta (restaura el stock) ──
  const cancel = await fetch(`${APP_URL}/api/sales/${sale.id}/cancel`, {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  const cancelBody = await cancel.json().catch(() => ({}));
  const [stockDesp] = await conn.query('SELECT stock FROM products WHERE id = ?', [PRODUCT_ID]);
  const [venta] = await conn.query('SELECT status FROM sales WHERE id = ?', [sale.id]);
  console.log(`\n🧹  Cancelación: HTTP ${cancel.status} — venta status=${venta[0]?.status}, stock ${stockAntes} → ${Number(stockDesp[0].stock)}`);

  await conn.end();

  if (!okHtml || !okEsc) {
    console.error('\n❌  El ticket NO muestra la tasa contra USD.');
    process.exit(1);
  }
  console.log('\n🎉  Venta de prueba OK: el ticket imprime "Tasa: 1 USD = X" y la venta quedó cancelada.');
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
