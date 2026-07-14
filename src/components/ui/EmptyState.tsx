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
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: 'var(--bg-muted)', border: '1px solid var(--border-secondary)' }}>
        <Icon className="w-6 h-6" style={{ color: 'var(--text-tertiary)' }} />
      </div>
      <h3 className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      {description && <p className="text-sm max-w-xs" style={{ color: 'var(--text-secondary)' }}>{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
