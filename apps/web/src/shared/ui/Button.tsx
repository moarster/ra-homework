/** Кнопка. Вариант задает смысл, а не цвет: цвета приходят из токенов. */

import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './cx.js';

export type ButtonVariant = 'primary' | 'accent' | 'ghost' | 'outline';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Кнопка в нажатом (активном) состоянии: для переключателей. */
  active?: boolean;
  /** В React 19 ref передается обычным пропом - он нужен кнопкам-якорям поповеров. */
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg border border-transparent hover:bg-primary-600',
  accent: 'bg-accent text-accent-fg border border-transparent hover:bg-accent-600',
  ghost: 'bg-transparent text-fg border border-transparent hover:bg-surface-hover',
  outline: 'bg-surface-weak text-fg border border-border-base hover:bg-surface-hover',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5',
  md: 'h-9 px-3.5 text-[13px] gap-2',
};

export function Button({
  variant = 'outline',
  size = 'sm',
  active = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center rounded-control font-medium whitespace-nowrap',
        'cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        active && 'bg-primary-soft text-primary-text border-primary/40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
