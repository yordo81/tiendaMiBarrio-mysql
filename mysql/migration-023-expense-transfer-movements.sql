-- ============================================================
-- Migration 023: Normalizar movimientos de gastos y traslados
-- ============================================================
-- Ejecutar: mysql -u root -p tienda_mi_barrio < migration-023-expense-transfer-movements.sql
-- ============================================================
-- El módulo de Movimientos filtra por tipo y los reportes por almacén
-- buscan type='gasto'. Hasta ahora los gastos con producto se registraban
-- como 'salida' (con nota "Gasto: ...") y los traslados como 'salida'/
-- 'entrada' (con nota "Traslado ..."). Esta migración:
--   1) agrega 'gasto' al ENUM de location_movements.type
--   2) normaliza los movimientos existentes:
--      - gastos  → type='gasto'
--      - traslados (origen) → type='traslado_out'
--      - traslados (destino) → type='traslado_in'

-- ── 1. Agregar 'gasto' al ENUM de type ──
ALTER TABLE location_movements
  MODIFY type ENUM('entrada','salida','traslado_out','traslado_in','venta','ajuste','gasto') NOT NULL;

-- ── 2. Normalizar movimientos existentes ──

-- Gastos con producto (nota "Gasto: ...") → tipo propio 'gasto'
UPDATE location_movements
  SET type = 'gasto'
  WHERE type = 'salida' AND notes LIKE 'Gasto: %';

-- Salida de un traslado (nota "Traslado ...") → 'traslado_out'
UPDATE location_movements
  SET type = 'traslado_out'
  WHERE type = 'salida' AND notes LIKE 'Traslado%';

-- Entrada de un traslado (nota "Traslado ...") → 'traslado_in'
UPDATE location_movements
  SET type = 'traslado_in'
  WHERE type = 'entrada' AND notes LIKE 'Traslado%';

SELECT '✅ migration-023: enum con gasto y movimientos normalizados' AS status;
