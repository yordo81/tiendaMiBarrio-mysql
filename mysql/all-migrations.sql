-- ============================================================
-- Todas las migraciones consolidadas (002 → 025)
-- TiendaMiBarrio — MySQL Edition
-- ============================================================
-- Este archivo reemplaza los archivos individuales
-- migration-002*.sql … migration-025*.sql.
-- Se ejecuta desde entrypoint.sh de forma atómica.
-- ============================================================

USE tienda_mi_barrio;

-- ============================================================
-- Migración 002: ON DELETE SET NULL a FK de user_id
-- ============================================================
-- Procedure auxiliar: dropea TODAS las FK de una columna
DELIMITER //
DROP PROCEDURE IF EXISTS _drop_fk_if_exists //
CREATE PROCEDURE _drop_fk_if_exists(IN tbl_name VARCHAR(255), IN col_name VARCHAR(255))
BEGIN
  DECLARE fk_name VARCHAR(255);
  DECLARE done INT DEFAULT FALSE;
  DECLARE cur CURSOR FOR
    SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = tbl_name
      AND COLUMN_NAME = col_name
      AND REFERENCED_TABLE_NAME IS NOT NULL;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO fk_name;
    IF done THEN LEAVE read_loop; END IF;
    SET @sql = CONCAT('ALTER TABLE ', tbl_name, ' DROP FOREIGN KEY ', fk_name);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE cur;
END //
DELIMITER ;

CALL _drop_fk_if_exists('sales', 'user_id');
ALTER TABLE sales MODIFY user_id CHAR(36) NULL;
ALTER TABLE sales ADD CONSTRAINT fk_sales_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

CALL _drop_fk_if_exists('expenses', 'user_id');
ALTER TABLE expenses MODIFY user_id CHAR(36) NULL;
ALTER TABLE expenses ADD CONSTRAINT fk_expenses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

CALL _drop_fk_if_exists('stock_movements', 'user_id');
ALTER TABLE stock_movements MODIFY user_id CHAR(36) NULL;
ALTER TABLE stock_movements ADD CONSTRAINT fk_stock_movements_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

CALL _drop_fk_if_exists('stock_transfers', 'user_id');
ALTER TABLE stock_transfers MODIFY user_id CHAR(36) NULL;
ALTER TABLE stock_transfers ADD CONSTRAINT fk_stock_transfers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

CALL _drop_fk_if_exists('location_movements', 'user_id');
ALTER TABLE location_movements MODIFY user_id CHAR(36) NULL;
ALTER TABLE location_movements ADD CONSTRAINT fk_location_movements_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

DROP PROCEDURE IF EXISTS _drop_fk_if_exists;

-- ============================================================
-- Migración 003: Vincular customer_payments con sales
-- ============================================================
ALTER TABLE customer_payments
  ADD COLUMN sale_id CHAR(36) NULL AFTER customer_id,
  ADD FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL;

-- ============================================================
-- Migración 004: Tabla purchases (histórico de compras)
-- ============================================================
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

-- ============================================================
-- Migración 005: Tabla audit_logs
-- ============================================================
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

-- ============================================================
-- Migración 006: Módulo de Contabilidad
-- ============================================================
ALTER TABLE expenses
  ADD COLUMN payment_method ENUM('cash','transfer','mixed') NULL DEFAULT NULL AFTER amount;

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

-- ============================================================
-- Migración 007a: Gestión de Capital
-- ============================================================
ALTER TABLE cash_register
  MODIFY COLUMN type ENUM('initial','adjustment','purchase','capital') NOT NULL DEFAULT 'adjustment';

