export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute } from '@/lib/db/mysql';
import { logAudit } from '@/lib/db/audit';
import { handle, ok, err, forbidden, notFound } from '@/lib/api-helpers';
const randomUUID = () => crypto.randomUUID();

// ── GET: Obtener un producto por ID (con relaciones) ─────────────────────────
export const GET = handle(async (_: Request, ctx) => {
  const { id } = await ctx!.params;
  await requireAuth();

  const rows = await query<Record<string, unknown>>(
    `SELECT p.*,
            c.name AS category_name,
            GROUP_CONCAT(DISTINCT s.id ORDER BY ps.is_preferred DESC SEPARATOR '||') AS supplier_ids,
            GROUP_CONCAT(DISTINCT s.name ORDER BY ps.is_preferred DESC SEPARATOR '||') AS supplier_names
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN product_suppliers ps ON ps.product_id = p.id
     LEFT JOIN suppliers s ON s.id = ps.supplier_id
     WHERE p.id = ?
     GROUP BY p.id`,
    [id]
  );

  if (rows.length === 0) return notFound('Producto no encontrado');

  const product = rows[0];
  return ok({
    ...product,
    active: Boolean(product.active),
    is_perishable: Boolean(product.is_perishable),
    supplier_ids: product.supplier_ids ? String(product.supplier_ids).split('||') : [],
    supplier_names: product.supplier_names ? String(product.supplier_names).split('||') : [],
  });
});

export const PUT = handle(async (request: Request, ctx) => {
  const { id } = await ctx!.params;
  const sessionUser = await requireAuth();
  const body = await request.json();
  const ts = new Date().toISOString().slice(0,19).replace('T',' ');

  // Validar código de barras único (excluyendo este producto)
  const barcode = String(body.barcode ?? '').trim() || null;
  if (barcode) {
    const existing = await queryOne<{id: string}>('SELECT id FROM products WHERE barcode = ? AND id != ? LIMIT 1', [barcode, id]);
    if (existing) return err(`Ya existe un producto con el código de barras ${barcode}`);
  }

  const current = await queryOne<{stock: number}>('SELECT stock FROM products WHERE id=?', [id]);
  const oldStock = current?.stock ?? 0;
  const newStock = Number(body.stock);
  const diff = newStock - oldStock;

  // Normalizar fecha de caducidad: vacío (o inválido) → NULL, la columna es DATE
  const expirationDate = (() => {
    const raw = String(body.expiration_date ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  })();

  await execute(
    `UPDATE products SET name=?,barcode=?,description=?,category_id=?,sale_price=?,cost=?,stock=?,min_stock=?,unit=?,expiration_date=?,is_perishable=?,image_url=?,updated_at=? WHERE id=?`,
    [body.name, barcode, body.description??null, body.category_id??null, Number(body.sale_price), Number(body.cost),
     Number(body.stock), Number(body.min_stock), body.unit??'unidad', expirationDate, body.is_perishable ? 1 : 0, body.image_url ?? null, ts, id]
  );

  if (diff !== 0) {
    const locRows = await query<{location_id: string}>(`
      SELECT location_id FROM location_stock WHERE product_id=? ORDER BY quantity DESC LIMIT 1
    `, [id]);
    let targetLocationId: string | undefined;
    let locationName: string | undefined;
    if (locRows.length > 0) {
      targetLocationId = locRows[0].location_id;
      const loc = await queryOne<{ name: string }>('SELECT name FROM locations WHERE id=?', [targetLocationId]);
      locationName = loc?.name;
    } else if (diff > 0) {
      const locations = await query<{id: string; name: string}>(
        'SELECT id, name FROM locations WHERE active=1 ORDER BY name ASC LIMIT 1'
      );
      if (locations.length > 0) {
        targetLocationId = locations[0].id;
        locationName = locations[0].name;
      }
    }

    if (targetLocationId) {
      if (diff > 0) {
        await execute(
          'INSERT INTO location_stock (id,location_id,product_id,quantity,updated_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE quantity=quantity+?,updated_at=?',
          [randomUUID(), targetLocationId, id, diff, ts, diff, ts]
        );
      } else {
        const curLocStock = await queryOne<{quantity: number}>(
          'SELECT quantity FROM location_stock WHERE location_id=? AND product_id=?',
          [targetLocationId, id]
        );
        if (curLocStock && curLocStock.quantity < Math.abs(diff)) {
          return err(`Stock insuficiente en el almacén. Disponible: ${curLocStock.quantity}, necesario: ${Math.abs(diff)}`);
        }
        await execute(
          'UPDATE location_stock SET quantity=quantity+?,updated_at=? WHERE location_id=? AND product_id=?',
          [diff, ts, targetLocationId, id]
        );
      }
      await execute(
        `INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,user_id,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
        [randomUUID(), targetLocationId, id, 'ajuste', Math.abs(diff),
         `Ajuste por edición de producto`, sessionUser.id, ts]
      );

      // Also record in stock_movements for the product history
      await execute(
        'INSERT INTO stock_movements (id,product_id,type,quantity,reason,user_id,date,created_at) VALUES (?,?,?,?,?,?,?,?)',
        [randomUUID(), id, 'adjust', Math.abs(diff), `Ajuste por edición de producto (${locationName ?? targetLocationId})`, sessionUser.id, ts, ts]
      );
    }

    // ── Auditoría para el ajuste de stock ──
    const productName = body.name ?? 'Producto';
    const actionType = diff > 0 ? 'adjust_increase' : 'adjust_decrease';
    await logAudit({
      user_id: sessionUser.id,
      user_name: sessionUser.name,
      action: actionType,
      entity_type: 'stock_movement',
      entity_id: id,
      entity_name: productName,
      details: { old_stock: oldStock, new_stock: newStock, diff: Math.abs(diff), location_id: targetLocationId, location_name: locationName },
    });
  }

  if (Array.isArray(body.supplier_ids)) {
    await execute('DELETE FROM product_suppliers WHERE product_id = ?', [id]);
    for (let i = 0; i < body.supplier_ids.length; i++) {
      await execute('INSERT IGNORE INTO product_suppliers (id,product_id,supplier_id,is_preferred) VALUES (?,?,?,?)',
        [randomUUID(), id, body.supplier_ids[i], i === 0 ? 1 : 0]);
    }
  }

  const rows = await query(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?`, [id]);
  return ok(rows[0]);
});

export const DELETE = handle(async (_: Request, ctx) => {
  const { id } = await ctx!.params;
  const sessionUser = await requireAuth();
  if (sessionUser.role !== 'owner' && sessionUser.role !== 'admin') {
    return forbidden('No autorizado — solo administradores');
  }
  const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  const product = await queryOne<{ name: string }>('SELECT name FROM products WHERE id=?', [id]);
  await execute('UPDATE products SET active=0, updated_at=? WHERE id=?', [ts, id]);

  if (product) {
    await logAudit({
      user_id: sessionUser.id,
      user_name: sessionUser.name,
      action: 'delete',
      entity_type: 'product',
      entity_id: id,
      entity_name: product.name,
    });
  }

  return ok({ ok: true });
});
