-- ============================================================
-- TiendaMiBarrio — Inicialización de Base de Datos (Docker)
-- ============================================================
-- Este script se ejecuta automáticamente al iniciar el contenedor
-- MySQL por primera vez. La base de datos ya fue creada por la
-- variable MYSQL_DATABASE definida en docker-compose.yml.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('owner','admin','seller','warehouse') NOT NULL DEFAULT 'seller',
  pos_id        VARCHAR(36)  NULL COMMENT 'Caja (punto de venta) asociada; en modo turnos el vendedor trabaja fijo en su almacén',
  permissions   JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_users_pos (pos_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS categories (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  parent_id  CHAR(36)     NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  barcode         VARCHAR(100)  NULL UNIQUE,
  name            VARCHAR(255)  NOT NULL,
  description     TEXT          NULL,
  category_id     CHAR(36)      NULL,
  sale_price      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cost            DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  stock           DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  min_stock       DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  unit            VARCHAR(50)   NOT NULL DEFAULT 'unidad',
  expiration_date DATE          NULL,
  is_perishable   TINYINT(1)    NOT NULL DEFAULT 0,
  image_url       VARCHAR(500)  NULL,
  active          TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  INDEX idx_active (active), INDEX idx_name (name),
  INDEX idx_barcode (barcode), INDEX idx_expiration (expiration_date), INDEX idx_is_perishable (is_perishable)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS suppliers (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  contact    VARCHAR(255) NULL,
  phone      VARCHAR(50)  NULL,
  notes      TEXT         NULL,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS product_suppliers (
  id           CHAR(36)   NOT NULL PRIMARY KEY,
  product_id   CHAR(36)   NOT NULL,
  supplier_id  CHAR(36)   NOT NULL,
  is_preferred TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_ps (product_id, supplier_id),
  FOREIGN KEY (product_id)  REFERENCES products(id)  ON DELETE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS purchase_prices (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  product_id  CHAR(36)      NOT NULL,
  supplier_id CHAR(36)      NOT NULL,
  price       DECIMAL(12,2) NOT NULL,
  date        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes       TEXT          NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id)  REFERENCES products(id)  ON DELETE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  INDEX idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customers (
  id         CHAR(36)      NOT NULL PRIMARY KEY,
  name       VARCHAR(255)  NOT NULL,
  phone      VARCHAR(50)   NULL,
  notes      TEXT          NULL,
  balance    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_balance (balance)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pos (
  id            VARCHAR(36) NOT NULL PRIMARY KEY,
  name          VARCHAR(60) NOT NULL,
  location_id   CHAR(36)    NOT NULL COMMENT 'Punto de venta (almacén tipo store) al que pertenece la caja',
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL,
  UNIQUE KEY uq_pos_name (name),
  KEY idx_pos_location (location_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  customer_id CHAR(36)      NULL,
  user_id     CHAR(36)      NULL,
  pos_id      VARCHAR(36)   NULL COMMENT 'Punto de venta / caja donde se realizó la venta',
  date        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status      ENUM('completed','partial','pending','cancelled') NOT NULL DEFAULT 'completed',
  notes       TEXT          NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (pos_id)      REFERENCES pos(id) ON DELETE SET NULL,
  INDEX idx_date (date), INDEX idx_status (status), INDEX idx_sales_pos (pos_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sale_items (
  id         CHAR(36)      NOT NULL PRIMARY KEY,
  sale_id    CHAR(36)      NOT NULL,
  product_id CHAR(36)      NOT NULL,
  quantity   DECIMAL(12,3) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  cost       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sale_id)    REFERENCES sales(id)    ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id),
  INDEX idx_sale (sale_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  sale_id         CHAR(36)      NOT NULL,
  method          ENUM('cash','transfer','mixed','credit') NOT NULL,
  amount_cash     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  amount_transfer DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  date            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes           TEXT          NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS customer_payments (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  customer_id CHAR(36)      NOT NULL,
  sale_id     CHAR(36)      NULL,
  amount      DECIMAL(12,2) NOT NULL,
  method      ENUM('cash','transfer','mixed') NOT NULL DEFAULT 'cash',
  date        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes       TEXT          NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (sale_id)     REFERENCES sales(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS expense_categories (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS expenses (
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  category_id      CHAR(36)      NULL,
  description      VARCHAR(500)  NOT NULL,
  amount           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  payment_method   ENUM('cash','transfer','mixed') NULL DEFAULT NULL,
  product_id       CHAR(36)      NULL,
  product_quantity DECIMAL(12,3) NULL,
  date             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id          CHAR(36)      NULL,
  pos_id           VARCHAR(36)   NULL COMMENT 'Punto de venta / caja donde se registró el gasto',
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE SET NULL,
  FOREIGN KEY (product_id)  REFERENCES products(id)           ON DELETE SET NULL,
  FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (pos_id)      REFERENCES pos(id)   ON DELETE SET NULL,
  INDEX idx_expenses_pos (pos_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_movements (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  product_id   CHAR(36)      NOT NULL,
  type         ENUM('in','out','adjust','expense') NOT NULL,
  quantity     DECIMAL(12,3) NOT NULL,
  reason       VARCHAR(255)  NOT NULL,
  reference_id CHAR(36)      NULL,
  user_id      CHAR(36)      NULL,
  date         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_product (product_id), INDEX idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS locations (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  type       ENUM('warehouse','store') NOT NULL DEFAULT 'warehouse',
  address    TEXT         NULL,
  notes      TEXT         NULL,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS location_stock (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  location_id CHAR(36)      NOT NULL,
  product_id  CHAR(36)      NOT NULL,
  quantity    DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loc_prod (location_id, product_id),
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id)  REFERENCES products(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_transfers (
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  from_location_id CHAR(36)      NOT NULL,
  to_location_id   CHAR(36)      NOT NULL,
  product_id       CHAR(36)      NOT NULL,
  quantity         DECIMAL(12,3) NOT NULL,
  notes            TEXT          NULL,
  user_id          CHAR(36)      NULL,
  batch_id         CHAR(36)      NULL COMMENT 'Identificador del lote de traslado (varias líneas por traslado)',
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_stock_transfers_batch (batch_id),
  FOREIGN KEY (from_location_id) REFERENCES locations(id),
  FOREIGN KEY (to_location_id)   REFERENCES locations(id),
  FOREIGN KEY (product_id)       REFERENCES products(id),
  FOREIGN KEY (user_id)          REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  pos_id      VARCHAR(36)   NULL COMMENT 'Punto de venta / caja donde se registró la compra',
  invoice_number VARCHAR(100) NULL COMMENT 'Número de factura de compra',
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id)  REFERENCES products(id)  ON DELETE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id)     REFERENCES users(id)     ON DELETE SET NULL,
  FOREIGN KEY (pos_id)      REFERENCES pos(id)       ON DELETE SET NULL,
  INDEX idx_product (product_id),
  INDEX idx_supplier (supplier_id),
  INDEX idx_date (created_at),
  INDEX idx_purchases_pos (pos_id),
  INDEX idx_invoice_number (invoice_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

CREATE TABLE IF NOT EXISTS location_movements (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  location_id CHAR(36)      NOT NULL,
  product_id  CHAR(36)      NOT NULL,
  type        ENUM('entrada','salida','traslado_out','traslado_in','venta','ajuste','gasto') NOT NULL,
  quantity    DECIMAL(12,3) NOT NULL,
  reference_id CHAR(36)     NULL,
  notes       TEXT          NULL,
  user_id     CHAR(36)      NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_location (location_id),
  INDEX idx_created  (created_at),
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id)  REFERENCES products(id),
  FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- CASH REGISTER (contabilidad — saldo inicial y ajustes manuales)
-- ============================================================
CREATE TABLE IF NOT EXISTS cash_register (
  id               CHAR(36)      NOT NULL PRIMARY KEY,
  type             ENUM('initial','adjustment','purchase','capital') NOT NULL DEFAULT 'adjustment',
  cash_amount      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  transfer_amount  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  notes            TEXT          NULL,
  date             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id          CHAR(36)      NULL,
  shift_id         CHAR(36)      NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Datos semilla
-- ============================================================
INSERT IGNORE INTO expense_categories (id,name) VALUES
  (UUID(),'Consumo interno'),(UUID(),'Salarios'),(UUID(),'Transporte'),
  (UUID(),'Electricidad y servicios'),(UUID(),'Gastos operativos varios');
INSERT IGNORE INTO categories (id,name) VALUES (UUID(),'Sin categoría');
INSERT IGNORE INTO locations (id,name,type) VALUES (UUID(),'Almacén Principal','warehouse');
INSERT IGNORE INTO locations (id,name,type) VALUES (UUID(),'Punto de venta principal','store');

-- Caja principal asociada al punto de venta por defecto
INSERT INTO pos (id, name, location_id, active, created_at)
SELECT 'POS-1', 'Caja principal', l.id, 1, NOW()
FROM locations l
WHERE l.type = 'store' AND l.active = 1
  AND NOT EXISTS (SELECT 1 FROM pos WHERE id = 'POS-1')
LIMIT 1;

-- ============================================================
-- RESERVATIONS (pedidos de clientes desde la landing page)
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
-- NOTIFICATION LOGS (notificaciones internas)
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_logs (
  id         VARCHAR(36) NOT NULL PRIMARY KEY,
  type       VARCHAR(50) NOT NULL COMMENT 'Tipo: expiration_5d, expiration_15d, expiration_30d, low_stock, etc.',
  product_id VARCHAR(36) DEFAULT NULL,
  title      VARCHAR(255) NOT NULL,
  message    TEXT NOT NULL,
  severity   ENUM('critical','warning','info','success') NOT NULL DEFAULT 'info',
  dismissed  TINYINT(1)  NOT NULL DEFAULT 0,
  created_at DATETIME    NOT NULL,
  read_at    DATETIME    DEFAULT NULL,
  INDEX idx_notification_type (type),
  INDEX idx_notification_product (product_id),
  INDEX idx_notification_dismissed (dismissed, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SETTINGS + SHIFTS (configuración del negocio y turnos de caja)
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  id            VARCHAR(36) NOT NULL PRIMARY KEY,
  business_name VARCHAR(120) NOT NULL DEFAULT 'TiendaMiBarrio',
  logo_url      VARCHAR(255) DEFAULT NULL,
  work_mode     ENUM('daily','shifts') NOT NULL DEFAULT 'daily' COMMENT 'daily = por días, shifts = por turnos',
  receipt_printer_width ENUM('57','80') NOT NULL DEFAULT '80' COMMENT 'Ancho del papel del ticket (57 mm u 80 mm)',
  receipt_print_method ENUM('browser','usb') NOT NULL DEFAULT 'browser' COMMENT 'browser = diálogo del navegador, usb = ESC/POS directo por WebUSB',
  receipt_auto_print TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Imprimir el ticket automáticamente al registrar una venta',
  show_reservations TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = mostrar el módulo de reservaciones y el catálogo público en la página de entrada',
  enable_touch_pos TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = mostrar el punto de venta táctil para vendedores',
  updated_by    VARCHAR(36) DEFAULT NULL,
  updated_at    DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO settings (id, business_name, logo_url, work_mode, updated_at)
VALUES ('1', 'TiendaMiBarrio', NULL, 'daily', NOW())
ON DUPLICATE KEY UPDATE id = id;

CREATE TABLE IF NOT EXISTS shifts (
  id            VARCHAR(36) NOT NULL PRIMARY KEY,
  user_id       VARCHAR(36) NOT NULL COMMENT 'Quien abrió el turno',
  pos_id        VARCHAR(36) NOT NULL COMMENT 'Punto de venta / caja',
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
  open_guard    VARCHAR(36) GENERATED ALWAYS AS (IF(status = 'open', pos_id, NULL)) STORED COMMENT 'Guardia: máximo un turno abierto por caja',
  KEY idx_shifts_status (status),
  KEY idx_shifts_opened (opened_at),
  KEY idx_shifts_pos_opened (pos_id, opened_at),
  UNIQUE KEY uq_shifts_open_per_pos (open_guard),
  CONSTRAINT fk_shifts_pos FOREIGN KEY (pos_id) REFERENCES pos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- Usuario administrador por defecto (solo en Docker)
-- Usuario: Admin / Correo: a@a.com / Password: Admin.1
-- ============================================================
INSERT IGNORE INTO users (id,name,email,password_hash,role,permissions,active,created_at,updated_at)
VALUES (
  UUID(),
  'Admin',
  'a@a.com',
  '$2b$12$S7UdnMpUhJR5SrJFhPTLeOYMsNAfluEag5T21kFkGrLwPL415Aela',
  'owner',
  JSON_ARRAY(),
  1,
  NOW(),
  NOW()
);

-- ============================================================
-- IMPRESORAS (multi-impresora: cuál imprime los tickets de venta)
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

-- ============================================================
-- Las cajas (pos) pertenecen a un punto de venta (locations type='store')
-- ============================================================
ALTER TABLE pos ADD CONSTRAINT fk_pos_location FOREIGN KEY (location_id) REFERENCES locations(id);

-- ============================================================
-- Los usuarios pueden estar asociados a una caja (pos)
-- (constraint añadido aquí porque users se crea antes que pos)
-- ============================================================
ALTER TABLE users ADD CONSTRAINT fk_users_pos FOREIGN KEY (pos_id) REFERENCES pos(id);
