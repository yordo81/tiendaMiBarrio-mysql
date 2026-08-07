-- ============================================================
-- Migration 015: Registrar la caja en gastos y compras
-- ============================================================
-- Ejecutar: mysql -u root -p tienda_mi_barrio < migration-015-pos-gastos-compras.sql
-- O: node scripts/apply-migration-015.js
-- ============================================================
-- Permite que el arqueo y el reporte de cada turno sumen SOLO los
-- gastos y compras registrados en su caja (expenses.pos_id /
-- purchases.pos_id → pos.id). Los registros anteriores a esta
-- migración quedan con pos_id NULL y no se atribuyen a ningún turno.

ALTER TABLE expenses ADD COLUMN pos_id VARCHAR(36) NULL COMMENT 'Punto de venta / caja donde se registró el gasto' AFTER user_id;
ALTER TABLE expenses ADD CONSTRAINT fk_expenses_pos FOREIGN KEY (pos_id) REFERENCES pos(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD KEY idx_expenses_pos (pos_id);

ALTER TABLE purchases ADD COLUMN pos_id VARCHAR(36) NULL COMMENT 'Punto de venta / caja donde se registró la compra' AFTER user_id;
ALTER TABLE purchases ADD CONSTRAINT fk_purchases_pos FOREIGN KEY (pos_id) REFERENCES pos(id) ON DELETE SET NULL;
ALTER TABLE purchases ADD KEY idx_purchases_pos (pos_id);

SELECT '✅ migration-015: expenses.pos_id y purchases.pos_id agregadas (gastos y compras vinculados a caja)' AS status;
