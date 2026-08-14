'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useCallback, useMemo, useState } from 'react';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Package, ShoppingCart, Users, Truck,
  TrendingDown, BarChart2, UserCog, Wifi, WifiOff,
  Warehouse, ArrowRightLeft, ShoppingBag, Shield, DollarSign, CalendarCheck, Bell, Settings, Clock3,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';
import { useOnlineStatus } from '@/hooks/use-online';
import type { AppUser } from '@/types';
import { UNAUTHORIZED_EVENT, type UnauthorizedEventDetail } from '@/lib/api-client';

interface NavItem { href: string; icon: LucideIcon; label: string; roles: string[]; workMode?: 'shifts' }
interface NavGroup { title: string; icon: LucideIcon; items: NavItem[] }

// Dashboard queda fijo en la parte superior (fuera del acordeón).
// El vendedor no tiene dashboard: entra directo al punto de venta táctil.
const dashboardItem: NavItem = { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', roles: ['owner','admin','warehouse'] };

// Enlaces agrupados por categoría para el acordeón del sidebar
const navGroups: NavGroup[] = [
  {
    title: 'Ventas y clientes',
    icon: ShoppingCart,
    items: [
      { href: '/dashboard/ventas', icon: ShoppingCart, label: 'Ventas', roles: ['owner','admin','seller'] },
      { href: '/dashboard/reservaciones', icon: CalendarCheck, label: 'Reservaciones', roles: ['owner','admin','seller'] },
      { href: '/dashboard/clientes', icon: Users, label: 'Clientes', roles: ['owner','admin','seller'] },
    ],
  },
  {
    title: 'Inventario',
    icon: Package,
    items: [
      { href: '/dashboard/inventario', icon: Package, label: 'Inventario', roles: ['owner','admin','warehouse'] },
      { href: '/dashboard/compras', icon: ShoppingBag, label: 'Compras', roles: ['owner','admin','warehouse'] },
      { href: '/dashboard/movimientos', icon: ArrowRightLeft, label: 'Movimientos', roles: ['owner','admin','warehouse'] },
      { href: '/dashboard/almacenes', icon: Warehouse, label: 'Almacenes', roles: ['owner','admin','warehouse'] },
      { href: '/dashboard/proveedores', icon: Truck, label: 'Proveedores', roles: ['owner','admin','warehouse'] },
    ],
  },
  {
    title: 'Finanzas',
    icon: DollarSign,
    items: [
      { href: '/dashboard/gastos', icon: TrendingDown, label: 'Gastos', roles: ['owner','admin'] },
      { href: '/dashboard/contabilidad', icon: DollarSign, label: 'Contabilidad', roles: ['owner','admin'] },
      { href: '/dashboard/turnos', icon: Clock3, label: 'Turnos', roles: ['owner','admin'], workMode: 'shifts' },
    ],
  },
  {
    title: 'Administración',
    icon: Shield,
    items: [
      { href: '/dashboard/reportes', icon: BarChart2, label: 'Reportes', roles: ['owner','admin'] },
      { href: '/dashboard/auditoria', icon: Shield, label: 'Auditoría', roles: ['owner','admin'] },
      { href: '/dashboard/notificaciones', icon: Bell, label: 'Notificaciones', roles: ['owner','admin','warehouse','seller'] },
      { href: '/dashboard/usuarios', icon: UserCog, label: 'Usuarios', roles: ['owner','admin'] },
      { href: '/dashboard/configuracion', icon: Settings, label: 'Configuración', roles: ['owner'] },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, setUser } = useAuthStore();
  const settings = useSettingsStore(s => s.settings);
  const loadSettings = useSettingsStore(s => s.load);
  const isOnline = useOnlineStatus();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Acordeón puro: un solo grupo abierto a la vez. Al navegar (o al cargar)
  // se abre automáticamente el grupo de la página activa.
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const activeGroupTitle = useMemo(() => {
    const g = navGroups.find(grp => grp.items.some(item =>
      pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
    ));
    return g?.title;
  }, [pathname]);

  const showDashboard = !user ? true : dashboardItem.roles.includes(user.role);
  useEffect(() => { if (activeGroupTitle) setOpenGroup(activeGroupTitle); }, [activeGroupTitle]);

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

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href));

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
      <nav className="flex-1 px-3 py-4 space-y-2.5 overflow-y-auto">
        {showDashboard && (
          <Link
            href={dashboardItem.href}
            className={cn('flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150', isActive(dashboardItem.href) ? 'bg-brand-600/20 text-brand-400 border border-brand-500/30' : 'hover:bg-[var(--bg-tertiary)]')}
            style={!isActive(dashboardItem.href) ? { color: 'var(--text-secondary)' } : undefined}
          >
            <dashboardItem.icon className={cn('w-4 h-4 flex-shrink-0', isActive(dashboardItem.href) ? 'text-brand-400' : 'text-[var(--text-tertiary)]')} />
            {dashboardItem.label}
          </Link>
        )}
        {navGroups.map(group => {
          // Filtrar enlaces por rol, modo de operación (Turnos solo en modo
          // por turnos) y módulos desactivados (Reservaciones oculto)
          const items = group.items.filter(item =>
            (!user ? true : item.roles.includes(user.role)) &&
            (!item.workMode || settings?.work_mode === item.workMode) &&
            (item.href !== '/dashboard/reservaciones' || settings?.show_reservations !== false)
          );
          if (items.length === 0) return null;
          const open = openGroup === group.title;
          const groupActive = group.items.some(item => isActive(item.href));
          return (
            <div key={group.title} className="space-y-0.5">
              <button
                onClick={() => setOpenGroup(open ? null : group.title)}
                className={cn('w-full flex items-center gap-2.5 pl-2.5 pr-3 py-2 rounded-lg text-[11px] uppercase tracking-wider font-semibold transition-colors', open ? 'bg-[var(--bg-tertiary)] border-l-2 border-brand-500' : 'border-l-2 border-transparent hover:bg-[var(--bg-tertiary)]')}
                style={{ color: groupActive ? 'var(--brand-400)' : 'var(--text-tertiary)' }}
                aria-expanded={open}
              >
                <group.icon className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="flex-1 text-left">{group.title}</span>
                <ChevronDown className={cn('w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200', open ? 'rotate-180' : '')} />
              </button>
              <div className={cn('grid transition-all duration-200 ease-out', open ? 'grid-rows-[1fr] opacity-100 visible' : 'grid-rows-[0fr] opacity-0 invisible')}>
                <div className="overflow-hidden min-h-0">
                  <div className="space-y-0.5 pt-0.5 pl-1.5">
                    {items.map(({ href, icon: Icon, label }) => {
                      const active = isActive(href);
                      // El rol vendedor usa el punto de venta táctil en lugar
                      // de la página de ventas con modal (si está activado en
                      // Configuración → Operación → Módulos del sistema)
                      const linkHref = href === '/dashboard/ventas' && user?.role === 'seller' && settings?.enable_touch_pos !== false ? '/dashboard/ventas/touch' : href;
                      return (
                        <Link key={href} href={linkHref} className={cn('flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150', active ? 'bg-brand-600/20 text-brand-400 border border-brand-500/30' : 'hover:bg-[var(--bg-tertiary)]')} style={!active ? { color: 'var(--text-secondary)' } : undefined}>
                          <Icon className={cn('w-4 h-4 flex-shrink-0', active ? 'text-brand-400' : 'text-[var(--text-tertiary)]')} />
                          {label}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
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
