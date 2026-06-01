-- ============================================================
-- Migration 006: Módulo de Contabilidad
-- ============================================================
-- 1. Agrega columna payment_method a expenses para clasificar
--    egresos por efectivo/transferencia
-- 2. Crea tabla cash_register para saldo inicial y ajustes
-- ============================================================

USE tienda_mi_barrio;

-- 1. Agregar payment_method a expenses (nullable para registros antiguos)
ALTER TABLE expenses
  ADD COLUMN payment_method ENUM('cash','transfer','mixed') NULL DEFAULT NULL AFTER amount;

-- 2. Tabla de caja (saldo inicial y ajustes manuales)
CREATE TABLE IF NOT EXISTS cash_register (
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  type             ENUM('initial','adjustment') NOT NULL DEFAULT 'adjustment',
  cash_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  transfer_amount  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  notes            TEXT          NULL,
  date             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id          CHAR(36)      NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT '✓ migration-006: payment_method en expenses + cash_register table' AS status;
