'use client';
import { useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

// Simple global toast store
const listeners: Array<(toasts: Toast[]) => void> = [];
let toasts: Toast[] = [];

function notify(listeners: Array<(t: Toast[]) => void>, t: Toast[]) {
  listeners.forEach((l) => l([...t]));
}

export const toast = {
  show(message: string, type: ToastType = 'info', duration = 4000) {
    const id = crypto.randomUUID();
    toasts = [...toasts, { id, message, type, duration }];
    notify(listeners, toasts);
    if (duration > 0) {
      setTimeout(() => toast.dismiss(id), duration);
    }
  },
  success: (msg: string) => toast.show(msg, 'success'),
  error: (msg: string) => toast.show(msg, 'error'),
  info: (msg: string) => toast.show(msg, 'info'),
  warning: (msg: string) => toast.show(msg, 'warning'),
  dismiss(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
    notify(listeners, toasts);
  },
};

const icons = {
  success: <CheckCircle size={16} className="text-green-400" />,
  error: <AlertCircle size={16} className="text-red-400" />,
  info: <Info size={16} className="text-blue-400" />,
  warning: <AlertTriangle size={16} className="text-yellow-400" />,
};

const styles: Record<ToastType, string> = {
  success: 'border-green-500/30 bg-green-500/10',
  error: 'border-red-500/30 bg-red-500/10',
  info: 'border-blue-500/30 bg-blue-500/10',
  warning: 'border-yellow-500/30 bg-yellow-500/10',
};

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    listeners.push(setItems);
    return () => {
      const idx = listeners.indexOf(setItems);
      if (idx > -1) listeners.splice(idx, 1);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            'flex items-start gap-3 p-3 rounded-xl border backdrop-blur-sm',
            'shadow-lg pointer-events-auto animate-in slide-in-from-right-5 duration-200',
            styles[t.type as ToastType]
          )}
        >
          <span className="mt-0.5 shrink-0">{icons[t.type as ToastType]}</span>
          <p className="text-sm text-[#e6edf3] flex-1 leading-snug">{t.message}</p>
          <button
            onClick={() => toast.dismiss(t.id)}
            className="shrink-0 text-[#6e7681] hover:text-[#e6edf3] transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
