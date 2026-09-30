export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, transaction, execute } from '@/lib/db/mysql';
import { r2 } from '@/lib/currency';
import { handle, ok, err, notFound, forbidden } from '@/lib/api-helpers';
import { logAudit } from '@/lib/db/audit';
import { invalidateAllReportCaches } from '@/lib/report-cache';

// ── Modificar precios de una venta a crédito en curso ──────────────
// Cuando una venta queda como deuda (crédito u oferta parcial), el cliente
// empieza a abonar. Antes de que la deuda quede saldada, el dueño y los
// administradores pueden corregir el PRECIO DE VENTA de cada producto de la
// venta (lo mismo que se permite al registrar una oferta), igual que se
// negocia el precio mientras el cliente paga.
//
// Reglas:
//   - Solo dueño/admin (mismo permiso que la oferta).
//   - Solo ventas pendientes o parciales NO canceladas: una venta ya pagada
//     o cancelada no se modifica.
//   - Cada precio debe ser mayor que 0 (el servidor no acepta líneas gratis).
//   - El total de la venta se recalcula con los precios unitarios nuevos y
//     la moneda/tasa de la venta se mantienen (no se tocan).
//   - En venta de CRÉDITO, el saldo del cliente se ajusta por la diferencia
//     (más caro → debe más; más barato → debe menos, sin quedar negativo).
//   - En venta PARCIAL (oferta con abono inicial), el nuevo total debe seguir
//     cubriendo lo ya abonado: si los precios nuevos quedan por debajo de lo
//     ya pagado, se rechaza la modificación.
//   - Cada precio cambiado queda en auditoría (action 'price_override',
//     igual que al crear la venta con precio modificado).

