export const dynamic = 'force-dynamic';
import { pool, query, queryOne, transaction, execute } from '@/lib/db/mysql';
import { handle, ok, err, notFound, requireRole } from '@/lib/api-helpers';
import { requirePositiveNumber, requireNonNegativeNumber } from '@/lib/validate';
import { getOpenShiftId } from '@/lib/settings-server';
import { resolvePurchaseFactor, resolveCaptureUnit } from '@/lib/purchase-unit';
const randomUUID = () => crypto.randomUUID();

// ── API de Compras a Proveedores ───────────────────────────────────
// GET: Listar compras con filtros por producto, proveedor y fechas
// POST: Registrar una nueva compra con actualización de stock, costos y contabilidad

// ── GET: Listar compras ──
export const GET = handle(async (req: Request) => {
  await requireRole('owner', 'admin', 'warehouse');
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get('product_id');
  const supplierId = searchParams.get('supplier_id');
  const invoiceNumber = searchParams.get('invoice_number');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 500);

  let sql = `SELECT p.*, pr.name AS product_name, s.name AS supplier_name, u.name AS user_name, l.name AS location_name, po.name AS pos_name
             FROM purchases p
             LEFT JOIN products pr ON pr.id = p.product_id
             LEFT JOIN suppliers s ON s.id = p.supplier_id
             LEFT JOIN users u ON u.id = p.user_id
             LEFT JOIN locations l ON l.id = p.location_id
             LEFT JOIN pos po ON po.id = p.pos_id`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (productId) { conditions.push('p.product_id = ?'); params.push(productId); }
  if (supplierId) { conditions.push('p.supplier_id = ?'); params.push(supplierId); }
  if (invoiceNumber) { conditions.push('p.invoice_number LIKE ?'); params.push(`%${invoiceNumber}%`); }
  if (from) { conditions.push('p.created_at >= ?'); params.push(from); }
  if (to) {
    const toDate = to.length === 10 ? to + ' 23:59:59' : to;
    conditions.push('p.created_at <= ?');
    params.push(toDate);
  }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY p.created_at DESC LIMIT ' + limit;    return ok(await query(sql, params));
});

// ── Helper: obtener la moneda base del sistema ──
async function getBaseCurrency(): Promise<string> {
  const base = await queryOne<{ code: string }>(
    "SELECT code FROM currencies WHERE is_base = 1 AND active = 1 LIMIT 1"
  );
  return base?.code ?? 'CUP';
}

// ── Helper: obtener tasa de cambio ──
// Las tasas se guardan SIEMPRE contra el dólar (1 USD = X moneda) y de
// ahí se deriva la tasa entre dos monedas:
//   1 from = (USD de to) / (USD de from) to
async function getUsdRate(code: string): Promise<number | null> {
  if (code === 'USD') return 1;
  const row = await queryOne<{ rate: number }>(
    "SELECT rate FROM currency_rates WHERE from_currency = 'USD' AND to_currency = ?",
    [code]
  );
  const rate = row ? Number(row.rate) : 0;
  return rate > 0 ? rate : null;
}

async function getExchangeRate(from: string, to: string): Promise<number> {
  if (from === to) return 1;
  const [fromUsd, toUsd] = await Promise.all([getUsdRate(from), getUsdRate(to)]);
  if (fromUsd && toUsd) return toUsd / fromUsd;
  // Sin referencia USD utilizable: par directo guardado a mano (si existe)
  const direct = await queryOne<{ rate: number }>(
    'SELECT rate FROM currency_rates WHERE from_currency = ? AND to_currency = ?',
    [from, to]
  );
  const rate = direct ? Number(direct.rate) : 0;
  return rate > 0 ? rate : 1;
}

