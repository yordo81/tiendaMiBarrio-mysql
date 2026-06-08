-- ============================================================
-- Ventas por Producto — TiendaMiBarrio (MySQL 8+)
--
-- Por cada producto activo muestra:
--   - Stock actual
--   - Total comprado (purchases)
--   - Total vendido (sale_items, ventas no canceladas)
--   - N° de ventas
--   - Stock inicial real = stock_actual + vendido - comprado
--   - Estado
--
-- Uso desde terminal:
--   mysql -u root -p tienda_mi_barrio < scripts/ventas-por-producto.sql
--
-- O dentro del cliente MySQL:
--   source scripts/ventas-por-producto.sql
-- ============================================================

WITH datos AS (
  SELECT
    p.id,
    p.name,
    p.stock,
    p.min_stock,
    p.unit,
    COALESCE(compras.total_comprado, 0)  AS total_comprado,
    COALESCE(ventas.total_vendido, 0)    AS total_vendido,
    COALESCE(ventas.numero_ventas, 0)    AS numero_ventas
  FROM products p
  LEFT JOIN (
    SELECT
      pu.product_id,
      COALESCE(SUM(pu.quantity), 0) AS total_comprado
    FROM purchases pu
    GROUP BY pu.product_id
  ) compras ON compras.product_id = p.id
  LEFT JOIN (
    SELECT
      si.product_id,
      COALESCE(SUM(si.quantity), 0) AS total_vendido,
      COUNT(DISTINCT si.sale_id)    AS numero_ventas
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id AND s.status != 'cancelled'
    GROUP BY si.product_id
  ) ventas ON ventas.product_id = p.id
  WHERE p.active = 1
)

-- ============================================================
-- Tabla principal
-- ============================================================
SELECT
  d.name                                              AS 'Producto',
  d.stock                                              AS 'Stock',
  d.total_comprado                                     AS 'Comprado',
  d.total_vendido                                      AS 'Vendido',
  d.numero_ventas                                      AS '# Ventas',
  d.stock + d.total_vendido - d.total_comprado          AS 'Stock Inicial Real',
  CASE
    WHEN d.stock <= 0 AND d.total_vendido > 0           THEN '⚠ Sin stock c/ventas'
    WHEN d.stock <= 0                                    THEN 'Sin stock'
    WHEN d.total_vendido = 0 AND d.total_comprado = 0    THEN 'Sin movimientos'
    WHEN d.total_vendido = 0                             THEN 'Solo compras'
    ELSE 'OK'
  END                                                   AS 'Estado'
FROM datos d
ORDER BY d.total_vendido DESC;

-- ============================================================
-- Resumen global
-- ============================================================
SELECT '' AS '---', '' AS '---', '' AS '---', '' AS '---',
       '' AS '---', '' AS '---', '' AS '---';

SELECT 'RESUMEN' AS '---', '' AS '---', '' AS '---', '' AS '---',
       '' AS '---', '' AS '---', '' AS '---';

SELECT
  COALESCE(SUM(d.stock), 0)                                    AS 'Stock Total',
  COALESCE(SUM(d.total_comprado), 0)                           AS 'Total Comprado',
  COALESCE(SUM(d.total_vendido), 0)                            AS 'Total Vendido',
  COALESCE(SUM(d.stock + d.total_vendido - d.total_comprado), 0) AS 'Stock Inicial Total'
FROM datos d;

-- ============================================================
-- Top 5 más vendidos
-- ============================================================
SELECT '' AS '---', '' AS '---', '' AS '---', '' AS '---',
       '' AS '---', '' AS '---', '' AS '---';

SELECT 'TOP 5 MAS VENDIDOS' AS '---', '' AS '---', '' AS '---',
       '' AS '---', '' AS '---', '' AS '---', '' AS '---';

SELECT
  d.name      AS 'Producto',
  d.total_vendido AS 'Vendido',
  d.unit      AS 'Unidad'
FROM datos d
WHERE d.total_vendido > 0
ORDER BY d.total_vendido DESC
LIMIT 5;

-- ============================================================
-- Alertas: inconsistencias entre compras, ventas y stock
-- ============================================================
SELECT '' AS '---', '' AS '---', '' AS '---', '' AS '---',
       '' AS '---', '' AS '---', '' AS '---';

SELECT 'ALERTAS' AS '---', '' AS '---', '' AS '---', '' AS '---',
       '' AS '---', '' AS '---', '' AS '---';

-- 1. Productos con ventas pero sin stock
SELECT
  '⚠ Sin stock c/ventas' AS 'Tipo',
  d.name                 AS 'Producto',
  d.stock                AS 'Stock',
  d.total_vendido        AS 'Vendido',
  d.total_comprado       AS 'Comprado'
FROM datos d
WHERE d.stock <= 0 AND d.total_vendido > 0
ORDER BY d.total_vendido DESC;

-- 2. Stock inicial real negativo (se ha consumido más de lo comprado)
SELECT '' AS '---', '' AS '---', '' AS '---', '' AS '---',
       '' AS '---';

SELECT '⚠ Stock inicial negativo' AS 'Tipo',
       '(se ha vendido mas de lo comprado)' AS '---';

SELECT
  '⚠ Negativo' AS 'Tipo',
  d.name       AS 'Producto',
  d.stock      AS 'Stock',
  d.total_vendido AS 'Vendido',
  d.total_comprado AS 'Comprado',
  (d.stock + d.total_vendido - d.total_comprado) AS 'Stock Inicial'
FROM datos d
WHERE (d.stock + d.total_vendido - d.total_comprado) < 0
ORDER BY (d.stock + d.total_vendido - d.total_comprado) ASC;
