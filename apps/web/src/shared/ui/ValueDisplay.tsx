/**
 * Значение показателя: число, единица, светофорный цвет и честное отображение отсутствия данных.
 * Единица всегда рядом со значением (раздел 11.6 `CONTEXT.md`), форматирование - из контрактов.
 */

import {
  formatMetricValue,
  getMetric,
  type MetricId,
  QUALITY,
  QUALITY_NAMES,
  type Quality,
  SEVERITY,
  type Severity,
} from '@ra/contracts';
import { cx } from './cx.js';
import { severityClasses } from './severity.js';
import { Tooltip } from './Tooltip.js';

export interface ValueDisplayProps {
  metricId: MetricId;
  value: number | null | undefined;
  /** Качество значения: не GOOD показывается отдельно и не красится светофором. */
  quality?: Quality;
  severity?: Severity;
  /** Подписывать название показателя сверху. */
  withName?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: 'text-[12px]',
  md: 'text-[15px]',
  lg: 'text-[20px]',
} as const;

export function ValueDisplay({
  metricId,
  value,
  quality = QUALITY.GOOD,
  severity = SEVERITY.OK,
  withName = false,
  size = 'md',
  className,
}: ValueDisplayProps) {
  const metric = getMetric(metricId);
  const missing = value === null || value === undefined || quality !== QUALITY.GOOD;
  const classes = severityClasses(missing ? SEVERITY.UNKNOWN : severity);
  const text = missing ? '-' : formatMetricValue(value, metricId);

  const body = (
    <span
      className={cx(
        'tabular font-medium whitespace-nowrap',
        SIZES[size],
        classes.text,
        missing && 'opacity-70',
        className,
      )}
    >
      {text}
    </span>
  );

  return (
    <span className="inline-flex flex-col leading-tight">
      {withName && <span className="text-[11px] text-fg-faint">{metric.shortName}</span>}
      {missing && quality !== QUALITY.GOOD ? (
        <Tooltip content={QUALITY_NAMES[quality]}>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: причина отсутствия данных должна
              быть доступна с клавиатуры, иначе подсказка видна только мышью */}
          <span tabIndex={0} className="cursor-help">
            {body}
          </span>
        </Tooltip>
      ) : (
        body
      )}
    </span>
  );
}
