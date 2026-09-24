'use client';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  /** Tamaño compacto para espacios reducidos */
  size?: 'sm' | 'md';
}

// ── Interruptor (switch) accesible ───────────────────────────────
// Reemplaza a los checkboxes en opciones de sí/no (ej. "Cobrar sin
// decimales", "Cobrar en varias monedas").
export default function Toggle({ checked, onChange, label, disabled = false, size = 'md' }: ToggleProps) {
  const track = size === 'sm' ? 'w-9 h-5' : 'w-11 h-6';
  const knob = size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5';
  const shift = size === 'sm' ? (checked ? 'translate-x-4' : 'translate-x-0.5') : (checked ? 'translate-x-[22px]' : 'translate-x-0.5');

  return (
    <label className={`inline-flex items-center gap-2.5 select-none ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          'relative inline-flex flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
          track,
          checked ? 'bg-brand-600' : 'bg-[var(--bg-muted)] border border-[var(--border-secondary)]'
        )}
      >
        <span
          className={cn(
            'inline-block transform rounded-full bg-white shadow transition-transform',
            knob,
            shift
          )}
        />
      </button>
      {label && <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>}
    </label>
  );
}

// clsx mínimo local para no añadir dependencias
function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
