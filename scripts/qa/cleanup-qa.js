// ── QA cleanup: elimina los datos creados por las pruebas ────────────
// Borra SOLO filas nuevas (no presentes en el snapshot), respetando el
// orden de FK (hijos primero). Restaura stock de productos del snapshot
// que hayan cambiado. Nunca borra filas originales.
// Uso: node scripts/qa/cleanup-qa.js
const m = require('mysql2/promise');
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

async function main() {
  const snapPath = path.join(__dirname, 'snapshot.json');
  if (!fs.existsSync(snapPath)) { console.error('❌ No snapshot found. Run setup-qa.js first.'); process.exit(1); }
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
// ISO 8601 ("2026-08-07T06:40:07.000Z") → formato DATETIME MySQL
const dt = (v) => v == null ? null : String(v).replace('T', ' ').replace(/\..*Z$/, '').replace('Z', '');
const c = await m.createConnection(DB);
  await c.beginTransaction();
  try {
    // 1) Ventas nuevas: hijos (items/pagos/abonos) antes que la venta
    const [newSales] = await c.execute('SELECT id FROM sales');
    const keep = new Set(snap.saleIds || []);
    for (const s of newSales) {
      if (keep.has(s.id)) continue;
      await c.execute('DELETE FROM sale_items WHERE sale_id = ?', [s.id]);
      await c.execute('DELETE FROM payments WHERE sale_id = ?', [s.id]);
      await c.execute('DELETE FROM customer_payments WHERE sale_id = ?', [s.id]);
      await c.execute('DELETE FROM sales WHERE id = ?', [s.id]);
    }

    // 2) Movimientos nuevos (ubicación y stock global)
    const [newMovs] = await c.execute('SELECT id FROM location_movements');
    const keepMovs = new Set(snap.movIds || []);
    for (const r of newMovs) if (!keepMovs.has(r.id)) await c.execute('DELETE FROM location_movements WHERE id = ?', [r.id]);

    const [newSm] = await c.execute('SELECT id FROM stock_movements');
    const keepSm = new Set(snap.stockMovIds || []);
    for (const r of newSm) if (!keepSm.has(r.id)) await c.execute('DELETE FROM stock_movements WHERE id = ?', [r.id]);

    // 3) Turnos nuevos
    const [newShifts] = await c.execute('SELECT id FROM shifts');
    const keepSh = new Set(snap.shiftIds || []);
    for (const r of newShifts) if (!keepSh.has(r.id)) await c.execute('DELETE FROM shifts WHERE id = ?', [r.id]);

    // 4) Productos nuevos (los QA). stock_movements/location_stock/
    //    purchase_prices/product_suppliers/purchases/reservations se
    //    borran en cascada; location_movements/sale_items ya no existen.
    const [newProds] = await c.execute('SELECT id FROM products');
    const keepP = new Set(snap.products.map(p => p.id));
    for (const r of newProds) if (!keepP.has(r.id)) await c.execute('DELETE FROM products WHERE id = ?', [r.id]);

    // 5) Location_stock de productos/lugares QA (cascada al borrar el
    //    producto, pero por seguridad borrar lo que quede de lugares QA)
    const [newLocs] = await c.execute('SELECT id FROM locations');
    const keepL = new Set(snap.locations.map(l => l.id));
    for (const l of newLocs) if (!keepL.has(l.id)) await c.execute('DELETE FROM locations WHERE id = ?', [l.id]);

    // 6) Restaurar stock global de productos del snapshot si cambió
    for (const p of snap.products) {
      await c.execute('UPDATE products SET stock=?, updated_at=? WHERE id=?', [p.stock, dt(p.updated_at), p.id]);
    }
    // 7) Restaurar location_stock del snapshot si cambió (UPDATE, no DELETE)
    for (const s of snap.locStock) {
      await c.execute('UPDATE location_stock SET quantity=?, updated_at=? WHERE id=?', [s.quantity, dt(s.updated_at), s.id]);
    }

    // 8) Restaurar settings si cambió (los tests pueden togglear enable_touch_pos)
    for (const s of snap.settings) {
      await c.execute(
        'UPDATE settings SET work_mode=?, enable_touch_pos=?, show_reservations=?, receipt_auto_print=?, updated_at=? WHERE id=?',
        [s.work_mode, s.enable_touch_pos, s.show_reservations, s.receipt_auto_print, dt(s.updated_at), s.id]
      );
    }

    // 9) Usuarios QA (audit_logs en cascada)
    await c.execute("DELETE FROM users WHERE email LIKE 'qa.%'");
    await c.execute("DELETE FROM audit_logs WHERE user_id LIKE 'qa%'");

    await c.commit();
    console.log('✅ QA data cleaned. Snapshot restored.');
  } catch (e) {
    await c.rollback();
    console.error('❌ Cleanup failed, rolled back:', e.message);
    process.exit(1);
  } finally {
    await c.end();
  }
}

main();
