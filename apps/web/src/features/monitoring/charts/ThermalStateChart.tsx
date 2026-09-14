/**
 * Тепловое состояние систем: ОЖ, масло двигателя, масло трансмиссии и максимум тормозов на
 * единой шкале "процент до красной зоны". Одна картинка отвечает на вопрос "где машина ближе
 * всего к пределу", хотя единицы разные; физические значения подписаны рядом.
 */

import {
  COMPARATIVE_CHARTS,
  formatMetricValue,
  getMetric,
  type MetricId,
  SEVERITY,
  type ThresholdZone,
} from '@ra/contracts';
import { goodValue } from '../data/snapshot-values.js';
import { normativeZones, redlinePercent, redlineScale } from './chart-math.js';
import { BulletBar, type ChartPointProps, ValueLine } from './svg.js';

const THERMAL_METRICS: MetricId[] =
  COMPARATIVE_CHARTS.find((chart) => chart.id === 'THERMAL_STATE')?.metrics ?? [];

/** Шкала тянется за красную зону на пятую часть, чтобы перегрев был виден, а не упирался в край. */
const PERCENT_TOP = 120;

const percentFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function ThermalStateChart({ values, severities, model }: ChartPointProps) {
  const rows = THERMAL_METRICS.map((metric) => {
    const scale = redlineScale(normativeZones(metric, model.id));
    const value = goodValue(values, metric);
    const percent = scale === null || value === null ? null : redlinePercent(scale, value);
    const warnPercent = scale?.warnFrom == null ? null : redlinePercent(scale, scale.warnFrom);
    // Зоны шкалы в процентах выводятся из тех же нормативов, собственных порогов здесь нет.
    const zones: ThresholdZone[] = [
      { from: null, to: warnPercent ?? 100, severity: SEVERITY.OK },
      ...(warnPercent === null ? [] : [{ from: warnPercent, to: 100, severity: SEVERITY.WARN }]),
      { from: 100, to: null, severity: SEVERITY.ALARM },
    ];
    return {
      metric,
      value,
      percent,
      zones,
      severity: value === null ? SEVERITY.UNKNOWN : (severities[metric] ?? SEVERITY.OK),
    };
  });

  const closest = rows.reduce<(typeof rows)[number] | null>(
    (best, row) =>
      row.percent !== null && (best === null || (best.percent ?? 0) < row.percent) ? row : best,
    null,
  );

  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <div key={row.metric} className="flex flex-col gap-1">
          <ValueLine
            label={getMetric(row.metric).shortName}
            value={formatMetricValue(row.value, row.metric)}
            severity={row.severity}
            detail={row.percent === null ? '-' : `${percentFormatter.format(row.percent)}%`}
          />
          <BulletBar
            min={0}
            max={PERCENT_TOP}
            zones={row.zones}
            value={row.percent}
            severity={row.severity}
            marks={[100]}
            label={`${getMetric(row.metric).name}: ${formatMetricValue(row.value, row.metric)}`}
          />
        </div>
      ))}
      <div className="border-t border-border-base pt-2 text-[11px] text-fg-muted">
        {closest === null || closest.percent === null ? (
          'Нет температур в этой точке'
        ) : (
          <>
            Ближе всего к пределу:{' '}
            <span className="font-semibold text-fg">{getMetric(closest.metric).shortName}</span>,{' '}
            <span className="tabular">{percentFormatter.format(closest.percent)}%</span> до красной
            зоны
          </>
        )}
      </div>
    </div>
  );
}
