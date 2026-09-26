export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/session';
import { query, queryOne, execute, transaction } from '@/lib/db/mysql';
import { handle, ok, err, forbidden } from '@/lib/api-helpers';
import { logAudit } from '@/lib/db/audit';
const randomUUID = () => crypto.randomUUID();

// ── API de Monedas y Tasas de Cambio ─────────────────────────────
// Convención: las tasas se guardan SIEMPRE contra el dólar.
// `currency_rates` solo contiene filas USD → moneda (1 USD = X moneda).
// La tasa hacia la moneda base se deriva de esa referencia y por eso
// cambiar la moneda base no recalcula ni convierte nada.
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
    currency_type: string;
    active: number;
  }>('SELECT code, name, symbol, is_base, currency_type, active FROM currencies ORDER BY is_base DESC, code ASC');

  // Obtener todas las tasas de cambio (con la fecha de la última actualización:
  // el POS la usa para avisar al vendedor cuando la tasa está desactualizada)
  const rates = await query<{
    from_currency: string;
    to_currency: string;
    rate: number;
    updated_at: string;
  }>('SELECT from_currency, to_currency, rate, updated_at FROM currency_rates');

  // ── Referencia al dólar: 1 USD = X moneda (filas USD → moneda) ──
  const usdMap: Record<string, number> = {};
  for (const r of rates) {
    if (r.from_currency === 'USD' && Number(r.rate) > 0) usdMap[r.to_currency] = Number(r.rate);
  }
  const baseCode = currencies.find(c => c.is_base)?.code ?? '';
  /** Tasa contra el dólar: 1 USD = X moneda. El propio USD = 1. */
  const usdOf = (code: string): number | null =>
    code === 'USD' ? 1 : (usdMap[code] != null ? usdMap[code] : null);
  /** Cuánto vale 1 USD en la moneda base (1 si la base es USD). */
  const usdInBase = baseCode ? usdOf(baseCode) : null;
  /** Tasa hacia la base derivada de la referencia USD: 1 moneda = X base. */
  const rateToBase = (code: string): number | null => {
    if (!baseCode) return null;
    if (code === baseCode) return 1;
    const usd = usdOf(code);
    return usdInBase != null && usd ? usdInBase / usd : null;
  };

  return ok({
    currencies: currencies.map(c => {
      const toBase = rateToBase(c.code);
      return {
        ...c,
        is_base: Boolean(c.is_base),
        // 'cash' = moneda física (solo efectivo); 'digital' = solo transferencia
        currency_type: c.currency_type === 'digital' ? 'digital' : 'cash',
        active: Boolean(c.active),
        // Tasa hacia la base (derivada de la referencia USD); la base = 1.
        // Una moneda sin tasa USD queda vacía: no se puede convertir.
        rates: baseCode && toBase != null ? { [baseCode]: toBase } : {},
        // Referencia al dólar: 1 USD = X moneda (null = sin tasa registrada)
        usd_rate: usdOf(c.code),
      };
    }),
    // Fecha de la última actualización de cada tasa (para avisos de tasa vieja).
    // Clave: `USD->MONEDA`, porque toda tasa se guarda contra el dólar.
    rates_updated_at: Object.fromEntries(
      rates.map(r => [`${r.from_currency}->${r.to_currency}`, r.updated_at])
    ),
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
  // Tipo de moneda: 'cash' (física, solo efectivo) o 'digital' (solo transferencia)
  const currencyType = body.currency_type === 'digital' ? 'digital' : 'cash';

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
    'INSERT INTO currencies (code, name, symbol, is_base, currency_type, active) VALUES (?, ?, ?, ?, ?, 1)',
    [code, name, symbol, isBase ? 1 : 0, currencyType]
  );

  await logAudit({
    user_id: user.id,
    user_name: user.name,
    action: 'create',
    entity_type: 'currency',
    entity_id: code,
    entity_name: `${name} (${code})`,
    details: { code, name, symbol, is_base: isBase, currency_type: currencyType },
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
    // Cambiar la moneda base: SOLO se actualiza qué moneda es base.
    // Como las tasas se guardan contra el dólar (1 USD = X moneda),
    // cambiar la base no toca ni convierte ninguna tasa: cada moneda
    // conserva su tasa USD tal cual fue escrita.
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
    // Actualizar tasa de cambio. Las tasas SIEMPRE se expresan contra el
    // dólar: se guarda la fila USD → moneda (1 USD = X moneda). No se
    // crea ninguna tasa inversa ni se recalcula nada más.
    const fromCurrency = String(body.from_currency ?? 'USD').trim().toUpperCase();
    const toCurrency = String(body.to_currency ?? '').trim().toUpperCase();
    const rate = parseFloat(body.rate);

    if (fromCurrency !== 'USD') {
      return err('Las tasas se guardan contra el dólar: from_currency debe ser "USD" (1 USD = X moneda)');
    }
    if (!toCurrency) return err('Se requiere la moneda destino');
    if (toCurrency === 'USD') return err('La tasa del dólar es 1 por definición');
    if (isNaN(rate) || rate <= 0) return err('La tasa debe ser un número positivo');

    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await execute(
      `INSERT INTO currency_rates (id, from_currency, to_currency, rate, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rate = VALUES(rate), updated_at = VALUES(updated_at), updated_by = VALUES(updated_by)`,
      [randomUUID(), 'USD', toCurrency, rate, ts, user.id]
    );

    // No se crea la tasa inversa automáticamente: cada tasa se escribe a mano
    // y cambiar la moneda base tampoco convierte las tasas existentes.

    await logAudit({
      user_id: user.id,
      user_name: user.name,
      action: 'update',
      entity_type: 'currency_rate',
      entity_id: `USD-${toCurrency}`,
      entity_name: `Tasa 1 USD = ${rate} ${toCurrency}`,
      details: { from: 'USD', to: toCurrency, rate },
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

  // Actualizar tipo de moneda (física/digital)
  if (action === 'set_type') {
    const code = String(body.code ?? '').trim().toUpperCase();
    if (!code) return err('Código de moneda requerido');
    const currencyType = body.currency_type === 'digital' ? 'digital' : 'cash';

    const currency = await queryOne<{ code: string }>('SELECT code FROM currencies WHERE code = ?', [code]);
    if (!currency) return err('Moneda no encontrada');

    await execute('UPDATE currencies SET currency_type = ? WHERE code = ?', [currencyType, code]);

    await logAudit({
      user_id: user.id,
      user_name: user.name,
      action: 'update',
      entity_type: 'currency',
      entity_id: code,
      entity_name: `Tipo de ${code}: ${currencyType === 'digital' ? 'digital' : 'física'}`,
      details: { code, currency_type: currencyType },
    });

    return ok({ ok: true });
  }

  // Actualizar nombre/símbolo/tipo
  const code = String(body.code ?? '').trim().toUpperCase();
  const name = String(body.name ?? '').trim();
  const symbol = String(body.symbol ?? '').trim();

  if (!code) return err('Código de moneda requerido');
  if (!name) return err('Nombre requerido');
  if (!symbol) return err('Símbolo requerido');

  const currencyType = body.currency_type === 'digital' ? 'digital' : 'cash';
  await execute('UPDATE currencies SET name = ?, symbol = ?, currency_type = ? WHERE code = ?', [name, symbol, currencyType, code]);

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
