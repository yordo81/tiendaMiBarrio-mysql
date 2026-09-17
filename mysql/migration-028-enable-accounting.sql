-- ============================================================
-- Migración 028: Opción para activar/desactivar módulo de contabilidad
-- ============================================================

ALTER TABLE settings
  ADD COLUMN enable_accounting TINYINT(1) NOT NULL DEFAULT 1
  AFTER enable_touch_pos;

SELECT '✅ Migración 028: enable_accounting agregado a settings' AS status;
