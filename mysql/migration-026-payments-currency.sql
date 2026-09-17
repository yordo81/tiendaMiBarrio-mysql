-- ============================================================
-- Migración 026: Moneda en los pagos (arqueo por moneda)
--
-- Agrega currency_code y exchange_rate a payments y
-- customer_payments para que cada pago quede identificado con la
-- moneda en la que se cobró y la tasa congelada del momento.
--
-- El arqueo de caja (cierre de turno) usa estas columnas para:
--   - Sumar el efectivo esperado SEPARADO por moneda (cuánto hay
--     en caja de cada una, sin mezclar montos).
--   - Mantener el total esperado en moneda base (convirtiendo el
--     efectivo de otras monedas con la tasa congelada del pago).
-- ============================================================

ALTER TABLE payments
  ADD COLUMN currency_code  VARCHAR(10)  NULL COMMENT 'Moneda del pago' AFTER amount_transfer,
  ADD COLUMN exchange_rate  DECIMAL(16,6) NULL COMMENT 'Tasa de cambio al momento del pago (1 moneda = X base)' AFTER currency_code;

ALTER TABLE customer_payments
  ADD COLUMN currency_code  VARCHAR(10)  NULL COMMENT 'Moneda del abono' AFTER amount,
  ADD COLUMN exchange_rate  DECIMAL(16,6) NULL COMMENT 'Tasa de cambio al momento del abono (1 moneda = X base)' AFTER currency_code;

-- Los pagos históricos fueron cobrados en la moneda base del negocio:
-- se hereda de la venta si la venta tenía moneda, si no quedan NULL
-- (NULL = moneda base) y el arqueo los trata como base.
UPDATE payments p
  JOIN sales s ON s.id = p.sale_id
  SET p.currency_code = s.currency_code,
      p.exchange_rate = s.exchange_rate
  WHERE p.currency_code IS NULL AND s.currency_code IS NOT NULL;

UPDATE customer_payments cp
  JOIN sales s ON s.id = cp.sale_id
  SET cp.currency_code = s.currency_code,
      cp.exchange_rate = s.exchange_rate
  WHERE cp.currency_code IS NULL AND s.currency_code IS NOT NULL;
