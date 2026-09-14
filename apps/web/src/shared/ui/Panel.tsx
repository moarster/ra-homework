/** Стеклянная поверхность - базовый слой всего интерфейса. */

import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './cx.js';

export type PanelTone = 'glass' | 'float' | 'popup' | 'plain';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  tone?: PanelTone;
  /** Панель лежит поверх спутникового снимка: нужна темная подложка под текст. */
  overImagery?: boolean;
  /** Без скругления и тени: панель во всю область. */
  flush?: boolean;
  /** В React 19 ref передается обычным пропом. */
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
}

const TONES: Record<PanelTone, string> = {
  glass: 'glass',
  float: 'glass-float',
  // Всплывашка над снимком: плотная подложка вместо полупрозрачной (см. `app.css`).
  popup: 'glass-popup',
  plain: 'bg-surface-weak border border-border-base',
};

export function Panel({
  tone = 'glass',
  overImagery = false,
  flush = false,
  className,
  children,
  ref,
  ...rest
}: PanelProps) {
  return (
    <div
      ref={ref}
      className={cx(
        TONES[tone],
        overImagery && 'glass-over-imagery',
        flush ? 'rounded-none shadow-none' : 'rounded-panel',
        'text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
