-- ============================================================
-- Migration 008: Agregar campo barcode a la tabla products
-- ============================================================
-- Permite identificar productos por código de barras desde
-- la app móvil Flutter con escáner de cámara.
-- ============================================================

USE tienda_mi_barrio;

ALTER TABLE products
  ADD COLUMN barcode VARCHAR(100) NULL UNIQUE AFTER id,
  ADD INDEX idx_barcode (barcode);

SELECT '✓ migration-008: columna barcode agregada a products' AS status;
