import { queryOne } from '@/lib/db/mysql';

// ── Configuración del negocio (lado servidor) ─────────────────────
// Lee la tabla settings (fila única id='1'). Se usa en metadatos,
// manifiesto PWA y rutas API. Siempre devuelve valores por defecto
// si la tabla no existe o la BD está caída.

export interface BusinessSettings {
  business_name: string;
  logo_url: string | null;
  work_mode: 'daily' | 'shifts';
}

export const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  business_name: 'TiendaMiBarrio',
  logo_url: null,
  work_mode: 'daily',
};

export async function getBusinessSettings(): Promise<BusinessSettings> {
  try {
    const row = await queryOne<{ business_name: string | null; logo_url: string | null; work_mode: string | null }>(
      'SELECT business_name, logo_url, work_mode FROM settings WHERE id = ? LIMIT 1',
      ['1']
    );
    if (row) {
      return {
        business_name: row.business_name?.trim() || DEFAULT_BUSINESS_SETTINGS.business_name,
        logo_url: row.logo_url ?? null,
        work_mode: row.work_mode === 'shifts' ? 'shifts' : 'daily',
      };
    }
  } catch {
    // Tabla ausente (migración pendiente) o BD caída → usar defaults
  }
  return DEFAULT_BUSINESS_SETTINGS;
}

// Devuelve el id del turno de caja abierto (solo en modo turnos), o null
export async function getOpenShiftId(): Promise<string | null> {
  const settings = await getBusinessSettings();
  if (settings.work_mode !== 'shifts') return null;
  try {
    const row = await queryOne<{ id: string }>(
      "SELECT id FROM shifts WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1"
    );
    return row?.id ?? null;
  } catch {
    return null;
  }
}
