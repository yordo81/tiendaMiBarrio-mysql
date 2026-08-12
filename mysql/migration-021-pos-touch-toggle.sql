-- ============================================================
-- Migration 021: Activar / desactivar el punto de venta táctil
-- ============================================================
-- Ejecutar: mysql -u root -p tienda_mi_barrio < migration-021-pos-touch-toggle.sql
-- ============================================================

-- 1 = el POS táctil (/dashboard/ventas/touch) está disponible para los
-- vendedores (se redirige ahí desde Ventas, el dashboard y los menús).
-- 0 = se desactiva: los vendedores vuelven a la página de ventas con la
-- ventana modal de nueva venta.
ALTER TABLE settings
  ADD COLUMN enable_touch_pos TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '1 = mostrar el punto de venta táctil para vendedores' AFTER show_reservations;

UPDATE settings SET enable_touch_pos = 1 WHERE id = '1';

SELECT '✅ migration-021: columna enable_touch_pos agregada a settings' AS status;
