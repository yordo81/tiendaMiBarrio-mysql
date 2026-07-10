-- ============================================================
-- Migration 007: Gestión de Capital / Inversiones en Inventario
-- ============================================================
-- 1. Amplía cash_register.type para aceptar 'purchase' (compra
--    de inventario como reinversión) y 'capital' (aporte de
--    nuevo capital del dueño).
-- 2. NOTA: MySQL no permite ALTER TABLE para modificar un ENUM
--    sobre la marcha de forma segura, así que usamos ALTER
--    para cambiar la definición del ENUM.
-- ============================================================

USE tienda_mi_barrio;

ALTER TABLE cash_register
  MODIFY COLUMN type ENUM('initial','adjustment','purchase','capital') NOT NULL DEFAULT 'adjustment';

SELECT '✓ migration-007: cash_register.type ampliado a purchase + capital' AS status;
