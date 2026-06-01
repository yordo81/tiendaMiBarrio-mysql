-- ============================================================
-- Migration 005: Agregar tabla audit_logs
-- ============================================================
-- Registro de auditoría para rastrear eliminaciones y otras
-- acciones críticas realizadas por administradores.
-- ============================================================

USE tienda_mi_barrio;

CREATE TABLE IF NOT EXISTS audit_logs (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  user_id     CHAR(36)      NOT NULL,
  user_name   VARCHAR(255)  NOT NULL,
  action      VARCHAR(50)   NOT NULL,
  entity_type VARCHAR(50)   NOT NULL,
  entity_id   CHAR(36)      NOT NULL,
  entity_name VARCHAR(255)  NULL,
  details     JSON          NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_entity (entity_type),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT '✓ audit_logs creada' AS status;
