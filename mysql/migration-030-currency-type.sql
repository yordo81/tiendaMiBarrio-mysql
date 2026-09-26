-- ============================================================
-- Migración 030 — Tipo de moneda: física (efectivo) o digital
-- ============================================================
-- Cada moneda se clasifica como:
--   'cash'    → moneda física: solo se puede cobrar en EFECTIVO.
--   'digital' → moneda digital: solo se puede cobrar por TRANSFERENCIA.
-- El cobro mixto admite ambas.
--
-- Valores por defecto para las monedas conocidas: CUP, USD y EUR son
-- físicas; MLC (Moneda Libremente Convertible) es digital.
-- ============================================================

-- ── 1) Columna nueva (guard idempotente por si ya existe) ──────
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'currencies'
    AND COLUMN_NAME = 'currency_type'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE currencies ADD COLUMN currency_type VARCHAR(10) NOT NULL DEFAULT ''cash'' COMMENT ''cash = moneda física (efectivo); digital = moneda digital (transferencia)'' AFTER is_base',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2) Clasificación por defecto de las monedas conocidas ──────
UPDATE currencies SET currency_type = 'digital' WHERE code = 'MLC';
UPDATE currencies SET currency_type = 'cash'    WHERE code IN ('CUP', 'USD', 'EUR');

-- ── 3) Registrar la migración en la tabla de control ───────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   VARCHAR(255) NOT NULL PRIMARY KEY,
  applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (filename)
VALUES ('migration-030-currency-type.sql');

SELECT '✅ Migración 030: tipo de moneda (física/digital) aplicado' AS status;
