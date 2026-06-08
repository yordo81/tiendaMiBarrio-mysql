/**
 * Análisis de Inventario — TiendaMiBarrio MySQL
 *
 * Compara el stock actual de cada producto contra:
 *  - Total vendido (sale_items de ventas no canceladas)
 *  - Total comprado (purchases)
 *  - Neto de stock_movements (entradas - salidas + ajustes)
 *
 * Uso:
 *   node scripts/analisis-inventario.js
 *
 * Configuración de BD: edita las variables DB_* abajo o define
 * variables de entorno DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.
 */

const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME     || 'tienda_mi_barrio',
};

async function main() {
  const pool = mysql.createPool({
    ...DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 1,
    decimalNumbers: true,
  });

  const [products] = await pool.execute(`
    SELECT
      p.id,
      p.name,
      p.stock,
      p.min_stock,
      p.unit,
      (SELECT COALESCE(SUM(si.quantity), 0)
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id AND s.status != 'cancelled'
       WHERE si.product_id = p.id) AS total_sold,
      (SELECT COALESCE(SUM(pu.quantity), 0)
       FROM purchases pu
       WHERE pu.product_id = p.id) AS total_purchased,
      (SELECT COALESCE(SUM(
         CASE sm.type
           WHEN 'in'     THEN sm.quantity
           WHEN 'out'    THEN -sm.quantity
           WHEN 'adjust' THEN sm.quantity
           WHEN 'expense' THEN -sm.quantity
           ELSE 0
         END
       ), 0)
       FROM stock_movements sm
       WHERE sm.product_id = p.id) AS stock_mov_net
    FROM products p
    WHERE p.active = 1
    ORDER BY p.name
  `);

  console.log('============================================');
  console.log('  INVENTARIO — RESUMEN POR PRODUCTO');
  console.log('  Generado: ' + new Date().toISOString().slice(0, 10));
  console.log('============================================\n');

  const header = [
    'Producto'.padEnd(36),
    'Stock'.padStart(10),
    'Mínimo'.padStart(8),
    'Vendido'.padStart(10),
    'Comprado'.padStart(10),
    'Mov.Net'.padStart(10),
    'Diferencia'.padStart(12),
    'Estado'.padEnd(14),
  ].join(' | ');

  console.log(header);
  console.log('-'.repeat(header.length));

  let hasDiscrepancy = false;
  const lines = [];

  for (const p of products) {
    const stock  = Number(p.stock);
    const sold   = Number(p.total_sold);
    const bought = Number(p.total_purchased);
    const movNet = Number(p.stock_mov_net);
    const diff   = Math.abs(stock - movNet) > 0.009 ? (stock - movNet) : 0;
    const status = stock <= 0          ? 'SIN STOCK'
                 : stock <= Number(p.min_stock) ? 'STOCK BAJO'
                 : 'OK';

    if (diff !== 0) hasDiscrepancy = true;

    const line = [
      String(p.name).padEnd(36).slice(0, 36),
      String(stock).padStart(10),
      String(p.min_stock).padStart(8),
      String(sold).padStart(10),
      String(bought).padStart(10),
      String(movNet).padStart(10),
      (diff === 0 ? '0' : (diff > 0 ? '+' : '') + diff.toFixed(3)).padStart(12),
      status.padEnd(14),
    ].join(' | ');
    lines.push(line);
  }

  lines.forEach(l => console.log(l));

  console.log('\n══════════════════════════════════════════════════');
  console.log('Leyenda:');
  console.log('  Mov.Net = stock según movimientos registrados');
  console.log('  Diferencia = Stock actual - Mov.Net (≠0 = discrepancia)');
  console.log('══════════════════════════════════════════════════\n');

  if (hasDiscrepancy) {
    console.log('⚠  HAY DISCREPANCIAS entre el stock actual y los movimientos registrados.');
    console.log('   Revisa si faltan stock_movements o si se editó products.stock manualmente.\n');
  } else {
    console.log('✓  No hay diferencias significativas entre stock actual y movimientos.\n');
  }

  // ── Totals ──
  const totalStock   = products.reduce((a, p) => a + Number(p.stock), 0);
  const totalSold    = products.reduce((a, p) => a + Number(p.total_sold), 0);
  const totalBought  = products.reduce((a, p) => a + Number(p.total_purchased), 0);
  const totalMovNet  = products.reduce((a, p) => a + Number(p.stock_mov_net), 0);
  console.log('── Resumen global ──');
  console.log(`  Stock total:     ${totalStock}`);
  console.log(`  Total vendido:   ${totalSold}`);
  console.log(`  Total comprado:  ${totalBought}`);
  console.log(`  Mov. neto total: ${totalMovNet}`);

  await pool.end();
}

main().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
