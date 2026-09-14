/**
 * Тормозная симметрия: четыре столбика на общей шкале с фоновыми зонами норматива и разброс
 * с собственным светофором. Все столбики высоко - общий перегрев на спуске; один выше
 * остальных - подклинивший механизм.
 */

import { formatMetricValue, getMetric, type MetricId, SEVERITY } from '@ra/contracts';
import { Badge, cx, severityClasses } from '@/shared/ui';
import { goodValue } from '../data/snapshot-values.js';
import { deviationZones, normativeZones, redlineScale } from './chart-math.js';
import { type ChartPointProps, clamp, SCALE_HEADROOM, SEVERITY_FILL, ZONE_FILL } from './svg.js';

const WHEELS: MetricId[] = [
  'BRAKE_TEMPERATURE_FRONT_LEFT',
  'BRAKE_TEMPERATURE_FRONT_RIGHT',
  'BRAKE_TEMPERATURE_REAR_LEFT',
  'BRAKE_TEMPERATURE_REAR_RIGHT',
];

/** Высота столбиков, пиксели. */
const COLUMN_HEIGHT_PX = 116;

export function BrakeSymmetryChart({ values, severities, model }: ChartPointProps) {
  // Норматив у всех четырех колес общий: достаточно зон первого.
  const zones = normativeZones('BRAKE_TEMPERATURE_FRONT_LEFT', model.id);
  const redFrom = redlineScale(zones)?.redFrom ?? 0;
  const temperatures = WHEELS.map((metric) => goodValue(values, metric));
  const hottest = Math.max(0, ...temperatures.map((value) => value ?? 0));
  const top = Math.max(redFrom, hottest, 1) * (1 + SCALE_HEADROOM);
  const pct = (value: number) => clamp((value / top) * 100, 0, 100);
  const ticks = [
    ...new Set(
      deviationZones(zones).flatMap((zone) =>
        [zone.from, zone.to].filter((edge): edge is number => edge !== null),
      ),
    ),
  ];
  const spread = goodValue(values, 'BRAKE_TEMPERATURE_SPREAD');
  const spreadSeverity = severities.BRAKE_TEMPERATURE_SPREAD ?? SEVERITY.UNKNOWN;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <div
          aria-hidden="true"
          className="tabular relative w-7 shrink-0 text-right text-[10px] text-fg-faint"
          style={{ height: COLUMN_HEIGHT_PX }}
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 translate-y-1/2"
              style={{ bottom: `${pct(tick)}%` }}
            >
              {formatMetricValue(tick, 'BRAKE_TEMPERATURE_MAX', { withUnit: false })}
            </span>
          ))}
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-4 gap-2">
          {WHEELS.map((metric, index) => {
            const value = temperatures[index] ?? null;
            const severity = severities[metric] ?? SEVERITY.UNKNOWN;
            const text = formatMetricValue(value, metric);
            return (
              <div key={metric} className="flex min-w-0 flex-col items-center gap-1">
                <svg
                  viewBox="0 0 10 100"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`${getMetric(metric).name}: ${text}`}
                  className="block w-full"
                  style={{ height: COLUMN_HEIGHT_PX }}
                >
                  <rect x={0} y={0} width={10} height={100} className="fill-surface-weak" />
                  {zones.map((zone) => {
                    const upper = 100 - pct(zone.to ?? top);
                    const lower = 100 - pct(zone.from ?? 0);
                    return lower > upper ? (
                      <rect
                        key={`${zone.from}-${zone.to}`}
                        x={0}
                        y={upper}
                        width={10}
                        height={lower - upper}
                        className={ZONE_FILL[zone.severity]}
                      />
                    ) : null;
                  })}
                  {value !== null && (
                    <rect
                      x={2.5}
                      y={100 - pct(value)}
                      width={5}
                      height={pct(value)}
                      className={SEVERITY_FILL[severity]}
                    />
                  )}
                </svg>
                <span
                  className={cx(
                    'tabular text-[12px] font-semibold whitespace-nowrap',
                    severityClasses(value === null ? SEVERITY.UNKNOWN : severity).text,
                  )}
                >
                  {text}
                </span>
                <span className="w-full truncate text-center text-[10px] text-fg-faint">
                  {getMetric(metric).shortName}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border-base pt-2">
        <span className="text-[11px] text-fg-muted">Разброс температур</span>
        <span className="flex items-center gap-2">
          <span
            className={cx(
              'tabular text-[13px] font-semibold',
              severityClasses(spreadSeverity).text,
            )}
          >
            {formatMetricValue(spread, 'BRAKE_TEMPERATURE_SPREAD')}
          </span>
          <Badge severity={spread === null ? SEVERITY.UNKNOWN : spreadSeverity}>
            {severityClasses(spread === null ? SEVERITY.UNKNOWN : spreadSeverity).name}
          </Badge>
        </span>
      </div>
    </div>
  );
}
