export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute, transaction } from '@/lib/db/mysql';
import { logAudit } from '@/lib/db/audit';
import { normalizePhone } from '@/lib/validate';
import { handle, ok, err } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

// ── Validar formato de teléfono dominicano ──
const PHONE_REGEX = /^(\+?53)?[\s.-]?\d{7,8}$/;

function isValidPhone(phone: string): boolean {
  return PHONE_REGEX.test(phone.trim());
}

// ── GET: Listar reservaciones (autenticado, dashboard) ──
export const GET = handle(async (req: Request) => {
  await requireAuth();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status'); // pending, confirmed, cancelled

  let sql = `
    SELECT r.*, p.name AS product_name, p.sale_price, p.unit
    FROM reservations r
    LEFT JOIN products p ON p.id = r.product_id
  `;
  const params: unknown[] = [];
  if (status) {
    sql += ' WHERE r.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY r.created_at DESC';

  const rows = await query(sql, params);
  return ok(rows);
});

// ── PUT: Actualizar estado de una reservación (confirmar/cancelar) ──
// Al confirmar, se crea automáticamente una venta y se descuenta del inventario.
export const PUT = handle(async (req: Request) => {
  const sessionUser = await requireAuth();
  const { id, status } = await req.json();

  if (!id) return err('ID de reservación requerido');
  if (!['pending', 'confirmed', 'cancelled'].includes(status)) {
    return err('Estado inválido. Valores: pending, confirmed, cancelled');
  }

  const existing = await query<{
    id: string;
    status: string;
    product_id: string;
    quantity: number;
    customer_name: string;
    customer_phone: string | null;
  }>('SELECT id, status, product_id, quantity, customer_name, customer_phone FROM reservations WHERE id = ?', [id]);
  if (existing.length === 0) return err('Reservación no encontrada');

  // Solo permitir modificar reservaciones pendientes
  if (existing[0].status !== 'pending') {
    return err('Solo se pueden modificar reservaciones con estado pendiente');
  }

  const reservation = existing[0];
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  if (status === 'confirmed') {
    // ── CONFIRMAR: Crear venta + descontar inventario ──
    const product = await queryOne<{
      id: string;
      name: string;
      sale_price: number;
      cost: number;
      stock: number;
      unit: string;
    }>('SELECT id, name, sale_price, cost, stock, unit FROM products WHERE id = ? AND active = 1', [reservation.product_id]);

    if (!product) return err('Producto no encontrado o no disponible');

    const qty = Number(reservation.quantity);
    if (Number(product.stock) < qty) {
      return err(`Stock insuficiente. Disponible: ${product.stock} ${product.unit}, solicitado: ${qty}`);
    }

    // Crear o reusar cliente
    let customerId: string | null = null;
    if (reservation.customer_name?.trim()) {
      const existingCustomer = await queryOne<{ id: string }>(
        'SELECT id FROM customers WHERE name = ? AND active = 1 LIMIT 1',
        [reservation.customer_name.trim()]
      );
      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        const newCustomerId = randomUUID();
        await execute(
          'INSERT INTO customers (id, name, phone, notes, balance, active, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?)',
          [newCustomerId, reservation.customer_name.trim(), reservation.customer_phone, `Creado desde reservación ${id}`, ts, ts]
        );
        customerId = newCustomerId;
      }
    }

    const saleId = randomUUID();
    const total = Number(product.sale_price) * qty;

    await transaction(async (conn) => {
      // 1. Actualizar estado de la reservación
      await conn.execute(
        'UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?',
        ['confirmed', ts, id]
      );

      // 2. Crear la venta
      await conn.execute(
        'INSERT INTO sales (id, customer_id, user_id, date, total, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [saleId, customerId, sessionUser.id, ts, total, 'completed', `Venta generada desde reservación ${id}`, ts, ts]
      );

      // 3. Crear item de venta
      await conn.execute(
        'INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price, cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), saleId, product.id, qty, Number(product.sale_price), Number(product.cost), ts]
      );

      // 4. Descontar stock global con bloqueo de fila
      const [lockRows] = await conn.execute(
        'SELECT stock FROM products WHERE id = ? FOR UPDATE',
        [product.id]
      );
      const lockedStock = (lockRows as { stock: number }[])[0]?.stock ?? 0;
      if (lockedStock < qty) {
        throw new Error(`Stock insuficiente. Disponible: ${lockedStock}, solicitado: ${qty}`);
      }
      await conn.execute('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?', [qty, ts, product.id]);

      // 5. Registrar movimiento de stock
      await conn.execute(
        "INSERT INTO stock_movements (id, product_id, type, quantity, reason, reference_id, user_id, date, created_at) VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?)",
        [randomUUID(), product.id, qty, 'Venta por reservación confirmada', saleId, sessionUser.id, ts, ts]
      );

      // 6. Descontar de location_stock (del primer almacén con stock)
      const [locRows] = await conn.execute(
        'SELECT location_id, quantity FROM location_stock WHERE product_id = ? AND quantity > 0 ORDER BY quantity DESC LIMIT 1',
        [product.id]
      );
      const locations = locRows as { location_id: string; quantity: number }[];
      if (locations.length > 0) {
        const loc = locations[0];
        const remaining = Number(loc.quantity) - qty;
        if (remaining <= 0) {
          await conn.execute('DELETE FROM location_stock WHERE location_id = ? AND product_id = ?', [loc.location_id, product.id]);
        } else {
          await conn.execute('UPDATE location_stock SET quantity = ?, updated_at = ? WHERE location_id = ? AND product_id = ?',
            [remaining, ts, loc.location_id, product.id]);
        }

        await conn.execute(
          'INSERT INTO location_movements (id, location_id, product_id, type, quantity, notes, reference_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [randomUUID(), loc.location_id, product.id, 'venta', qty, 'Venta por reservación confirmada', saleId, sessionUser.id, ts]
        );
      }

      // 7. Crear pago en efectivo (la reservación se paga al confirmar)
      await conn.execute(
        'INSERT INTO payments (id, sale_id, method, amount_cash, amount_transfer, date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [randomUUID(), saleId, 'cash', total, 0, ts, `Pago de reservación ${id}`, ts]
      );
    });

    await logAudit({
      user_id: sessionUser.id,
      user_name: sessionUser.name,
      action: 'confirm',
      entity_type: 'reservation',
      entity_id: id,
      entity_name: `Reservación de ${reservation.customer_name} — ${qty} ${product.unit}(s) de ${product.name}`,
      details: {
        product_id: product.id,
        product_name: product.name,
        quantity: qty,
        total,
        sale_id: saleId,
        customer_name: reservation.customer_name,
        customer_phone: reservation.customer_phone,
      },
    });

    return ok({
      ok: true,
      id,
      status: 'confirmed',
      sale_id: saleId,
      message: `Reservación confirmada y venta #${saleId.slice(0, 8)} creada por $${total.toFixed(2)}`,
    });
  }

  // ── CANCELAR: Solo actualizar estado ──
  await execute(
    'UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?',
    [status, ts, id]
  );

  await logAudit({
    user_id: sessionUser.id,
    user_name: sessionUser.name,
    action: 'cancel',
    entity_type: 'reservation',
    entity_id: id,
    entity_name: `Reservación cancelada — ${reservation.customer_name} (${reservation.quantity} unidad(es))`,
    details: {
      product_id: reservation.product_id,
      quantity: reservation.quantity,
      customer_name: reservation.customer_name,
      customer_phone: reservation.customer_phone,
    },
  });

  return ok({ ok: true, id, status });
});

