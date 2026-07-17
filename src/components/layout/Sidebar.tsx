'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useCallback, useState } from 'react';
import { useAuthStore } from '@/lib/stores/auth-store';
import { classifyRole, cn } from '@/lib/utils';
import {
  LayoutDashboard, Package, ShoppingCart, Users, Truck,
  TrendingDown, BarChart2, UserCog, LogOut, Wifi, WifiOff,
  Warehouse, ArrowRightLeft, ShoppingBag, Shield, DollarSign, CalendarCheck,
} from 'lucide-react';
import { useOnlineStatus } from '@/hooks/use-online';
import { toast } from '@/components/ui/toaster';
import type { AppUser } from '@/types';
import ThemeToggle from '@/components/ui/ThemeToggle';

const navItems = [
  { href: '/dashboard',             icon: LayoutDashboard, label: 'Dashboard',    roles: ['owner','admin','seller','warehouse'] },
  { href: '/dashboard/ventas',      icon: ShoppingCart,    label: 'Ventas',       roles: ['owner','admin','seller'] },
  { href: '/dashboard/reservaciones', icon: CalendarCheck,   label: 'Reservaciones', roles: ['owner','admin','seller'] },
  { href: '/dashboard/inventario',  icon: Package,         label: 'Inventario',   roles: ['owner','admin','warehouse'] },
  { href: '/dashboard/compras',     icon: ShoppingBag,     label: 'Compras',      roles: ['owner','admin','warehouse'] },
  { href: '/dashboard/movimientos', icon: ArrowRightLeft,  label: 'Movimientos',  roles: ['owner','admin','warehouse'] },
  { href: '/dashboard/almacenes',   icon: Warehouse,       label: 'Almacenes',    roles: ['owner','admin','warehouse'] },
  { href: '/dashboard/clientes',    icon: Users,           label: 'Clientes',     roles: ['owner','admin','seller'] },
  { href: '/dashboard/proveedores', icon: Truck,           label: 'Proveedores',  roles: ['owner','admin','warehouse'] },
  { href: '/dashboard/gastos',      icon: TrendingDown,    label: 'Gastos',       roles: ['owner','admin'] },
  { href: '/dashboard/contabilidad', icon: DollarSign,     label: 'Contabilidad', roles: ['owner','admin'] },
  { href: '/dashboard/reportes',    icon: BarChart2,       label: 'Reportes',     roles: ['owner','admin'] },
  { href: '/dashboard/auditoria',   icon: Shield,          label: 'Auditoría',    roles: ['owner','admin'] },
  { href: '/dashboard/usuarios',    icon: UserCog,         label: 'Usuarios',     roles: ['owner'] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const isOnline = useOnlineStatus();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const loadUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const d = await res.json();
        if (d.user) setUser(d.user as AppUser);
        return;
      }
      // Si el servidor no reconoce la sesión, limpiar auth local
      toast.warning('Sesión expirada. Por favor, inicia sesión de nuevo para continuar.');
      setUser(null);
    } catch {
      // Error de red — no limpiar el usuario para evitar pantalla en blanco
    }
  }, [setUser]);

  useEffect(() => { loadUser(); }, [loadUser]);

  const allowedItems = navItems.filter(item => !user ? true : item.roles.includes(user.role));

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null); router.push('/auth/login');
  }

  return (
    <aside className="hidden md:flex flex-col w-60 h-screen fixed left-0 top-0 z-40" style={{ backgroundColor: 'var(--bg-secondary)', borderRightColor: 'var(--border-primary)', borderRightWidth: '1px' }}>
      <div className="flex items-center gap-3 px-5 py-5" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md shadow-brand-600/30">
          <ShoppingCart className="w-4 h-4 text-white" />
        </div>
        <div>
          <span className="font-display text-base leading-tight block" style={{ color: 'var(--text-primary)' }}>TiendaMiBarrio</span>
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>MySQL Edition</span>
        </div>
      </div>
      <div className={cn('mx-3 mt-3 px-3 py-1.5 rounded-lg text-xs flex items-center gap-2 font-medium', !mounted || isOnline ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20')}>
        {!mounted || isOnline ? <Wifi className="w-3 h-3"/> : <WifiOff className="w-3 h-3"/>}
        {!mounted || isOnline ? 'En línea' : 'Sin conexión'}
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {allowedItems.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link key={href} href={href} className={cn('flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group', active ? 'bg-brand-600/20 text-brand-400 border border-brand-500/30' : 'hover:bg-[var(--bg-tertiary)]')} style={!active ? { color: 'var(--text-secondary)' } : undefined}>
              <Icon className={cn('w-4 h-4 flex-shrink-0', active ? 'text-brand-400' : 'group-hover:text-[var(--text-secondary)]')} style={!active ? { color: 'var(--text-tertiary)' } : undefined} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 space-y-2" style={{ borderTop: '1px solid var(--border-primary)' }}>
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-8 h-8 bg-brand-600/30 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-brand-400 text-sm font-semibold">{user?.name?.charAt(0).toUpperCase() ?? '?'}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{user?.name ?? 'Cargando...'}</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{user ? classifyRole(user.role) : ''}</p>
          </div>
        </div>
        <ThemeToggle showLabel />
        <button onClick={handleLogout} className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group hover:text-red-400 hover:bg-red-500/10" style={{ color: 'var(--text-secondary)' }}>
          <LogOut className="w-4 h-4 flex-shrink-0 group-hover:text-red-400" style={{ color: 'var(--text-tertiary)' }} />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
