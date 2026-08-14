-- ============================================================
-- Migration 022: Vendedores asociados a un punto de venta (caja)
-- ============================================================
-- Ejecutar: mysql -u root -p tienda_mi_barrio < migration-022-users-pos.sql
-- ============================================================
-- Cada usuario puede estar asociado a una caja (punto de venta). En modo
-- por turnos, el vendedor asociado trabaja fijo en su caja: abre el turno
-- y vende solo en el almacén de esa caja, sin elegir almacén ni caja en el
-- punto de venta táctil.

-- ── 1. Columna de asociación ──
ALTER TABLE users
  ADD COLUMN pos_id VARCHAR(36) NULL
  COMMENT 'Caja (punto de venta) asociada; en modo turnos el vendedor trabaja fijo en su almacén'
  AFTER role;

ALTER TABLE users ADD KEY idx_users_pos (pos_id);
ALTER TABLE users ADD CONSTRAINT fk_users_pos FOREIGN KEY (pos_id) REFERENCES pos(id);

SELECT '✅ migration-022: columna users.pos_id agregada y vinculada a pos' AS status;
