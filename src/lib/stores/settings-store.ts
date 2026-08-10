import { create } from 'zustand';

// ── Store de configuración del negocio ─────────────────────────────
// Se carga una sola vez (flag loaded) desde /api/settings y queda
// disponible para sidebar, topbar, login y páginas públicas.

export interface BusinessSettings {
  business_name: string;
  logo_url: string | null;
  work_mode: 'daily' | 'shifts';
  // Impresión de tickets de venta (comprobante del cliente)
  receipt_printer_width: '57' | '80';
  receipt_print_method: 'browser' | 'usb';
  receipt_auto_print: boolean;
}

export const DEFAULT_SETTINGS: BusinessSettings = {
  business_name: 'TiendaMiBarrio',
  logo_url: null,
  work_mode: 'daily',
  receipt_printer_width: '80',
  receipt_print_method: 'browser',
  receipt_auto_print: true,
};

interface SettingsState {
  settings: BusinessSettings | null;
  loaded: boolean;
  load: () => Promise<void>;
  setSettings: (s: BusinessSettings) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const d = await res.json();
        const s = d?.settings;
        set({
          settings: {
            business_name: String(s?.business_name ?? DEFAULT_SETTINGS.business_name),
            logo_url: s?.logo_url ?? null,
            work_mode: s?.work_mode === 'shifts' ? 'shifts' : 'daily',
            receipt_printer_width: s?.receipt_printer_width === '57' ? '57' : '80',
            receipt_print_method: s?.receipt_print_method === 'usb' ? 'usb' : 'browser',
            receipt_auto_print: s?.receipt_auto_print !== false,
          },
          loaded: true,
        });
      }
    } catch {
      // Sin conexión o servidor caído — usar defaults
    } finally {
      if (!get().loaded) set({ loaded: true });
    }
  },

  setSettings: (s) => set({ settings: s, loaded: true }),
}));

// Selectores útiles con valores por defecto
export function useBusinessName(): string {
  return useSettingsStore(s => s.settings?.business_name) ?? DEFAULT_SETTINGS.business_name;
}

export function useBusinessLogo(): string | null {
  return useSettingsStore(s => s.settings?.logo_url) ?? null;
}

export function useWorkMode(): 'daily' | 'shifts' {
  return useSettingsStore(s => s.settings?.work_mode) ?? DEFAULT_SETTINGS.work_mode;
}
