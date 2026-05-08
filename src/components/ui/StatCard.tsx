import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  loading?: boolean;
}

const variants = {
  default: 'text-brand-400 bg-brand-500/10 border-brand-500/20',
  success: 'text-green-400 bg-green-500/10 border-green-500/20',
  warning: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  danger:  'text-red-400 bg-red-500/10 border-red-500/20',
  info:    'text-blue-400 bg-blue-500/10 border-blue-500/20',
};

export default function StatCard({ title, value, subtitle, icon: Icon, trend, variant = 'default' }: StatCardProps) {
  return (
    <div className="card p-5 hover:border-[#30363d] transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center border', variants[variant])}>
          <Icon className="w-4 h-4" />
        </div>
        {trend && (
          <span className={cn(
            'text-xs font-medium px-2 py-0.5 rounded-full',
            trend.value >= 0 ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'
          )}>
            {trend.value >= 0 ? '↑' : '↓'} {Math.abs(trend.value)}%
          </span>
        )}
      </div>
      <p className="text-2xl font-semibold text-[#e6edf3] mb-0.5">{value}</p>
      <p className="text-sm text-[#8b949e]">{title}</p>
      {subtitle && <p className="text-xs text-[#6e7681] mt-1">{subtitle}</p>}
    </div>
  );
}
// loading state handled by parent - prop accepted but not used for skeleton
// (skeleton display is optional in this compact version)
