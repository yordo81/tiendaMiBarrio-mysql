-- ============================================================
-- Migration 003: Vincular customer_payments con sales
-- ============================================================
-- Agrega columna sale_id a customer_payments para saber qué
-- venta(s) está pagando cada abono.
-- ============================================================

USE tienda_mi_barrio;

ALTER TABLE customer_payments
  ADD COLUMN sale_id CHAR(36) NULL AFTER customer_id,
  ADD FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL;
