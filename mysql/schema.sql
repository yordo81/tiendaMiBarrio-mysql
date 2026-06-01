-- ============================================================
-- TiendaMiBarrio MySQL Edition - Schema completo
-- Ejecutar: mysql -u root -p < mysql/schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS tienda_mi_barrio CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE tienda_mi_barrio;

CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('owner','admin','seller','warehouse') NOT NULL DEFAULT 'seller',
  permissions   JSON         NOT NULL DEFAULT (JSON_ARRAY()),
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email)
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
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  name        VARCHAR(255)  NOT NULL,
  description TEXT          NULL,
  category_id CHAR(36)      NULL,
  sale_price  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cost        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  stock       DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  min_stock   DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  unit        VARCHAR(50)   NOT NULL DEFAULT 'unidad',
  image_url   VARCHAR(500)  NULL,
  active      TINYINT(1)    NOT NULL DEFAULT 1,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  INDEX idx_active (active), INDEX idx_name (name)
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

CREATE TABLE IF NOT EXISTS sales (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  customer_id CHAR(36)      NULL,
  user_id     CHAR(36)      NULL,
  date        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status      ENUM('completed','partial','pending','cancelled') NOT NULL DEFAULT 'completed',
  notes       TEXT          NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_date (date), INDEX idx_status (status)
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
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES expense_categories(id) ON DELETE SET NULL,
  FOREIGN KEY (product_id)  REFERENCES products(id)           ON DELETE SET NULL,
  FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE SET NULL
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
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id)  REFERENCES products(id)  ON DELETE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id)     REFERENCES users(id)     ON DELETE SET NULL,
  INDEX idx_product (product_id),
  INDEX idx_supplier (supplier_id),
  INDEX idx_date (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Datos semilla
INSERT IGNORE INTO expense_categories (id,name) VALUES
  (UUID(),'Consumo interno'),(UUID(),'Salarios'),(UUID(),'Transporte'),
  (UUID(),'Electricidad y servicios'),(UUID(),'Gastos operativos varios');
INSERT IGNORE INTO categories (id,name) VALUES (UUID(),'Sin categoría');
INSERT IGNORE INTO locations (id,name,type) VALUES (UUID(),'Almacén Principal','warehouse');

-- ============================================================
-- AUDIT LOGS
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
-- CASH REGISTER (contabilidad — saldo inicial y ajustes manuales)
-- ============================================================
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

-- LOCATION MOVEMENTS (tracks all stock movements per location)
CREATE TABLE IF NOT EXISTS location_movements (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  location_id CHAR(36)      NOT NULL,
  product_id  CHAR(36)      NOT NULL,
  type        ENUM('entrada','salida','traslado_out','traslado_in','venta','ajuste') NOT NULL,
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
