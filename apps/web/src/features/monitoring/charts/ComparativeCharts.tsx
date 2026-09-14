/**
 * Кумулятивная область сравнительных чартов (раздел 9.2 `CONTEXT.md`): показатели, которые
 * разумно сравнивать в одной точке. Все четыре строятся на точку монитора, а без монитора -
 * на последнюю точку. Сетка раскладывается по ширине области: 4, 2 или 1 в ряд.
 *
 * Значения берутся из того же буфера серий, что и полотно графиков, поэтому чарт на мониторе
 * и значение на вертикальной линии монитора совпадают по определению.
 */

import {
  APP_CONFIG,
  type ChartId,
  COMPARATIVE_CHARTS,
  type MetricId,
  type VehicleModel,
} from '@ra/contracts';
import { type ReactNode, useMemo, useSyncExternalStore } from 'react';
import { formatTime } from '@/shared/format';
import { useMonitorTs } from '@/shared/store';
import { cx, Panel, Skeleton } from '@/shared/ui';
import { severitiesOf } from '../data/snapshot-values.js';
import type { SeriesBuffer } from '../timeseries/series-buffer.js';
import { BrakeSymmetryChart } from './BrakeSymmetryChart.js';
import { DutyModeChart } from './DutyModeChart.js';
import { LoadBalanceChart } from './LoadBalanceChart.js';
import type { ChartPointProps } from './svg.js';
import { ThermalStateChart } from './ThermalStateChart.js';

const CHART_METRICS: MetricId[] = [
  ...new Set(COMPARATIVE_CHARTS.flatMap((chart) => chart.metrics)),
];

const RENDERERS: Record<ChartId, (props: ChartPointProps) => ReactNode> = {
  BRAKE_SYMMETRY: BrakeSymmetryChart,
  LOAD_BALANCE: LoadBalanceChart,
  THERMAL_STATE: ThermalStateChart,
  DUTY_MODE: DutyModeChart,
};

export function ComparativeCharts({
  buffer,
  model,
}: {
  buffer: SeriesBuffer;
  model: VehicleModel;
}) {
  const version = useSyncExternalStore(buffer.subscribe, buffer.getVersion);
  const monitorTs = useMonitorTs();
  const loaded = buffer.isLoaded();

  // biome-ignore lint/correctness/useExhaustiveDependencies: буфер mutable, признак новых данных - его версия
  const point = useMemo(() => {
    const index = buffer.indexAt(monitorTs);
    const values = buffer.pointValues(monitorTs);
    return {
      at: index < 0 ? null : (buffer.xs()[index] ?? null),
      values,
      severities: severitiesOf(values, model, CHART_METRICS),
    };
  }, [buffer, model, monitorTs, version]);

  const isMonitor = monitorTs !== null;
  const outside = loaded && point.at === null;

  return (
    <section aria-label="Сравнительные чарты" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 px-1">
        <h2 className="text-[13px] font-semibold">Сравнение в одной точке</h2>
        <span
          className={cx('tabular text-[12px]', isMonitor ? 'text-accent-text' : 'text-fg-muted')}
        >
          {isMonitor
            ? `на монитор ${formatTime(monitorTs)}`
            : point.at !== null
              ? `на последнюю точку ${formatTime(point.at)}`
              : ''}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 @xl/monitor:grid-cols-2 @6xl/monitor:grid-cols-4">
        {APP_CONFIG.comparativeCharts.map((chartId) => {
          const chart = COMPARATIVE_CHARTS.find((item) => item.id === chartId);
          if (chart === undefined) {
            return null;
          }
          const Renderer = RENDERERS[chartId];
          return (
            <Panel
              key={chartId}
              tone="glass"
              className={cx('flex flex-col gap-3 p-3.5', isMonitor && 'ring-1 ring-accent/35')}
            >
              <div>
                <h3 className="text-[13px] font-semibold">{chart.name}</h3>
                <p className="text-[11px] leading-snug text-fg-muted">{chart.description}</p>
              </div>
              {!loaded ? (
                <div className="flex flex-col gap-2" aria-busy="true">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : outside ? (
                <p className="py-6 text-center text-[12px] text-fg-faint">
                  Точка монитора левее загруженного периода: данных в ней нет.
                </p>
              ) : (
                <Renderer values={point.values} severities={point.severities} model={model} />
              )}
            </Panel>
          );
        })}
      </div>
    </section>
  );
}
