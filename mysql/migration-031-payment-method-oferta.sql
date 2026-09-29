-- ── migration-031: nuevo método de pago "oferta" ─────────────────────
-- "oferta" permite registrar una venta en varias monedas (una fila de pago
-- por moneda, igual que el mixto multi-moneda) con precio de venta final
-- negociado. Se agrega al ENUM `payments.method`.
--
-- Uso: mysql -u root -p < mysql/migration-031-payment-method-oferta.sql
-- (o ejecuta las sentencias de este archivo con tu cliente MySQL).

ALTER TABLE payments
  MODIFY COLUMN method ENUM('cash','transfer','mixed','credit','oferta') NOT NULL;

INSERT IGNORE INTO schema_migrations (filename) VALUES ('migration-031-payment-method-oferta.sql');
