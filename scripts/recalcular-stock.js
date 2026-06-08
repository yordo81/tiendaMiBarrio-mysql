/**
 * Recalcular Stock — TiendaMiBarrio MySQL
 *
 * Calcula el stock correcto de cada producto basándose en:
 *   stock = compras - ventas (no canceladas) - gastos con producto + ajustes
 *
 * Modos:
 *   node scripts/recalcular-stock.js              → solo vista previa (dry-run)
 *   node scripts/recalcular-stock.js --apply       → ejecuta los cambios
 *   node scripts/recalcular-stock.js --apply --force → salta la confirmación
 *
 * Configuración de BD via variables de entorno:
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 */

const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME     || 'tienda_mi_barrio',
};

// ── Parse args ──
const APPLY  = process.argv.includes('--apply');
const FORCE  = process.argv.includes('--force');

async function main() {
  const pool = mysql.createPool({
    ...DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 1,
    decimalNumbers: true,
  });

  console.log('══════════════════════════════════════════════════════');
  console.log('  RECALCULAR STOCK');
  console.log(`  Modo:      ${APPLY ? 'APLICAR CAMBIOS' : 'VISTA PREVIA (dry-run)'}`);
  console.log(`  Fecha:     ${new Date().toISOString().slice(0, 10)}`);
  if (!APPLY) console.log('  Usa --apply para escribir los cambios.');
  console.log('══════════════════════════════════════════════════════\n');

  // ── Query: calcular stock correcto para cada producto activo ──
  const [products] = await pool.execute(`
    SELECT
      p.id,
      p.name,
      p.stock                                          AS stock_actual,
      p.min_stock,
      (SELECT COALESCE(SUM(pu.quantity), 0)
       FROM purchases pu WHERE pu.product_id = p.id)   AS total_compras,
      (SELECT COALESCE(SUM(si.quantity), 0)
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id AND s.status != 'cancelled'
       WHERE si.product_id = p.id)                     AS total_ventas,
      (SELECT COALESCE(SUM(e.product_quantity), 0)
       FROM expenses e
       WHERE e.product_id = p.id AND e.product_quantity IS NOT NULL) AS total_gastos,
      (SELECT COALESCE(SUM(sm.quantity), 0)
       FROM stock_movements sm
       WHERE sm.product_id = p.id AND sm.type = 'adjust') AS total_ajustes,
      (SELECT COUNT(*) FROM purchases WHERE product_id = p.id) AS tiene_compras,
      (SELECT COUNT(*) FROM sale_items si
       JOIN sales s ON s.id=si.sale_id AND s.status != 'cancelled'
       WHERE si.product_id = p.id)                     AS tiene_ventas,
      (SELECT COUNT(*) FROM stock_movements WHERE product_id = p.id) AS tiene_movs
    FROM products p
    WHERE p.active = 1
    ORDER BY p.name
  `);

  // ── Mostrar tabla comparativa ──
  const header = [
    'Producto'.padEnd(36),
    'Actual'.padStart(10),
    'Compras'.padStart(10),
    'Ventas'.padStart(10),
    'Gastos'.padStart(8),
    'Ajustes'.padStart(8),
    'Corregido'.padStart(12),
    'Δ'.padStart(8),
  ].join(' | ');

  console.log(header);
  console.log('-'.repeat(header.length));

  const updates = []; // { id, name, stock_actual, stock_correcto, diff }
  let totalDiff = 0;

  for (const p of products) {
    const actual    = Number(p.stock_actual);
    const compras   = Number(p.total_compras);
    const ventas    = Number(p.total_ventas);
    const gastos    = Number(p.total_gastos);
    const ajustes   = Number(p.total_ajustes);

    // stock = compras - ventas - gastos_con_producto + ajustes
    let correcto = compras - ventas - gastos + ajustes;
    if (correcto < 0) correcto = 0;

    const diff = correcto - actual;
    totalDiff += diff;

    const deltaStr = diff === 0 ? '0' : (diff > 0 ? '+' : '') + diff.toFixed(3);

    const line = [
      String(p.name).padEnd(36).slice(0, 36),
      String(actual).padStart(10),
      String(compras).padStart(10),
      String(ventas).padStart(10),
      String(gastos).padStart(8),
      String(ajustes).padStart(8),
      String(correcto).padStart(12),
      deltaStr.padStart(8),
    ].join(' | ');
    console.log(line);

    if (Math.abs(diff) > 0.009) {
      updates.push({ id: p.id, name: p.name, stock_actual: actual, stock_correcto: correcto, diff });
    }
  }

  // ── Resumen ──
  const totalActual = products.reduce((a, p) => a + Number(p.stock_actual), 0);
  const totalCorrecto = products.reduce((a, p) => {
    const compras = Number(p.total_compras);
    const ventas  = Number(p.total_ventas);
    const gastos  = Number(p.total_gastos);
    const ajustes = Number(p.total_ajustes);
    let corr = compras - ventas - gastos + ajustes;
    return a + (corr < 0 ? 0 : corr);
  }, 0);

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  RESUMEN');
  console.log(`  Stock actual total:    ${totalActual}`);
  console.log(`  Stock corregido total: ${totalCorrecto}`);
  console.log(`  Diferencia total:      ${totalDiff > 0 ? '+' : ''}${totalDiff.toFixed(3)}`);
  console.log(`  Productos a corregir:  ${updates.length}`);
  console.log('══════════════════════════════════════════════════════\n');

  if (updates.length === 0) {
    console.log('✓  No hay productos que corregir. Todo está consistente.\n');
    await pool.end();
    return;
  }

  // Mostrar detalle de lo que se va a cambiar
  console.log('── Detalle de cambios ──');
  for (const u of updates) {
    const arrow = u.stock_correcto > u.stock_actual ? '↑' : '↓';
    console.log(`  ${String(u.name).padEnd(30)} ${u.stock_actual} → ${u.stock_correcto} ${arrow}`);
  }

  // ── Ejecutar o informar ──
  if (!APPLY) {
    console.log('\n⚠  Modo vista previa — no se realizaron cambios.');
    console.log('   Ejecuta con --apply para aplicar los cambios.');
    await pool.end();
    return;
  }

  // ── Confirmación ──
  if (!FORCE) {
    console.log('');
    console.log(`⚠  Se actualizarán ${updates.length} productos.`);
    console.log('   ¿Continuar? (s/N): ');
    const answer = await new Promise(resolve => {
      process.stdin.once('data', data => {
        resolve(data.toString().trim().toLowerCase());
      });
    });
    if (answer !== 's' && answer !== 'si') {
      console.log('✕  Operación cancelada.\n');
      await pool.end();
      return;
    }
  }

  // ── Aplicar cambios dentro de una transacción ──
  console.log('');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const u of updates) {
      await conn.execute(
        'UPDATE products SET stock = ?, updated_at = NOW() WHERE id = ?',
        [u.stock_correcto, u.id]
      );
      console.log(`  ✓ ${String(u.name).padEnd(30)} ${u.stock_actual} → ${u.stock_correcto}`);
    }
    await conn.commit();
    console.log(`\n✓  ${updates.length} producto(s) actualizado(s).\n`);
  } catch (err) {
    await conn.rollback();
    console.error(`\n✕  ERROR durante la actualización:`, err.message);
    console.log('   Todos los cambios fueron revertidos (rollback).\n');
    await conn.release();
    await pool.end();
    process.exit(1);
  }
  conn.release();

  console.log('── Nota sobre location_stock ──');
  console.log('  Este script solo actualiza products.stock (stock global).');
  console.log('  Si usas múltiples almacenes, revisa location_stock por separado');
  console.log('  ejecutando: SELECT * FROM location_stock ORDER BY location_id, product_id;\n');

  await pool.end();
}

main().catch(e => {
  console.error('\n✕  ERROR:', e.message);
  process.exit(1);
});
