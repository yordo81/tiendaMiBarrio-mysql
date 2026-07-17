import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';
import { Providers } from '@/components/providers';
import { ThemeProvider } from '@/components/theme/ThemeProvider';

export const metadata: Metadata = {
  title: 'TiendaMiBarrio',
  description: 'Sistema de gestión para tu tienda',
  manifest: '/manifest.json',
  other: { 'mobile-web-app-capable': 'yes' },
};
export const viewport: Viewport = { themeColor: '#0d1117', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300..700;1,9..40,400&display=swap"
        />
        {/* Script anti-flash: aplica el tema antes del primer render */}
        <script dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem('tienda-theme');if(t==='dark')document.documentElement.classList.add('dark');else if(t==='light')document.documentElement.classList.add('light');else if(window.matchMedia('(prefers-color-scheme:light)').matches)document.documentElement.classList.add('light');else document.documentElement.classList.add('dark');}catch(e){document.documentElement.classList.add('dark')}})()`
        }} />
      </head>
      <body className="font-body antialiased">
        <ThemeProvider>
          <Providers>{children}</Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
