'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Package, ShoppingCart, Warehouse, BarChart2, MoveHorizontal, ShoppingBag, Shield, DollarSign, LogOut, Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useTheme } from '@/components/theme/ThemeProvider';
const nav = [
  { href: '/dashboard',            label: 'Inicio',     icon: LayoutDashboard },
  { href: '/dashboard/inventario', label: 'Inventario', icon: Package },
  { href: '/dashboard/movimientos',label: 'Movimientos',icon: MoveHorizontal },
  { href: '/dashboard/compras',    label: 'Compras',    icon: ShoppingBag },
  { href: '/dashboard/almacenes',  label: 'Almacenes',  icon: Warehouse },
  { href: '/dashboard/ventas',     label: 'Ventas',     icon: ShoppingCart },
  { href: '/dashboard/contabilidad',label: 'Caja',      icon: DollarSign },
  { href: '/dashboard/reportes',   label: 'Reportes',   icon: BarChart2 },
  { href: '/dashboard/auditoria',label: 'Auditoría', icon: Shield },
];
export default function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { setUser } = useAuthStore();
  const { theme, toggleTheme } = useTheme();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.push('/auth/login');
  }

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40" style={{ backgroundColor: 'var(--bg-secondary)', borderTop: '1px solid var(--border-primary)' }}>
      <ul className="flex">
        {nav.map(item => { const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href)); return (
          <li key={item.href} className="flex-1">
            <Link href={item.href} className={cn('flex flex-col items-center gap-1 py-3 text-[10px] transition-colors', active ? 'text-brand-400' : '')} style={!active ? { color: 'var(--text-tertiary)' } : undefined}>
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
