-- ============================================================
-- Migración 037 — Unidad de compra y factor de conversión
-- ============================================================
-- Permite comprar en una unidad y vender en otra (productos
-- fraccionados): comprar 50 kg de arroz y venderlo por libras.
--
-- products.purchase_unit   → unidad en que se COMPRA (NULL = misma
--                            que `unit`, la unidad de venta/stock).
-- products.purchase_factor → cuántas unidades de VENTA (= `unit`,
--                            la unidad del stock) equivale 1 unidad
--                            de compra. Ejemplo:
--                              unit           = 'libra'
--                              purchase_unit  = 'kg'
--                              purchase_factor= 2.20462
--                            Es decir: 1 kg = 2.20462 libras.
--
-- Conversión aplicada por la API de compras:
--   stock a incrementar = cantidad × factor
--   precio por unidad de venta = precio de compra ÷ factor
--   (el dinero total no cambia: 50 kg × $100 = 110.23 lb × $45.36)
--
-- NULL (o factor <= 0) → sin conversión: se conserva el
-- comportamiento actual de una sola unidad.
--
-- purchases.unit            → unidad en la que se capturó la cantidad
--                             (NULL = unidad del producto, filas viejas).
-- purchase_prices.unit      → unidad en la que se capturó el precio
--                             (NULL = unidad del producto, filas viejas).
-- Ambos hacen inequívoco el histórico sin romper los datos existentes.
-- ============================================================

-- ── 1) products: unidad de compra + factor ───────────────────
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'purchase_unit'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE products ADD COLUMN purchase_unit VARCHAR(50) NULL COMMENT ''Unidad de compra (NULL = misma que unit)'' AFTER unit',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'products'
    AND COLUMN_NAME = 'purchase_factor'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE products ADD COLUMN purchase_factor DECIMAL(12,6) NULL COMMENT ''Cuántas unidades de venta (unit) equivale 1 unidad de compra. NULL o <=0 = sin conversión'' AFTER purchase_unit',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2) purchases: unidad de la cantidad capturada ────────────
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'purchases'
    AND COLUMN_NAME = 'unit'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE purchases ADD COLUMN unit VARCHAR(50) NULL COMMENT ''Unidad de la cantidad capturada (NULL = unidad del producto)'' AFTER quantity',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 3) purchase_prices: unidad del precio capturado ──────────
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'purchase_prices'
    AND COLUMN_NAME = 'unit'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE purchase_prices ADD COLUMN unit VARCHAR(50) NULL COMMENT ''Unidad del precio capturado (NULL = unidad del producto)'' AFTER price',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 4) Registrar la migración en la tabla de control ─────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   VARCHAR(255) NOT NULL PRIMARY KEY,
  applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (filename)
VALUES ('migration-037-product-purchase-unit.sql');

SELECT '✅ Migración 037: purchase_unit/purchase_factor aplicada' AS status;
