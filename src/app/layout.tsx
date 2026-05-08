import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { Providers } from '@/components/providers';

export const metadata: Metadata = {
  title: 'TiendaMiBarrio',
  description: 'Sistema de gestión para tu tienda',
  manifest: '/manifest.json',
  other: { 'mobile-web-app-capable': 'yes' },
};
export const viewport: Viewport = { themeColor: '#0d1117', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="font-body antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
