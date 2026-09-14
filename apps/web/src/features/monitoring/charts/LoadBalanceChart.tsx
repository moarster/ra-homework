/**
 * Развесовка и загрузка: масса груза относительно номинала модели (зоны политики 10/10/20
 * и отсечка) и распределение нагрузки по осям с нормативной зоной передней оси.
 * Показывает перегруз, недогруз и кривую погрузку экскаватором.
 */

import { DERIVED_RULES, formatMetricValue, formatValue, getMetric, SEVERITY } from '@ra/contracts';
import { cx } from '@/shared/ui';
import { goodValue } from '../data/snapshot-values.js';
import { normativeZones, redlineScale } from './chart-math.js';
import {
  BulletBar,
  type ChartPointProps,
  clamp,
  SCALE_HEADROOM,
  SEVERITY_FILL,
  ValueLine,
} from './svg.js';

export function LoadBalanceChart({ values, severities, model }: ChartPointProps) {
  const cargo = goodValue(values, 'CARGO_MASS');
  const ratio = goodValue(values, 'PAYLOAD_RATIO');
  const payloadZones = normativeZones('PAYLOAD_RATIO', model.id);
  const green = payloadZones.find((zone) => zone.severity === SEVERITY.OK);
  const cutoff = redlineScale(payloadZones)?.redFrom ?? null;
  const payloadTop = Math.max(cutoff ?? 100, ratio ?? 0) * (1 + SCALE_HEADROOM);
  const unloaded = ratio !== null && ratio < DERIVED_RULES.loadedPayloadRatioPercent;
  const payloadSeverity =
    ratio === null ? SEVERITY.UNKNOWN : (severities.CARGO_MASS ?? SEVERITY.OK);

  const frontShare = goodValue(values, 'FRONT_AXLE_SHARE');
  const frontLoad = goodValue(values, 'FRONT_AXLE_LOAD');
  const rearLoad = goodValue(values, 'REAR_AXLE_LOAD');
  const shareZones = normativeZones('FRONT_AXLE_SHARE', model.id);
  const shareGreen = shareZones.find((zone) => zone.severity === SEVERITY.OK);
  const shareSeverity =
    frontShare === null ? SEVERITY.UNKNOWN : (severities.FRONT_AXLE_SHARE ?? SEVERITY.OK);
  const front = frontShare === null ? null : clamp(frontShare, 0, 100);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <ValueLine
          label={
            <>
              Груз {formatMetricValue(cargo, 'CARGO_MASS')} из{' '}
              {formatValue(model.ratedPayloadKg, getMetric('CARGO_MASS'))}
            </>
          }
          value={formatMetricValue(ratio, 'PAYLOAD_RATIO')}
          severity={payloadSeverity}
        />
        <BulletBar
          min={0}
          max={payloadTop}
          zones={payloadZones}
          value={ratio}
          severity={payloadSeverity}
          marks={cutoff === null ? [] : [cutoff]}
          label={`Загрузка ${formatMetricValue(ratio, 'PAYLOAD_RATIO')} от номинала`}
        />
        <div className="text-[10px] text-fg-faint">
          {green !== undefined && green.from !== null && green.to !== null
            ? `норма ${green.from}-${green.to}%`
            : ''}
          {cutoff !== null && `, пунктир - отсечка ${cutoff}%`}
          {unloaded && ', порожняя: нормативы груза не применяются'}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2 text-[11px]">
          <span className="text-fg-muted">
            Перед. ось{' '}
            <span
              className={cx(
                'tabular font-semibold',
                shareSeverity !== SEVERITY.OK && 'text-sev-warn-text',
                shareSeverity === SEVERITY.ALARM && 'text-sev-alarm-text',
              )}
            >
              {formatMetricValue(frontShare, 'FRONT_AXLE_SHARE')}
            </span>
          </span>
          <span className="text-fg-muted">
            Задн. ось{' '}
            <span className="tabular font-semibold text-fg">
              {formatMetricValue(frontShare === null ? null : 100 - frontShare, 'FRONT_AXLE_SHARE')}
            </span>
          </span>
        </div>
        <svg
          viewBox="0 0 100 16"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Распределение по осям: передняя ${formatMetricValue(frontShare, 'FRONT_AXLE_SHARE')}`}
          className="block h-4 w-full overflow-visible"
        >
          <rect x={0} y={3} width={100} height={10} className="fill-surface-active" />
          {front !== null && (
            <rect x={0} y={3} width={front} height={10} className={SEVERITY_FILL[shareSeverity]} />
          )}
          {shareGreen !== undefined && shareGreen.from !== null && shareGreen.to !== null && (
            <>
              <rect
                x={shareGreen.from}
                y={1}
                width={shareGreen.to - shareGreen.from}
                height={14}
                fill="none"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                className="stroke-sev-ok"
              />
              <line
                x1={(shareGreen.from + shareGreen.to) / 2}
                x2={(shareGreen.from + shareGreen.to) / 2}
                y1={0}
                y2={16}
                strokeWidth={1}
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
                className="stroke-fg-muted"
              />
            </>
          )}
        </svg>
        <div className="tabular flex justify-between gap-2 text-[10px] text-fg-faint">
          <span>{formatMetricValue(frontLoad, 'FRONT_AXLE_LOAD')}</span>
          {shareGreen !== undefined && shareGreen.from !== null && shareGreen.to !== null && (
            <span>
              рамка - норма передней оси {shareGreen.from}-{shareGreen.to}%
            </span>
          )}
          <span>{formatMetricValue(rearLoad, 'REAR_AXLE_LOAD')}</span>
        </div>
      </div>
    </div>
  );
}
