-- ============================================================
-- Migration 016: Cajas (pos) asociadas a puntos de venta
-- ============================================================
-- Ejecutar: mysql -u root -p tienda_mi_barrio < migration-016-pos-locations.sql
-- O: node scripts/apply-migration-016.js
-- ============================================================
-- Las cajas / puntos de venta (pos) ahora pertenecen a un almacén tipo
-- 'store' (punto de venta). Esto permite gestionar desde la UI la
-- creación, edición y activación/desactivación de cajas, siempre
-- vinculadas a una tienda (locations.type = 'store').

-- ── 1. Columna de asociación ──
ALTER TABLE pos ADD COLUMN location_id CHAR(36) NULL COMMENT 'Punto de venta (almacén tipo store) al que pertenece la caja' AFTER name;
ALTER TABLE pos ADD KEY idx_pos_location (location_id);

-- ── 2. Asociar cajas existentes ──
-- 2a. Si ya existe un punto de venta activo, todas las cajas se vinculan al primero.
UPDATE pos SET location_id = (
  SELECT id FROM locations WHERE type = 'store' AND active = 1 ORDER BY created_at ASC LIMIT 1
) WHERE location_id IS NULL
  AND EXISTS (SELECT 1 FROM locations WHERE type = 'store' AND active = 1);

-- 2b. Si no existe ningún punto de venta, se crea uno por cada caja huérfana.
INSERT INTO locations (id, name, type, address, notes, active, created_at, updated_at)
SELECT UUID(), CONCAT('Punto de venta: ', p.name), 'store', NULL,
       'Creado automáticamente al vincular la caja', 1, NOW(), NOW()
FROM pos p WHERE p.location_id IS NULL;

UPDATE pos p
JOIN locations l ON l.name = CONCAT('Punto de venta: ', p.name) AND l.type = 'store' AND l.active = 1
SET p.location_id = l.id
WHERE p.location_id IS NULL;

-- ── 3. Obligar la asociación a nivel de base de datos ──
ALTER TABLE pos MODIFY COLUMN location_id CHAR(36) NOT NULL;
ALTER TABLE pos ADD CONSTRAINT fk_pos_location FOREIGN KEY (location_id) REFERENCES locations(id);

SELECT '✅ migration-016: cajas vinculadas a puntos de venta (locations type=store)' AS status;
