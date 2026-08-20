import type { ButtonHTMLAttributes } from 'react';

export function Button({
  variant = 'ghost',
  small = false,
  className = '',
  children,
  ...rest
}: {
  variant?: 'primary' | 'ghost' | 'danger';
  small?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const classes = [
    'button',
    `button--${variant}`,
    small ? 'button--sm' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  );
}
