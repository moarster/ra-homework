/** Скелетон загрузки. Пульсация отключается при `prefers-reduced-motion` (правило в базовом слое). */

import { cx } from './cx.js';

export interface SkeletonProps {
  className?: string;
  /** Круглый скелетон: под иконки и точки. */
  circle?: boolean;
}

export function Skeleton({ className, circle = false }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'block animate-pulse bg-surface-active',
        circle ? 'rounded-full' : 'rounded-control',
        className,
      )}
    />
  );
}
