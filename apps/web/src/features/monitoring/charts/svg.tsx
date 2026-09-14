/**
 * Общие детали сравнительных чартов. Чарты - собственный SVG: полоски рисуются в процентных
 * координатах с `preserveAspectRatio="none"`, а подписи живут в HTML рядом. Так чарт
 * тянется по ширине карточки, текст не искажается, а цвета приходят из токенов классами
 * Tailwind и сами переключаются вместе с темой.
 */

import type { MetricId, PointValues, Severity, ThresholdZone, VehicleModel } from '@ra/contracts';
import type { ReactNode } from 'react';
import { cx, severityClasses } from '@/shared/ui';

/** Запас шкалы за красной зоной: значение за пределом должно быть видно, а не упираться в край. */
export const SCALE_HEADROOM = 0.15;

export const ZONE_FILL: Record<Severity, string> = {
  0: 'fill-sev-ok-soft',
  1: 'fill-sev-warn-soft',
  2: 'fill-sev-alarm-soft',
  3: 'fill-sev-unknown-soft',
};

export const SEVERITY_FILL: Record<Severity, string> = {
  0: 'fill-sev-ok',
  1: 'fill-sev-warn',
  2: 'fill-sev-alarm',
  3: 'fill-sev-unknown',
};

export const SEVERITY_STROKE: Record<Severity, string> = {
  0: 'stroke-sev-ok',
  1: 'stroke-sev-warn',
  2: 'stroke-sev-alarm',
  3: 'stroke-sev-unknown',
};

/** Точка, на которую строится чарт: значения, их светофор и паспорт модели. */
export interface ChartPointProps {
  values: PointValues;
  severities: Partial<Record<MetricId, Severity>>;
  model: VehicleModel;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export interface BulletBarProps {
  min: number;
  max: number;
  zones: readonly ThresholdZone[];
  value: number | null;
  severity: Severity;
  /** Отметки на шкале: отсечка, номинал. */
  marks?: readonly number[];
  label: string;
  /** Цвет полосы значения, если он не светофорный (у расхода нормативов нет). */
  barClassName?: string;
}

/** Горизонтальная полоса-буллет: фон зон норматива, полоса значения, риска значения. */
export function BulletBar({
  min,
  max,
  zones,
  value,
  severity,
  marks = [],
  label,
  barClassName,
}: BulletBarProps) {
  const span = max - min || 1;
  const pos = (v: number) => ((clamp(v, min, max) - min) / span) * 100;
  return (
    <svg
      viewBox="0 0 100 12"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="block h-3 w-full overflow-visible"
    >
      <rect x={0} y={2} width={100} height={8} className="fill-surface-active" />
      {zones.map((zone) => {
        const from = pos(zone.from ?? min);
        const to = pos(zone.to ?? max);
        return to > from ? (
          <rect
            key={`${zone.from}-${zone.to}-${zone.severity}`}
            x={from}
            y={2}
            width={to - from}
            height={8}
            className={ZONE_FILL[zone.severity]}
          />
        ) : null;
      })}
      {value !== null && (
        <>
          <rect
            x={0}
            y={4}
            width={pos(value)}
            height={4}
            className={barClassName ?? SEVERITY_FILL[severity]}
          />
          <line
            x1={pos(value)}
            x2={pos(value)}
            y1={0}
            y2={12}
            strokeWidth={2.5}
            vectorEffect="non-scaling-stroke"
            className={barClassName === undefined ? SEVERITY_STROKE[severity] : 'stroke-primary'}
          />
        </>
      )}
      {marks.map((mark) => (
        <line
          key={mark}
          x1={pos(mark)}
          x2={pos(mark)}
          y1={0}
          y2={12}
          strokeWidth={1}
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
          className="stroke-fg-muted"
        />
      ))}
    </svg>
  );
}

/** Строка подписи над полосой: название слева, значение с единицей справа. */
export function ValueLine({
  label,
  value,
  severity,
  detail,
}: {
  label: ReactNode;
  value: string;
  severity: Severity;
  detail?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="min-w-0 truncate text-[11px] text-fg-muted">{label}</span>
      <span className="tabular shrink-0 text-[12px] whitespace-nowrap">
        <span className={cx('font-semibold', severityClasses(severity).text)}>{value}</span>
        {detail !== undefined && <span className="ml-1.5 text-fg-faint">{detail}</span>}
      </span>
    </div>
  );
}
