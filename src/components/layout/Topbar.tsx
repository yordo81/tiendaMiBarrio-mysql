'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { WifiOff, LogOut, ChevronDown, User, Clock3 } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/use-online';
import { useAuthStore } from '@/lib/stores/auth-store';
import { useSettingsStore, useWorkMode } from '@/lib/stores/settings-store';
import { classifyRole, cn, formatCurrency, formatDateTime } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { SHIFT_CHANGED_EVENT, SHIFT_SUMMARY_CHANGED_EVENT } from '@/lib/shift-events';
import ThemeToggle from '@/components/ui/ThemeToggle';
import NotificationBell from '@/components/notifications/NotificationBell';
import OpenShiftModal from '@/components/shifts/OpenShiftModal';

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

  // Indicador de turno abierto (solo en modo por turnos)
  const workMode = useWorkMode();
  const isManager = user?.role === 'owner' || user?.role === 'admin';
  const isSellingRole = isManager || user?.role === 'seller';
  const [openShifts, setOpenShifts] = useState<Record<string, unknown>[]>([]);
  const [posList, setPosList] = useState<Record<string, unknown>[]>([]);
  const [shiftsLoaded, setShiftsLoaded] = useState(false);
  const shiftsFetching = useRef(false);
  // Modal de apertura directa desde el Topbar
  const [showOpenShift, setShowOpenShift] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  // Cargar la configuración del negocio para mostrar su nombre en el título
  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Turno abierto: se actualiza al instante cuando cambia un turno
  // (SHIFT_CHANGED_EVENT), cuando cambia la data del resumen en vivo
  // (SHIFT_SUMMARY_CHANGED_EVENT: venta, abono, gasto, caja) y cada 30s
  // como respaldo (cambios desde otra pestaña o por el reloj del servidor).
  const refreshShifts = useCallback(() => {
    if (workMode !== 'shifts') { setShiftsLoaded(true); setOpenShifts([]); setPosList([]); return; }
    // Evita fetchs superpuestos (intervalo + evento): el que está en curso
    // ya trae los datos más recientes al resolverse.
    if (shiftsFetching.current) return;
    shiftsFetching.current = true;
    api.getShifts()
      .then(d => {
        setOpenShifts((d.open ?? []) as Record<string, unknown>[]);
        setPosList((d.pos ?? []) as Record<string, unknown>[]);
        setShiftsLoaded(true);
      })
      .catch(() => setShiftsLoaded(true))
      .finally(() => { shiftsFetching.current = false; });
  }, [workMode, user?.id]);

  useEffect(() => {
    refreshShifts();
    const id = setInterval(refreshShifts, 30_000);
    const onShiftChanged = () => refreshShifts();
    const onSummaryChanged = () => refreshShifts();
    window.addEventListener(SHIFT_CHANGED_EVENT, onShiftChanged);
    window.addEventListener(SHIFT_SUMMARY_CHANGED_EVENT, onSummaryChanged);
    return () => {
      clearInterval(id);
      window.removeEventListener(SHIFT_CHANGED_EVENT, onShiftChanged);
      window.removeEventListener(SHIFT_SUMMARY_CHANGED_EVENT, onSummaryChanged);
    };
  }, [refreshShifts]);

  const myOpenShift = openShifts.find(s => String(s.user_id) === user?.id) ?? null;
  const openShiftCount = openShifts.length;
  const openPosIds = new Set(openShifts.map(s => String(s.pos_id)));
  const freeCajas = posList.filter(p => !openPosIds.has(String(p.id)));

  // Acumulado en vivo del turno propio (lo adjunta el GET /api/shifts)
  const myShiftSummary = (myOpenShift?.summary ?? null) as { total_sales: number; total_cash: number; expected_cash: number } | null;
  const shiftPillTitle = `Turno abierto en ${String(myOpenShift?.pos_name ?? 'la caja')}${myOpenShift?.opened_at ? ` desde ${formatDateTime(String(myOpenShift.opened_at))}` : ''}${myShiftSummary ? ` · Ventas ${formatCurrency(myShiftSummary.total_sales)} · Efectivo ${formatCurrency(myShiftSummary.total_cash)} · Esperado ${formatCurrency(myShiftSummary.expected_cash)}` : ''}`;
  const shiftPillContent = (
    <>
      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
      <span className="flex flex-col min-w-0 leading-tight">
        <span className="truncate max-w-[150px]">Turno: {String(myOpenShift?.pos_name ?? 'Caja')}</span>
        {myShiftSummary && (
          <span className="text-[10px] font-normal text-green-400/90 truncate max-w-[180px]">
            Ventas {formatCurrency(myShiftSummary.total_sales)} · Ef. {formatCurrency(myShiftSummary.total_cash)} · Esp. {formatCurrency(myShiftSummary.expected_cash)}
          </span>
        )}
      </span>
    </>
  );

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
    <>
    <header className="h-14 border-b backdrop-blur-sm flex items-center justify-between px-5 sticky top-0 z-20" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'color-mix(in srgb, var(--bg-primary) 80%, transparent)' }}>
      <h1 className="font-display text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{titles[pathname] ?? settings?.business_name ?? 'TiendaMiBarrio'}</h1>
      <div className="flex items-center gap-2">
        {/* Indicador de turno abierto (solo en modo por turnos) */}
        {mounted && workMode === 'shifts' && isSellingRole && (
          myOpenShift ? (
            isManager ? (
              <Link
                href="/dashboard/turnos"
                className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2.5 py-1.5 rounded-full hover:bg-green-500/15 transition-colors"
                title={shiftPillTitle}
              >
                {shiftPillContent}
              </Link>
            ) : (
              <span
                className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2.5 py-1.5 rounded-full"
                title={shiftPillTitle}
              >
                {shiftPillContent}
              </span>
            )
          ) : shiftsLoaded && openShiftCount === 0 ? (
            <button
              onClick={() => setShowOpenShift(true)}
              className="flex items-center gap-1.5 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-1 rounded-full hover:bg-yellow-500/15 transition-colors"
              title="No hay turnos abiertos — pulsa para abrir un turno"
            >
              <Clock3 size={12} />
              Sin turno
            </button>
          ) : shiftsLoaded ? (
            freeCajas.length > 0 ? (
            <button
              onClick={() => setShowOpenShift(true)}
                className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] bg-[var(--bg-muted)] border border-[var(--border-secondary)] px-2.5 py-1 rounded-full hover:bg-[var(--bg-hover)] transition-colors"
                title="Hay turnos abiertos en otras cajas — pulsa para abrir otro"
              >
                <Clock3 size={12} />
                {openShiftCount} turno(s) abierto(s)
              </button>
            ) : (
              <span
                className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] bg-[var(--bg-muted)] border border-[var(--border-secondary)] px-2.5 py-1 rounded-full"
                title="Todas las cajas tienen un turno abierto"
              >
                <Clock3 size={12} />
                {openShiftCount} turno(s) abierto(s)
              </span>
            )
          ) : null
        )}

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

    {/* Modal: Abrir turno (fuera del header: su backdrop-filter es containing block para fixed) */}
    <OpenShiftModal
      open={showOpenShift}
      pos={posList}
      openPosIds={openPosIds}
      onClose={() => setShowOpenShift(false)}
      onOpened={refreshShifts}
    />
    </>
  );
}