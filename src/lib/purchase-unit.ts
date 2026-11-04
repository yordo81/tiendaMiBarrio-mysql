// ── Unidad de compra y factor de conversión (migración 037) ────────
// Permite comprar en una unidad y vender en otra (productos fraccionados):
// comprar 50 kg de arroz y venderlo por libras.
//
//   unit            = 'libra'   ← unidad de venta / stock (products.unit)
//   purchase_unit   = 'kg'      ← unidad de compra (products.purchase_unit)
//   purchase_factor = 2.20462   ← 1 unidad de compra equivale a X unidades
//                                 de venta (1 kg = 2.20462 libras)
//
// Conversión aplicada al comprar (unidad de captura ≠ unidad de venta y
// factor > 0), según el contrato de la migración 037:
//   stock a incrementar         = cantidad × factor
//   precio por unidad de venta  = precio de compra ÷ factor
//   (el total en dinero no cambia: 50 kg × $100 = 110.23 lb × $45.36)
//
// NULL / factor <= 0 / sin unidad de compra = sin conversión (factor 1),
// conservando el comportamiento de una sola unidad.

// Normaliza comparaciones de unidades: minúsculas, sin tildes ni dobles espacios.
export function normalizeUnit(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// Campos del producto relevantes para la conversión (acepta la fila de
// la base de datos o el objeto Product del cliente).
export interface ProductUnitInfo {
  unit?: string | null;
  purchase_unit?: string | null;
  purchase_factor?: number | string | null;
}

// Factor aplicable a una compra capturada en `captureUnit` (o en la unidad
// de compra configurada del producto si no se indica). Devuelve 1 cuando
// no hay conversión: sin factor válido, sin unidad de compra distinta o
// cuando el usuario compró en la misma unidad de venta/stock.
export function resolvePurchaseFactor(
  product: ProductUnitInfo,
  captureUnit?: string | null,
): number {
  const factor = Number(product.purchase_factor);
  if (!Number.isFinite(factor) || factor <= 0) return 1;
  const saleUnit = normalizeUnit(product.unit);
  const purchaseUnit = normalizeUnit(product.purchase_unit);
  if (!purchaseUnit || purchaseUnit === saleUnit) return 1;
  const capture = captureUnit != null && String(captureUnit).trim()
    ? normalizeUnit(captureUnit)
    : purchaseUnit; // sin unidad explícita se asume la unidad de compra configurada
  if (!capture || capture === saleUnit) return 1;
  return factor;
}

// Redondeos coherentes con las columnas de MySQL:
// stock/quantity DECIMAL(12,3) y precios DECIMAL(12,2).
export function roundStock(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

// Unidad efectiva de captura para guardar en purchases/purchase_prices:
// la que digitó el usuario, o la unidad de compra configurada si la compra
// se realizó en ella, o NULL si se capturó en la unidad del producto
// (filas "clásicas", mismo criterio que usa la migración para los históricos).
export function resolveCaptureUnit(
  product: ProductUnitInfo,
  captureUnit?: string | null,
): string | null {
  if (captureUnit && String(captureUnit).trim()) return String(captureUnit).trim();
  if (resolvePurchaseFactor(product, captureUnit) !== 1) {
    const purchase = product.purchase_unit ? String(product.purchase_unit).trim() : '';
    if (purchase) return purchase;
  }
  return null;
}