// ── POST: Crear reservación(es) (pública, landing page) ──
// Soporta tanto un solo producto como múltiples productos (carrito)
// Formato legacy: { product_id, quantity, customer_name, customer_phone, notes }
// Formato carrito: { items: [{ product_id, quantity }], customer_name, customer_phone, notes }
export const POST = handle(async (req: Request) => {
  const body = await req.json() as { customer_name?: string; customer_phone?: string; notes?: string; items?: { product_id: string; quantity: number }[]; product_id?: string; quantity?: number };
  const { customer_name, customer_phone, notes } = body;
  const items: { product_id: string; quantity: number }[] = body.items ?? [{ product_id: body.product_id ?? '', quantity: body.quantity ?? 0 }];

  if (!customer_name?.trim()) return err('Tu nombre es requerido');

  // Validar formato de teléfono si se proporcionó
  if (customer_phone?.trim() && !isValidPhone(customer_phone)) {
    return err('Formato de teléfono inválido. Ejemplo: +53 55280263');
  }

  if (!items?.length) return err('Debes agregar al menos un producto');

  for (const item of items) {
    if (!item.product_id) return err('Cada producto debe tener un ID');
    if (!item.quantity || item.quantity <= 0) return err('La cantidad debe ser mayor a 0');
  }

  // Verificar que todos los productos existen y tienen stock suficiente
  const placeholders = items.map(() => '?').join(',');
  const productIds = items.map(i => i.product_id);
  const products = await query<{
    id: string;
    name: string;
    sale_price: number;
    stock: number;
    unit: string;
  }>(`SELECT id, name, sale_price, stock, unit FROM products WHERE id IN (${placeholders}) AND active = 1`, productIds);

  if (products.length !== items.length) {
    return err('Uno o más productos no fueron encontrados o no están disponibles');
  }

  const productMap = new Map(products.map(p => [p.id, p]));
  const productNames: string[] = [];

  for (const item of items) {
    const prod = productMap.get(item.product_id);
    if (!prod) return err('Producto no encontrado');
    const available = Number(prod.stock);
    if (available < item.quantity) {
      return err(`Stock insuficiente para "${prod.name}". Disponible: ${available} ${prod.unit}, solicitado: ${item.quantity}`);
    }
    productNames.push(`${item.quantity} ${prod.unit}(s) de ${prod.name}`);
  }

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const ids: string[] = [];

  for (const item of items) {
    const id = randomUUID();
    ids.push(id);
    await execute(
      `INSERT INTO reservations (id, product_id, customer_name, customer_phone, quantity, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [id, item.product_id, customer_name.trim(), normalizePhone(customer_phone), item.quantity, notes?.trim() ?? null, ts, ts]
    );
  }

  const message = items.length === 1
    ? `Reservación creada para ${productNames[0]}. Te contactaremos pronto.`
    : `Reservación creada para ${items.length} producto(s): ${productNames.join(', ')}. Te contactaremos pronto.`;

  return ok({ ok: true, ids, message }, 201);
});
