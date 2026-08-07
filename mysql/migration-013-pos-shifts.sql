-- ============================================================
-- Migration 013: Puntos de venta (cajas) para turnos de caja
-- ============================================================
-- Ejecutar: mysql -u root -p tienda_mi_barrio < migration-013-pos-shifts.sql
-- O: node scripts/apply-migration-013.js
-- ============================================================
-- Habilita turnos independientes por caja:
--   1. Tabla pos (puntos de venta / cajas).
--   2. shifts.pos_id: vincula cada turno a una caja.
--   3. Saneo: como máximo un turno abierto por caja.
--   4. Guardia a nivel de BD: índice único sobre una columna
--      generada que impide DOS turnos 'open' en la misma caja,
--      aunque la validación de la API fallara o hubiera carrera.

-- ── 1. Tabla de puntos de venta / cajas ──
CREATE TABLE IF NOT EXISTS pos (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_pos_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Caja principal por defecto (los turnos existentes se reasignan a ella)
INSERT INTO pos (id, name, active, created_at)
SELECT 'POS-1', 'Caja principal', 1, NOW()
WHERE NOT EXISTS (SELECT 1 FROM pos WHERE id = 'POS-1');

-- ── 2. Vincular turnos a una caja ──
ALTER TABLE shifts ADD COLUMN pos_id VARCHAR(36) NULL COMMENT 'Punto de venta / caja' AFTER user_id;

UPDATE shifts SET pos_id = 'POS-1' WHERE pos_id IS NULL;

ALTER TABLE shifts MODIFY COLUMN pos_id VARCHAR(36) NOT NULL;
ALTER TABLE shifts ADD CONSTRAINT fk_shifts_pos FOREIGN KEY (pos_id) REFERENCES pos(id);
ALTER TABLE shifts ADD KEY idx_shifts_pos_opened (pos_id, opened_at);

-- ── 3. Saneo: cerrar turnos abiertos duplicados en una misma caja ──
-- (conserva el más reciente y cierra los anteriores, por si existieran)
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

-- ── 4. Guardia a nivel de BD ──
-- open_guard = pos_id cuando el turno está 'open' y NULL si está 'closed'.
-- El índice único ignora los NULL, así que solo puede existir UNA fila
-- 'open' por caja.
ALTER TABLE shifts ADD COLUMN open_guard VARCHAR(36)
  GENERATED ALWAYS AS (IF(status = 'open', pos_id, NULL)) STORED;
ALTER TABLE shifts ADD UNIQUE KEY uq_shifts_open_per_pos (open_guard);

SELECT '✅ migration-013: tabla pos creada, shifts.pos_id y guardia de turno único por caja' AS status;
