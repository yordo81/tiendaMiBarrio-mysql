'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Package, ShoppingCart, Warehouse, BarChart2, MoveHorizontal, ShoppingBag, Shield, DollarSign, LogOut, Sun, Moon, Settings, Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useWorkMode } from '@/lib/stores/settings-store';
import { useTheme } from '@/components/theme/ThemeProvider';
const nav: { href: string; label: string; icon: typeof Clock3; roles?: string[]; workMode?: 'daily' | 'shifts' }[] = [
  { href: '/dashboard',            label: 'Inicio',     icon: LayoutDashboard },
  { href: '/dashboard/inventario', label: 'Inventario', icon: Package },
  { href: '/dashboard/movimientos',label: 'Movimientos',icon: MoveHorizontal },
  { href: '/dashboard/compras',    label: 'Compras',    icon: ShoppingBag },
  { href: '/dashboard/almacenes',  label: 'Almacenes',  icon: Warehouse },
  { href: '/dashboard/ventas',     label: 'Ventas',     icon: ShoppingCart },
  { href: '/dashboard/turnos',     label: 'Turnos',     icon: Clock3, workMode: 'shifts' },
  { href: '/dashboard/contabilidad',label: 'Caja',      icon: DollarSign },
  { href: '/dashboard/reportes',   label: 'Reportes',   icon: BarChart2 },
  { href: '/dashboard/auditoria',label: 'Auditoría', icon: Shield },
  { href: '/dashboard/configuracion', label: 'Config.', icon: Settings, roles: ['owner'] },
];
export default function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const { theme, toggleTheme } = useTheme();
  const workMode = useWorkMode();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.push('/auth/login');
  }

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40" style={{ backgroundColor: 'var(--bg-secondary)', borderTop: '1px solid var(--border-primary)' }}>
      <ul className="flex">
        {/* Filtrar enlaces según el rol y el modo de operación (Turnos solo en modo por turnos) */}
        {nav.filter(item => (!item.roles || (user && item.roles.includes(user.role))) && (!item.workMode || workMode === item.workMode)).map(item => { const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href)); // El rol vendedor usa el punto de venta táctil en lugar de la página con modal
        const linkHref = item.href === '/dashboard/ventas' && user?.role === 'seller' ? '/dashboard/ventas/touch' : item.href; return (
          <li key={item.href} className="flex-1">
            <Link href={linkHref} className={cn('flex flex-col items-center gap-1 py-3 text-[10px] transition-colors', active ? 'text-brand-400' : '')} style={!active ? { color: 'var(--text-tertiary)' } : undefined}>
              <item.icon size={20}/>{item.label}
            </Link>
          </li>
        );})}
        <li className="flex-1">
          <button onClick={toggleTheme} className="flex flex-col items-center gap-1 py-3 text-[10px] transition-colors w-full" style={{ color: 'var(--text-tertiary)' }}>
            {theme === 'dark' ? <Sun size={20}/> : <Moon size={20}/>}
            {theme === 'dark' ? 'Claro' : 'Oscuro'}
          </button>
        </li>
        <li className="flex-1">
          <button onClick={handleLogout} className="flex flex-col items-center gap-1 py-3 text-[10px] transition-colors hover:text-red-400 w-full" style={{ color: 'var(--text-tertiary)' }}>
            <LogOut size={20}/>Salir
          </button>
        </li>
      </ul>
    </nav>
  );
}
