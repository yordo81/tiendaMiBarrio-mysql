-- ============================================================
-- Migration 010: Agregar indicador de producto perecedero
-- ============================================================
-- Ejecutar: mysql -u root -p tienda_mi_barrio < migration-010-is-perishable.sql
-- ============================================================

ALTER TABLE products
  ADD COLUMN is_perishable TINYINT(1) NOT NULL DEFAULT 0 AFTER expiration_date;

-- Índice para filtrar productos perecederos
CREATE INDEX idx_is_perishable ON products (is_perishable);

SELECT '✅ migration-010: columna is_perishable agregada a products' AS status;
