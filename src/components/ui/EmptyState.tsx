import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#21262d] border border-[#30363d] flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-[#6e7681]" />
      </div>
      <h3 className="text-[#e6edf3] font-medium mb-1">{title}</h3>
      {description && <p className="text-[#8b949e] text-sm max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
