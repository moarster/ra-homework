/**
 * Вертикальное полотно временных рядов: по графику на показатель. Сначала отслеживаемые
 * показатели (закреплены сверху и выделены), затем остальные по группам с заголовками.
 *
 * Полотно не перерисовывается целиком ни от тика, ни от монитора: на данные подписаны только
 * смонтированные графики, а смонтированы только видимые (виртуализация в `SeriesRow`).
 */

import {
  getMetric,
  METRIC_GROUP_IDS,
  METRIC_GROUPS,
  type MetricId,
  type VehicleModel,
} from '@ra/contracts';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAppStore, useFocusMetric, useTrackedMetrics } from '@/shared/store';
import { EmptyState, MetricIcon, Panel, Skeleton } from '@/shared/ui';
import { ChartsIcon } from '../icons.js';
import { useScrollRoot } from '../scroll-root.js';
import { SERIES_ROW_HEIGHT_PX, SeriesRow } from './SeriesRow.js';
import type { SeriesBuffer } from './series-buffer.js';
import { CANVAS_METRICS } from './use-vehicle-series.js';

export interface SeriesCanvasProps {
  vehicleId: string;
  buffer: SeriesBuffer;
  model: VehicleModel;
  error: Error | null;
}

interface Flash {
  metricId: MetricId;
  /** Номер подсветки: повторный переход к тому же графику подсвечивает его снова. */
  count: number;
}

export function SeriesCanvas({ vehicleId, buffer, model, error }: SeriesCanvasProps) {
  const tracked = useTrackedMetrics();
  const focusMetric = useFocusMetric();
  const scrollRoot = useScrollRoot();
  const loaded = useSyncExternalStore(buffer.subscribe, () => buffer.isLoaded());
  const [flash, setFlash] = useState<Flash | null>(null);

  const trackedMetrics = tracked.filter((metricId) => CANVAS_METRICS.includes(metricId));
  const groups = METRIC_GROUP_IDS.map((groupId) => ({
    group: METRIC_GROUPS[groupId],
    metrics: CANVAS_METRICS.filter(
      (metricId) => getMetric(metricId).groupId === groupId && !trackedMetrics.includes(metricId),
    ),
  })).filter((entry) => entry.metrics.length > 0);

  /*
   * Автоскролл к графику: клик по показателю во всплывашке карты или по типу события в шапке.
   * Прокрутка откладывается на кадр: шапка и чарты над полотном к этому моменту уже получили
   * свою высоту. Фокус гасится после прокрутки, внутри того же кадра, чтобы повторный клик по
   * тому же показателю снова сработал. Погасить его раньше нельзя: смена фокуса перезапустила
   * бы эффект, и очистка отменила бы еще не случившуюся прокрутку.
   */
  useEffect(() => {
    if (focusMetric === null || !loaded) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      useAppStore.getState().setFocusMetric(null);
      const root = scrollRoot?.current ?? null;
      const target = root?.querySelector<HTMLElement>(`[data-metric="${focusMetric}"]`) ?? null;
      if (root === null || target === null) {
        return;
      }
      const offset =
        target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      root.scrollTo({
        top: Math.max(0, offset - (root.clientHeight - target.offsetHeight) / 2),
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
      setFlash((current) => ({ metricId: focusMetric, count: (current?.count ?? 0) + 1 }));
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [focusMetric, loaded, scrollRoot]);

  const row = (metricId: MetricId, isTracked: boolean) => (
    <SeriesRow
      key={metricId}
      vehicleId={vehicleId}
      metricId={metricId}
      buffer={buffer}
      model={model}
      tracked={isTracked}
      flash={flash?.metricId === metricId ? flash.count : 0}
    />
  );

  return (
    <section aria-label="Временные ряды" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 px-1">
        <h2 className="text-[13px] font-semibold">Временные ряды</h2>
        <span className="text-[12px] text-fg-muted">
          курсор общий для всех графиков, клик ставит монитор
        </span>
      </div>

      {error !== null && !loaded ? (
        <Panel tone="glass" className="py-4">
          <EmptyState
            icon={<ChartsIcon />}
            title="Серии не загрузились"
            description={error.message}
          />
        </Panel>
      ) : !loaded ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {['a', 'b', 'c'].map((key) => (
            // Высота как у настоящего графика: при загрузке полотно не прыгает.
            <div key={key} style={{ height: SERIES_ROW_HEIGHT_PX }}>
              <Skeleton className="h-full w-full rounded-panel" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {trackedMetrics.length > 0 && (
            <div className="flex flex-col gap-2 rounded-panel border border-primary/35 bg-primary-soft p-2">
              <h3 className="px-1 text-[11px] font-semibold tracking-wider text-primary-text uppercase">
                Отслеживаемые показатели
              </h3>
              {trackedMetrics.map((metricId) => row(metricId, true))}
            </div>
          )}
          {groups.map(({ group, metrics }) => (
            <div key={group.id} className="flex flex-col gap-2">
              <h3 className="mt-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold tracking-wider text-fg-faint uppercase">
                <MetricIcon groupId={group.id} className="size-3.5" />
                {group.name}
              </h3>
              {metrics.map((metricId) => row(metricId, false))}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
