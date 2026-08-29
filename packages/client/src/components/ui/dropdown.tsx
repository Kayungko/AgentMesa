import { useEffect, useRef, useState, useLayoutEffect, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Dropdown — a token-faithful replacement for native <select>.
 *
 * Native <select> renders its option list via the OS/browser, so the popup
 * can't inherit the design tokens (font, palette, radius, dark theme). This
 * component renders the trigger as a token-styled button and the options as a
 * portal (`position: fixed` → document.body, top-tier z-index) so the popup
 * matches every token and escapes every ancestor stacking context — the same
 * approach as tooltip.tsx. The popup also flips above the trigger when it
 * would overflow the viewport bottom, and clamps to the viewport edges.
 */

const DROPDOWN_Z = 90; // above toast (60), workspace menu (30), modal (20)
const MAX_MENU_HEIGHT = 260; // matches .dropdown__menu max-height

export interface DropdownOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  hint?: ReactNode;
  /** The status class (e.g. status--running) applied to the option row + trigger. */
  kind?: string;
  /** Run instead of onChange when the option is chosen (e.g. a meta action). */
  onSelect?: () => void;
}

export function Dropdown({
  options,
  value,
  onChange,
  ariaLabel,
  className = '',
  placeholder,
  emptyLabel = '—',
  statusClass = '',
  fullWidth = false,
}: {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  placeholder?: string;
  emptyLabel?: string;
  /** Optional status class on the trigger (e.g. status--running) for color coding. */
  statusClass?: string;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selected = options.find((option) => option.value === value);
  const label = selected ? selected.label : (placeholder ?? emptyLabel);

  const place = () => {
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    setActiveIndex(-1);
    const rect = anchor.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 4;
    // Flip above the trigger when there's not enough room below.
    const below = rect.bottom + gap;
    const fitsBelow = below + menuHeight <= vh;
    const top = fitsBelow ? below : Math.max(gap, rect.top - gap - menuHeight);
    const left = Math.max(gap, Math.min(rect.left, vw - menu.offsetWidth - gap));
    setPos({ top, left, width: rect.width });
  };

  // Measured after paint so the menu has its real height for viewport fitting.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    const onMenuReady = () => requestAnimationFrame(place);
    onMenuReady();
    window.addEventListener('resize', onMenuReady);
    window.addEventListener('scroll', onMenuReady, true);
    return () => {
      window.removeEventListener('resize', onMenuReady);
      window.removeEventListener('scroll', onMenuReady, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anchor, options, statusClass]);

  // Keep the keyboard-highlighted option scrolled into view.
  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(`dropdown-opt-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  // Close on outside click / Escape; support arrow-key navigation while open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        anchor?.focus();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const len = options.length;
        if (len === 0) return;
        let next = activeIndex;
        if (activeIndex === -1) next = event.key === 'ArrowDown' ? 0 : len - 1;
        else {
          let candidate = activeIndex + (event.key === 'ArrowDown' ? 1 : -1);
          // Skip disabled options.
          for (let guard = 0; guard < len; guard++) {
            if (candidate < 0) candidate = len - 1;
            else if (candidate >= len) candidate = 0;
            if (!options[candidate]?.disabled) break;
            candidate += event.key === 'ArrowDown' ? 1 : -1;
          }
          next = candidate;
        }
        setActiveIndex(next);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        const option = options[activeIndex];
        if (option && activeIndex >= 0 && !option.disabled) {
          event.preventDefault();
          choose(option);
        }
        return;
      }
      if (event.key === 'Tab') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIndex, options, anchor]);

  const choose = (option: DropdownOption) => {
    setOpen(false);
    if (option.onSelect) option.onSelect();
    else if (option.value !== value) onChange(option.value);
  };

  const menuStyle: CSSProperties | undefined = pos
    ? { top: pos.top, left: pos.left, width: pos.width, maxHeight: MAX_MENU_HEIGHT, zIndex: DROPDOWN_Z }
    : undefined;

  return (
    <div ref={rootRef} className={`dropdown ${fullWidth ? 'dropdown--full' : ''}`}>
      <button
        type="button"
        className={`dropdown__trigger ${statusClass}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={ariaLabel}
        ref={setAnchor}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="dropdown__value">{label}</span>
        <span className="dropdown__caret" aria-hidden="true">▾</span>
      </button>

      {open && menuStyle ? (
        createPortal(
          <div
            ref={menuRef}
            className="dropdown__menu"
            role="listbox"
            aria-activedescendant={activeIndex >= 0 ? `dropdown-opt-${activeIndex}` : undefined}
            style={menuStyle}
          >
            {options.map((option, index) => (
              <button
                key={`${option.value}-${index}`}
                id={`dropdown-opt-${index}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled}
                tabIndex={-1}
                className={`dropdown__option ${option.kind ?? ''} ${option.value === value ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`}
                disabled={option.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span className="dropdown__option-label">{option.label}</span>
                {option.hint ? <span className="dropdown__option-hint">{option.hint}</span> : null}
              </button>
            ))}
          </div>,
          document.body,
        )
      ) : null}
    </div>
  );
}
