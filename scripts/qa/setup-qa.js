// ── QA setup: usuarios temporales + snapshot de datos ─────────────────
// Crea usuarios QA (owner/seller) con contraseña conocida y guarda un
// snapshot JSON de los datos que los tests van a tocar, para restaurarlos.
// Uso: node scripts/qa/setup-qa.js
const m = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync('.env.local', 'utf8');
const DB = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: env.match(/DB_PASSWORD=(\S+)/)[1],
  database: 'tienda_mi_barrio',
};

const QA_PREFIX = 'qa.';
const PASSWORD = 'QaTest123!';
const OUT = path.join(__dirname, 'snapshot.json');

async function main() {
  const c = await m.createConnection(DB);
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Usuarios QA temporales (se eliminan en cleanup)
  const [existing] = await c.execute('SELECT id FROM users WHERE email LIKE ?', [`${QA_PREFIX}%`]);
  for (const u of existing) await c.execute('DELETE FROM users WHERE id = ?', [u.id]);

  // ids char(36): 8-4-4-4-12
  const ownerId = 'qaowner1-0000-0000-0000-000000000001';
  const sellerId = 'qaseller-0000-0000-0000-000000000002';
  await c.execute(
    `INSERT INTO users (id, name, email, password_hash, role, permissions, active, created_at, updated_at)
     VALUES (?,?,?,?,?,?,1,?,?)`,
    [ownerId, 'QA Owner', `${QA_PREFIX}owner@test.local`, hash, 'owner', '[]', now, now]
  );
  await c.execute(
    `INSERT INTO users (id, name, email, password_hash, role, permissions, active, created_at, updated_at)
     VALUES (?,?,?,?,?,?,1,?,?)`,
    [sellerId, 'QA Seller', `${QA_PREFIX}seller@test.local`, hash, 'seller', '[]', now, now]
  );
  // Vendedor asociado a POS-2 (Caja 2) — flujo de turnos
  await c.execute("UPDATE users SET pos_id = 'POS-2' WHERE id = ?", [sellerId]);

  // Snapshot de todo lo que los tests tocan
  const [products] = await c.execute('SELECT * FROM products');
  const [locStock] = await c.execute('SELECT * FROM location_stock');
  const [locations] = await c.execute('SELECT id FROM locations');
  const [sales] = await c.execute('SELECT id FROM sales');
  const [movements] = await c.execute('SELECT id FROM location_movements');
  const [stockMovs] = await c.execute('SELECT id FROM stock_movements');
  const [settings] = await c.execute('SELECT * FROM settings');
  const [shifts] = await c.execute('SELECT id FROM shifts');
  const [pays] = await c.execute('SELECT id FROM payments');
  const [saleItems] = await c.execute('SELECT id FROM sale_items');

  fs.writeFileSync(OUT, JSON.stringify({
    users: { ownerId, sellerId },
    products, locStock, locations,
    saleIds: sales.map(r => r.id),
    movIds: movements.map(r => r.id),
    stockMovIds: stockMovs.map(r => r.id),
    shiftIds: shifts.map(r => r.id),
    payIds: pays.map(r => r.id),
    saleItemIds: saleItems.map(r => r.id),
    settings,
    created_at: now,
  }, null, 2));

  console.log('✅ QA users created:', { ownerId, sellerId, password: PASSWORD });
  console.log('📸 Snapshot →', OUT);
  await c.end();
}

main().catch(e => { console.error('ERR', e.message); process.exit(1); });
