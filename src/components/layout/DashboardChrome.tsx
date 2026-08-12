'use client';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import MobileNav from '@/components/layout/MobileNav';

// ── Marco del dashboard ───────────────────────────────────────────
// En la ruta del punto de venta táctil (/dashboard/ventas/touch) se
// ocultan la barra lateral, el topbar y la navegación móvil para que la
// pantalla POS ocupe todo el espacio (está pensada para una pantalla
// touch dedicada). El resto de rutas conservan el marco habitual.

const TOUCH_POS_ROUTE = '/dashboard/ventas/touch';

export default function DashboardChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isTouchPos = pathname === TOUCH_POS_ROUTE;

  if (isTouchPos) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <Sidebar />
      <div className="md:ml-60 flex flex-col min-h-screen">
        <Topbar />
        <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}
