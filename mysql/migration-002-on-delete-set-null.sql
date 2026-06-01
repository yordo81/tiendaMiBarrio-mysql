-- ============================================================
-- Migración 002: Agregar ON DELETE SET NULL a FK de user_id
-- ============================================================
-- Ejecutar: mysql -u root -p < mysql/migration-002-on-delete-set-null.sql
-- O desde el cliente MySQL: SOURCE mysql/migration-002-on-delete-set-null.sql;
-- ============================================================
-- Esta migración es IDEMPOTENTE: se puede ejecutar múltiples veces.
-- Busca dinámicamente los nombres de las FK existentes usando
-- information_schema, las dropea, modifica la columna a NULL,
-- y las recrea con ON DELETE SET NULL.
-- ============================================================

CREATE DATABASE IF NOT EXISTS tienda_mi_barrio CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE tienda_mi_barrio;

DELIMITER //

-- Procedimiento auxiliar: dropea TODAS las FK de una columna específica
DROP PROCEDURE IF EXISTS drop_fk_if_exists //
CREATE PROCEDURE drop_fk_if_exists(IN tbl_name VARCHAR(255), IN col_name VARCHAR(255))
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
    IF done THEN
      LEAVE read_loop;
    END IF;
    SET @sql = CONCAT('ALTER TABLE ', tbl_name, ' DROP FOREIGN KEY ', fk_name);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;
  CLOSE cur;
END //

DELIMITER ;

-- ============================================================
-- 1. sales
-- ============================================================
CALL drop_fk_if_exists('sales', 'user_id');
ALTER TABLE sales MODIFY user_id CHAR(36) NULL;
ALTER TABLE sales ADD CONSTRAINT fk_sales_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
SELECT '✓ sales: user_id → NULL + ON DELETE SET NULL' AS status;

-- ============================================================
-- 2. expenses
-- ============================================================
CALL drop_fk_if_exists('expenses', 'user_id');
ALTER TABLE expenses MODIFY user_id CHAR(36) NULL;
ALTER TABLE expenses ADD CONSTRAINT fk_expenses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
SELECT '✓ expenses: user_id → NULL + ON DELETE SET NULL' AS status;

-- ============================================================
-- 3. stock_movements
-- ============================================================
CALL drop_fk_if_exists('stock_movements', 'user_id');
ALTER TABLE stock_movements MODIFY user_id CHAR(36) NULL;
ALTER TABLE stock_movements ADD CONSTRAINT fk_stock_movements_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
SELECT '✓ stock_movements: user_id → NULL + ON DELETE SET NULL' AS status;

-- ============================================================
-- 4. stock_transfers
-- ============================================================
CALL drop_fk_if_exists('stock_transfers', 'user_id');
ALTER TABLE stock_transfers MODIFY user_id CHAR(36) NULL;
ALTER TABLE stock_transfers ADD CONSTRAINT fk_stock_transfers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
SELECT '✓ stock_transfers: user_id → NULL + ON DELETE SET NULL' AS status;

-- ============================================================
-- 5. location_movements
-- ============================================================
CALL drop_fk_if_exists('location_movements', 'user_id');
ALTER TABLE location_movements MODIFY user_id CHAR(36) NULL;
ALTER TABLE location_movements ADD CONSTRAINT fk_location_movements_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
SELECT '✓ location_movements: user_id → NULL + ON DELETE SET NULL' AS status;

-- ============================================================
-- Limpiar procedimiento temporal
-- ============================================================
DROP PROCEDURE IF EXISTS drop_fk_if_exists;

-- ============================================================
-- Verificación final
-- ============================================================
SELECT '=== FK a users(id) después de la migración ===' AS '';
SELECT
  rc.TABLE_NAME,
  kcu.COLUMN_NAME,
  rc.CONSTRAINT_NAME,
  rc.DELETE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS rc
JOIN information_schema.KEY_COLUMN_USAGE kcu
  ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
  AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
  AND kcu.TABLE_NAME = rc.TABLE_NAME
  AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
WHERE rc.CONSTRAINT_SCHEMA = DATABASE()
  AND rc.REFERENCED_TABLE_NAME = 'users'
ORDER BY rc.TABLE_NAME;
