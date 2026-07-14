'use client';

import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/components/theme/ThemeProvider';
import { cn } from '@/lib/utils';

interface ThemeToggleProps {
  className?: string;
  /** Renders a full label next to the icon */
  showLabel?: boolean;
  /** Use a simpler layout (icon only, no border) */
  compact?: boolean;
}

export default function ThemeToggle({ className, showLabel = false, compact = false }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  if (compact) {
    return (
      <button
        onClick={toggleTheme}
        className={cn(
          'p-2 rounded-lg transition-all duration-200',
          isDark
            ? 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
          className,
        )}
        aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        title={isDark ? 'Modo claro' : 'Modo oscuro'}
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>
    );
  }

  return (
    <button
      onClick={toggleTheme}
      className={cn(
        'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group',
        isDark
          ? 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]',
        className,
      )}
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
    >
      {isDark ? (
        <Sun className="w-4 h-4 flex-shrink-0 text-[var(--text-tertiary)] group-hover:text-amber-400 transition-colors" />
      ) : (
        <Moon className="w-4 h-4 flex-shrink-0 text-[var(--text-tertiary)] group-hover:text-indigo-400 transition-colors" />
      )}
      {showLabel && <span>{isDark ? 'Modo claro' : 'Modo oscuro'}</span>}
    </button>
  );
}
