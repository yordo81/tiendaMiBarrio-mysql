export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute, transaction } from '@/lib/db/mysql';
import { handle, ok, err, forbidden } from '@/lib/api-helpers';
import { logAudit } from '@/lib/db/audit';
const randomUUID = () => crypto.randomUUID();

// ── API de Monedas y Tasas de Cambio ─────────────────────────────
// GET: público — lista monedas con sus tasas de cambio
// POST: solo dueño/admin — crear moneda
// PUT: solo dueño/admin — actualizar moneda o tasa de cambio
// DELETE: solo dueño/admin — desactivar moneda

export const GET = handle(async () => {
  const currencies = await query<{
    code: string;
    name: string;
    symbol: string;
    is_base: number;
    active: number;
  }>('SELECT code, name, symbol, is_base, active FROM currencies ORDER BY is_base DESC, code ASC');

  // Obtener todas las tasas de cambio
  const rates = await query<{
    from_currency: string;
    to_currency: string;
    rate: number;
    updated_at: string;
  }>('SELECT from_currency, to_currency, rate, updated_at FROM currency_rates');

  // Construir mapa de tasas
  const rateMap: Record<string, Record<string, number>> = {};
  for (const r of rates) {
    if (!rateMap[r.from_currency]) rateMap[r.from_currency] = {};
    rateMap[r.from_currency][r.to_currency] = Number(r.rate);
  }

  return ok({
    currencies: currencies.map(c => ({
      ...c,
      is_base: Boolean(c.is_base),
      active: Boolean(c.active),
      rates: rateMap[c.code] ?? {},
    })),
  });
});

export const POST = handle(async (req: Request) => {
  const user = await requireAuth();
  if (user.role !== 'owner' && user.role !== 'admin') {
    return forbidden('Solo el dueño o administrador pueden crear monedas');
  }

  const body = await req.json();
  const code = String(body.code ?? '').trim().toUpperCase();
  const name = String(body.name ?? '').trim();
  const symbol = String(body.symbol ?? '').trim();

  if (!code || code.length > 10) return err('El código de la moneda es obligatorio (máx. 10 caracteres)');
  if (!name) return err('El nombre de la moneda es obligatorio');
  if (!symbol) return err('El símbolo de la moneda es obligatorio');

  // Verificar que no exista
  const existing = await queryOne<{ code: string }>('SELECT code FROM currencies WHERE code = ?', [code]);
  if (existing) return err(`La moneda "${code}" ya existe`);

  // Verificar que solo haya una moneda base
  const isBase = body.is_base === true;
  if (isBase) {
    await execute('UPDATE currencies SET is_base = 0 WHERE is_base = 1');
  }

  await execute(
    'INSERT INTO currencies (code, name, symbol, is_base, active) VALUES (?, ?, ?, ?, 1)',
    [code, name, symbol, isBase ? 1 : 0]
  );

  await logAudit({
    user_id: user.id,
    user_name: user.name,
    action: 'create',
    entity_type: 'currency',
    entity_id: code,
    entity_name: `${name} (${code})`,
    details: { code, name, symbol, is_base: isBase },
  });

  return ok({ ok: true, code }, 201);
});

export const PUT = handle(async (req: Request) => {
  const user = await requireAuth();
  if (user.role !== 'owner' && user.role !== 'admin') {
    return forbidden('Solo el dueño o administrador pueden modificar monedas');
  }

  const body = await req.json();
  const action = String(body.action ?? 'update_rate');

  if (action === 'set_base') {
    // Cambiar la moneda base
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!code) return err('Código de moneda requerido');

    const currency = await queryOne<{ code: string }>('SELECT code FROM currencies WHERE code = ? AND active = 1', [code]);
    if (!currency) return err('Moneda no encontrada o inactiva');

    await execute('UPDATE currencies SET is_base = 0 WHERE is_base = 1');
    await execute('UPDATE currencies SET is_base = 1 WHERE code = ?', [code]);

    await logAudit({
      user_id: user.id,
      user_name: user.name,
      action: 'update',
      entity_type: 'currency',
      entity_id: code,
      entity_name: `Moneda base cambiada a ${code}`,
      details: { new_base: code },
    });

    return ok({ ok: true });
  }

  if (action === 'update_rate') {
    // Actualizar tasa de cambio
    const fromCurrency = String(body.from_currency ?? '').trim().toUpperCase();
    const toCurrency = String(body.to_currency ?? '').trim().toUpperCase();
    const rate = parseFloat(body.rate);

    if (!fromCurrency || !toCurrency) return err('Se requieren las monedas origen y destino');
    if (isNaN(rate) || rate <= 0) return err('La tasa debe ser un número positivo');

    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await execute(
      `INSERT INTO currency_rates (id, from_currency, to_currency, rate, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rate = VALUES(rate), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)`,
      [randomUUID(), fromCurrency, toCurrency, rate, ts, user.id]
    );

    // Crear tasa inversa automáticamente
    if (rate > 0) {
      const inverseRate = Math.round((1 / rate) * 1000000) / 1000000;
      await execute(
        `INSERT INTO currency_rates (id, from_currency, to_currency, rate, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE rate = VALUES(rate), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)`,
        [randomUUID(), toCurrency, fromCurrency, inverseRate, ts, user.id]
      );
    }

    await logAudit({
      user_id: user.id,
      user_name: user.name,
      action: 'update',
      entity_type: 'currency_rate',
      entity_id: `${fromCurrency}-${toCurrency}`,
      entity_name: `Tasa ${fromCurrency} → ${toCurrency}`,
      details: { from: fromCurrency, to: toCurrency, rate },
    });

    return ok({ ok: true });
  }

  if (action === 'toggle_active') {
    // Activar/desactivar moneda
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!code) return err('Código de moneda requerido');

    const currency = await queryOne<{ code: string; is_base: number }>(
      'SELECT code, is_base FROM currencies WHERE code = ?', [code]
    );
    if (!currency) return err('Moneda no encontrada');
    if (currency.is_base && body.active === false) return err('No se puede desactivar la moneda base');

    await execute('UPDATE currencies SET active = ? WHERE code = ?', [body.active ? 1 : 0, code]);

    return ok({ ok: true });
  }

  // Actualizar nombre/símbolo
  const code = String(body.code ?? '').trim().toUpperCase();
  const name = String(body.name ?? '').trim();
  const symbol = String(body.symbol ?? '').trim();

  if (!code) return err('Código de moneda requerido');
  if (!name) return err('Nombre requerido');
  if (!symbol) return err('Símbolo requerido');

  await execute('UPDATE currencies SET name = ?, symbol = ? WHERE code = ?', [name, symbol, code]);

  return ok({ ok: true });
});

export const DELETE = handle(async (req: Request) => {
  const user = await requireAuth();
  if (user.role !== 'owner') return forbidden('Solo el dueño puede eliminar monedas');

  const { code } = await req.json();
  const currencyCode = String(code ?? '').trim().toUpperCase();
  if (!currencyCode) return err('Código de moneda requerido');

  const currency = await queryOne<{ code: string; is_base: number }>(
    'SELECT code, is_base FROM currencies WHERE code = ?', [currencyCode]
  );
  if (!currency) return err('Moneda no encontrada');
  if (currency.is_base) return err('No se puede eliminar la moneda base');

  await execute('UPDATE currencies SET active = 0 WHERE code = ?', [currencyCode]);

  await logAudit({
    user_id: user.id,
    user_name: user.name,
    action: 'delete',
    entity_type: 'currency',
    entity_id: currencyCode,
    entity_name: currencyCode,
    details: { code: currencyCode },
  });

  return ok({ ok: true });
});
