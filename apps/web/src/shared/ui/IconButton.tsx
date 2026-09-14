/** Квадратная кнопка с одной иконкой. Подпись обязательна: она же доступное имя. */

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx.js';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Доступное имя и текст всплывашки. */
  label: string;
  icon: ReactNode;
  active?: boolean;
  size?: 'sm' | 'md';
}

export function IconButton({
  label,
  icon,
  active = false,
  size = 'sm',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        'inline-flex items-center justify-center rounded-control border cursor-pointer',
        'text-fg-muted hover:text-fg hover:bg-surface-hover disabled:opacity-45',
        size === 'sm' ? 'size-7' : 'size-9',
        active ? 'bg-primary-soft text-primary-text border-primary/40' : 'border-transparent',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
