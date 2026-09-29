-- ============================================================
-- Migración 033 — Método de pago general en ventas
-- ============================================================
-- Guarda el método general con el que se registró la venta:
-- 'cash' (efectivo), 'transfer' (transferencia), 'mixed' (mixto),
-- 'oferta' (precio negociado cobrado en varias monedas) o 'credit'
-- (crédito: queda como deuda). El listado de ventas usa este dato
-- para la columna "Tipo"; antes derivaba Contado/Crédito del estado,
-- lo que perdía el método real de la venta (oferta, transferencia,
-- mixto...). NULL = ventas anteriores a la columna (el listado puede
-- derivarlo de los pagos como respaldo).
-- ============================================================

-- ── 1) Columna nueva (guard idempotente por si ya existe) ──────
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sales'
    AND COLUMN_NAME = 'payment_method'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE sales ADD COLUMN payment_method ENUM(''cash'',''transfer'',''mixed'',''credit'',''oferta'') NULL COMMENT ''Método general de la venta: cash/transfer/mixed/credit/oferta'' AFTER total',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2) Registrar la migración en la tabla de control ───────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   VARCHAR(255) NOT NULL PRIMARY KEY,
  applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (filename)
VALUES ('migration-033-sales-payment-method.sql');

SELECT '✅ Migración 033: sales.payment_method aplicada' AS status;
