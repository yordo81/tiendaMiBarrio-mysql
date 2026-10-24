-- ============================================================
-- Migración 035 — Moneda de pago en los gastos
-- ============================================================
-- Al declarar un gasto se elige la moneda según el método de pago:
--   - Efectivo (cash): solo monedas físicas (`currencies.currency_type`='cash')
--   - Transferencia (transfer): solo monedas digitales ('digital')
--   - Mixto (mixed): cualquiera
--
-- Columnas nuevas en `expenses`:
--   - currency_code:   código de la moneda del pago (NULL = moneda base,
--     como todos los registros antiguos).
--   - currency_amount: monto ORIGINAL declarado en ESA moneda.
--   - exchange_rate:   tasa congelada al registrar (1 moneda = X base).
--
-- `amount` sigue siendo el monto en MONEDA BASE (monto × tasa al
-- momento del registro), de modo que todos los reportes, la
-- contabilidad y las tarjetas del módulo siguen sumando en base sin
// cambios. El arqueo del turno desglosa la salida de efectivo por
// moneda con `currency_code` + `currency_amount`.
-- ============================================================

-- ── 1) Columnas nuevas (guards idempotentes por si ya existen) ──
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'expenses'
    AND COLUMN_NAME = 'currency_code'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE expenses ADD COLUMN currency_code VARCHAR(10) NULL COMMENT ''Moneda del pago del gasto (NULL = moneda base)'' AFTER payment_method',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'expenses'
    AND COLUMN_NAME = 'currency_amount'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE expenses ADD COLUMN currency_amount DECIMAL(12,2) NULL COMMENT ''Monto original declarado en la moneda del gasto'' AFTER currency_code',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'expenses'
    AND COLUMN_NAME = 'exchange_rate'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE expenses ADD COLUMN exchange_rate DECIMAL(12,6) NULL COMMENT ''Tasa congelada al registrar: 1 moneda = X base'' AFTER currency_amount',
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
VALUES ('migration-035-expense-currency.sql');

SELECT '✅ Migración 035: expenses.currency_code / currency_amount / exchange_rate aplicadas' AS status;