-- ============================================================
-- Migración 007b: Reservaciones
-- ============================================================
CREATE TABLE IF NOT EXISTS reservations (
  id             CHAR(36)      NOT NULL PRIMARY KEY,
  product_id     CHAR(36)      NOT NULL,
  customer_name  VARCHAR(255)  NOT NULL,
  customer_phone VARCHAR(50)   NULL,
  quantity       DECIMAL(12,3) NOT NULL DEFAULT 1.000,
  status         ENUM('pending','confirmed','cancelled') NOT NULL DEFAULT 'pending',
  notes          TEXT          NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_status (status),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Migración 008: Barcode
-- ============================================================
ALTER TABLE products
  ADD COLUMN barcode VARCHAR(100) NULL UNIQUE AFTER id,
  ADD INDEX idx_barcode (barcode);

-- ============================================================
-- Migración 009: Fecha de caducidad
-- ============================================================
ALTER TABLE products
  ADD COLUMN expiration_date DATE NULL AFTER unit,
  ADD INDEX idx_expiration (expiration_date);

-- ============================================================
-- Migración 010: Producto perecedero
-- ============================================================
ALTER TABLE products
  ADD COLUMN is_perishable TINYINT(1) NOT NULL DEFAULT 0 AFTER expiration_date,
  ADD INDEX idx_is_perishable (is_perishable);

-- ============================================================
-- Migración 011: Notificaciones internas
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_logs (
  id         VARCHAR(36) NOT NULL PRIMARY KEY,
  type       VARCHAR(50) NOT NULL COMMENT 'Tipo: expiration_5d, expiration_15d, expiration_30d, low_stock, etc.',
  product_id VARCHAR(36) DEFAULT NULL,
  title      VARCHAR(255) NOT NULL,
  message    TEXT NOT NULL,
  severity   ENUM('critical','warning','info','success') NOT NULL DEFAULT 'info',
  dismissed  TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  read_at    DATETIME DEFAULT NULL,
  INDEX idx_notification_type (type),
  INDEX idx_notification_product (product_id),
  INDEX idx_notification_dismissed (dismissed, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Migración 012: Configuración del negocio + Turnos de caja
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  id            VARCHAR(36) NOT NULL PRIMARY KEY,
  business_name VARCHAR(120) NOT NULL DEFAULT 'TiendaMiBarrio',
  logo_url      VARCHAR(255) DEFAULT NULL,
  work_mode     ENUM('daily','shifts') NOT NULL DEFAULT 'daily' COMMENT 'daily = por días, shifts = por turnos',
  updated_by    VARCHAR(36) DEFAULT NULL,
  updated_at    DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO settings (id, business_name, logo_url, work_mode, updated_at)
VALUES ('1', 'TiendaMiBarrio', NULL, 'daily', NOW())
ON DUPLICATE KEY UPDATE id = id;

CREATE TABLE IF NOT EXISTS shifts (
  id            VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id       VARCHAR(36) NOT NULL COMMENT 'Quien abrió el turno',
  opened_at     DATETIME NOT NULL,
  closed_at     DATETIME DEFAULT NULL,
  opening_cash  DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Fondo inicial en caja',
  closing_cash  DECIMAL(12,2) DEFAULT NULL COMMENT 'Efectivo contado al cerrar',
  expected_cash DECIMAL(12,2) DEFAULT NULL COMMENT 'Efectivo esperado según movimientos',
  difference    DECIMAL(12,2) DEFAULT NULL COMMENT 'Diferencia: contado - esperado',
  notes         VARCHAR(500) DEFAULT NULL,
  status        ENUM('open','closed') NOT NULL DEFAULT 'open',
  closed_by     VARCHAR(36) DEFAULT NULL,
  created_at    DATETIME NOT NULL,
  KEY idx_shifts_status (status),
  KEY idx_shifts_opened (opened_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE cash_register ADD COLUMN shift_id VARCHAR(36) DEFAULT NULL COMMENT 'Turno de caja asociado' AFTER user_id;

-- ============================================================
-- Migración 013: Puntos de venta (cajas) para turnos
-- ============================================================
CREATE TABLE IF NOT EXISTS pos (
  id         VARCHAR(36) NOT NULL PRIMARY KEY,
  name       VARCHAR(60) NOT NULL,
  active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_pos_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO pos (id, name, active, created_at)
SELECT 'POS-1', 'Caja principal', 1, NOW()
WHERE NOT EXISTS (SELECT 1 FROM pos WHERE id = 'POS-1');

ALTER TABLE shifts ADD COLUMN pos_id VARCHAR(36) NULL COMMENT 'Punto de venta / caja' AFTER user_id;
UPDATE shifts SET pos_id = 'POS-1' WHERE pos_id IS NULL;
ALTER TABLE shifts MODIFY COLUMN pos_id VARCHAR(36) NOT NULL;
ALTER TABLE shifts ADD CONSTRAINT fk_shifts_pos FOREIGN KEY (pos_id) REFERENCES pos(id);
ALTER TABLE shifts ADD KEY idx_shifts_pos_opened (pos_id, opened_at);

-- Cerrar turnos abiertos duplicados en una misma caja
UPDATE shifts s
JOIN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY pos_id, status ORDER BY opened_at DESC) AS rn
    FROM shifts
    WHERE status = 'open'
  ) t WHERE t.rn > 1
) dup ON dup.id = s.id
SET s.status = 'closed';

-- Guardia a nivel de BD: máximo un turno abierto por caja
ALTER TABLE shifts ADD COLUMN open_guard VARCHAR(36)
  GENERATED ALWAYS AS (IF(status = 'open', pos_id, NULL)) STORED;
ALTER TABLE shifts ADD UNIQUE KEY uq_shifts_open_per_pos (open_guard);

-- ============================================================
-- Migración 014: Registrar caja en ventas
-- ============================================================
ALTER TABLE sales ADD COLUMN pos_id VARCHAR(36) NULL COMMENT 'Punto de venta / caja donde se realizó la venta' AFTER user_id;
ALTER TABLE sales ADD CONSTRAINT fk_sales_pos FOREIGN KEY (pos_id) REFERENCES pos(id) ON DELETE SET NULL;
ALTER TABLE sales ADD KEY idx_sales_pos (pos_id);

-- ============================================================
-- Migración 015: Registrar caja en gastos y compras
-- ============================================================
ALTER TABLE expenses ADD COLUMN pos_id VARCHAR(36) NULL COMMENT 'Punto de venta / caja donde se registró el gasto' AFTER user_id;
ALTER TABLE expenses ADD CONSTRAINT fk_expenses_pos FOREIGN KEY (pos_id) REFERENCES pos(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD KEY idx_expenses_pos (pos_id);

ALTER TABLE purchases ADD COLUMN pos_id VARCHAR(36) NULL COMMENT 'Punto de venta / caja donde se registró la compra' AFTER user_id;
ALTER TABLE purchases ADD CONSTRAINT fk_purchases_pos FOREIGN KEY (pos_id) REFERENCES pos(id) ON DELETE SET NULL;
ALTER TABLE purchases ADD KEY idx_purchases_pos (pos_id);

-- ============================================================
-- Migración 016: Cajas asociadas a puntos de venta (locations)
-- ============================================================
ALTER TABLE pos ADD COLUMN location_id CHAR(36) NULL COMMENT 'Punto de venta (almacén tipo store) al que pertenece la caja' AFTER name;
ALTER TABLE pos ADD KEY idx_pos_location (location_id);

-- Asociar cajas existentes al primer punto de venta
UPDATE pos SET location_id = (
  SELECT id FROM locations WHERE type = 'store' AND active = 1 ORDER BY created_at ASC LIMIT 1
) WHERE location_id IS NULL
  AND EXISTS (SELECT 1 FROM locations WHERE type = 'store' AND active = 1);

-- Crear punto de venta si no existe
INSERT INTO locations (id, name, type, address, notes, active, created_at, updated_at)
SELECT UUID(), CONCAT('Punto de venta: ', p.name), 'store', NULL,
       'Creado automáticamente al vincular la caja', 1, NOW(), NOW()
FROM pos p WHERE p.location_id IS NULL;

UPDATE pos p
JOIN locations l ON l.name = CONCAT('Punto de venta: ', p.name) AND l.type = 'store' AND l.active = 1
SET p.location_id = l.id
WHERE p.location_id IS NULL;

ALTER TABLE pos MODIFY COLUMN location_id CHAR(36) NOT NULL;
ALTER TABLE pos ADD CONSTRAINT fk_pos_location FOREIGN KEY (location_id) REFERENCES locations(id);

-- ============================================================
-- Migración 017: invoice_number en purchases
-- ============================================================
ALTER TABLE purchases
  ADD COLUMN invoice_number VARCHAR(100) NULL COMMENT 'Número de factura de compra' AFTER pos_id,
  ADD INDEX idx_invoice_number (invoice_number);

-- ============================================================
-- Migración 018a: Impresión de tickets
-- ============================================================
ALTER TABLE settings
  ADD COLUMN receipt_printer_width ENUM('57','80') NOT NULL DEFAULT '80'
  COMMENT 'Ancho del papel del ticket (57 mm u 80 mm)' AFTER work_mode;

ALTER TABLE settings
  ADD COLUMN receipt_print_method ENUM('browser','usb') NOT NULL DEFAULT 'browser'
  COMMENT 'Método: browser = diálogo del navegador, usb = ESC/POS directo por WebUSB' AFTER receipt_printer_width;

ALTER TABLE settings
  ADD COLUMN receipt_auto_print TINYINT(1) NOT NULL DEFAULT 1
  COMMENT 'Imprimir el ticket automáticamente al registrar una venta' AFTER receipt_print_method;

UPDATE settings SET receipt_printer_width='80', receipt_print_method='browser', receipt_auto_print=1 WHERE id='1';

-- ============================================================
-- Migración 018b: batch_id en stock_transfers
-- ============================================================
ALTER TABLE stock_transfers
  ADD COLUMN batch_id CHAR(36) NULL COMMENT 'Identificador del lote de traslado' AFTER user_id,
  ADD INDEX idx_stock_transfers_batch (batch_id);

UPDATE stock_transfers st
JOIN (
  SELECT MIN(id) AS anchor_id, from_location_id, to_location_id, user_id, created_at
  FROM stock_transfers
  GROUP BY from_location_id, to_location_id, user_id, created_at
) g
  ON g.from_location_id = st.from_location_id
  AND g.to_location_id   = st.to_location_id
  AND ((g.user_id IS NULL AND st.user_id IS NULL) OR g.user_id = st.user_id)
  AND g.created_at = st.created_at
SET st.batch_id = g.anchor_id;

-- ============================================================
-- Migración 019: Impresoras registradas
-- ============================================================
CREATE TABLE IF NOT EXISTS printers (
  id            VARCHAR(36)  NOT NULL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL,
  vendor_id     INT UNSIGNED NOT NULL COMMENT 'ID del fabricante USB',
  product_id    INT UNSIGNED NOT NULL COMMENT 'ID del producto USB',
  serial_number VARCHAR(255) NULL COMMENT 'Número de serie USB (puede estar vacío)',
  device_key    VARCHAR(255) GENERATED ALWAYS AS (CONCAT(vendor_id, ':', product_id, ':', COALESCE(serial_number, ''))) STORED,
  is_default    TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = imprime los tickets de venta',
  created_at    DATETIME     NOT NULL,
  updated_at    DATETIME     NOT NULL,
  UNIQUE KEY uq_printers_device_key (device_key),
  INDEX idx_printers_default (is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Migración 020: Mostrar / ocultar reservaciones
-- ============================================================
ALTER TABLE settings
  ADD COLUMN show_reservations TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '1 = mostrar el módulo de reservaciones y el catálogo público en la página de entrada' AFTER receipt_auto_print;
UPDATE settings SET show_reservations = 1 WHERE id = '1';

-- ============================================================
-- Migración 021: Activar / desactivar POS táctil
-- ============================================================
ALTER TABLE settings
  ADD COLUMN enable_touch_pos TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '1 = mostrar el punto de venta táctil para vendedores' AFTER show_reservations;
UPDATE settings SET enable_touch_pos = 1 WHERE id = '1';

-- ============================================================
-- Migración 022: Vendedores asociados a un punto de venta (caja)
-- ============================================================
ALTER TABLE users
  ADD COLUMN pos_id VARCHAR(36) NULL
  COMMENT 'Caja (punto de venta) asociada; en modo turnos el vendedor trabaja fijo en su almacén'
  AFTER role;
ALTER TABLE users ADD KEY idx_users_pos (pos_id);
ALTER TABLE users ADD CONSTRAINT fk_users_pos FOREIGN KEY (pos_id) REFERENCES pos(id);

-- ============================================================
-- Migración 023: Normalizar movimientos de gastos y traslados
-- ============================================================
ALTER TABLE location_movements
  MODIFY type ENUM('entrada','salida','traslado_out','traslado_in','venta','ajuste','gasto') NOT NULL;

UPDATE location_movements SET type = 'gasto' WHERE type = 'salida' AND notes LIKE 'Gasto: %';
UPDATE location_movements SET type = 'traslado_out' WHERE type = 'salida' AND notes LIKE 'Traslado%';
UPDATE location_movements SET type = 'traslado_in' WHERE type = 'entrada' AND notes LIKE 'Traslado%';

-- ============================================================
-- Migración 024: Hard delete de productos (ON DELETE SET NULL)
-- ============================================================
DELIMITER //
DROP PROCEDURE IF EXISTS _mig024_drop_fk //
CREATE PROCEDURE _mig024_drop_fk(IN p_table VARCHAR(64), IN p_ref_table VARCHAR(64))
BEGIN
  DECLARE v_ConstraintName VARCHAR(64);
  SELECT CONSTRAINT_NAME INTO v_ConstraintName
    FROM information_schema.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = p_table
     AND COLUMN_NAME = 'product_id'
     AND REFERENCED_TABLE_NAME = p_ref_table
   LIMIT 1;
  IF v_ConstraintName IS NOT NULL THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` DROP FOREIGN KEY `', v_ConstraintName, '`');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL _mig024_drop_fk('sale_items', 'products');
ALTER TABLE sale_items MODIFY COLUMN product_id CHAR(36) NULL;
ALTER TABLE sale_items ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

CALL _mig024_drop_fk('stock_transfers', 'products');
ALTER TABLE stock_transfers MODIFY COLUMN product_id CHAR(36) NULL;
ALTER TABLE stock_transfers ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

CALL _mig024_drop_fk('stock_movements', 'products');
ALTER TABLE stock_movements MODIFY COLUMN product_id CHAR(36) NULL;
ALTER TABLE stock_movements ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

DROP PROCEDURE IF EXISTS _mig024_drop_fk;

-- ============================================================
-- Migración 025: Soporte multi-moneda
-- ============================================================
CREATE TABLE IF NOT EXISTS currencies (
  code        VARCHAR(10)  NOT NULL PRIMARY KEY COMMENT 'Código ISO de la moneda (ej: CUP, USD, EUR)',
  name        VARCHAR(100) NOT NULL COMMENT 'Nombre de la moneda (ej: Peso Cubano)',
  symbol      VARCHAR(10)  NOT NULL COMMENT 'Símbolo de la moneda (ej: $, €, ₽)',
  is_base     TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = moneda base del negocio',
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Monedas disponibles en el sistema';

CREATE TABLE IF NOT EXISTS currency_rates (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  from_currency VARCHAR(10)   NOT NULL COMMENT 'Moneda origen',
  to_currency   VARCHAR(10)   NOT NULL COMMENT 'Moneda destino',
  rate          DECIMAL(16,6) NOT NULL COMMENT 'Tasa: 1 from_currency = X to_currency',
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by    VARCHAR(36)   NULL,
  UNIQUE KEY uq_rate_pair (from_currency, to_currency),
  FOREIGN KEY (from_currency) REFERENCES currencies(code) ON DELETE CASCADE,
  FOREIGN KEY (to_currency)   REFERENCES currencies(code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Tasas de cambio entre monedas';

ALTER TABLE purchases
  ADD COLUMN currency_code  VARCHAR(10)   NULL COMMENT 'Moneda del precio de compra' AFTER pos_id,
  ADD COLUMN exchange_rate  DECIMAL(16,6) NULL COMMENT 'Tasa de cambio al momento de la compra' AFTER currency_code;

ALTER TABLE sales
  ADD COLUMN currency_code  VARCHAR(10)   NULL COMMENT 'Moneda de la venta' AFTER pos_id,
  ADD COLUMN exchange_rate  DECIMAL(16,6) NULL COMMENT 'Tasa de cambio al momento de la venta' AFTER currency_code;

ALTER TABLE sale_items
  ADD COLUMN currency_code  VARCHAR(10)   NULL COMMENT 'Moneda del precio unitario' AFTER sale_id,
  ADD COLUMN exchange_rate  DECIMAL(16,6) NULL COMMENT 'Tasa de cambio al momento de la venta' AFTER currency_code;

-- Monedas comunes
INSERT IGNORE INTO currencies (code, name, symbol, is_base, active) VALUES
  ('CUP', 'Peso Cubano',         '$',  1, 1),
  ('USD', 'Dólar Estadounidense', '$',  0, 1),
  ('EUR', 'Euro',                 '€',  0, 1),
  ('MLC', 'Moneda Libremente Convertible', '₱', 0, 1);

-- Tasas de cambio iniciales
INSERT IGNORE INTO currency_rates (id, from_currency, to_currency, rate, updated_at) VALUES
  (UUID(), 'USD', 'CUP', 240.000000, NOW()),
  (UUID(), 'EUR', 'CUP', 260.000000, NOW()),
  (UUID(), 'MLC', 'CUP', 120.000000, NOW()),
  (UUID(), 'CUP', 'USD', 0.004167,   NOW()),
  (UUID(), 'CUP', 'EUR', 0.003846,   NOW()),
  (UUID(), 'CUP', 'MLC', 0.008333,   NOW()),
  (UUID(), 'USD', 'EUR', 0.920000,   NOW()),
  (UUID(), 'EUR', 'USD', 1.087000,   NOW()),
  (UUID(), 'USD', 'MLC', 2.000000,   NOW()),
  (UUID(), 'MLC', 'USD', 0.500000,   NOW()),
  (UUID(), 'EUR', 'MLC', 2.167000,   NOW()),
  (UUID(), 'MLC', 'EUR', 0.461000,   NOW());

-- ============================================================
-- Migración 026: Moneda en los pagos (arqueo por moneda)
-- ============================================================
ALTER TABLE payments
  ADD COLUMN currency_code  VARCHAR(10)  NULL COMMENT 'Moneda del pago' AFTER amount_transfer,
  ADD COLUMN exchange_rate  DECIMAL(16,6) NULL COMMENT 'Tasa de cambio al momento del pago (1 moneda = X base)' AFTER currency_code;

ALTER TABLE customer_payments
  ADD COLUMN currency_code  VARCHAR(10)  NULL COMMENT 'Moneda del abono' AFTER amount,
  ADD COLUMN exchange_rate  DECIMAL(16,6) NULL COMMENT 'Tasa de cambio al momento del abono (1 moneda = X base)' AFTER currency_code;

-- Los pagos históricos heredan la moneda de su venta (NULL = moneda base)
UPDATE payments p
  JOIN sales s ON s.id = p.sale_id
  SET p.currency_code = s.currency_code,
      p.exchange_rate = s.exchange_rate
  WHERE p.currency_code IS NULL AND s.currency_code IS NOT NULL;

UPDATE customer_payments cp
  JOIN sales s ON s.id = cp.sale_id
  SET cp.currency_code = s.currency_code,
      cp.exchange_rate = s.exchange_rate
  WHERE cp.currency_code IS NULL AND s.currency_code IS NOT NULL;

-- ============================================================
-- Migración 027: Monedas en productos (costo y venta)
-- ============================================================
ALTER TABLE products
  ADD COLUMN cost_currency VARCHAR(10) NULL COMMENT 'Moneda del precio de costo (NULL = moneda base)' AFTER cost;

ALTER TABLE products
  ADD COLUMN sale_currency VARCHAR(10) NULL COMMENT 'Moneda del precio de venta (NULL = moneda base)' AFTER sale_price;

-- Migración 028: Opción para activar/desactivar módulo de contabilidad
-- ============================================================
ALTER TABLE settings
  ADD COLUMN enable_accounting TINYINT(1) NOT NULL DEFAULT 1
  AFTER enable_touch_pos;

-- ============================================================
-- Fin de todas las migraciones consolidadas (002 → 028)
-- ============================================================
SELECT '✅ Todas las migraciones (002-028) aplicadas correctamente' AS status;
