'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const PAGE_SIZE_OPTIONS = [10, 30, 50] as const;

export default function Pagination({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  // Don't show pagination if total items <= 10
  if (totalItems <= 10) return null;

  const totalPages = pageSize === 0 ? 1 : Math.ceil(totalItems / pageSize);
  const showingAll = pageSize === 0;
  const from = showingAll ? 1 : (currentPage - 1) * pageSize + 1;
  const to = showingAll ? totalItems : Math.min(currentPage * pageSize, totalItems);

  function goTo(page: number) {
    onPageChange(Math.max(1, Math.min(page, totalPages)));
  }

  // Generate page numbers to display
  const getPages = (): (number | '...')[] => {
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }
    pages.push(1);
    if (currentPage > 3) pages.push('...');
    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('...');
    pages.push(totalPages);
    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--border-primary)' }}>
      {/* Info */}
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        Mostrando <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{totalItems > 0 ? `${from}–${to}` : '0'}</span> de{' '}
        <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{totalItems}</span>
      </p>

      {/* Page size selector */}
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        <span>Filas por página:</span>
        <div className="flex gap-1">
          {PAGE_SIZE_OPTIONS.map(size => (
            <button
              key={size}
              onClick={() => { onPageSizeChange(size); onPageChange(1); }}
              className={cn(
                'px-2 py-1 rounded-md text-xs font-medium transition-colors',
                pageSize === size
                  ? 'bg-brand-600/20 text-brand-400 border border-brand-600/30'
                  : 'border border-transparent hover:bg-[var(--bg-muted)]'
              )}
              style={pageSize !== size ? { color: 'var(--text-secondary)' } : undefined}
            >
              {size}
            </button>
          ))}
          <button
            onClick={() => { onPageSizeChange(0); onPageChange(1); }}
            className={cn(
              'px-2 py-1 rounded-md text-xs font-medium transition-colors',
              pageSize === 0
                ? 'bg-brand-600/20 text-brand-400 border border-brand-600/30'
                : 'border border-transparent hover:bg-[var(--bg-muted)]'
            )}
            style={pageSize !== 0 ? { color: 'var(--text-secondary)' } : undefined}
          >
            Todos
          </button>
        </div>
      </div>

      {/* Page navigation */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => goTo(currentPage - 1)}
            disabled={currentPage <= 1}
            className="p-1.5 rounded-md disabled:opacity-30 disabled:cursor-not-allowed transition-colors hover:bg-[var(--bg-muted)]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          {getPages().map((p, i) =>
            p === '...' ? (
              <span key={`ellipsis-${i}`} className="px-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>···</span>
            ) : (
              <button
                key={p}
                onClick={() => goTo(p)}
                className={cn(
                  'min-w-[28px] h-7 rounded-md text-xs font-medium transition-colors',
                  p === currentPage
                    ? 'bg-brand-600 text-white'
                    : 'hover:bg-[var(--bg-muted)]'
                )}
                style={p !== currentPage ? { color: 'var(--text-secondary)' } : undefined}
              >
                {p}
              </button>
            )
          )}
          <button
            onClick={() => goTo(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="p-1.5 rounded-md disabled:opacity-30 disabled:cursor-not-allowed transition-colors hover:bg-[var(--bg-muted)]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
