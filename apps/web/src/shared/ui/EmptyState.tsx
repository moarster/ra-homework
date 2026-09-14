/** Пустое состояние: объясняет, почему пусто, а не просто занимает место. */

import type { ReactNode } from 'react';
import { cx } from './cx.js';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        'flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center',
        className,
      )}
    >
      {icon !== undefined && <div className="text-fg-faint [&>svg]:size-8">{icon}</div>}
      <div className="text-[15px] font-medium text-fg">{title}</div>
      {description !== undefined && (
        <div className="max-w-96 text-[12px] leading-relaxed text-fg-muted">{description}</div>
      )}
      {action}
    </div>
  );
}
