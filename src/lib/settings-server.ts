import { query, queryOne } from '@/lib/db/mysql';

// ── Configuración del negocio (lado servidor) ─────────────────────
// Lee la tabla settings (fila única id='1'). Se usa en metadatos,
// manifiesto PWA y rutas API. Siempre devuelve valores por defecto
// si la tabla no existe o la BD está caída.

export interface BusinessSettings {
  business_name: string;
  logo_url: string | null;
  work_mode: 'daily' | 'shifts';
  // Impresión de tickets de venta (comprobante del cliente)
  receipt_printer_width: '57' | '80';
  receipt_print_method: 'browser' | 'usb';
  receipt_auto_print: boolean;
}

export const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  business_name: 'TiendaMiBarrio',
  logo_url: null,
  work_mode: 'daily',
  receipt_printer_width: '80',
  receipt_print_method: 'browser',
  receipt_auto_print: true,
};

export async function getBusinessSettings(): Promise<BusinessSettings> {
  try {
    const row = await queryOne<{
      business_name: string | null;
      logo_url: string | null;
      work_mode: string | null;
      receipt_printer_width: string | null;
      receipt_print_method: string | null;
      receipt_auto_print: number | null;
    }>(
      'SELECT business_name, logo_url, work_mode, receipt_printer_width, receipt_print_method, receipt_auto_print FROM settings WHERE id = ? LIMIT 1',
      ['1']
    );
    if (row) {
      return {
        business_name: row.business_name?.trim() || DEFAULT_BUSINESS_SETTINGS.business_name,
        logo_url: row.logo_url ?? null,
        work_mode: row.work_mode === 'shifts' ? 'shifts' : 'daily',
        receipt_printer_width: row.receipt_printer_width === '57' ? '57' : '80',
        receipt_print_method: row.receipt_print_method === 'usb' ? 'usb' : 'browser',
        receipt_auto_print: row.receipt_auto_print == null ? DEFAULT_BUSINESS_SETTINGS.receipt_auto_print : Number(row.receipt_auto_print) === 1,
      };
    }
  } catch {
    // Tabla ausente (migración pendiente) o BD caída → usar defaults
  }
  return DEFAULT_BUSINESS_SETTINGS;
}

// Devuelve el id del turno de caja abierto (solo en modo turnos), o null.
// Si se pasa posId, busca el turno abierto de ESA caja. Sin posId y con
// VARIAS cajas abiertas a la vez, devuelve null: la vinculación sería
// ambigua y es mejor no etiquetar el movimiento a un turno arbitrario.
export async function getOpenShiftId(posId?: string | null): Promise<string | null> {
  const settings = await getBusinessSettings();
  if (settings.work_mode !== 'shifts') return null;
  try {
    if (posId) {
      const row = await queryOne<{ id: string }>(
        "SELECT id FROM shifts WHERE status = 'open' AND pos_id = ? ORDER BY opened_at DESC LIMIT 1",
        [posId]
      );
      return row?.id ?? null;
    }
    const rows = await query<{ id: string }>(
      "SELECT id FROM shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 2"
    );
    return rows.length === 1 ? rows[0].id : null;
  } catch {
    return null;
  }
}
