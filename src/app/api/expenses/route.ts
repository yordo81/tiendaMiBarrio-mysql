export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, transaction } from '@/lib/db/mysql';
import { logAudit } from '@/lib/db/audit';
import { handle, ok, err, notFound, forbidden, requireRole } from '@/lib/api-helpers';
import { localToUtcDb } from '@/lib/shift-time';
import { validateExpensePaymentMethodOrDefault, requirePositiveNumber } from '@/lib/validate';
import { r2 } from '@/lib/currency';
import { invalidateAllReportCaches } from '@/lib/report-cache';
const randomUUID = () => crypto.randomUUID();

export const GET = handle(async (req: Request) => {
  await requireRole('owner', 'admin');
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from'), to = searchParams.get('to');
  let sql = `SELECT e.*,ec.name AS category_name,p.name AS product_name,u.name AS user_name,po.name AS pos_name FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id LEFT JOIN products p ON p.id=e.product_id LEFT JOIN users u ON u.id=e.user_id LEFT JOIN pos po ON po.id=e.pos_id`;
  const params: unknown[] = []; const where: string[] = [];
  // e.date se guarda en UTC (ver lib/shift-time): los límites locales del
  // input se convierten a UTC para que el filtro de fechas sea correcto en
  // la zona horaria del negocio (ej. Cuba: la noche local cae al día
  // siguiente en UTC y el gasto desaparecía del filtro de su día).
  if (from) { where.push('e.date>=?'); params.push(localToUtcDb(`${from} 00:00:00`)); }
  if (to)   { where.push('e.date<=?'); params.push(localToUtcDb(`${to} 23:59:59`)); }
  if (where.length) sql += ' WHERE '+where.join(' AND ');
  sql += ' ORDER BY e.date DESC LIMIT 200';
  return ok(await query(sql, params));
});

