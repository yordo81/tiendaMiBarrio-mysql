-- ============================================================
-- Migration 007: Reservations (Reservaciones de mercancía)
-- ============================================================
-- Permite a clientes potenciales (visitantes de la landing page)
-- reservar productos directamente desde la página pública.
-- ============================================================

CREATE TABLE IF NOT EXISTS reservations (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  product_id    CHAR(36)      NOT NULL,
  customer_name VARCHAR(255)  NOT NULL,
  customer_phone VARCHAR(50)  NULL,
  quantity      DECIMAL(12,3) NOT NULL DEFAULT 1.000,
  status        ENUM('pending','confirmed','cancelled') NOT NULL DEFAULT 'pending',
  notes         TEXT          NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_status (status),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
