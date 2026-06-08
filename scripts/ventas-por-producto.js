/**
 * Ventas por Producto — TiendaMiBarrio MySQL
 *
 * Para cada producto, muestra:
 *  - Stock actual
 *  - Total vendido (desde sale_items, ventas no canceladas)
 *  - Stock inicial estimado (stock actual + ventas)
 *  - Productos con ventas pero sin stock (posible inconsistencia)
 *
 * Uso:
 *   node scripts/ventas-por-producto.js
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

async function main() {
  const pool = mysql.createPool({
    ...DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 1,
    decimalNumbers: true,
  });

  console.log('═══════════════════════════════════════════════════════');
  console.log('  VENTAS POR PRODUCTO');
  console.log(`  Fecha: ${new Date().toISOString().slice(0, 10)}`);
  console.log('═══════════════════════════════════════════════════════\n');

  const [rows] = await pool.execute(`
    SELECT
      p.id,
      p.name,
      p.unit,
      p.stock                                               AS stock_actual,
      COALESCE(SUM(si.quantity), 0)                         AS total_vendido,
      COUNT(DISTINCT si.sale_id)                            AS numero_ventas,
      p.stock + COALESCE(SUM(si.quantity), 0)               AS stock_inicial_estimado,
      (SELECT COUNT(*) FROM purchases pu
       WHERE pu.product_id = p.id)                          AS tiene_compras
    FROM products p
    LEFT JOIN sale_items si ON si.product_id = p.id
    LEFT JOIN sales s ON s.id = si.sale_id AND s.status != 'cancelled'
    WHERE p.active = 1
    GROUP BY p.id, p.name, p.unit, p.stock
    ORDER BY total_vendido DESC
  `);

  // ── Encabezado ──
  const header = [
    'Producto'.padEnd(32),
    'Stock'.padStart(8),
    'Vendido'.padStart(10),
    '# Ventas'.padStart(9),
    'Stock Inicial'.padStart(14),
    'Estado'.padEnd(14),
  ].join(' | ');

  console.log(header);
  console.log('-'.repeat(header.length));

  let totalStock = 0;
  let totalVendido = 0;
  const alertas = [];

  for (const r of rows) {
    const stock     = Number(r.stock_actual);
    const vendido   = Number(r.total_vendido);
    const numVentas = Number(r.numero_ventas);
    const stockInicial = Number(r.stock_inicial_estimado);
    const compras   = Number(r.tiene_compras);

    totalStock += stock;
    totalVendido += vendido;

    // Estado del producto
    let estado;
    let esAlerta = false;

    if (stock <= 0 && vendido > 0) {
      estado = '⚠  Sin stock / c/vtas';
      esAlerta = true;
    } else if (stock <= 0) {
      estado = 'Sin stock';
    } else if (vendido === 0) {
      estado = 'Sin ventas';
    } else {
      estado = 'OK';
    }

    if (esAlerta) {
      alertas.push(`  ⚠  ${String(r.name).padEnd(28)} vendido: ${vendido}, stock: ${stock}`);
    }

    const line = [
      String(r.name).padEnd(32).slice(0, 32),
      String(stock).padStart(8),
      String(vendido).padStart(10),
      String(numVentas).padStart(9),
      String(stockInicial).padStart(14),
      estado.padEnd(14),
    ].join(' | ');

    console.log(line);
  }

  // ── Totales ──
  console.log('-'.repeat(header.length));
  const totalLine = [
    'TOTALES'.padEnd(32),
    String(totalStock).padStart(8),
    String(totalVendido).padStart(10),
    ''.padStart(9),
    String(totalStock + totalVendido).padStart(14),
    ''.padEnd(14),
  ].join(' | ');
  console.log(totalLine);

  console.log('\n═══════════════════════════════════════════════════════\n');

  // ── Alertas ──
  if (alertas.length > 0) {
    console.log('⚠  Productos con ventas registradas pero stock insuficiente:');
    alertas.forEach(a => console.log(a));
    console.log('');
    console.log('   → Stock inicial estimado = stock actual + total vendido');
    console.log('   → Si el stock inicial es alto pero el actual es bajo,');
    console.log('     revisa si faltan compras registradas o hubo gastos/ajustes.\n');
  } else {
    console.log('✓  No se detectaron inconsistencias entre ventas y stock.\n');
  }

  // ── Top ventas ──
  const top = rows
    .filter(r => Number(r.total_vendido) > 0)
    .sort((a, b) => Number(b.total_vendido) - Number(a.total_vendido))
    .slice(0, 5);

  if (top.length > 0) {
    console.log('── Top 5 más vendidos ──');
    top.forEach((r, i) => {
      console.log(`  ${i + 1}. ${String(r.name).padEnd(28)} ${String(r.total_vendido).padStart(6)} ${r.unit}`);
    });
    console.log('');
  }

  await pool.end();
}

main().catch(e => {
  console.error('\n✕  ERROR:', e.message);
  process.exit(1);
});
