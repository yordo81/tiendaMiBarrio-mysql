'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

interface Option {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Message shown when the filter yields no results */
  noResultsMessage?: string;
  /** Optional className override */
  className?: string;
  disabled?: boolean;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Buscar…',
  noResultsMessage = 'Sin resultados',
  className = '',
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  // inputValue updates immediately (for the text field)
  const [inputValue, setInputValue] = useState('');
  // debouncedFilter lags 300ms behind inputValue (for filtering the list)
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isProgrammaticChange = useRef(false);
  const closingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedOption = options.find(o => o.value === value);

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
    // Skip debounce for programmatic changes (e.g. openDropdown)
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
    const list = containerRef.current?.querySelector('#searchable-select-list');
    if (!list) return;
    const item = list.children[highlightIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, open, filtered.length]);

  const openDropdown = useCallback(() => {
    if (!disabled) {
      isProgrammaticChange.current = true;
      setOpen(true);
      setHighlightIndex(0);
      setDebouncedFilter(''); // Show all options immediately
      if (selectedOption) {
        setInputValue(selectedOption.label);
      }
    }
  }, [disabled, selectedOption]);

  const closeDropdown = useCallback(() => {
    if (!open || closing) return;
    setClosing(true);
    closingTimerRef.current = setTimeout(() => {
      setClosing(false);
      setOpen(false);
      // Allow closing again after timeout completes
    }, 150);
  }, [open, closing]);

  const selectOption = useCallback(
    (opt: Option) => {
      onChange(opt.value);
      closeDropdown();
      // No focus() — the dropdown is animating out
    },
    [onChange, closeDropdown]
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
        setDebouncedFilter(inputValue); // flush debounce for next open
        if (filtered[highlightIndex]) {
          selectOption(filtered[highlightIndex]);
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

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Hidden native select for form validity */}
      <select
        className="sr-only"
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-hidden="true"
        tabIndex={-1}
      >
        <option value="" />
        {options.map(o => (
          <option key={o.value} value={o.value} />
        ))}
      </select>

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className="input pr-9"
          placeholder={selectedOption ? selectedOption.label : placeholder}
          value={open ? inputValue : (selectedOption?.label ?? '')}
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
          aria-controls="searchable-select-list"
        />
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
          id="searchable-select-list"
          role="listbox"
          className={`absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] shadow-lg shadow-black/20 backdrop-blur-sm origin-top ${closing ? 'animate-slide-up' : 'animate-slide-down'}`}
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-[var(--text-tertiary)]">
              {noResultsMessage}
            </li>
          ) : (
            filtered.map((opt, i) => {
              const isSelected = opt.value === value;
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
                    selectOption(opt);
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate">{opt.label}</span>
                    {isSelected && (
                      <svg className="w-3.5 h-3.5 shrink-0 text-brand-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
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
