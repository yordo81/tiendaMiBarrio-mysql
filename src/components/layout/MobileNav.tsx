'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Package, ShoppingCart, Warehouse, BarChart2, MoveHorizontal, ShoppingBag, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
const nav = [
  { href: '/dashboard',            label: 'Inicio',     icon: LayoutDashboard },
  { href: '/dashboard/inventario', label: 'Inventario', icon: Package },
  { href: '/dashboard/movimientos',label: 'Movimientos',icon: MoveHorizontal },
  { href: '/dashboard/compras',    label: 'Compras',    icon: ShoppingBag },
  { href: '/dashboard/almacenes',  label: 'Almacenes',  icon: Warehouse },
  { href: '/dashboard/ventas',     label: 'Ventas',     icon: ShoppingCart },
  { href: '/dashboard/reportes',   label: 'Reportes',   icon: BarChart2 },
  { href: '/dashboard/auditoria',label: 'Auditoría', icon: Shield },
];
export default function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#161b22] border-t border-[#21262d]">
      <ul className="flex">
        {nav.map(item => { const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href)); return (
          <li key={item.href} className="flex-1">
            <Link href={item.href} className={cn('flex flex-col items-center gap-1 py-3 text-[10px] transition-colors', active ? 'text-brand-400' : 'text-[#6e7681]')}>
              <item.icon size={20}/>{item.label}
            </Link>
          </li>
        );})}
      </ul>
    </nav>
  );
}
