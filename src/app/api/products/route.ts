export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, execute } from '@/lib/db/mysql';
import { handle, ok } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

// ── API de Productos ───────────────────────────────────────────────
// GET: Listar productos con filtros (stock bajo, por almacén)
// POST: Crear nuevo producto con stock inicial y registro contable

// ── GET: Listar productos ──
export const GET = handle(async (request: Request) => {
  await requireAuth();
  const { searchParams } = new URL(request.url);
  const lowStock = searchParams.get('low_stock') === 'true';
  const locationId = searchParams.get('location_id');

  const params: unknown[] = [];

  // Al filtrar por almacén, obtener el stock de ese almacén mediante subconsulta
  const locationStockSelect = locationId
    ? '(SELECT quantity FROM location_stock WHERE product_id = p.id AND location_id = ?) AS location_stock,'
    : '';
  if (locationId) params.push(locationId);

  let whereClause = 'WHERE p.active = 1';
  if (lowStock) whereClause += ' AND p.stock <= p.min_stock';
  if (locationId) {
    whereClause += ' AND p.id IN (SELECT product_id FROM location_stock WHERE location_id=?)';
    params.push(locationId);
  }

  let sql = `
    SELECT p.*,
      c.name AS category_name,
      ${locationStockSelect}
      GROUP_CONCAT(DISTINCT s.id ORDER BY ps.is_preferred DESC SEPARATOR '||') AS supplier_ids,
      GROUP_CONCAT(DISTINCT s.name ORDER BY ps.is_preferred DESC SEPARATOR '||') AS supplier_names
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN product_suppliers ps ON ps.product_id = p.id
    LEFT JOIN suppliers s ON s.id = ps.supplier_id
    ${whereClause}
    GROUP BY p.id ORDER BY p.name ASC
  `;

  let locationNameForFilter = '';
  const locMap = new Map<string, string>();

  if (locationId) {
    // Al filtrar por almacén, solo obtener el nombre del almacén seleccionado
    const locRows = await query<{name: string}>('SELECT name FROM locations WHERE id = ?', [locationId]);
    if (locRows.length > 0) locationNameForFilter = String(locRows[0].name);
  } else {
    // Construir mapa de ubicaciones para cada producto (muestra dónde hay stock)
    try {
      const locRows = await query<{product_id: string; location_name: string}>(
        `SELECT ls.product_id, l.name AS location_name
         FROM location_stock ls
         JOIN locations l ON l.id = ls.location_id AND l.active=1
         WHERE ls.quantity > 0
         GROUP BY ls.product_id, l.name`
      );
      for (const r of locRows) {
        if (!locMap.has(r.product_id)) locMap.set(r.product_id, r.location_name);
      }
    } catch (e) { console.error('[locationMap]', e); }
  }

  const rows = await query(sql, params);
  return ok(rows.map((r: Record<string, unknown>) => {
    // Separar el campo location_stock para no filtrarlo al cliente
    const { location_stock, ...rest } = r;
    // Usar stock del almacén si se filtró por uno, sino usar stock global
    const stockValue = location_stock !== undefined ? Number(location_stock) : Number(rest.stock);
    return {
      ...rest,
      stock: stockValue,
      active: Boolean(rest.active),
      supplier_ids: rest.supplier_ids ? String(rest.supplier_ids).split('||') : [],
      supplier_names: rest.supplier_names ? String(rest.supplier_names).split('||') : [],
      location_name: locationId ? locationNameForFilter : (locMap.get(String(rest.id)) ?? '—'),
    };
  }));
});

// ── POST: Crear nuevo producto ──
export const POST = handle(async (request: Request) => {
  const sessionUser = await requireAuth();
  const body = await request.json();
  const id = randomUUID();
  const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  const isCapital = body.is_capital === true;  // true = aporte de capital, false = reinversión

  // Insertar producto
  await execute(
    `INSERT INTO products (id,name,description,category_id,sale_price,cost,stock,min_stock,unit,image_url,active,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    [id, body.name, body.description??null, body.category_id??null,
     Number(body.sale_price??0), Number(body.cost??0), Number(body.stock??0),
     Number(body.min_stock??0), body.unit??'unidad', body.image_url ?? null, ts, ts]
  );

  // Asignar proveedores
  if (Array.isArray(body.supplier_ids)) {
    for (let i = 0; i < body.supplier_ids.length; i++) {
      await execute(
        'INSERT IGNORE INTO product_suppliers (id,product_id,supplier_id,is_preferred) VALUES (?,?,?,?)',
        [randomUUID(), id, body.supplier_ids[i], i === 0 ? 1 : 0]
      );
    }
  }

  // Registrar stock inicial en ubicaciones y contabilidad
  const initialStock = Number(body.stock ?? 0);
  if (initialStock > 0) {
    let targetLocationId = body.location_id;
    if (!targetLocationId) {
      const locations = await query<{id: string}>(
        'SELECT id FROM locations WHERE active=1 ORDER BY name ASC LIMIT 1'
      );
      if (locations.length > 0) targetLocationId = locations[0].id;
    }
    if (targetLocationId) {
      await execute(
        `INSERT INTO location_stock (id, location_id, product_id, quantity, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = quantity + ?, updated_at = ?`,
        [randomUUID(), targetLocationId, id, initialStock, ts, initialStock, ts]
      );
      await execute(
        `INSERT INTO location_movements (id, location_id, product_id, type, quantity, notes, user_id, created_at)
         VALUES (?, ?, ?, 'entrada', ?, ?, ?, ?)`,
        [randomUUID(), targetLocationId, id, initialStock, 'Stock inicial', sessionUser.id, ts]
      );
    }

    // ── Registrar en contabilidad ──
    const totalCost = Math.round(initialStock * Number(body.cost ?? 0) * 100) / 100;
    if (totalCost > 0) {
      if (isCapital) {
        // Aporte de capital: ingresa dinero a la caja
        await execute(
          `INSERT INTO cash_register (id, type, cash_amount, transfer_amount, notes, date, user_id, created_at)
           VALUES (?, 'capital', ?, 0, ?, ?, ?, ?)`,
          [randomUUID(), totalCost,
           `Aporte de capital para stock inicial: ${initialStock} × ${body.name}`, ts, sessionUser.id, ts]
        );
      } else {
        // Reinversión: egreso de caja por compra de inventario
        await execute(
          `INSERT INTO cash_register (id, type, cash_amount, transfer_amount, notes, date, user_id, created_at)
           VALUES (?, 'purchase', ?, 0, ?, ?, ?, ?)`,
          [randomUUID(), -totalCost,
           `Compra por stock inicial: ${initialStock} × ${body.name}`, ts, sessionUser.id, ts]
        );
      }
    }
  }

  const rows = await query(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?`, [id]);
  return ok(rows[0], 201);
});
