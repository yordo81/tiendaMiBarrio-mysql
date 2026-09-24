-- ============================================================
-- Migración 029 — Tasas de cambio con referencia al dólar
-- ============================================================
-- 1) `currency_rates` pasa a guardar ÚNICAMENTE filas USD → moneda:
--        1 USD = X <moneda>
--    Las tasas existentes (referidas a la moneda base) se derivan al
--    dólar automáticamente y los pares antiguos se eliminan. NO se
--    crean tasas inversas: cada fila nace de datos escritos a mano
--    (o de su inversa ya guardada, usada SOLO en lectura).
-- 2) `sales.usd_rate`: tasa contra el dólar congelada al momento de
--    la venta (1 USD = X moneda de la venta) para los tickets. Las
--    ventas antiguas se rellenan con la tasa vigente.
-- Esta migración se registra a sí misma en `schema_migrations` al final,
-- de modo que quede constancia sin importar cómo se aplique (entrypoint.sh
-- del contenedor o scripts/apply-migration-029.js).
-- ============================================================

-- ── 1) Columna nueva: tasa USD congelada por venta ─────────────
-- (guard idempotente por si la columna ya existe)
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sales'
    AND COLUMN_NAME = 'usd_rate'
);
SET @ddl := IF(@col = 0,
  'ALTER TABLE sales ADD COLUMN usd_rate DECIMAL(16,6) NULL COMMENT ''Tasa USD congelada: 1 USD = X moneda de la venta''',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2) Valor de 1 USD en la moneda base (@u) ───────────────────
-- Se calcula ANTES de tocar la tabla, usando lo que haya guardado.
SET @base := (SELECT code FROM currencies WHERE is_base = 1 AND active = 1 LIMIT 1);

SET @u := CASE
  WHEN @base IS NULL THEN NULL
  WHEN @base = 'USD' THEN 1
  ELSE COALESCE(
    -- directa: fila 1 USD = X base
    (SELECT rate FROM currency_rates
      WHERE from_currency = 'USD' AND to_currency = @base),
    -- inversa guardada: 1 base = X USD ⇒ 1 USD = 1/X base (solo lectura)
    (SELECT 1 / rate FROM currency_rates
      WHERE from_currency = @base AND to_currency = 'USD' AND rate <> 0),
    -- por una tercera moneda Z: 1 USD = a Z y 1 base = b Z ⇒ a/b base
    (SELECT a.rate / b.rate FROM currency_rates a
       JOIN currency_rates b ON b.to_currency = a.to_currency
      WHERE a.from_currency = 'USD' AND b.from_currency = @base
        AND a.to_currency <> @base AND b.rate <> 0
      LIMIT 1),
    -- encadenada: 1 USD = a Z y 1 Z = c base ⇒ a*c base
    (SELECT a.rate * c.rate FROM currency_rates a
       JOIN currency_rates c ON c.from_currency = a.to_currency
      WHERE a.from_currency = 'USD' AND c.to_currency = @base
        AND a.to_currency <> @base AND c.rate <> 0
      LIMIT 1)
  )
END;

-- ── 3) Crear las filas USD → moneda derivadas ──────────────────
-- 3a) USD → moneda base (si aún no existía)
INSERT IGNORE INTO currency_rates (id, from_currency, to_currency, rate, updated_at, updated_by)
SELECT UUID(), 'USD', c.code, ROUND(@u, 6), NOW(), NULL
FROM currencies c
WHERE c.code = @base
  AND c.code <> 'USD'
  AND @u IS NOT NULL
  AND EXISTS (SELECT 1 FROM currencies WHERE code = 'USD');

-- 3b) USD → cada otra moneda activa:
--     1 USD = @u base   y   1 X = r_base base   ⇒   1 USD = @u / r_base X
INSERT IGNORE INTO currency_rates (id, from_currency, to_currency, rate, updated_at, updated_by)
SELECT UUID(), 'USD', c.code, ROUND(@u / d.r_base, 6), NOW(), NULL
FROM currencies c
JOIN (
  SELECT c2.code AS code,
    COALESCE(
      -- directa: 1 X = r base
      (SELECT r.rate FROM currency_rates r
        WHERE r.from_currency = c2.code AND r.to_currency = @base),
      -- inversa guardada: 1 base = r X ⇒ 1 X = 1/r base (solo lectura)
      (SELECT 1 / r.rate FROM currency_rates r
        WHERE r.from_currency = @base AND r.to_currency = c2.code AND r.rate <> 0),
      -- por Z: 1 X = a Z y 1 base = b Z ⇒ a/b base
      (SELECT a.rate / b.rate FROM currency_rates a
         JOIN currency_rates b ON b.to_currency = a.to_currency
        WHERE a.from_currency = c2.code AND b.from_currency = @base
          AND a.to_currency <> @base AND b.rate <> 0
        LIMIT 1),
      -- encadenada: 1 X = a Z y 1 Z = c base ⇒ a*c base
      (SELECT a.rate * z.rate FROM currency_rates a
         JOIN currency_rates z ON z.from_currency = a.to_currency
        WHERE a.from_currency = c2.code AND z.to_currency = @base
          AND a.to_currency <> @base AND z.rate <> 0
        LIMIT 1)
    ) AS r_base
  FROM currencies c2
) d ON d.code = c.code
WHERE @u IS NOT NULL
  AND c.active = 1
  AND c.code <> 'USD'
  AND d.r_base IS NOT NULL
  AND d.r_base > 0
  AND EXISTS (SELECT 1 FROM currencies WHERE code = 'USD');

-- ── 4) Eliminar los pares antiguos: solo queda la referencia USD ──
DELETE FROM currency_rates
WHERE from_currency <> 'USD'
  AND EXISTS (SELECT 1 FROM currencies WHERE code = 'USD');

-- Fila trivial USD → USD (el dólar vale 1 por definición)
DELETE FROM currency_rates
WHERE from_currency = 'USD' AND to_currency = 'USD';

-- ── 5) Rellenar sales.usd_rate en las ventas antiguas ──────────
-- exchange_rate congelado = 1 moneda de venta = r base
-- usd_rate              = 1 USD = (@u / r) moneda de venta
UPDATE sales
SET usd_rate = ROUND(@u / exchange_rate, 6)
WHERE @u IS NOT NULL
  AND currency_code IS NOT NULL
  AND exchange_rate IS NOT NULL
  AND exchange_rate > 0
  AND usd_rate IS NULL;

-- ── 6) Registrar la migración en la tabla de control ───────────
-- Garantiza la existencia de `schema_migrations` y deja constancia de que
-- esta migración ya se aplicó, evitando que entrypoint.sh la re-ejecute.
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   VARCHAR(255) NOT NULL PRIMARY KEY,
  applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO schema_migrations (filename)
VALUES ('migration-029-usd-reference-rates.sql');
