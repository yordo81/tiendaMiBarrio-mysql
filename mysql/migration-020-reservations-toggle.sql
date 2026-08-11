-- ============================================================
-- Migration 020: Mostrar / ocultar el módulo de Reservaciones
-- ============================================================
-- Ejecutar: mysql -u root -p tienda_mi_barrio < migration-020-reservations-toggle.sql
-- ============================================================

-- 1 = el módulo de Reservaciones se muestra (catálogo público en la página
-- de entrada + menú del dashboard). 0 = se oculta y la página de entrada
-- pasa a ser la de inicio (/inicio).
ALTER TABLE settings
  ADD COLUMN show_reservations TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '1 = mostrar el módulo de reservaciones y el catálogo público en la página de entrada' AFTER receipt_auto_print;

UPDATE settings SET show_reservations = 1 WHERE id = '1';

SELECT '✅ migration-020: columna show_reservations agregada a settings' AS status;
