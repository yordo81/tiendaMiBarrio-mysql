-- ============================================================
-- Migration 011: Sistema de notificaciones internas
-- ============================================================
-- Ejecutar: mysql -u root -p tienda_mi_barrio < migration-011-notification-logs.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_logs (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  type VARCHAR(50) NOT NULL COMMENT 'Tipo: expiration_5d, expiration_15d, expiration_30d, low_stock, etc.',
  product_id VARCHAR(36) DEFAULT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  severity ENUM('critical','warning','info','success') NOT NULL DEFAULT 'info',
  dismissed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  read_at DATETIME DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_notification_type ON notification_logs (type);
CREATE INDEX idx_notification_product ON notification_logs (product_id);
CREATE INDEX idx_notification_dismissed ON notification_logs (dismissed, created_at);

SELECT '✅ migration-011: tabla notification_logs creada' AS status;
