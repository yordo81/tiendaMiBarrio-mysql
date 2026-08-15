// ── QA manual cleanup: elimina TODO el rastro de las pruebas QA ───────
// Útil cuando el snapshot se corrompió (ej. pruebas abortadas a medias).
// Borra por patrón de nombre (QA %, qa.%): ventas, movimientos, productos,
// ubicaciones y usuarios QA. No toca datos de producción.
// Uso: node scripts/qa/manual-cleanup.js
const m = require('mysql2/promise');
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8');
const DB = {
  host: 'localhost', port: 3306, user: 'root',
  password: env.match(/DB_PASSWORD=(\S+)/)[1], database: 'tienda_mi_barrio',
};

async function main() {
  const c = await m.createConnection(DB);
  await c.beginTransaction();
  try {
    const [[{ n }]] = await c.execute("SELECT COUNT(*) n FROM products WHERE name LIKE 'QA %'");
    console.log('QA products a eliminar:', n);

    // 1) Ventas QA + sus items y pagos
    const [qaSales] = await c.execute("SELECT id FROM sales WHERE notes LIKE 'QA %' OR notes LIKE 'qa %'");
    console.log('QA sales:', qaSales.length);
    for (const s of qaSales) {
      await c.execute('DELETE FROM sale_items WHERE sale_id = ?', [s.id]);
      await c.execute('DELETE FROM payments WHERE sale_id = ?', [s.id]);
      await c.execute('DELETE FROM customer_payments WHERE sale_id = ?', [s.id]);
      await c.execute('DELETE FROM sales WHERE id = ?', [s.id]);
    }

    // 2) Movimientos de almacén y de stock de los productos QA (RESTRICT/CASCADE)
    await c.execute("DELETE lm FROM location_movements lm JOIN products p ON p.id=lm.product_id WHERE p.name LIKE 'QA %'");
    // stock_movements se borra en cascada con products, pero también hay
    // movimientos de productos QA creados sin producto asociado? No: siempre con producto.

    // 3) Ubicaciones QA (los location_stock se borran en cascada)
    await c.execute("DELETE FROM locations WHERE name LIKE 'QA %'");

    // 4) Productos QA (cascada: stock_movements, location_stock, purchases, purchase_prices, product_suppliers, reservations)
    await c.execute("DELETE FROM products WHERE name LIKE 'QA %'");

    // 5) Usuarios QA (audit_logs en cascada)
    await c.execute("DELETE FROM users WHERE email LIKE 'qa.%'");

    // 6) Auditoría QA (si quedó algo sin usuario)
    await c.execute("DELETE FROM audit_logs WHERE user_name LIKE 'QA %' OR user_id LIKE 'qa%'");

    await c.commit();
    console.log('✅ Manual cleanup OK');
  } catch (e) {
    await c.rollback();
    console.error('❌ Rollback:', e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
}
main();
