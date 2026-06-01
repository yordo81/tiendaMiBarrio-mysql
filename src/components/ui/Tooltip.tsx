'use client';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface InfoTooltipProps {
  children: React.ReactNode;
  content: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  iconClassName?: string;
}

export default function InfoTooltip({ children, content, side = 'top', className, iconClassName }: InfoTooltipProps) {
  const [show, setShow] = useState(false);

  const positionStyles: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrowStyles: Record<string, string> = {
    top: 'top-full left-1/2 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-[#1c2128]',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-l-[5px] border-r-[5px] border-b-[5px] border-l-transparent border-r-transparent border-b-[#1c2128]',
    left: 'left-full top-1/2 -translate-y-1/2 border-t-[5px] border-b-[5px] border-l-[5px] border-t-transparent border-b-transparent border-l-[#1c2128]',
    right: 'right-full top-1/2 -translate-y-1/2 border-t-[5px] border-b-[5px] border-r-[5px] border-t-transparent border-b-transparent border-r-[#1c2128]',
  };

  return (
    <span
      className={cn('relative inline-flex items-center', className)}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      <svg
        className={cn('ml-1 shrink-0 text-[#6e7681] hover:text-[#8b949e] transition-colors cursor-help', iconClassName ?? 'w-3.5 h-3.5')}
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Z" />
        <path d="M7.25 11.5v-4a.75.75 0 0 1 1.5 0v4a.75.75 0 0 1-1.5 0ZM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
      </svg>
      {show && (
        <span className={cn(
          'absolute z-50 pointer-events-none',
          positionStyles[side]
        )}>
          <span className="block bg-[#1c2128] border border-[#30363d] rounded-lg px-3 py-2 text-xs text-[#e6edf3] shadow-xl whitespace-normal max-w-[260px] leading-relaxed font-normal">
            {content}
          </span>
          <span className={cn('absolute w-0 h-0', arrowStyles[side])} />
        </span>
      )}
    </span>
  );
}
