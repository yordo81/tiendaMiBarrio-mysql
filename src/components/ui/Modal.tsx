'use client';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizes = {
  sm: 'w-full sm:max-w-sm',
  md: 'w-full sm:max-w-md',
  lg: 'w-full sm:max-w-lg lg:max-w-xl',
  xl: 'w-full sm:max-w-xl lg:max-w-3xl',
};

export default function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 lg:p-6">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      {/* Panel */}
      <div className={cn(
        'relative w-full bg-[#161b22] border border-[#21262d] shadow-2xl z-10',
        'rounded-t-2xl md:rounded-2xl',
        sizes[size],
        'max-h-[90vh] flex flex-col'
      )}>
        <div className="flex items-center justify-between px-4 py-3 sm:px-5 sm:py-4 border-b border-[#21262d] flex-shrink-0">
          <h2 className="font-semibold text-[#e6edf3] text-base">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#6e7681] hover:text-[#e6edf3] hover:bg-[#21262d] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}
