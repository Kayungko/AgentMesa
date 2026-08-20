import type { ButtonHTMLAttributes } from 'react';

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
  const classes = [
    'icon-button',
    active ? 'is-active' : '',
    pressed ? 'is-pressed' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} aria-label={label} data-tooltip={label} {...rest}>
      {children}
    </button>
  );
}
