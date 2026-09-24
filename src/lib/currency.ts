// ── Utilidades de conversión de moneda (cliente y servidor) ──────────
// Convención de tasas: `currency_rates` guarda SOLO filas contra el
// dólar (1 USD = X moneda). La tasa de una moneda hacia la base se
// deriva de esa referencia: tasa_base(X) = (1 USD en base) ÷ (1 USD = X).
// La moneda base tiene tasa 1 consigo misma. Convertir entre dos
// monedas siempre pasa por la base: FROM → base → TO.

/** Redondeo monetario a 2 decimales. */
export function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Redondeo HACIA ARRIBA al múltiplo de `step` (por defecto 0.05).
 * Se aplica SIEMPRE a los precios convertidos: no existen monedas de
 * 1 centavo, así que un precio de 46.9767 pasa a 47.00 y uno de 2.331 a
 * 2.35. Los múltiplos exactos se quedan igual (2.35 → 2.35). El epsilon
 * evita falsos techos por flotantes.
 */
export function roundToNickel(n: number, step = 0.05): number {
  const s = step > 0 ? step : 0.05;
  return r2(Math.ceil(n / s - 1e-9) * s);
}

export interface CurrencyLike {
  code: string;
  /** Tasa hacia la moneda base: 1 unidad = rate unidades base. En la base es 1. */
  rate: number;
  is_base: boolean;
}

/**
 * Convierte un monto desde una moneda a otra usando las tasas vigentes
 * (o congeladas) del negocio. Siempre pasa por la moneda base:
 *   - base → extranjera: divide por su tasa (1 USD = 430 CUP ⇒ 430 CUP / 430 = 1 USD)
 *   - extranjera → base: multiplica por su tasa (1 USD = 430 CUP ⇒ 5 USD = 2150 CUP)
 *   - extranjera → extranjera: base intermedia
 *
 * `from` o `to` vacíos/null se tratan como MONEDA BASE (los productos sin
 * `sale_currency` están fijados en la base). Si no se encuentra la tasa de
 * una moneda extranjera, se devuelve el monto sin convertir.
 */
export function convertAmount(
  amount: number,
  from: string | null | undefined,
  to: string | null | undefined,
  currencies: CurrencyLike[]
): number {
  const fromCode = (from ?? '').trim().toUpperCase() || null; // null = moneda base
  const toCode = (to ?? '').trim().toUpperCase() || null;
  if (!fromCode || !toCode || fromCode === toCode) return amount;
  const fromCur = currencies.find(c => c.code === fromCode) ?? null;
  const toCur = currencies.find(c => c.code === toCode) ?? null;
  const fromIsBase = !fromCur || fromCur.is_base;
  const toIsBase = !toCur || toCur.is_base;
  // from → base
  const inBase = fromIsBase
    ? amount
    : (fromCur!.rate > 0 ? amount * fromCur!.rate : amount);
  if (toIsBase) return r2(inBase);
  // base → to
  return r2(toCur!.rate > 0 ? inBase / toCur!.rate : inBase);
}