export const POST = handle(async (req: Request) => {
  const sessionUser = await requireRole('owner', 'admin');
  const body = await req.json();
  const id = randomUUID(); const ts = new Date().toISOString().slice(0,19).replace('T',' ');
  const date = body.date ? new Date(body.date).toISOString().slice(0,19).replace('T',' ') : ts;

  // Validar monto del gasto: debe ser un número positivo
  const amount = requirePositiveNumber(body.amount, 'Monto del gasto');
  if (!body.description || !String(body.description).trim()) return err('La descripción del gasto es obligatoria');
  if (body.product_quantity != null && Number(body.product_quantity) <= 0) return err('La cantidad del producto debe ser mayor a 0');

  // Caja (punto de venta) opcional: atribuye el gasto a la caja para el arqueo del turno
  const posId = body.pos_id ? String(body.pos_id).trim() : '';
  if (posId) {
    const pos = await queryOne<{ id: string }>('SELECT id FROM pos WHERE id = ? AND active = 1', [posId]);
    if (!pos) return err('La caja seleccionada no existe o está desactivada');
  }

  // ── Moneda del gasto ──────────────────────────────────────────
  // El usuario declara el gasto en la moneda en que lo pagó. El método
  // (ya validado arriba) define qué tipo de moneda admite:
  //   - cash (efectivo): solo monedas físicas (currency_type='cash')
  //   - transfer: solo monedas digitales (currency_type='digital')
  //   - mixed: cualquiera
  // El servidor congela la tasa vigente (1 moneda = X base) y convierte
  // el monto a la MONEDA BASE, que es lo que guarda `amount`: así los
  // reportes, la contabilidad y las tarjetas del módulo siguen sumando
  // en base sin cambios. El monto original en SU moneda se conserva en
  // `currency_amount` para el arqueo por moneda del turno.
  const paymentMethod = body.payment_method
    ? validateExpensePaymentMethodOrDefault(body.payment_method)
    : null;
  const currenciesRows = await query<{
    code: string; is_base: number; currency_type: string;
  }>("SELECT code, is_base, currency_type FROM currencies WHERE active = 1");
  const ratesRows = await query<{ to_currency: string; rate: number }>(
    "SELECT to_currency, rate FROM currency_rates WHERE from_currency = 'USD'"
  );
  const baseCode = currenciesRows.find(c => Number(c.is_base) === 1)?.code ?? '';
  if (!baseCode) return err('No hay moneda base configurada');
  const usdOf = (code: string): number | null =>
    code === 'USD' ? 1 : (ratesRows.find(r => r.to_currency === code && Number(r.rate) > 0)?.rate ?? null);
  const usdInBase = usdOf(baseCode);
  const rateToBase = (code: string): number | null => {
    if (code === baseCode) return 1;
    const usd = usdOf(code);
    return usdInBase != null && usd ? usdInBase / usd : null;
  };
  const typeOf = new Map<string, string>();
  for (const c of currenciesRows) typeOf.set(c.code, c.currency_type === 'digital' ? 'digital' : 'cash');

  // ── Mixto multi-moneda: una parte por moneda ─────────────────────
  // El gasto mixto admite la MEZCLA entre monedas físicas (efectivo) y
  // digitales (transferencia): cada parte declara una moneda y un monto
  // en ESA moneda. El servidor congela la tasa de cada parte y su método
  // lo fija el TIPO de la moneda (como en el POS): físicas → 'cash',
  // digitales → 'transfer'. Sin partes, el mixto sigue admitiendo una
  // sola moneda (el arqueo la divide 50/50 como aproximación histórica).
  interface MixedPart { code: string | null; amount: number; rate: number; method: 'cash' | 'transfer'; }
  const mixedPartsRows: MixedPart[] = [];
  if (paymentMethod === 'mixed' && Array.isArray(body.parts) && body.parts.length > 0) {
    for (const part of body.parts) {
      const partAmount = requirePositiveNumber(part?.amount, 'Monto de cada parte del gasto mixto');
      const partCodeRaw = part?.currency ? String(part.currency).trim().toUpperCase() : baseCode;
      const cur = currenciesRows.find(c => c.code === partCodeRaw);
      if (!cur) return err(`La moneda "${partCodeRaw}" no existe o está inactiva`);
      const partRate = partCodeRaw === baseCode ? 1 : (rateToBase(partCodeRaw) ?? 0);
      if (!(partRate > 0)) return err(`La moneda ${partCodeRaw} no tiene una tasa de cambio registrada`);
      const type = typeOf.get(partCodeRaw) ?? 'cash';
      mixedPartsRows.push({
        code: partCodeRaw === baseCode ? null : partCodeRaw,
        amount: r2(partAmount),
        rate: partRate,
        method: type === 'digital' ? 'transfer' : 'cash',
      });
    }
  }

  // Moneda elegida: '' o null = moneda base (no aplica al mixto con partes)
  const rawCurrency = body.currency ? String(body.currency).trim().toUpperCase() : '';
  const currencyCode = rawCurrency && rawCurrency !== baseCode ? rawCurrency : null;
  if (currencyCode && !currenciesRows.some(c => c.code === currencyCode)) {
    return err(`La moneda "${currencyCode}" no existe o está inactiva`);
  }
  // Tipo de moneda vs método de pago: físicas solo en efectivo y digitales
  // solo por transferencia; el mixto admite cualquiera.
  if (currencyCode && paymentMethod) {
    const type = typeOf.get(currencyCode) ?? 'cash';
    if (paymentMethod === 'cash' && type !== 'cash') {
      return err(`La moneda ${currencyCode} es digital: solo se puede pagar por transferencia`);
    }
    if (paymentMethod === 'transfer' && type !== 'digital') {
      return err(`La moneda ${currencyCode} es física: solo se puede pagar en efectivo`);
    }
  }
  const exchangeRate = currencyCode ? (rateToBase(currencyCode) ?? 0) : 1;
  if (currencyCode && !(exchangeRate > 0)) {
    return err(`La moneda ${currencyCode} no tiene una tasa de cambio registrada`);
  }
  // Monto en moneda base (lo que se guarda en `amount`, como siempre):
  // mixto con partes → suma de cada parte × su tasa congelada;
  // resto → monto × tasa de la moneda elegida.
  const amountBase = mixedPartsRows.length > 0
    ? r2(mixedPartsRows.reduce((a, p) => a + p.amount * p.rate, 0))
    : r2(amount * exchangeRate);
  // Desglose JSON del mixto solo cuando se pagan partes multi-moneda
  const mixedPartsJson = mixedPartsRows.length > 0
    ? JSON.stringify(mixedPartsRows.map(p => ({ code: p.code, amount: p.amount, rate: p.rate, method: p.method })))
    : null;


  await transaction(async (conn) => {
    await conn.execute(
      'INSERT INTO expenses (id,category_id,description,amount,payment_method,currency_code,currency_amount,exchange_rate,mixed_parts,product_id,product_quantity,pos_id,date,user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id,body.category_id??null,String(body.description).trim(),amountBase,paymentMethod,currencyCode,currencyCode?r2(amount):null,currencyCode?exchangeRate:null,mixedPartsJson,body.product_id??null,body.product_quantity??null,posId||null,date,sessionUser.id,ts,ts]
    );
    if (body.product_id && body.product_quantity) {
      const productId = body.product_id;
      const qty = Number(body.product_quantity);

      await conn.execute('UPDATE products SET stock=GREATEST(0,stock-?),updated_at=? WHERE id=?',[qty,ts,productId]);

      await conn.execute("INSERT INTO stock_movements (id,product_id,type,quantity,reason,reference_id,user_id,date,created_at) VALUES (?,?,'expense',?,?,?,?,?,?)",
        [randomUUID(),productId,qty,body.description,id,sessionUser.id,date,ts]);

      const locationId = body.location_id;
      if (locationId) {
        const [locRows] = await conn.execute(
          'SELECT id, quantity FROM location_stock WHERE location_id=? AND product_id=? LIMIT 1',
          [locationId, productId]
        );
        const existing = (locRows as { id: string; quantity: number }[])[0];
        const available = existing?.quantity ?? 0;

        if (available < qty) {
          throw new Error(`Stock insuficiente en el almacén. Disponible: ${available}, solicitado: ${qty}`);
        }

        await conn.execute(
          'UPDATE location_stock SET quantity=quantity-?, updated_at=? WHERE location_id=? AND product_id=?',
          [qty, ts, locationId, productId]
        );

        // Movimiento de almacén tipo 'gasto': así aparece en el módulo de
        // Movimientos con su etiqueta y filtro propios, y los reportes por
        // almacén lo localizan por reference_id + type='gasto'.
        await conn.execute(
          'INSERT INTO location_movements (id,location_id,product_id,type,quantity,notes,reference_id,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          [randomUUID(), locationId, productId, 'gasto', qty, `Gasto: ${body.description}`, id, sessionUser.id, ts]
        );
      }
    }
  });

  // Invalidar caché de reportes (dashboard incluye gastos)
  invalidateAllReportCaches(sessionUser.id).catch(() => {});

  return ok((await query('SELECT * FROM expenses WHERE id=?',[id]))[0], 201);
});

