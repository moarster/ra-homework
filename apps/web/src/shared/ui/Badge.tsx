/** Светофорный бейдж: один и тот же во всем интерфейсе. */

import { SEVERITY, type Severity } from '@ra/contracts';
import type { ReactNode } from 'react';
import { cx } from './cx.js';
import { severityClasses } from './severity.js';

export interface BadgeProps {
  severity?: Severity;
  /** Точка-индикатор слева. */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

export function Badge({ severity = SEVERITY.OK, dot = true, className, children }: BadgeProps) {
  const classes = severityClasses(severity);
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[11px] font-medium',
        classes.surface,
        classes.text,
        className,
      )}
    >
      {dot && <span aria-hidden="true" className={cx('size-1.5 rounded-full', classes.solid)} />}
      {children}
    </span>
  );
}