// ── POST: Registrar nueva compra ──
export const POST = handle(async (req: Request) => {
  const sessionUser = await requireRole('owner', 'admin', 'warehouse');
  // `unit` (opcional): unidad en que se captura la cantidad/precio. NULL/
  // ausente = unidad de compra configurada del producto (o su unidad de venta).
  const { product_id, supplier_id, quantity, price, unit, location_id, notes, is_capital, expiration_date, pos_id, invoice_number, currency_code, exchange_rate } = await req.json();

  if (!product_id || !supplier_id) {
    return err('Faltan datos: producto y proveedor requeridos');
  }
  const qty = requirePositiveNumber(quantity, 'Cantidad');
  const unitPrice = requireNonNegativeNumber(price, 'Precio de compra');

  // Caja (punto de venta) opcional: atribuye la compra a la caja para el arqueo del turno
  const posId = pos_id ? String(pos_id).trim() : '';
  if (posId) {
    const pos = await queryOne<{ id: string }>('SELECT id FROM pos WHERE id = ? AND active = 1', [posId]);
    if (!pos) return err('La caja seleccionada no existe o está desactivada');
  }

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Construir notas de compra incluyendo la referencia de factura y caducidad
  const invoiceRef = invoice_number && String(invoice_number).trim() ? `Factura #${String(invoice_number).trim()}` : null;
  const purchaseNotes = [
    invoiceRef,
    expiration_date ? `Vence: ${expiration_date}` : null,
    notes ? String(notes) : null,
  ].filter(Boolean).join(' | ') || null;

  // Verificar que el producto existe y está activo
  const [preCheck] = await pool.execute(
    'SELECT stock, cost FROM products WHERE id=? AND active=1', [product_id]
  ) as unknown as [{ stock: number; cost: number }[], unknown];
  if (!preCheck[0]) {
    return notFound('Producto no encontrado o inactivo');
  }

  // Resolver moneda y tasa de cambio
  const baseCurrency = await getBaseCurrency();
  const purchaseCurrency = currency_code ? String(currency_code).trim().toUpperCase() : baseCurrency;
  let purchaseExchangeRate = exchange_rate ? parseFloat(exchange_rate) : null;
  if (purchaseCurrency !== baseCurrency && !purchaseExchangeRate) {
    purchaseExchangeRate = await getExchangeRate(purchaseCurrency, baseCurrency);
  }
  if (purchaseCurrency === baseCurrency) {
    purchaseExchangeRate = 1;
  }

  // En modo turnos, vincular el egreso/ingreso al turno abierto de la caja
  const shiftId = await getOpenShiftId(posId || null);

  // Ejecutar toda la operación en una transacción
  const result = await transaction(async (conn) => {
    // Obtener datos actuales del producto (con bloqueo de fila), incluyendo
    // la unidad de venta y la configuración de compra (migración 037)
    const product = await conn.execute(
      'SELECT stock, cost, unit, purchase_unit, purchase_factor FROM products WHERE id=? AND active=1',
      [product_id]
    ) as unknown as [{ stock: number; cost: number; unit: string; purchase_unit: string | null; purchase_factor: number | null }[], unknown];
    const current = product[0][0];

    const currentStock = Number(current.stock ?? 0);
    const currentCost = Number(current.cost ?? 0);

    // ── Conversión compra → venta (migración 037) ──
    // La compra se captura en `unit` (por defecto la unidad de compra del
    // producto). Si esa unidad difiere de la unidad de venta y el producto
    // tiene factor configurado:
    //   stock a incrementar         = cantidad × factor
    //   precio por unidad de venta  = precio de compra ÷ factor
    //   (el total en dinero no cambia)
    const captureUnit = resolveCaptureUnit(current, unit ? String(unit) : null);
    const factor = resolvePurchaseFactor(current, captureUnit);
    const purchaseQty = qty;                                        // unidades de captura
    const stockQty = Math.round(qty * factor * 1000) / 1000;        // unidades de venta/stock
    const saleUnitPrice = Math.round((unitPrice / factor) * 100) / 100; // precio por unidad de venta
    const purchasePrice = unitPrice;
    // Convertir precio (por unidad de venta) a moneda base para el costo promedio
    const basePrice = Math.round(saleUnitPrice * (purchaseExchangeRate ?? 1) * 100) / 100;

    // Calcular nuevo stock y costo promedio ponderado (en moneda base)
    const newStock = currentStock + stockQty;
    const newCost = ((currentStock * currentCost) + (stockQty * basePrice)) / newStock;

    // Actualizar producto (stock en unidades de venta, costo y opcionalmente fecha de caducidad)
    if (expiration_date) {
      await conn.execute(
        'UPDATE products SET stock=stock+?, cost=?, expiration_date=?, updated_at=? WHERE id=?',
        [stockQty, Math.round(newCost * 100) / 100, expiration_date, ts, product_id]
      );
    } else {
      await conn.execute(
        'UPDATE products SET stock=stock+?, cost=?, updated_at=? WHERE id=?',
        [stockQty, Math.round(newCost * 100) / 100, ts, product_id]
      );
    }

    // Registrar movimiento de stock de entrada (en unidades de venta; se
    // anota la equivalencia cuando hubo conversión)
    const smId = randomUUID();
    const stockMovReason = factor !== 1 && current.unit
      ? `${purchaseNotes ? `Compra: ${purchaseNotes}` : 'Compra'} — ${purchaseQty} ${captureUnit} = ${stockQty} ${current.unit}`
      : (purchaseNotes ? `Compra: ${purchaseNotes}` : 'Compra');
    await conn.execute(
      "INSERT INTO stock_movements (id,product_id,type,quantity,reason,reference_id,user_id,date,created_at) VALUES (?,?,'in',?,?,?,?,?,?)",
      [smId, product_id, stockQty, stockMovReason, null, sessionUser.id, ts, ts]
    );

    // Registrar precio de compra histórico (precio en su unidad de captura)
    const ppId = randomUUID();
    await conn.execute(
      'INSERT INTO purchase_prices (id,product_id,supplier_id,price,unit,date,notes,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [ppId, product_id, supplier_id, purchasePrice, captureUnit, ts, purchaseNotes, ts]
    );

    // Vincular producto con proveedor si no existe
    await conn.execute(
      'INSERT IGNORE INTO product_suppliers (id,product_id,supplier_id,is_preferred) VALUES (?,?,?,0)',
      [randomUUID(), product_id, supplier_id]
    );

    // Determinar almacén destino
    let targetLocationId = location_id;
    if (!targetLocationId) {
      const locs = await conn.execute(
        'SELECT id FROM locations WHERE active=1 ORDER BY name ASC LIMIT 1'
      ) as unknown as [{ id: string }[], unknown];
      if (locs[0].length > 0) targetLocationId = locs[0][0].id;
    }

    // ── Obtener nombres para la nota contable ──
    const prodRes = await conn.execute(
      'SELECT name FROM products WHERE id=?', [product_id]
    ) as unknown as [{ name: string }[], unknown];
    const suppRes = await conn.execute(
      'SELECT name FROM suppliers WHERE id=?', [supplier_id]
    ) as unknown as [{ name: string }[], unknown];
    const productName = prodRes[0][0]?.name ?? 'Producto';
    const supplierName = suppRes[0][0]?.name ?? 'Proveedor';

    // Insertar registro en historial de compras (cantidad y precio en la
    // unidad de captura; `purchases.unit` deja inequívoco el histórico).
    // El total del dinero sí o sí es cantidad × precio de captura: 50 kg × $100.
    const purchaseId = randomUUID();
    const totalCost = Math.round(purchaseQty * purchasePrice * (purchaseExchangeRate ?? 1) * 100) / 100;
    await conn.execute(
      'INSERT INTO purchases (id,product_id,supplier_id,quantity,unit,total_cost,unit_price,location_id,notes,user_id,pos_id,invoice_number,currency_code,exchange_rate,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [purchaseId, product_id, supplier_id, purchaseQty, captureUnit, totalCost, purchasePrice, targetLocationId ?? null, purchaseNotes, sessionUser.id, posId || null, invoice_number ? String(invoice_number).trim() : null, purchaseCurrency, purchaseExchangeRate, ts]
    );

    // ── Registrar en contabilidad ──
    // Descripción legible de la cantidad: en unidades de venta, con la
    // unidad de captura entre paréntesis si difiere
    const qtyDescription = factor !== 1 && current.unit
      ? `${stockQty} ${current.unit} (${purchaseQty} ${captureUnit ?? ''})`
      : `${purchaseQty}`;

    if (is_capital) {
      // Aporte de capital nuevo: ingresa dinero a la caja
      await conn.execute(
        `INSERT INTO cash_register (id, type, cash_amount, transfer_amount, notes, date, user_id, shift_id, created_at)
         VALUES (?, 'capital', ?, 0, ?, ?, ?, ?, ?)`,
        [randomUUID(), totalCost, `Aporte de capital para compra: ${qtyDescription} de ${productName} (proveedor: ${supplierName})`, ts, sessionUser.id, shiftId, ts]
      );
    } else {
      // Reinversión: egreso de caja por compra de inventario
      await conn.execute(
        `INSERT INTO cash_register (id, type, cash_amount, transfer_amount, notes, date, user_id, shift_id, created_at)
         VALUES (?, 'purchase', ?, 0, ?, ?, ?, ?, ?)`,
        [randomUUID(), -totalCost, `Compra de inventario: ${qtyDescription} de ${productName} (proveedor: ${supplierName})`, ts, sessionUser.id, shiftId, ts]
      );
    }

    // Actualizar stock del almacén (en unidades de venta)
    if (targetLocationId) {
      await conn.execute(
        'INSERT INTO location_stock (id,location_id,product_id,quantity,updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+?,updated_at=?',
        [randomUUID(), targetLocationId, product_id, stockQty, ts, stockQty, ts]
      );
      // Nota con la referencia de factura para que el filtro "Número de
      // factura" del módulo de Movimientos encuentre el movimiento.
      const moveNote = invoice_number
        ? `Compra: ${purchaseNotes ?? ''} (Factura #${String(invoice_number).trim()})`
        : (purchaseNotes ? `Compra: ${purchaseNotes}` : 'Compra');
      await conn.execute(
        "INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,reference_id,user_id,created_at) VALUES (?,?,?,'entrada',?,?,?,?,?)",
        [randomUUID(), targetLocationId, product_id, stockQty, moveNote, null, sessionUser.id, ts]
      );
    }

    return {
      id: purchaseId,
      stock_before: currentStock,
      stock_after: Math.round(newStock * 1000) / 1000,
      cost_before: currentCost,
      cost_after: Math.round(newCost * 100) / 100,
      purchase_price: purchasePrice,
      unit: captureUnit,
      purchase_factor: factor,
      stock_qty: stockQty,
      unit_price_sale_unit: saleUnitPrice,
      currency_code: purchaseCurrency,
      exchange_rate: purchaseExchangeRate,
      base_price: basePrice,
      stock_movement_id: smId,
      purchase_price_id: ppId,
    };
  });

  return ok({ ok: true, ...result }, 201);
});
