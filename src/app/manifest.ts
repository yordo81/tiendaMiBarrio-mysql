import type { MetadataRoute } from 'next';
import { getBusinessSettings } from '@/lib/settings-server';

// ── Manifiesto PWA dinámico ────────────────────────────────────────
// Usa el nombre del negocio configurado (fallback a TiendaMiBarrio).

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const s = await getBusinessSettings();
  return {
    name: s.business_name,
    short_name: s.business_name.slice(0, 12),
    description: `Sistema de gestión de ${s.business_name}`,
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#0d1117',
    theme_color: '#0d1117',
    orientation: 'portrait-primary',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
