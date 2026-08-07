-- ============================================================
-- Migration 014: Registrar el punto de venta (caja) en las ventas
-- ============================================================
-- Ejecutar: mysql -u root -p tienda_mi_barrio < migration-014-sales-pos.sql
-- O: node scripts/apply-migration-014.js
-- ============================================================
-- Permite que el arqueo y el reporte de cada turno sumen SOLO las
-- ventas realizadas en su caja (sales.pos_id → pos.id).
-- Las ventas anteriores a esta migración quedan con pos_id NULL y no
-- se atribuyen a ningún turno.

ALTER TABLE sales ADD COLUMN pos_id VARCHAR(36) NULL COMMENT 'Punto de venta / caja donde se realizó la venta' AFTER user_id;
ALTER TABLE sales ADD CONSTRAINT fk_sales_pos FOREIGN KEY (pos_id) REFERENCES pos(id) ON DELETE SET NULL;
ALTER TABLE sales ADD KEY idx_sales_pos (pos_id);

SELECT '✅ migration-014: sales.pos_id agregada (ventas vinculadas a caja)' AS status;
