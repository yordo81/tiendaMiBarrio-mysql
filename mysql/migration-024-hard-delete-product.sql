-- Migration 024: Allow hard delete of products
-- Makes product_id nullable and adds ON DELETE SET NULL to tables that
-- previously had RESTRICT (no action) foreign keys, so that deleting a
-- product does not fail due to historical records.

-- Helper procedure: drop FK by table + referenced table dynamically
DELIMITER $$

DROP PROCEDURE IF EXISTS _mig024_drop_fk$$
CREATE PROCEDURE _mig024_drop_fk(
  IN p_table VARCHAR(64),
  IN p_ref_table VARCHAR(64)
)
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
END$$

DELIMITER ;

-- 1. sale_items: make product_id nullable, add ON DELETE SET NULL
CALL _mig024_drop_fk('sale_items', 'products');
ALTER TABLE sale_items MODIFY COLUMN product_id CHAR(36) NULL;
ALTER TABLE sale_items ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

-- 2. stock_transfers: make product_id nullable, add ON DELETE SET NULL
CALL _mig024_drop_fk('stock_transfers', 'products');
ALTER TABLE stock_transfers MODIFY COLUMN product_id CHAR(36) NULL;
ALTER TABLE stock_transfers ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

-- 3. stock_movements: make product_id nullable, add ON DELETE SET NULL
CALL _mig024_drop_fk('stock_movements', 'products');
ALTER TABLE stock_movements MODIFY COLUMN product_id CHAR(36) NULL;
ALTER TABLE stock_movements ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

-- Cleanup helper procedure
DROP PROCEDURE IF EXISTS _mig024_drop_fk;
