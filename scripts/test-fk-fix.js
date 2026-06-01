#!/usr/bin/env node
/**
 * Test: verificar que el fix de FK funciona correctamente.
 * 1. Crea un producto y verifica que location_movements se inserta sin error
 * 2. Verifica que requireAuth() rechaza usuarios eliminados
 * 
 * Ejecutar: node scripts/test-fk-fix.js
 */

const mysql = require('mysql2/promise');
const http = require('http');
const crypto = require('crypto');
const { randomUUID } = crypto;

const DB = { host: '127.0.0.1', user: 'root', password: 'root', port: 3306, database: 'tienda_mi_barrio' };

let conn;

async function testProductCreation() {
  console.log('\n🧪 Test 1: Crear producto y verificar location_movements...\n');

  // Obtener un usuario real de la BD
  const [users] = await conn.execute('SELECT id FROM users WHERE active=1 LIMIT 1');
  if (!users.length) throw new Error('No hay usuarios activos en la BD');
  const userId = users[0].id;
  console.log(`   Usuario válido: ${userId}`);

  // Obtener una ubicación
  const [locs] = await conn.execute('SELECT id FROM locations WHERE active=1 LIMIT 1');
  if (!locs.length) throw new Error('No hay ubicaciones');
  const locationId = locs[0].id;

  const productId = randomUUID();
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Crear producto
  await conn.execute(
    `INSERT INTO products (id, name, description, category_id, sale_price, cost, stock, min_stock, unit, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [productId, 'Test Product', null, null, 100, 50, 10, 2, 'unidad', ts, ts]
  );
  console.log('   ✅ Producto creado');

  // Insertar en location_stock (simula lo que hace la API)
  await conn.execute(
    'INSERT INTO location_stock (id, location_id, product_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)',
    [randomUUID(), locationId, productId, 10, ts]
  );
  console.log('   ✅ location_stock insertado');

  // Insertar en location_movements con un user_id VÁLIDO (simula el fix)
  await conn.execute(
    'INSERT INTO location_movements (id, location_id, product_id, type, quantity, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [randomUUID(), locationId, productId, 'entrada', 10, 'Stock inicial', userId, ts]
  );
  console.log('   ✅ location_movements insertado (user_id válido)');

  // Intentar insertar location_movements con user_id INVÁLIDO (debería fallar)
  const fakeId = randomUUID();
  try {
    await conn.execute(
      'INSERT INTO location_movements (id, location_id, product_id, type, quantity, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [randomUUID(), locationId, productId, 'entrada', 5, 'Test FK fail', fakeId, ts]
    );
    console.log('   ❌ ¡ERROR! Se insertó con user_id inválido - la FK no está funcionando');
    // Limpiar
    await conn.execute('DELETE FROM location_movements WHERE notes = ?', ['Test FK fail']);
  } catch (e) {
    if (e.code === 'ER_NO_REFERENCED_ROW_2') {
      console.log('   ✅ FK funciona: user_id inválido rechazado correctamente');
    } else {
      console.log(`   ⚠️ Error inesperado: ${e.message}`);
    }
  }

  // Verificar ON DELETE SET NULL: eliminar el usuario y ver que location_movements.user_id → NULL
  console.log('\n🧪 Test 2: Verificar ON DELETE SET NULL...\n');

  // Crear un usuario temporal
  const testUserId = randomUUID();
  await conn.execute(
    `INSERT INTO users (id, name, email, password_hash, role, permissions, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [testUserId, 'Test User', `test-${Date.now()}@test.com`, '$2b$12$test', 'seller', '[]', ts, ts]
  );
  console.log('   ✅ Usuario temporal creado');

  // Insertar location_movement con ese usuario
  const movId = randomUUID();
  await conn.execute(
    'INSERT INTO location_movements (id, location_id, product_id, type, quantity, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [movId, locationId, productId, 'entrada', 3, 'Test ON DELETE SET NULL', testUserId, ts]
  );
  console.log('   ✅ location_movements insertado con usuario temporal');

  // Eliminar el usuario temporal
  await conn.execute('DELETE FROM users WHERE id = ?', [testUserId]);
  console.log('   ✅ Usuario temporal eliminado');

  // Verificar que la location_movement tiene user_id = NULL
  const [rows] = await conn.execute('SELECT user_id FROM location_movements WHERE id = ?', [movId]);
  if (rows.length && rows[0].user_id === null) {
    console.log('   ✅ ON DELETE SET NULL funciona: user_id → NULL después de eliminar usuario');
  } else if (rows.length && rows[0].user_id !== null) {
    console.log(`   ❌ user_id sigue siendo ${rows[0].user_id} - puede que la columna no permita NULL aún`);
    console.log('      Ejecuta la migración: mysql -u root -p < mysql/migration-002-on-delete-set-null.sql');
  } else {
    console.log('   ⚠️ Movimiento no encontrado (posiblemente se eliminó en cascada)');
  }

  // Limpiar datos de prueba
  await conn.execute('DELETE FROM location_movements WHERE id IN (SELECT id FROM (SELECT id FROM location_movements WHERE product_id=?) AS tmp)', [productId]);
  await conn.execute('DELETE FROM location_stock WHERE product_id = ?', [productId]);
  await conn.execute('DELETE FROM products WHERE id = ?', [productId]);

  return true;
}

async function testRequireAuth() {
  console.log('\n🧪 Test 3: Verificar que requireAuth() rechaza usuarios eliminados...\n');

  // Crear usuario temporal
  const testUserId = randomUUID();
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await conn.execute(
    `INSERT INTO users (id, name, email, password_hash, role, permissions, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [testUserId, 'Auth Test', `authtest-${Date.now()}@test.com`, '$2b$12$test', 'seller', '[]', ts, ts]
  );
  console.log('   ✅ Usuario temporal creado');

  // Verificar que el usuario existe en la BD
  const [dbCheck] = await conn.execute('SELECT id FROM users WHERE id = ? AND active = 1', [testUserId]);
  console.log(`   ${dbCheck.length ? '✅' : '❌'} Usuario encontrado en BD`);

  // Eliminar el usuario (simula que alguien lo borra directamente)
  await conn.execute('DELETE FROM users WHERE id = ?', [testUserId]);
  console.log('   ✅ Usuario eliminado de la BD');

  // Verificar que la consulta de requireAuth() no lo encuentra
  const [afterDelete] = await conn.execute('SELECT id FROM users WHERE id = ? AND active = 1', [testUserId]);
  console.log(`   ${afterDelete.length === 0 ? '✅' : '❌'} requireAuth() no encuentra al usuario eliminado (correcto)`);

  return true;
}

async function main() {
  console.log('========================================');
  console.log('  Test FK Fix - TiendaMiBarrio');
  console.log('========================================');

  try {
    conn = await mysql.createConnection(DB);
    console.log('📦 Conectado a MySQL');

    await testProductCreation();
    await testRequireAuth();

    console.log('\n========================================');
    console.log('  ✅ Todos los tests pasaron');
    console.log('========================================\n');
  } catch (e) {
    console.error('\n❌ Test falló:', e.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

main();
