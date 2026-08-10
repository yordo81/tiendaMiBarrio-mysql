-- ============================================================
-- Migration 019: Impresoras registradas (multi-impresora)
-- ============================================================
-- Permite registrar varias impresoras térmicas (identificadas por su
-- dispositivo USB: vendor_id + product_id + serial) y marcar una de
-- ellas como la impresora que imprime los tickets de venta.
-- ============================================================
-- Ejecutar: mysql -u root -p tienda_mi_barrio < migration-019-printers.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS printers (
  id            VARCHAR(36)  NOT NULL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  vendor_id     INT UNSIGNED NOT NULL COMMENT 'ID del fabricante USB',
  product_id    INT UNSIGNED NOT NULL COMMENT 'ID del producto USB',
  serial_number VARCHAR(255) NULL COMMENT 'Número de serie USB (puede estar vacío)',
  device_key    VARCHAR(255) GENERATED ALWAYS AS (CONCAT(vendor_id, ':', product_id, ':', COALESCE(serial_number, ''))) STORED COMMENT 'Clave única del dispositivo (evita duplicados)',
  is_default    TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = imprime los tickets de venta',
  created_at    DATETIME     NOT NULL,
  updated_at    DATETIME     NOT NULL,
  UNIQUE KEY uq_printers_device_key (device_key),
  INDEX idx_printers_default (is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Impresoras registradas para imprimir tickets de venta';

SELECT '✅ migration-019: tabla printers creada' AS status;
