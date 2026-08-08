-- ============================================================
-- Migration 017: Campo invoice_number en purchases (n.º de factura)
-- ============================================================
-- Ejecutar: mysql -u root -p < mysql/migration-017-purchases-invoice.sql
-- o: node scripts/apply-migration-017.js
-- ============================================================

USE tienda_mi_barrio;

ALTER TABLE purchases
  ADD COLUMN invoice_number VARCHAR(100) NULL COMMENT 'Número de factura de compra' AFTER pos_id,
  ADD INDEX idx_invoice_number (invoice_number);

SELECT '✓ Columna invoice_number agregada a purchases' AS status;
