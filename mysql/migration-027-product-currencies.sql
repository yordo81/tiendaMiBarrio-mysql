-- ============================================================
-- Migración 027: Monedas en productos (costo y venta)
-- ============================================================
USE tienda_mi_barrio;

-- Agregar columna de moneda del costo
ALTER TABLE products
  ADD COLUMN cost_currency VARCHAR(10) NULL COMMENT 'Moneda del precio de costo (NULL = moneda base)' AFTER cost;

-- Agregar columna de moneda de venta
ALTER TABLE products
  ADD COLUMN sale_currency VARCHAR(10) NULL COMMENT 'Moneda del precio de venta (NULL = moneda base)' AFTER sale_price;

-- Los productos existentes heredan la moneda base (NULL)
-- No se necesita migración de datos ya que NULL = moneda base

SELECT '✅ Migración 027: Monedas en productos aplicada correctamente' AS status;
