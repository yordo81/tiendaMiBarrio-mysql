-- ============================================================
-- Migración 036 — Gasto mixto multi-moneda
-- ============================================================
-- Cuando el pago del gasto es MIXTO se puede pagar la mezcla entre
-- monedas físicas (efectivo) y digitales (transferencia): se declara
-- una PARTE por moneda, igual que en el POS multi-moneda. Esta columna
-- guarda el desglose, p. ej.:
--   [{"code":"CUP","amount":5000,"rate":1,"method":"cash"},
--    {"code":"USD","amount":10,"rate":240,"method":"transfer"}]
--
-- - `code` es el código de la moneda (null = moneda base) y `amount`
--   el monto declarado EN ESA moneda.
-- - `rate` es la tasa congelada al registrar (1 moneda = X base) y
--   `method` lo fija el TIPO de la moneda: físicas → 'cash',
--   digitales → 'transferencia'.
-- - `amount` (total del gasto en MONEDA BASE) sigue sumando parts × su
--   tasa; los gastos mixtos con UNA sola moneda (legado) no llevan
--   desglose y quedan como estaban (mitad/mitad aproximada).
-- ============================================================

-- ── 1) Columna nueva (guard idempotente por si ya existe) ──────
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'expenses'
    AND COLUMN_NAME = 'mixed_parts'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE expenses ADD COLUMN mixed_parts JSON NULL COMMENT ''Desglose del gasto mixto por moneda: [{code, amount, rate, method}]'' AFTER exchange_rate',
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
VALUES ('migration-036-expense-mixed-parts.sql');

SELECT '✅ Migración 036: expenses.mixed_parts aplicada' AS status;
