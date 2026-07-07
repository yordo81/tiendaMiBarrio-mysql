'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useCallback, useState } from 'react';
import { useAuthStore } from '@/lib/stores/auth-store';
import { classifyRole, cn } from '@/lib/utils';
import { LayoutDashboard, Package, ShoppingCart, Users, Truck, TrendingDown, BarChart2, UserCog, LogOut, Wifi, WifiOff, Warehouse, ArrowRightLeft, ShoppingBag, Shield, DollarSign, CalendarCheck } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/use-online';
import type { AppUser } from '@/types';

const navItems = [
  { href: '/dashboard',             icon: LayoutDashboard, label: 'Dashboard',    roles: ['owner','admin','seller','warehouse'] },
  { href: '/dashboard/inventario',  icon: Package,         label: 'Inventario',   roles: ['owner','admin','warehouse'] },
  { href: '/dashboard/compras',     icon: ShoppingBag,     label: 'Compras',      roles: ['owner','admin','warehouse'] },
  { href: '/dashboard/movimientos', icon: ArrowRightLeft,  label: 'Movimientos',  roles: ['owner','admin','warehouse'] },
  { href: '/dashboard/almacenes',   icon: Warehouse,       label: 'Almacenes',    roles: ['owner','admin','warehouse'] },
  { href: '/dashboard/ventas',      icon: ShoppingCart,    label: 'Ventas',       roles: ['owner','admin','seller'] },
  { href: '/dashboard/clientes',    icon: Users,           label: 'Clientes',     roles: ['owner','admin','seller'] },
  { href: '/dashboard/proveedores', icon: Truck,           label: 'Proveedores',  roles: ['owner','admin','warehouse'] },
  { href: '/dashboard/gastos',      icon: TrendingDown,    label: 'Gastos',       roles: ['owner','admin'] },
  { href: '/dashboard/contabilidad', icon: DollarSign,     label: 'Contabilidad', roles: ['owner','admin'] },
  { href: '/dashboard/reportes',    icon: BarChart2,       label: 'Reportes',     roles: ['owner','admin'] },
  { href: '/dashboard/auditoria',     icon: Shield,          label: 'Auditoría',      roles: ['owner','admin'] },
  { href: '/dashboard/reservaciones', icon: CalendarCheck,   label: 'Reservaciones', roles: ['owner','admin','seller'] },
  { href: '/dashboard/usuarios',       icon: UserCog,         label: 'Usuarios',        roles: ['owner'] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const isOnline = useOnlineStatus();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const loadUser = useCallback(async () => {
    if (user) return;
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) { const d = await res.json(); if (d.user) setUser(d.user as AppUser); }
    } catch {}
  }, [user, setUser]);

  useEffect(() => { loadUser(); }, [loadUser]);

  const allowedItems = navItems.filter(item => !user ? true : item.roles.includes(user.role));

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null); router.push('/auth/login');
  }

  return (
    <aside className="hidden md:flex flex-col w-60 h-screen bg-[#161b22] border-r border-[#21262d] fixed left-0 top-0 z-40">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-[#21262d]">
        <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-md shadow-brand-600/30">
          <ShoppingCart className="w-4 h-4 text-white" />
        </div>
        <div>
          <span className="font-display text-[#e6edf3] text-base leading-tight block">TiendaMiBarrio</span>
          <span className="text-[10px] text-[#6e7681] uppercase tracking-wider">MySQL Edition</span>
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
            <Link key={href} href={href} className={cn('flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group', active ? 'bg-brand-600/20 text-brand-400 border border-brand-500/30' : 'text-[#8b949e] hover:text-[#e6edf3] hover:bg-[#1c2128]')}>
              <Icon className={cn('w-4 h-4 flex-shrink-0', active ? 'text-brand-400' : 'text-[#6e7681] group-hover:text-[#8b949e]')} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-[#21262d] p-3 space-y-2">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-8 h-8 bg-brand-600/30 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-brand-400 text-sm font-semibold">{user?.name?.charAt(0).toUpperCase() ?? '?'}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[#e6edf3] font-medium truncate">{user?.name ?? 'Cargando...'}</p>
            <p className="text-xs text-[#6e7681]">{user ? classifyRole(user.role) : ''}</p>
          </div>
        </div>
        <button onClick={handleLogout} className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-[#8b949e] hover:text-red-400 hover:bg-red-500/10 transition-all duration-150 group">
          <LogOut className="w-4 h-4 flex-shrink-0 text-[#6e7681] group-hover:text-red-400" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}