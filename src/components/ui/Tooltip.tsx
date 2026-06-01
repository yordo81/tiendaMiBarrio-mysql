'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
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
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 8;

    switch (side) {
      case 'top':
        setCoords({ top: rect.top - gap, left: rect.left + rect.width / 2 });
        break;
      case 'bottom':
        setCoords({ top: rect.bottom + gap, left: rect.left + rect.width / 2 });
        break;
      case 'left':
        setCoords({ top: rect.top + rect.height / 2, left: rect.left - gap });
        break;
      case 'right':
        setCoords({ top: rect.top + rect.height / 2, left: rect.right + gap });
        break;
    }
  }, [side]);

  const handleMouseEnter = useCallback(() => {
    updatePosition();
    setShow(true);
  }, [updatePosition]);

  const handleMouseLeave = useCallback(() => setShow(false), []);

  // Hide tooltip on scroll / resize to avoid stale positioning
  useEffect(() => {
    if (!show) return;
    const hide = () => setShow(false);
    window.addEventListener('scroll', hide, { capture: true });
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, { capture: true });
      window.removeEventListener('resize', hide);
    };
  }, [show]);

  const transformMap: Record<string, string> = {
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left: 'translate(-100%, -50%)',
    right: 'translate(0, -50%)',
  };

  const arrowStyles: Record<string, string> = {
    top: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-full border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-[#1c2128]',
    bottom: 'top-0 left-1/2 -translate-x-1/2 -translate-y-full border-l-[5px] border-r-[5px] border-b-[5px] border-l-transparent border-r-transparent border-b-[#1c2128]',
    left: 'top-1/2 right-0 -translate-y-1/2 translate-x-full border-t-[5px] border-b-[5px] border-l-[5px] border-t-transparent border-b-transparent border-l-[#1c2128]',
    right: 'top-1/2 left-0 -translate-y-1/2 -translate-x-full border-t-[5px] border-b-[5px] border-r-[5px] border-t-transparent border-b-transparent border-r-[#1c2128]',
  };

  return (
    <span
      ref={triggerRef}
      className={cn('relative inline-flex items-center', className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
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
        <span
          className="fixed z-50 pointer-events-none"
          style={{ top: coords.top, left: coords.left, transform: transformMap[side] }}
        >
          <span className="block bg-[#1c2128] border border-[#30363d] rounded-lg px-3 py-2 text-xs text-[#e6edf3] shadow-xl whitespace-normal max-w-[260px] leading-relaxed font-normal">
            {content}
          </span>
          <span className={cn('absolute w-0 h-0', arrowStyles[side])} />
        </span>
      )}
    </span>
  );
}
