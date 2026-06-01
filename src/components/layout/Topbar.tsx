'use client';
import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/use-online';
const titles: Record<string,string> = { '/dashboard':'Dashboard','/dashboard/inventario':'Inventario','/dashboard/ventas':'Ventas','/dashboard/clientes':'Clientes','/dashboard/proveedores':'Proveedores','/dashboard/gastos':'Gastos','/dashboard/reportes':'Reportes','/dashboard/usuarios':'Usuarios','/dashboard/almacenes':'Almacenes' };
export default function Topbar() {
  const pathname = usePathname();
  const isOnline = useOnlineStatus();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return (
    <header className="h-14 border-b border-[#21262d] bg-[#0d1117]/80 backdrop-blur-sm flex items-center justify-between px-5 sticky top-0 z-20">
      <h1 className="font-display text-base font-semibold text-[#e6edf3]">{titles[pathname] ?? 'TiendaMiBarrio'}</h1>
      {mounted && !isOnline && <div className="flex items-center gap-1.5 text-yellow-400 text-xs bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-1 rounded-full"><WifiOff size={12}/>Sin conexión</div>}
    </header>
  );
}