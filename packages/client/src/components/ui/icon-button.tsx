import { useState, type ButtonHTMLAttributes } from 'react';
import { Tooltip } from './tooltip.js';

export function IconButton({
  label,
  active = false,
  pressed = false,
  className = '',
  children,
  ...rest
}: {
  label: string;
  active?: boolean;
  pressed?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const classes = [
    'icon-button',
    active ? 'is-active' : '',
    pressed ? 'is-pressed' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <>
      <button
        type="button"
        className={classes}
        aria-label={label}
        data-tooltip={label}
        ref={setAnchor}
        onMouseEnter={(event) => setAnchor(event.currentTarget)}
        onMouseLeave={() => setAnchor(null)}
        onFocus={(event) => setAnchor(event.currentTarget)}
        onBlur={() => setAnchor(null)}
        {...rest}
      >
        {children}
      </button>
      <Tooltip label={label} anchor={anchor} />
    </>
  );
}
