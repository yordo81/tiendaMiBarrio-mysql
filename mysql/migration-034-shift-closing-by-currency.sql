-- ============================================================
-- Migración 034 — Arqueo de cierre por moneda (contado declarado)
-- ============================================================
-- Al cerrar un turno se debe declarar el efectivo contado en TODAS
-- las monedas físicas en que se realizaron las ventas (no solo el
-- total convertido a moneda base). Esta columna guarda ese desglose
-- declarado por el usuario al cerrar, p. ej.:
--   [{"code":"CUP","amount":9000,"rate":1},
--    {"code":"USD","amount":20,"rate":240}]
--
-- - `rate` es la tasa congelada del turno (1 moneda = X base), la
--   misma referencia con la que se calculó el efectivo esperado.
-- - `closing_cash` sigue guardando el TOTAL del contado expresado en
--   moneda base (suma de cada moneda × su tasa), y `difference` la
--   diferencia contra `expected_cash`, ambos en base.
-- - Los cierres anteriores quedan con NULL: el reporte los muestra
--   con el total en base (comportamiento previo).
-- ============================================================

-- ── 1) Columna nueva (guard idempotente por si ya existe) ──────
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'shifts'
    AND COLUMN_NAME = 'closing_cash_by_currency'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE shifts ADD COLUMN closing_cash_by_currency JSON NULL COMMENT ''Desglose del efectivo contado al cerrar, por moneda: [{code, amount, rate}] (rate: 1 moneda = X base)'' AFTER closing_cash',
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
VALUES ('migration-034-shift-closing-by-currency.sql');

SELECT '✅ Migración 034: shifts.closing_cash_by_currency aplicada' AS status;
