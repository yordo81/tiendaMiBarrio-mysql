-- ============================================================
-- Migración 032 — Total al precio de lista en ventas
-- ============================================================
-- Guarda el total del pedido al precio de lista (antes del descuento)
-- para las ventas de tipo oferta, de modo que el ticket impreso —y su
-- reimpresión desde el detalle de la venta— pueda mostrar el descuento.
-- NULL = sin descuento (venta normal o oferta al precio de lista).
-- ============================================================

-- ── 1) Columna nueva (guard idempotente por si ya existe) ──────
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sales'
    AND COLUMN_NAME = 'list_total'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE sales ADD COLUMN list_total DECIMAL(12,2) NULL COMMENT ''Total al precio de lista antes del descuento de oferta'' AFTER exchange_rate',
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
VALUES ('migration-032-sales-list-total.sql');

SELECT '✅ Migración 032: total al precio de lista en ventas aplicada' AS status;
