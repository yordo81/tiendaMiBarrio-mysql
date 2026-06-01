-- ============================================================
-- Migration 004: Agregar tabla purchases (histórico de compras)
-- ============================================================
-- Ejecutar: mysql -u root -p < mysql/migration-004-purchases-table.sql
-- ============================================================

USE tienda_mi_barrio;

CREATE TABLE IF NOT EXISTS purchases (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  product_id  CHAR(36)      NOT NULL,
  supplier_id CHAR(36)      NOT NULL,
  quantity    DECIMAL(12,3) NOT NULL,
  unit_price  DECIMAL(12,2) NOT NULL,
  total_cost  DECIMAL(12,2) NOT NULL,
  location_id CHAR(36)      NULL,
  notes       TEXT          NULL,
  user_id     CHAR(36)      NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id)  REFERENCES products(id)  ON DELETE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id)     REFERENCES users(id)     ON DELETE SET NULL,
  INDEX idx_product (product_id),
  INDEX idx_supplier (supplier_id),
  INDEX idx_date (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT '✓ Tabla purchases creada correctamente' AS status;
