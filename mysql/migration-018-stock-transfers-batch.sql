-- ============================================================
-- Migration 018: batch_id en stock_transfers (agrupación por lote)
-- ============================================================
-- Un traslado puede mover varios productos a la vez. Todas las líneas
-- de un mismo traslado comparten batch_id, lo que permite agruparlas
-- de forma definitiva en el historial sin depender del created_at.
-- Ejecutar: mysql -u root -p < mysql/migration-018-stock-transfers-batch.sql
-- o: node scripts/apply-migration-018.js
-- ============================================================

USE tienda_mi_barrio;

-- ── 1. Columna de lote ──
ALTER TABLE stock_transfers
  ADD COLUMN batch_id CHAR(36) NULL COMMENT 'Identificador del lote de traslado (varias líneas por traslado)' AFTER user_id,
  ADD INDEX idx_stock_transfers_batch (batch_id);

-- ── 2. Backfill: agrupar los traslados existentes por lote ──
-- Las líneas de un mismo traslado se insertaron juntas (mismo origen,
-- destino, usuario y created_at). Se usa el id de la primera línea de
-- cada grupo como identificador del lote.
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

SELECT '✓ Columna batch_id agregada a stock_transfers y traslados existentes agrupados' AS status;
