export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, transaction } from '@/lib/db/mysql';
import { validatePaymentMethodOrDefault } from '@/lib/validate';
import { handle, ok, err } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

// ── API Móvil de Ventas ──────────────────────────────────────────
// Versión simplificada para Flutter. Acepta productos identificados
// por barcode o por id, y registra la venta con descuento de stock.

export const POST = handle(async (req: Request) => {
  const sessionUser = await requireAuth();
  const { items, payment, customer_id, location_id, notes } = await req.json();

  if (!items?.length) return err('La venta debe tener al menos un producto');

  // Si los items vienen con barcode en lugar de product_id, resolver a IDs
  const resolvedItems: {
    product_id: string;
    barcode?: string;
    quantity: number;
    unit_price: number;
    cost?: number;
  }[] = [];

  for (const item of items) {
    if (item.product_id) {
      // Ya viene con ID directo
      resolvedItems.push(item);
    } else if (item.barcode) {
      // Buscar producto por código de barras
      const product = await queryOne<{ id: string; sale_price: number; cost: number }>(
        'SELECT id, sale_price, cost FROM products WHERE barcode = ? AND active = 1 LIMIT 1',
        [item.barcode]
      );
      if (!product) {
        return err(`Producto con código ${item.barcode} no encontrado`);
      }
      resolvedItems.push({
        product_id: product.id,
        barcode: item.barcode,
        quantity: item.quantity ?? 1,
        unit_price: item.unit_price ?? product.sale_price,
        cost: item.cost ?? product.cost,
      });
    } else {
      return err('Cada item debe tener product_id o barcode');
    }
  }

  // Calcular total
  const total = resolvedItems.reduce(
    (a: number, i) => a + i.quantity * i.unit_price,
    0
  );

  const saleId = randomUUID();
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const status = payment?.method === 'credit' ? 'pending' : 'completed';
  const saleDate = ts;

  // Validar stock antes de la transacción
  for (const item of resolvedItems) {
    let available: number;
    if (location_id) {
      const locStock = await queryOne<{ quantity: number }>(
        'SELECT quantity FROM location_stock WHERE location_id=? AND product_id=?',
        [location_id, item.product_id]
      );
      available = locStock?.quantity ?? 0;
    } else {
      const prod = await queryOne<{ stock: number }>(
        'SELECT stock FROM products WHERE id=?',
        [item.product_id]
      );
      available = prod?.stock ?? 0;
    }
    if (available < item.quantity) {
      return err(
        `Stock insuficiente para "${item.barcode ?? item.product_id}". Disponible: ${available}`
      );
    }
  }

  await transaction(async (conn) => {
    // Insertar encabezado
    await conn.execute(
      `INSERT INTO sales (id,customer_id,user_id,date,total,status,notes,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [saleId, customer_id ?? null, sessionUser.id, saleDate, total, status, notes ?? null, ts, ts]
    );

    for (const item of resolvedItems) {
      // Insertar item de venta
      await conn.execute(
        `INSERT INTO sale_items (id,sale_id,product_id,quantity,unit_price,cost,created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [randomUUID(), saleId, item.product_id, item.quantity, item.unit_price, item.cost ?? 0, ts]
      );

      // Bloquear fila y descontar stock global
      const [lockRows] = await conn.execute(
        'SELECT stock FROM products WHERE id=? FOR UPDATE',
        [item.product_id]
      );
      const lockedStock = (lockRows as { stock: number }[])[0]?.stock ?? 0;
      if (lockedStock < item.quantity) {
        throw new Error(`Stock insuficiente del producto. Disponible: ${lockedStock}`);
      }
      await conn.execute(
        'UPDATE products SET stock=stock-?,updated_at=? WHERE id=?',
        [item.quantity, ts, item.product_id]
      );

      // Registrar movimiento de stock
      await conn.execute(
        `INSERT INTO stock_movements (id,product_id,type,quantity,reason,reference_id,user_id,date,created_at)
         VALUES (?,?,'out',?,?,?,?,?,?)`,
        [randomUUID(), item.product_id, item.quantity, 'Venta (App Móvil)', saleId, sessionUser.id, saleDate, ts]
      );

      // Descontar stock del almacén
      let targetLocationId = location_id;
      if (!targetLocationId) {
        const [locRows] = await conn.execute(
          'SELECT location_id FROM location_stock WHERE product_id=? AND quantity>0 ORDER BY quantity DESC LIMIT 1',
          [item.product_id]
        );
        const locs = locRows as { location_id: string }[];
        if (locs.length > 0) targetLocationId = locs[0].location_id;
      }

      if (targetLocationId) {
        const [locRows] = await conn.execute(
          'SELECT id, quantity FROM location_stock WHERE location_id=? AND product_id=?',
          [targetLocationId, item.product_id]
        );
        const existing = (locRows as { id: string; quantity: number }[])[0];
        const curQty = existing?.quantity ?? 0;
        if (curQty < item.quantity) {
          throw new Error(`Stock insuficiente en el almacén. Disponible: ${curQty}`);
        }
        const remaining = curQty - item.quantity;
        if (remaining <= 0) {
          if (existing) {
            await conn.execute('DELETE FROM location_stock WHERE location_id=? AND product_id=?',
              [targetLocationId, item.product_id]);
          }
        } else {
          await conn.execute('UPDATE location_stock SET quantity=?, updated_at=? WHERE location_id=? AND product_id=?',
            [remaining, ts, targetLocationId, item.product_id]);
        }
        await conn.execute(
          `INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,reference_id,user_id,created_at)
           VALUES (?,?,?,'venta',?,?,?,?,?)`,
          [randomUUID(), targetLocationId, item.product_id, item.quantity, 'Venta (App Móvil)', saleId, sessionUser.id, ts]
        );
      }
    }

    // Registrar pago
    const method = validatePaymentMethodOrDefault(payment?.method);
    const amountCash = method === 'cash' ? total : (payment?.amount_cash ?? 0);
    const amountTransfer = method === 'transfer' ? total : (payment?.amount_transfer ?? 0);
    await conn.execute(
      `INSERT INTO payments (id,sale_id,method,amount_cash,amount_transfer,date,notes,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [randomUUID(), saleId, method, amountCash, amountTransfer, saleDate, payment?.notes ?? null, ts]
    );

    // Si es crédito, actualizar saldo
    if (method === 'credit' && customer_id) {
      await conn.execute('UPDATE customers SET balance=balance+?,updated_at=? WHERE id=?',
        [total, ts, customer_id]);
    }
  });

  return ok({ id: saleId, total, status }, 201);
});
