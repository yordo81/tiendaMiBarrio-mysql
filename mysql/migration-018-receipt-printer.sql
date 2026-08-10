-- ============================================================
-- Migration 018: Impresión de tickets (comprobante del cliente)
-- ============================================================
-- Ejecutar: mysql -u root -p tienda_mi_barrio < migration-018-receipt-printer.sql
-- ============================================================

-- Ancho del papel del ticket de venta (impresora térmica 57 mm u 80 mm)
ALTER TABLE settings
  ADD COLUMN receipt_printer_width ENUM('57','80') NOT NULL DEFAULT '80'
  COMMENT 'Ancho del papel del ticket (57 mm u 80 mm)' AFTER work_mode;

-- Método de impresión del ticket:
--   browser = diálogo de impresión del navegador (cualquier impresora instalada)
--   usb     = impresión directa ESC/POS por WebUSB (solo Chrome/Edge + USB)
ALTER TABLE settings
  ADD COLUMN receipt_print_method ENUM('browser','usb') NOT NULL DEFAULT 'browser'
  COMMENT 'Método: browser = diálogo del navegador, usb = ESC/POS directo por WebUSB' AFTER receipt_printer_width;

-- Imprimir el ticket automáticamente al registrar cada venta
ALTER TABLE settings
  ADD COLUMN receipt_auto_print TINYINT(1) NOT NULL DEFAULT 1
  COMMENT 'Imprimir el ticket automáticamente al registrar una venta' AFTER receipt_print_method;

UPDATE settings SET receipt_printer_width='80', receipt_print_method='browser', receipt_auto_print=1 WHERE id='1';

SELECT '✅ migration-018: columnas de impresión de tickets agregadas a settings' AS status;
