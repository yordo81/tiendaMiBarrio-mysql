export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, transaction } from '@/lib/db/mysql';
import { validatePaymentMethodOrDefault, requirePositiveNumber } from '@/lib/validate';
import { handle, ok, err } from '@/lib/api-helpers';
import { getBusinessSettings } from '@/lib/settings-server';
import { invalidateAllReportCaches } from '@/lib/report-cache';
import { logAudit } from '@/lib/db/audit';
const randomUUID = () => crypto.randomUUID();

// ── API de Ventas (POS) ────────────────────────────────────────────
// GET: Lista de ventas con filtros por fecha
// POST: Crear nueva venta con productos, pagos y descuento de stock

// ── GET: Listar ventas ──
export const GET = handle(async (req: Request) => {
  await requireAuth();
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'), to = searchParams.get('to');
  const posId = searchParams.get('pos_id');
  const userId = searchParams.get('user_id');
  const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') ?? '50') || 50));

  let sql = `SELECT s.*,c.name AS customer_name,u.name AS user_name,p.name AS pos_name,cur.symbol AS currency_symbol,cur.name AS currency_name FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.user_id LEFT JOIN pos p ON p.id=s.pos_id LEFT JOIN currencies cur ON cur.code=s.currency_code`;
  const params: unknown[] = [];
  const where: string[] = [];
  if (from) { where.push('s.date>=?'); params.push(from); }
  if (to)   { where.push('s.date<=?'); params.push(to + ' 23:59:59'); }
  // Filtro por usuario: permite que cada vendedor vea solo sus propias ventas
  if (userId) { where.push('s.user_id = ?'); params.push(userId); }
  // Filtro por caja (punto de venta); 'none' = ventas sin caja asignada
  if (posId) {
    if (posId === 'none') where.push('s.pos_id IS NULL');
    else { where.push('s.pos_id = ?'); params.push(posId); }
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY s.date DESC LIMIT ' + Math.floor(limit);
  return ok(await query(sql, params));
});

// ── POST: Crear nueva venta ──
export const POST = handle(async (req: Request) => {
  const sessionUser = await requireAuth();
  const { items, payment, customer_id, location_id, notes, date, pos_id, currency_code, exchange_rate } = await req.json();
  if (!items?.length) return err('La venta debe tener al menos un producto');
  // Nota: las ventas a crédito pueden registrarse sin cliente (el POS táctil
  // de los vendedores no pide cliente; la deuda queda pendiente en el historial).

  // Caja (punto de venta) opcional: atribuye la venta a la caja para el arqueo del turno
  const posId = pos_id ? String(pos_id).trim() : '';
  if (posId) {
    const pos = await queryOne<{ id: string }>('SELECT id FROM pos WHERE id = ? AND active = 1', [posId]);
    if (!pos) return err('La caja seleccionada no existe o está desactivada');
  }

  // ── Resolver productos desde la BD (integridad de precios) ──────
  // El precio de venta y el costo se resuelven desde la BD. Los
  // vendedores y almaceneros no pueden enviar precios custom: siempre
  // se usa el sale_price de la BD. Solo el dueño y el admin pueden
  // modificar el precio de venta al crear la venta.
  const canOverridePrice = sessionUser.role === 'owner' || sessionUser.role === 'admin';
  // Registro de precios modificados para auditoría
  const priceOverrides: { product_id: string; product_name: string; original_price: number; custom_price: number; quantity: number }[] = [];
  const resolvedItems: {
    product_id: string;
    quantity: number;
    unit_price: number;
    cost: number;
    name: string;
  }[] = [];
  for (const item of items) {
    if (!item?.product_id) return err('Cada producto de la venta requiere product_id');
    const qty = requirePositiveNumber(item.quantity, 'Cantidad');
    const product = await queryOne<{ id: string; sale_price: number; cost: number; name: string }>(
      'SELECT id, sale_price, cost, name FROM products WHERE id = ? AND active = 1 LIMIT 1',
      [item.product_id]
    );
    if (!product) return err('Producto no encontrado o inactivo');
    // El precio unitario viene del cliente: solo el dueño/admin puede
    // enviar un precio custom; el resto siempre usa el de la BD.
    const clientPrice = Number(item.unit_price);
    const dbPrice = Number(product.sale_price);
    const unitPrice = canOverridePrice && clientPrice > 0 ? clientPrice : dbPrice;
    // Registrar si el precio fue modificado (para auditoría)
    if (canOverridePrice && clientPrice > 0 && clientPrice !== dbPrice) {
      priceOverrides.push({
        product_id: product.id,
        product_name: product.name,
        original_price: dbPrice,
        custom_price: clientPrice,
        quantity: qty,
      });
    }
    resolvedItems.push({
      product_id: product.id,
      quantity: qty,
      unit_price: unitPrice,
      cost: Number(product.cost),
      name: product.name,
    });
  }
  const itemsToProcess = resolvedItems;

  // En modo por turnos, las ventas requieren un turno abierto en la caja:
  // se bloquea la venta hasta que el vendedor abra el turno desde su dashboard.
  const settings = await getBusinessSettings();
  if (settings.work_mode === 'shifts') {
    if (!posId) return err('Estás en modo por turnos: abre un turno en una caja para poder vender');
    const openShift = await queryOne<{ id: string }>("SELECT id FROM shifts WHERE status='open' AND pos_id=? LIMIT 1", [posId]);
    if (!openShift) return err('No hay un turno abierto en la caja seleccionada. Abre un turno antes de vender.');
  }

  const saleId = randomUUID();
  const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  const tz = process.env.TIMEZONE ?? 'America/Havana';
  const saleDate = date
    ? new Date(date).toISOString().slice(0,19).replace('T',' ')
    : new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      }).format(new Date()).replace(', ', ' ');
  const total = itemsToProcess.reduce((a: number, i: { quantity: number; unit_price: number }) => a + i.quantity * i.unit_price, 0);
  const status = payment?.method === 'credit' ? 'pending' : 'completed';

  // ── Resolver moneda y tasa de cambio ──
  const saleCurrency = currency_code ? String(currency_code).trim().toUpperCase() : null;
  let saleExchangeRate = exchange_rate ? parseFloat(exchange_rate) : null;
  // Si se especificó moneda pero no tasa, obtenerla de la BD
  if (saleCurrency && !saleExchangeRate) {
    const baseCurrency = await queryOne<{ code: string }>("SELECT code FROM currencies WHERE is_base = 1 AND active = 1 LIMIT 1");
    const base = baseCurrency?.code ?? 'CUP';
    if (saleCurrency !== base) {
      const rate = await queryOne<{ rate: number }>(
        'SELECT rate FROM currency_rates WHERE from_currency = ? AND to_currency = ?',
        [saleCurrency, base]
      );
      saleExchangeRate = rate?.rate ?? 1;
    } else {
      saleExchangeRate = 1;
    }
  }
  // Si no se especificó moneda, usar la base
  if (!saleCurrency) {
    const baseCurrency = await queryOne<{ code: string }>("SELECT code FROM currencies WHERE is_base = 1 AND active = 1 LIMIT 1");
    // saleCurrency queda null y saleExchangeRate queda null (moneda base)
  }

  // ── Validar stock antes de iniciar la transacción (pre-check rápido) ──
  for (const item of itemsToProcess) {
    let available: number;
    if (location_id) {
      // Validar stock en el almacén específico seleccionado
      const locStock = await queryOne<{ quantity: number }>(
        'SELECT quantity FROM location_stock WHERE location_id=? AND product_id=?',
        [location_id, item.product_id]
      );
      available = locStock?.quantity ?? 0;
    } else {
      // Validar stock global cuando no hay almacén
      const prod = await queryOne<{ stock: number }>(
        'SELECT stock FROM products WHERE id=?',
        [item.product_id]
      );
      available = prod?.stock ?? 0;
    }
    if (available < item.quantity) {
      return err(`Stock insuficiente${location_id?' en el almacén seleccionado':''}. Disponible: ${available}, solicitado: ${item.quantity}`);
    }
  }

  await transaction(async (conn) => {
    // Insertar encabezado de venta (incluye moneda)
    await conn.execute(
      'INSERT INTO sales (id,customer_id,user_id,pos_id,currency_code,exchange_rate,date,total,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [saleId, customer_id??null, sessionUser.id, posId || null, saleCurrency, saleExchangeRate, saleDate, total, status, notes??null, ts, ts]
    );
    for (const item of itemsToProcess) {
      // Insertar cada producto vendido (precio, costo y moneda desde la BD)
      await conn.execute(
        'INSERT INTO sale_items (id,sale_id,currency_code,exchange_rate,product_id,quantity,unit_price,cost,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [randomUUID(), saleId, saleCurrency, saleExchangeRate, item.product_id, item.quantity, item.unit_price, item.cost, ts]
      );
      // Validar stock dentro de la transacción con bloqueo de fila (race-condition safe)
      const [lockRows] = await conn.execute(
        'SELECT stock FROM products WHERE id=? FOR UPDATE',
        [item.product_id]
      );
      const lockedStock = (lockRows as { stock: number }[])[0]?.stock ?? 0;
      if (lockedStock < item.quantity) {
        throw new Error(`Stock insuficiente del producto. Disponible: ${lockedStock}, solicitado: ${item.quantity}`);
      }
      // Descontar stock global
      await conn.execute('UPDATE products SET stock=stock-?,updated_at=? WHERE id=?',[item.quantity, ts, item.product_id]);
      // Registrar movimiento de stock
      await conn.execute(
        "INSERT INTO stock_movements (id,product_id,type,quantity,reason,reference_id,user_id,date,created_at) VALUES (?,?,'out',?,?,?,?,?,?)",
        [randomUUID(), item.product_id, item.quantity, 'Venta', saleId, sessionUser.id, saleDate, ts]
      );

      // Descontar stock del almacén correspondiente
      let targetLocationId = location_id;
      if (!targetLocationId) {
        // Si no se especificó almacén, usar el que tenga más stock
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

        // Validar stock en la ubicación
        if (curQty < item.quantity) {
          throw new Error(`Stock insuficiente en el almacén. Disponible: ${curQty}, solicitado: ${item.quantity}`);
        }

        const remaining = curQty - item.quantity;

        if (remaining <= 0) {
          if (existing) {
            await conn.execute('DELETE FROM location_stock WHERE location_id=? AND product_id=?', [targetLocationId, item.product_id]);
          }
        } else {
          await conn.execute('UPDATE location_stock SET quantity=?, updated_at=? WHERE location_id=? AND product_id=?',
            [remaining, ts, targetLocationId, item.product_id]);
        }

        // Registrar movimiento de almacén
        await conn.execute(
          'INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,reference_id,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          [randomUUID(), targetLocationId, item.product_id, 'venta', item.quantity, 'Venta registrada', saleId, sessionUser.id, ts]
        );
      }
    }

    // Registrar el pago
    const method = validatePaymentMethodOrDefault(payment?.method);
    const amountCash = method === 'cash' ? total : (payment?.amount_cash ?? 0);
    const amountTransfer = method === 'transfer' ? total : (payment?.amount_transfer ?? 0);
    await conn.execute(
      'INSERT INTO payments (id,sale_id,method,amount_cash,amount_transfer,date,notes,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [randomUUID(), saleId, method, amountCash, amountTransfer, saleDate, payment?.notes??null, ts]
    );

    // Si es crédito, actualizar saldo del cliente
    if (method === 'credit' && customer_id) {
      await conn.execute('UPDATE customers SET balance=balance+?,updated_at=? WHERE id=?',[total, ts, customer_id]);
    }
  });

  // Datos completos de la venta para imprimir el ticket del cliente
  const sale = await queryOne<Record<string, unknown>>(
    `SELECT s.*, c.name AS customer_name, u.name AS user_name, p.name AS pos_name
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN pos p ON p.id = s.pos_id
     WHERE s.id = ?`,
    [saleId]
  );
  const saleItems = await query<Record<string, unknown>>(
    `SELECT si.*, p.name AS product_name, p.unit FROM sale_items si
     LEFT JOIN products p ON p.id = si.product_id
     WHERE si.sale_id = ?`,
    [saleId]
  );

  // Invalidar caché de reportes (dashboard, seller, margins, etc.)
  invalidateAllReportCaches(sessionUser.id).catch(() => {});

  // Registrar auditoría de precios modificados por admin/dueño
  if (priceOverrides.length > 0) {
    for (const override of priceOverrides) {
      await logAudit({
        user_id: sessionUser.id,
        user_name: sessionUser.name,
        action: 'price_override',
        entity_type: 'sale_item',
        entity_id: saleId,
        entity_name: override.product_name,
        details: {
          product_id: override.product_id,
          original_price: override.original_price,
          custom_price: override.custom_price,
          quantity: override.quantity,
          sale_total: total,
        },
      });
    }
  }

  return ok({ ...(sale ?? {}), id: saleId, total, status, items: saleItems }, 201);
});