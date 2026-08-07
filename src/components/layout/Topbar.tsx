'use client';
import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { WifiOff, LogOut, ChevronDown, User } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/use-online';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useSettingsStore } from '@/lib/stores/settings-store';
import { classifyRole, cn } from '@/lib/utils';
import ThemeToggle from '@/components/ui/ThemeToggle';
import NotificationBell from '@/components/notifications/NotificationBell';

const titles: Record<string,string> = {
  '/dashboard':'Dashboard','/dashboard/inventario':'Inventario','/dashboard/ventas':'Ventas',
  '/dashboard/clientes':'Clientes','/dashboard/proveedores':'Proveedores','/dashboard/gastos':'Gastos',
  '/dashboard/reportes':'Reportes','/dashboard/usuarios':'Usuarios','/dashboard/almacenes':'Almacenes',
  '/dashboard/contabilidad':'Contabilidad','/dashboard/turnos':'Turnos','/dashboard/auditoria':'Auditoría','/dashboard/compras':'Compras',
  '/dashboard/movimientos':'Movimientos','/dashboard/reservaciones':'Reservaciones','/dashboard/notificaciones':'Notificaciones',
  '/dashboard/configuracion':'Configuración',
};

export default function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const { user, setUser } = useAuthStore();
  const settings = useSettingsStore(s => s.settings);
  const loadSettings = useSettingsStore(s => s.load);
  const [mounted, setMounted] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setMounted(true); }, []);
  // Cargar la configuración del negocio para mostrar su nombre en el título
  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Cerrar menú al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setUserMenuOpen(false);
      }
    };
    if (userMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userMenuOpen]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.push('/auth/login');
  };

  return (
    <header className="h-14 border-b backdrop-blur-sm flex items-center justify-between px-5 sticky top-0 z-20" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'color-mix(in srgb, var(--bg-primary) 80%, transparent)' }}>
      <h1 className="font-display text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{titles[pathname] ?? settings?.business_name ?? 'TiendaMiBarrio'}</h1>
      <div className="flex items-center gap-2">
        {mounted && !isOnline && (
          <div className="flex items-center gap-1.5 text-yellow-400 text-xs bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-1 rounded-full">
            <WifiOff size={12}/>Sin conexión
          </div>
        )}

        {/* User dropdown */}
        <div className="relative">
          <button
            ref={buttonRef}
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className={cn(
              'flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-all duration-200 border',
              userMenuOpen
                ? 'bg-brand-500/15 text-brand-400 border-brand-500/30'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] border-transparent'
            )}
            title="Menú de usuario"
          >
            <div className="w-7 h-7 bg-brand-600/30 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-brand-400 text-xs font-semibold">
                {user?.name?.charAt(0)?.toUpperCase() ?? <User className="w-3.5 h-3.5" />}
              </span>
            </div>
            <span className="hidden sm:block text-xs font-medium max-w-[100px] truncate">
              {user?.name ?? 'Usuario'}
            </span>
            <ChevronDown className={cn('w-3 h-3 transition-transform duration-200', userMenuOpen && 'rotate-180')} />
          </button>

          {userMenuOpen && (
            <div
              ref={menuRef}
              className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-primary)] shadow-2xl shadow-black/30 z-50 overflow-hidden"
            >
              {/* User info header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-primary)]">
                <div className="w-9 h-9 bg-brand-600/30 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="text-brand-400 text-sm font-semibold">
                    {user?.name?.charAt(0)?.toUpperCase() ?? '?'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {user?.name ?? 'Cargando...'}
                  </p>
                  <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    {user ? classifyRole(user.role) : ''}
                  </p>
                </div>
              </div>

              {/* Logout */}
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors hover:bg-red-500/10 text-[var(--text-secondary)] hover:text-red-400"
              >
                <LogOut className="w-4 h-4 flex-shrink-0" />
                <span>Cerrar sesión</span>
              </button>
            </div>
          )}
        </div>

        <NotificationBell />
        <ThemeToggle compact />
      </div>
    </header>
  );
}