-- ============================================================
-- Migration 009: Agregar fecha de caducidad a productos
-- ============================================================
-- Ejecutar: mysql -u root -p tienda_mi_barrio < migration-009-expiration.sql
-- ============================================================

ALTER TABLE products
  ADD COLUMN expiration_date DATE NULL AFTER unit;

-- Eliminar productos vencidos de la vista de catálogo activo (opcional)
-- Se puede usar en consultas: WHERE expiration_date IS NULL OR expiration_date >= CURDATE()

-- Índice para búsquedas rápidas por fecha de caducidad
CREATE INDEX idx_expiration ON products (expiration_date);

SELECT '✅ migration-009: columna expiration_date agregada a products' AS status;
