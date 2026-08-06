'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useCallback, useState } from 'react';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Package, ShoppingCart, Users, Truck,
  TrendingDown, BarChart2, UserCog, Wifi, WifiOff,
  Warehouse, ArrowRightLeft, ShoppingBag, Shield, DollarSign, CalendarCheck, Bell, Settings,
} from 'lucide-react';
import { useOnlineStatus } from '@/hooks/use-online';
import type { AppUser } from '@/types';
import { UNAUTHORIZED_EVENT, type UnauthorizedEventDetail } from '@/lib/api-client';

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
  { href: '/dashboard/notificaciones', icon: Bell,         label: 'Notificaciones', roles: ['owner','admin','warehouse','seller'] },
  { href: '/dashboard/usuarios',    icon: UserCog,         label: 'Usuarios',     roles: ['owner'] },
  { href: '/dashboard/configuracion', icon: Settings,      label: 'Configuración', roles: ['owner'] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, setUser } = useAuthStore();
  const settings = useSettingsStore(s => s.settings);
  const loadSettings = useSettingsStore(s => s.load);
  const isOnline = useOnlineStatus();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Cargar configuración del negocio (nombre/logo) una sola vez
  useEffect(() => { loadSettings(); }, [loadSettings]);

  const loadUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const d = await res.json();
        if (d.user) setUser(d.user as AppUser);
        return;
      }
      // Si el servidor no reconoce la sesión, limpiar auth local
      // y disparar el evento centralizado para que providers.tsx
      // muestre el toast y redirija al login con su debounce
      setUser(null);
      window.dispatchEvent(
        new CustomEvent<UnauthorizedEventDetail>(UNAUTHORIZED_EVENT, {
          detail: { url: '/api/auth/me', message: 'Sesión expirada. Por favor, inicia sesión de nuevo para continuar.' },
        })
      );
    } catch {
      // Error de red — no limpiar el usuario para evitar pantalla en blanco
    }
  }, [setUser]);

  useEffect(() => { loadUser(); }, [loadUser]);

  const allowedItems = navItems.filter(item => !user ? true : item.roles.includes(user.role));

  return (
    <aside className="hidden md:flex flex-col w-60 h-screen fixed left-0 top-0 z-40" style={{ backgroundColor: 'var(--bg-secondary)', borderRightColor: 'var(--border-primary)', borderRightWidth: '1px' }}>
      <div className="flex items-center gap-3 px-5 py-5" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden shadow-md shadow-brand-600/30">
          {settings?.logo_url ? (
            <img src={settings.logo_url} alt="" className="w-full h-full object-contain p-0.5" />
          ) : (
            <ShoppingCart className="w-4 h-4 text-white" />
          )}
        </div>
        <div className="min-w-0">
          <span className="font-display text-base leading-tight block truncate" style={{ color: 'var(--text-primary)' }}>{settings?.business_name ?? 'TiendaMiBarrio'}</span>
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
      <div className="p-3 flex items-center justify-center" style={{ borderTop: '1px solid var(--border-primary)' }}>
        <p className="text-[10px] text-[var(--text-tertiary)] opacity-50 text-center">
          TiendaMiBarrio MySQL Edition
        </p>
      </div>
    </aside>
  );
}
