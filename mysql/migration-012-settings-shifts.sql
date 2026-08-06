-- ============================================================
-- Migration 012: Configuración del negocio + Turnos de caja
-- ============================================================
-- Ejecutar: mysql -u root -p tienda_mi_barrio < migration-012-settings-shifts.sql
-- ============================================================

-- ── 1. Tabla de configuración (una sola fila, id fijo '1') ──
CREATE TABLE IF NOT EXISTS settings (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  business_name VARCHAR(120) NOT NULL DEFAULT 'TiendaMiBarrio',
  logo_url VARCHAR(255) DEFAULT NULL,
  work_mode ENUM('daily','shifts') NOT NULL DEFAULT 'daily' COMMENT 'daily = por días, shifts = por turnos',
  updated_by VARCHAR(36) DEFAULT NULL,
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO settings (id, business_name, logo_url, work_mode, updated_at)
VALUES ('1', 'TiendaMiBarrio', NULL, 'daily', NOW())
ON DUPLICATE KEY UPDATE id = id;

-- ── 2. Tabla de turnos de caja ──
CREATE TABLE IF NOT EXISTS shifts (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL COMMENT 'Quien abrió el turno',
  opened_at DATETIME NOT NULL,
  closed_at DATETIME DEFAULT NULL,
  opening_cash DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Fondo inicial en caja',
  closing_cash DECIMAL(12,2) DEFAULT NULL COMMENT 'Efectivo contado al cerrar',
  expected_cash DECIMAL(12,2) DEFAULT NULL COMMENT 'Efectivo esperado según movimientos',
  difference DECIMAL(12,2) DEFAULT NULL COMMENT 'Diferencia: contado - esperado',
  notes VARCHAR(500) DEFAULT NULL,
  status ENUM('open','closed') NOT NULL DEFAULT 'open',
  closed_by VARCHAR(36) DEFAULT NULL,
  created_at DATETIME NOT NULL,
  KEY idx_shifts_status (status),
  KEY idx_shifts_opened (opened_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 3. Vincular movimientos de caja al turno ──
ALTER TABLE cash_register ADD COLUMN shift_id VARCHAR(36) DEFAULT NULL COMMENT 'Turno de caja asociado' AFTER user_id;

SELECT '✅ migration-012: tablas settings y shifts creadas, cash_register.shift_id agregada' AS status;
