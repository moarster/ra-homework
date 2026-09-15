/**
 * Иконка показателя, группы или статуса машины. Рисунок берется из справочника контрактов,
 * цвет наследуется через `currentColor`.
 */

import { metricGroupIcon, metricIcon, vehicleStatusIcon } from '@ra/contracts';
import { cx } from './cx.js';

export interface MetricIconProps {
  /** Идентификатор показателя; взаимоисключающе с `groupId` и `statusId`. */
  metricId?: string;
  groupId?: string;
  /** Статус машины (`VehicleStatus`). */
  statusId?: string;
  className?: string;
}

export function MetricIcon({ metricId, groupId, statusId, className }: MetricIconProps) {
  const svg =
    statusId !== undefined
      ? vehicleStatusIcon(statusId)
      : groupId !== undefined
        ? metricGroupIcon(groupId)
        : metricIcon(metricId ?? 'UNKNOWN');
  return (
    <span
      aria-hidden="true"
      className={cx('inline-block size-4 shrink-0 [&>svg]:size-full', className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: рисунок - константа справочника контрактов, внешних данных в нем нет
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
