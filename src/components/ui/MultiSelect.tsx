'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

interface Option {
  value: string;
  label: string;
  sublabel?: string;
}

interface MultiSelectProps {
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  noResultsMessage?: string;
  className?: string;
  disabled?: boolean;
  maxDisplay?: number; // Máximo de tags visibles antes de mostrar "+N"
}

export default function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Seleccionar…',
  noResultsMessage = 'Sin resultados',
  className = '',
  disabled = false,
  maxDisplay = 3,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isProgrammaticChange = useRef(false);
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When actually closed (not in closing animation), reset values
  useEffect(() => {
    if (!open && !closing) {
      setInputValue('');
      setDebouncedFilter('');
    }
  }, [open, closing]);

  // Cleanup closing timer on unmount
  useEffect(() => {
    return () => {
      if (closingTimerRef.current) clearTimeout(closingTimerRef.current);
    };
  }, []);

  // Debounce: update debouncedFilter 300ms after inputValue stops changing
  useEffect(() => {
    if (isProgrammaticChange.current) {
      isProgrammaticChange.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedFilter(inputValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const filtered = debouncedFilter.trim()
    ? options.filter(o =>
        o.label.toLowerCase().includes(debouncedFilter.toLowerCase()) ||
        (o.sublabel && o.sublabel.toLowerCase().includes(debouncedFilter.toLowerCase()))
      )
    : options;

  // Recalculate highlight index when filtered list shrinks
  useEffect(() => {
    setHighlightIndex(prev => Math.min(prev, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || filtered.length === 0) return;
    const list = containerRef.current?.querySelector('#multiselect-list');
    if (!list) return;
    const item = list.children[highlightIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, open, filtered.length]);

  const openDropdown = useCallback(() => {
    if (!disabled) {
      isProgrammaticChange.current = true;
      setOpen(true);
      setHighlightIndex(0);
      setDebouncedFilter('');
      setInputValue('');
    }
  }, [disabled]);

  const closeDropdown = useCallback(() => {
    if (!open || closing) return;
    setClosing(true);
    closingTimerRef.current = setTimeout(() => {
      setClosing(false);
      setOpen(false);
    }, 150);
  }, [open, closing]);

  const toggleOption = useCallback(
    (opt: Option) => {
      const isSelected = value.includes(opt.value);
      if (isSelected) {
        onChange(value.filter(v => v !== opt.value));
      } else {
        onChange([...value, opt.value]);
      }
    },
    [value, onChange]
  );

  const removeOption = useCallback(
    (optValue: string) => {
      onChange(value.filter(v => v !== optValue));
    },
    [value, onChange]
  );

  // Auto-select input text when dropdown opens
  useEffect(() => {
    if (open) {
      inputRef.current?.select();
    }
  }, [open]);

  // Click outside → close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, closeDropdown]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        openDropdown();
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex(i => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        setDebouncedFilter(inputValue);
        if (filtered[highlightIndex]) {
          toggleOption(filtered[highlightIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        closeDropdown();
        break;
      case 'Tab':
        closeDropdown();
        break;
    }
  };

  const selectedOptions = options.filter(o => value.includes(o.value));
  const visibleTags = selectedOptions.slice(0, maxDisplay);
  const hiddenCount = selectedOptions.length - maxDisplay;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        {/* Tags + input */}
        <div
          className={`input min-h-[42px] py-1.5 pr-9 flex flex-wrap items-center gap-1.5 cursor-pointer ${
            open ? 'ring-2 ring-brand-500/50 border-brand-500/50' : ''
          }`}
          onClick={() => (open || closing ? closeDropdown() : openDropdown())}
        >
          {selectedOptions.length === 0 && !open && (
            <span className="text-sm text-[var(--text-tertiary)]">{placeholder}</span>
          )}
          {visibleTags.map(opt => (
            <span
              key={opt.value}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand-600/20 text-brand-400 text-xs font-medium"
            >
              {opt.label}
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  removeOption(opt.value);
                }}
                className="hover:text-brand-300 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {hiddenCount > 0 && (
            <span className="text-xs text-[var(--text-tertiary)]">
              +{hiddenCount} más
            </span>
          )}
          <input
            ref={inputRef}
            type="text"
            className="flex-1 min-w-[60px] bg-transparent border-none outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
            placeholder={selectedOptions.length > 0 ? '' : placeholder}
            value={open ? inputValue : ''}
            onChange={e => {
              if (!open) setOpen(true);
              setInputValue(e.target.value);
              setHighlightIndex(0);
            }}
            onFocus={() => openDropdown()}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            aria-controls="multiselect-list"
          />
        </div>
        {/* Chevron */}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => (open || closing ? closeDropdown() : openDropdown())}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          aria-hidden="true"
        >
          <svg
            className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Dropdown */}
      {(open || closing) && (
        <ul
          id="multiselect-list"
          role="listbox"
          aria-multiselectable="true"
          className={`absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-lg shadow-black/20 backdrop-blur-sm origin-top ${
            closing ? 'animate-slide-up' : 'animate-slide-down'
          }`}
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-[var(--text-tertiary)]">
              {noResultsMessage}
            </li>
          ) : (
            filtered.map((opt, i) => {
              const isSelected = value.includes(opt.value);
              const isHighlighted = i === highlightIndex;
              return (
                <li
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  className={`
                    flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer text-sm
                    transition-colors border-b border-[var(--border-primary)] last:border-0
                    ${isHighlighted ? 'bg-[var(--bg-muted)]' : ''}
                    ${isSelected ? 'text-brand-400' : 'text-[var(--text-primary)]'}
                    hover:bg-[var(--bg-muted)]
                  `}
                  onMouseEnter={() => setHighlightIndex(i)}
                  onMouseDown={e => {
                    e.preventDefault();
                    toggleOption(opt);
                  }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Checkbox */}
                    <span
                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-brand-500 border-brand-500 text-white'
                          : 'border-[var(--border-secondary)]'
                      }`}
                    >
                      {isSelected && (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </span>
                    <span className="truncate">{opt.label}</span>
                  </div>
                  {opt.sublabel && (
                    <span className="text-xs text-[var(--text-tertiary)] shrink-0 whitespace-nowrap">
                      {opt.sublabel}
                    </span>
                  )}
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