export const DELETE = handle(async (req: Request) => {
  const sessionUser = await requireAuth();
  if (sessionUser.role !== 'owner' && sessionUser.role !== 'admin') {
    return forbidden('No autorizado — solo administradores');
  }

  const { id } = await req.json();
  if (!id) return err('ID requerido');

  const expense = await queryOne<{
    product_id: string | null;
    product_quantity: number | null;
    description: string;
  }>('SELECT product_id, product_quantity, description FROM expenses WHERE id=?', [id]);

  if (!expense) return notFound('Gasto no encontrado');

  const ts = new Date().toISOString().slice(0,19).replace('T',' ');

  await transaction(async (conn) => {
    if (expense.product_id && expense.product_quantity) {
      const qty = Number(expense.product_quantity);

      await conn.execute('UPDATE products SET stock=stock+?, updated_at=? WHERE id=?', [qty, ts, expense.product_id]);

      await conn.execute("DELETE FROM stock_movements WHERE reference_id=? AND type='expense'", [id]);

      // Los gastos nuevos guardan reference_id; los anteriores a la
      // normalización lo tienen NULL y se localizan por la nota "Gasto: ...".
      const [locMoveRows] = await conn.execute(
        "SELECT id, location_id FROM location_movements WHERE type='gasto' AND (reference_id=? OR (reference_id IS NULL AND notes LIKE ?))",
        [id, `%Gasto: ${expense.description}%`]
      ) as unknown as [{ id: string; location_id: string }[], unknown];

      if (locMoveRows.length > 0) {
        for (const lm of locMoveRows) {
          await conn.execute(
            'UPDATE location_stock SET quantity=quantity+?, updated_at=? WHERE location_id=? AND product_id=?',
            [qty, ts, lm.location_id, expense.product_id]
          );
          await conn.execute('DELETE FROM location_movements WHERE id=?', [lm.id]);
        }
      }
    }

    await conn.execute('DELETE FROM expenses WHERE id=?', [id]);
  });

  await logAudit({
    user_id: sessionUser.id,
    user_name: sessionUser.name,
    action: 'delete',
    entity_type: 'expense',
    entity_id: id,
    entity_name: expense.description,
    details: { amount: expense.product_quantity ? Number(expense.product_quantity) : null },
  });

  // Invalidar caché de reportes después de eliminar gasto
  invalidateAllReportCaches(sessionUser.id).catch(() => {});

  return ok({ ok: true });
});
