/**
 * Иконка показателя или группы. Рисунок берется из справочника контрактов
 * (на этапе 2 это общая заглушка, уникальные иконки появятся на этапе 6),
 * цвет наследуется через `currentColor`.
 */

import { metricGroupIcon, metricIcon } from '@ra/contracts';
import { cx } from './cx.js';

export interface MetricIconProps {
  /** Идентификатор показателя; взаимоисключающе с `groupId`. */
  metricId?: string;
  groupId?: string;
  className?: string;
}

export function MetricIcon({ metricId, groupId, className }: MetricIconProps) {
  const svg = groupId !== undefined ? metricGroupIcon(groupId) : metricIcon(metricId ?? 'UNKNOWN');
  return (
    <span
      aria-hidden="true"
      className={cx('inline-block size-4 shrink-0 [&>svg]:size-full', className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: рисунок - константа справочника контрактов, внешних данных в нем нет
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
