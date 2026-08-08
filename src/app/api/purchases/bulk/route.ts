export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { queryOne, transaction } from '@/lib/db/mysql';
import { handle, ok, err } from '@/lib/api-helpers';
import { getOpenShiftId } from '@/lib/settings-server';
const randomUUID = () => crypto.randomUUID();

// ── API de Compra por Factura (varios productos a la vez) ──────────
// POST: Registra en una sola transacción la entrada de inventario de
// varios productos provenientes de una misma factura de compra:
//   - Actualiza stock y costo promedio ponderado de cada producto
//   - Registra movimiento de stock 'in', precio de compra histórico y
//     el vínculo producto-proveedor por línea
//   - Inserta un registro de compra por producto con la referencia de factura
//   - Actualiza el stock del almacén destino
//   - Genera un único asiento de caja (egreso por reinversión o aporte
//     de capital) por el total de la factura
// Se agrupan líneas repetidas del mismo producto (cantidad y precio promedio).

export const POST = handle(async (req: Request) => {
  const sessionUser = await requireAuth();
  const { items, supplier_id, location_id, invoice_number, notes, is_capital, pos_id } = await req.json();

  if (!Array.isArray(items) || items.length === 0) {
    return err('Debes incluir al menos un producto de la factura');
  }
  if (!supplier_id) return err('Selecciona un proveedor');
  if (!invoice_number || !String(invoice_number).trim()) return err('Indica el número de factura');

  // Caja (punto de venta) opcional: atribuye la compra a la caja para el arqueo del turno
  const posId = pos_id ? String(pos_id).trim() : '';
  if (posId) {
    const pos = await queryOne<{ id: string }>('SELECT id FROM pos WHERE id = ? AND active = 1', [posId]);
    if (!pos) return err('La caja seleccionada no existe o está desactivada');
  }

  // Validar y agrupar líneas del mismo producto (cantidad sumada, precio promedio)
  const merged = new Map<string, { quantity: number; price: number; expiration_date: string | null }>();
  for (const it of items ?? []) {
    const productId = String(it?.product_id ?? '');
    const quantity = Number(it?.quantity ?? 0);
    const price = Number(it?.price ?? 0);
    if (!productId || quantity <= 0 || price < 0) {
      return err('Cada línea debe tener producto, cantidad (>0) y precio válido');
    }
    const existing = merged.get(productId);
    if (existing) {
      const totalQty = existing.quantity + quantity;
      existing.price = Math.round(((existing.price * existing.quantity) + (price * quantity)) / totalQty * 100) / 100;
      existing.quantity = totalQty;
      if (it.expiration_date) existing.expiration_date = String(it.expiration_date);
    } else {
      merged.set(productId, { quantity, price, expiration_date: it.expiration_date ? String(it.expiration_date) : null });
    }
  }
  const lines = [...merged.entries()].map(([product_id, v]) => ({ product_id, ...v }));

  const supplier = await queryOne<{ name: string }>('SELECT name FROM suppliers WHERE id = ? AND active = 1', [supplier_id]);
  if (!supplier) return err('Proveedor no encontrado o inactivo');

  // Prevalidar los productos antes de abrir la transacción para dar
  // errores claros (la transacción queda solo para el flujo feliz)
  for (const line of lines) {
    const prod = await queryOne<{ name: string }>('SELECT name FROM products WHERE id = ? AND active = 1', [line.product_id]);
    if (!prod) return err(`Producto no encontrado o inactivo: ${line.product_id}`, 404);
  }

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const invoiceRef = `Factura #${String(invoice_number).trim()}`;

  // En modo turnos, vincular el egreso/ingreso al turno abierto de la caja
  const shiftId = await getOpenShiftId(posId || null);

  const result = await transaction(async (conn) => {
    // Determinar almacén destino (por defecto el primero activo)
    let targetLocationId = location_id;
    if (!targetLocationId) {
      const locs = await conn.execute(
        'SELECT id FROM locations WHERE active=1 ORDER BY name ASC LIMIT 1'
      ) as unknown as [{ id: string }[], unknown];
      if (locs[0].length > 0) targetLocationId = locs[0][0].id;
    }

    const processed: { product_id: string; quantity: number; price: number; cost_after: number; purchase_id: string }[] = [];
    let totalCost = 0;

    for (const line of lines) {
      // Obtener datos actuales del producto (con bloqueo de fila)
      const product = await conn.execute(
        'SELECT stock, cost FROM products WHERE id=? AND active=1',
        [line.product_id]
      ) as unknown as [{ stock: number; cost: number }[], unknown];
      const current = product[0][0];
      if (!current) throw new Error(`Producto no encontrado o inactivo: ${line.product_id}`);

      const currentStock = Number(current.stock ?? 0);
      const currentCost = Number(current.cost ?? 0);
      const purchaseQty = Number(line.quantity);
      const purchasePrice = Math.round(Number(line.price) * 100) / 100;
      const newStock = currentStock + purchaseQty;
      const newCost = ((currentStock * currentCost) + (purchaseQty * purchasePrice)) / newStock;
      const lineTotal = Math.round(purchaseQty * purchasePrice * 100) / 100;
      totalCost += lineTotal;

      // Actualizar producto (stock, costo y opcionalmente fecha de caducidad)
      if (line.expiration_date) {
        await conn.execute(
          'UPDATE products SET stock=stock+?, cost=?, expiration_date=?, updated_at=? WHERE id=?',
          [purchaseQty, Math.round(newCost * 100) / 100, line.expiration_date, ts, line.product_id]
        );
      } else {
        await conn.execute(
          'UPDATE products SET stock=stock+?, cost=?, updated_at=? WHERE id=?',
          [purchaseQty, Math.round(newCost * 100) / 100, ts, line.product_id]
        );
      }

      // Notas con la referencia de factura (y vencimiento si aplica)
      const purchaseNotes = [
        invoiceRef,
        notes ? String(notes) : null,
        line.expiration_date ? `Vence: ${line.expiration_date}` : null,
      ].filter(Boolean).join(' | ');

      // Registrar movimiento de stock de entrada
      const smId = randomUUID();
      await conn.execute(
        "INSERT INTO stock_movements (id,product_id,type,quantity,reason,reference_id,user_id,date,created_at) VALUES (?,?,?,'in',?,?,?,?,?,?)",
        [smId, line.product_id, purchaseQty, purchaseNotes, null, sessionUser.id, ts, ts]
      );

      // Registrar precio de compra histórico
      const ppId = randomUUID();
      await conn.execute(
        'INSERT INTO purchase_prices (id,product_id,supplier_id,price,date,notes,created_at) VALUES (?,?,?,?,?,?,?)',
        [ppId, line.product_id, supplier_id, purchasePrice, ts, purchaseNotes, ts]
      );

      // Vincular producto con proveedor si no existe
      await conn.execute(
        'INSERT IGNORE INTO product_suppliers (id,product_id,supplier_id,is_preferred) VALUES (?,?,?,0)',
        [randomUUID(), line.product_id, supplier_id]
      );

      // Insertar registro en historial de compras
      const purchaseId = randomUUID();
      await conn.execute(
        'INSERT INTO purchases (id,product_id,supplier_id,quantity,unit_price,total_cost,location_id,notes,user_id,pos_id,invoice_number,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [purchaseId, line.product_id, supplier_id, purchaseQty, purchasePrice, lineTotal, targetLocationId ?? null, purchaseNotes, sessionUser.id, posId || null, String(invoice_number).trim(), ts]
      );

      // Actualizar stock del almacén
      if (targetLocationId) {
        await conn.execute(
          'INSERT INTO location_stock (id,location_id,product_id,quantity,updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+?,updated_at=?',
          [randomUUID(), targetLocationId, line.product_id, purchaseQty, ts, purchaseQty, ts]
        );
        await conn.execute(
          "INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,reference_id,user_id,created_at) VALUES (?,?,?,'entrada',?,?,?,?,?)",
          [randomUUID(), targetLocationId, line.product_id, purchaseQty, purchaseNotes, null, sessionUser.id, ts]
        );
      }

      processed.push({
        product_id: line.product_id,
        quantity: purchaseQty,
        price: purchasePrice,
        cost_after: Math.round(newCost * 100) / 100,
        purchase_id: purchaseId,
      });
    }

    // ── Registrar en contabilidad (un solo asiento por el total de la factura) ──
    const totalRounded = Math.round(totalCost * 100) / 100;
    const cashNotes = `${invoiceRef} (${processed.length} producto(s), proveedor: ${supplier.name})`;
    if (is_capital) {
      // Aporte de capital nuevo: ingresa dinero a la caja
      await conn.execute(
        `INSERT INTO cash_register (id, type, cash_amount, transfer_amount, notes, date, user_id, shift_id, created_at)
         VALUES (?, 'capital', ?, 0, ?, ?, ?, ?, ?)`,
        [randomUUID(), totalRounded, `Aporte de capital para compra ${cashNotes}`, ts, sessionUser.id, shiftId, ts]
      );
    } else {
      // Reinversión: egreso de caja por compra de inventario
      await conn.execute(
        `INSERT INTO cash_register (id, type, cash_amount, transfer_amount, notes, date, user_id, shift_id, created_at)
         VALUES (?, 'purchase', ?, 0, ?, ?, ?, ?, ?)`,
        [randomUUID(), -totalRounded, `Compra de inventario ${cashNotes}`, ts, sessionUser.id, shiftId, ts]
      );
    }

    return { items: processed, purchase_count: processed.length, total_cost: totalRounded };
  });

  return ok({ ok: true, ...result }, 201);
});