export const PUT = handle(async (req: Request, ctx) => {
  const sessionUser = await requireAuth();
  if (sessionUser.role !== 'owner' && sessionUser.role !== 'admin') {
    return forbidden('Solo el dueño y los administradores pueden modificar los precios de una venta');
  }

  const { id: saleId } = await ctx!.params;
  const sale = await queryOne<{
    id: string;
    total: number;
    status: string;
    currency_code: string | null;
    customer_id: string | null;
    payment_method: string | null;
  }>('SELECT id, total, status, currency_code, customer_id, payment_method FROM sales WHERE id = ?', [saleId]);

  if (!sale) return notFound('Venta no encontrada');
  if (sale.status === 'cancelled') return err('La venta está cancelada: no se puede modificar');
  if (sale.status === 'completed') return err('La venta ya está pagada: no se puede modificar');
  if (!sale.customer_id) return err('La venta no tiene cliente asociado');

  const body = await req.json();
  const overrides: { product_id: string; unit_price: number }[] = Array.isArray(body?.prices)
    ? (body.prices as { product_id?: unknown; unit_price?: unknown }[])
        .map(p => ({ product_id: String(p?.product_id ?? ''), unit_price: Number(p?.unit_price) }))
        .filter(p => p.product_id && Number.isFinite(p.unit_price))
    : [];
  if (overrides.length === 0) {
    return err('Envía el listado de precios a modificar: prices = [{ product_id, unit_price }]');
  }
  if (overrides.some(p => p.unit_price <= 0)) {
    return err('Cada precio debe ser mayor que 0');
  }

  const items = await query<{ id: string; product_id: string; quantity: number; unit_price: number }>(
    'SELECT id, product_id, quantity, unit_price FROM sale_items WHERE sale_id = ?',
    [saleId]
  );
  if (items.length === 0) return err('La venta no tiene productos registrados');

  // Solo se aceptan productos de esta venta (se ignoran IDs desconocidos).
  const byProduct = new Map(items.map(i => [String(i.product_id), i]));
  const changes: { product_name: string; product_id: string; original_price: number; custom_price: number; quantity: number }[] = [];
  for (const o of overrides) {
    const item = byProduct.get(o.product_id);
    if (!item) return err('Uno de los productos no pertenece a esta venta');
    if (Math.round(o.unit_price * 100) === Math.round(Number(item.unit_price) * 100)) continue;
    changes.push({
      product_id: item.product_id,
      original_price: r2(Number(item.unit_price)),
      custom_price: r2(o.unit_price),
      quantity: Number(item.quantity),
      product_name: '',
    });
  }
  if (changes.length === 0) {
    return err('No hay cambios de precio: todos los precios son iguales a los registrados');
  }

  // Nombres de los productos modificados (para auditoría y respuesta).
  const nameRows = await query<{ id: string; name: string }>(
    `SELECT id, name FROM products WHERE id IN (${changes.map(() => '?').join(',')})`,
    [changes.map(c => c.product_id)]
  );
  const nameById = new Map((nameRows as { id: string; name: string }[]).map(r => [String(r.id), String(r.name)]));
  for (const c of changes) c.product_name = nameById.get(String(c.product_id)) ?? 'Producto';

  // Nuevo total de la venta: los ítems sin override mantienen su precio.
  const newUnitPrice = new Map(changes.map(c => [String(c.product_id), c.custom_price]));
  const newTotal = r2(items.reduce(
    (a, i) => a + Number(i.quantity) * (newUnitPrice.get(String(i.product_id)) ?? Number(i.unit_price)),
    0
  ));

  // Lo ya abonado a la venta, en la moneda de la venta (misma conversión
  // que GET /api/sales/[id] y que el cobro de ventas pendientes).
  const saleRateRaw = await queryOne<{ exchange_rate: number | null }>(
    'SELECT exchange_rate FROM sales WHERE id = ?',
    [saleId]
  );
  const saleRate = saleRateRaw?.exchange_rate != null && Number(saleRateRaw.exchange_rate) > 0 ? Number(saleRateRaw.exchange_rate) : 1;
  const rateOf = (code: string | null, rate: number | null): number =>
    code ? (rate != null && Number(rate) > 0 ? Number(rate) : 1) : 1;
  const payments = await query<{ amount_cash: number; amount_transfer: number; currency_code: string | null; exchange_rate: number | null; method: string }>(
    'SELECT amount_cash, amount_transfer, currency_code, exchange_rate, method FROM payments WHERE sale_id = ?',
    [saleId]
  );
  const customerPayments = await query<{ amount: number; currency_code: string | null; exchange_rate: number | null }>(
    'SELECT amount, currency_code, exchange_rate FROM customer_payments WHERE sale_id = ?',
    [saleId]
  );
  const paidBase = (customerPayments as { amount: number; currency_code: string | null; exchange_rate: number | null }[])
    .reduce((a, p) => a + Number(p.amount ?? 0) * rateOf(p.currency_code, p.exchange_rate), 0);
  const paidAtSaleBase = (payments as { amount_cash: number; amount_transfer: number; currency_code: string | null; exchange_rate: number | null; method: string }[])
    .filter(p => p.method !== 'credit')
    .reduce((a, p) => a + (Number(p.amount_cash ?? 0) + Number(p.amount_transfer ?? 0)) * rateOf(p.currency_code, p.exchange_rate), 0);
  const totalPaid = r2((paidBase + paidAtSaleBase) / saleRate);

  // La deuda ya abonada no puede quedar mayor que el nuevo total: si los
  // precios nuevos suman menos de lo ya cobrado, se rechaza.
  if (newTotal + 0.01 < totalPaid) {
    return err(`El nuevo total (${r2(newTotal)}) es menor que lo ya abonado (${totalPaid}): no se puede aplicar`);
  }

  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  // Crédito: por payment_method o por la fila de pago 'credit' (ventas
  // anteriores a la columna payment_method).
  const wasCredit = String(sale.payment_method ?? '') === 'credit'
    || (payments as { method: string }[]).some(p => String(p.method ?? '') === 'credit');
  const oldTotal = Number(sale.total);

  await transaction(async (conn) => {
    // 1) Actualizar los precios unitarios de las líneas modificadas.
    for (const c of changes) {
      await conn.execute('UPDATE sale_items SET unit_price = ? WHERE sale_id = ? AND product_id = ?', [
        c.custom_price, saleId, c.product_id,
      ]);
    }
    // 2) Recalcular el total de la venta.
    await conn.execute('UPDATE sales SET total = ?, updated_at = ? WHERE id = ?', [newTotal, ts, saleId]);

    // 3) Ajustar el saldo del cliente por la diferencia (solo crédito: en la
    // oferta parcial la deuda del cliente ya se registró por la parte no
    // cobrada y el estado se recalcula con el total en el próximo abono).
    if (wasCredit) {
      await conn.execute('UPDATE customers SET balance = GREATEST(0, balance + ?), updated_at = ? WHERE id = ?', [
        r2(newTotal - oldTotal), ts, sale.customer_id,
      ]);
    }
  });

  // En ventas parciales (oferta con abono inicial), si el nuevo total ya no
  // está cubierto por lo abonado, la venta vuelve a 'partial' (normalmente
  // sigue en partial; si un aumento la deja cubierta, se marca como pagada).
  if (!wasCredit && sale.status !== 'pending') {
    const nextStatus = totalPaid + 0.01 >= newTotal ? 'completed' : 'partial';
    if (nextStatus !== sale.status) {
      await execute('UPDATE sales SET status = ?, updated_at = ? WHERE id = ?', [nextStatus, ts, saleId]);
    }
  }

  invalidateAllReportCaches(sessionUser.id).catch(() => {});

  // Auditoría: un registro por precio modificado (igual que al crear la venta).
  try {
    for (const c of changes) {
      await logAudit({
        user_id: sessionUser.id,
        user_name: sessionUser.name,
        action: 'price_override',
        entity_type: 'sale_item',
        entity_id: saleId,
        entity_name: c.product_name,
        details: {
          product_id: c.product_id,
          original_price: c.original_price,
          custom_price: c.custom_price,
          quantity: c.quantity,
          sale_total: newTotal,
          sale_status: sale.status,
        },
      });
    }
  } catch (e) {
    console.error('[audit] modificación de precios de venta', e);
  }

  return ok({
    id: saleId,
    total: newTotal,
    total_paid: totalPaid,
    remaining: r2(Math.max(0, newTotal - totalPaid)),
    changes: changes.map(c => ({
      product_id: c.product_id,
      product_name: c.product_name,
      original_price: c.original_price,
      custom_price: c.custom_price,
      quantity: c.quantity,
    })),
  });
});
