/**
 * Плашка машины в списке. Вся плашка окрашена светофором последней точки (полоса слева),
 * семь показателей из `APP_CONFIG.cardMetrics` - иконкой, значением с единицей и светофорным
 * цветом. Показатели прячутся с конца списка приоритетов по ширине области (`monitoring.css`).
 *
 * Плашка подписана только на свою машину и обновляется раз в секунду (`refresh.ts`);
 * показатель, у которого после округления ничего не изменилось, не перерисовывается.
 */

import {
  APP_CONFIG,
  formatMetricValue,
  getMetric,
  type MetricId,
  QUALITY,
  type Quality,
  SEVERITY,
  type Severity,
  VEHICLE_STATUS_NAMES,
} from '@ra/contracts';
import { memo } from 'react';
import { formatDuration, formatShortTime } from '@/shared/format';
import { useAppStore, useTrackedMetrics } from '@/shared/store';
import { cx, MetricIcon, SeverityMark, severityClasses, Tooltip, ValueDisplay } from '@/shared/ui';
import { isGrey } from '../data/fleet.js';
import { resolveModel, severitiesOf, snapshotValues } from '../data/snapshot-values.js';
import { ChevronRightIcon } from '../icons.js';
import { useCardSnapshot } from './refresh.js';
import type { ApiVehicle } from './use-fleet.js';

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^+\d]/g, '')}`;
}

export const VehicleCard = memo(function VehicleCard({ vehicle }: { vehicle: ApiVehicle }) {
  const snapshot = useCardSnapshot(vehicle.id);
  const tracked = useTrackedMetrics();
  const model = resolveModel(vehicle.modelId);

  const grey = snapshot === undefined || isGrey({ severity: snapshot.sev, status: snapshot.st });
  const severity = grey ? SEVERITY.UNKNOWN : snapshot.sev;
  const classes = severityClasses(severity);
  const values =
    snapshot !== undefined && model !== undefined ? snapshotValues(snapshot, model) : {};
  const severities =
    model !== undefined && !grey ? severitiesOf(values, model, APP_CONFIG.cardMetrics) : {};

  return (
    <li className="glass group relative flex overflow-hidden rounded-panel hover:bg-surface-hover">
      {/*
        Кнопка растянута на всю плашку, а содержимое лежит над ней: внутри серой плашки есть
        ссылка на телефон водителя, а ссылку нельзя вкладывать в кнопку.
      */}
      <button
        type="button"
        aria-label={`Открыть страницу машины, борт ${vehicle.sideNumber}, ${classes.name.toLowerCase()}`}
        onClick={() => useAppStore.getState().selectVehicle(vehicle.id)}
        className="absolute inset-0 z-0 cursor-pointer rounded-panel"
      />
      <span aria-hidden="true" className={cx('w-1 shrink-0', classes.solid)} />
      <div className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-2 pl-3">
        <div className="w-[96px] shrink-0">
          <div className="flex items-baseline gap-1">
            <span className="text-[10px] text-fg-faint">борт</span>
            <span className="tabular text-[22px] leading-none font-semibold">
              {vehicle.sideNumber}
            </span>
            {/* Форма дублирует цвет полосы: статус читается и без различения цветов. */}
            <SeverityMark severity={severity} className="self-center" />
          </div>
          <div className="mt-1 truncate text-[11px] text-fg-muted">
            {model?.name ?? vehicle.modelId}
          </div>
          <div className="tabular truncate text-[10px] text-fg-faint">{vehicle.plate}</div>
        </div>

        {grey ? (
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[12px]">
            <span className={cx('font-medium', classes.text)}>Нет связи</span>
            <span className="truncate text-fg-muted">
              {snapshot === undefined ? (
                'данных от машины не поступало'
              ) : (
                <>
                  последняя передача{' '}
                  <span className="tabular text-fg">
                    {formatShortTime(snapshot.t - snapshot.age)}
                  </span>
                  , {formatDuration(snapshot.age)} назад
                </>
              )}
            </span>
            <a
              href={telHref(vehicle.driver.phone)}
              className="tabular pointer-events-auto relative w-fit text-primary-text underline-offset-2 hover:underline"
            >
              {vehicle.driver.phone}
            </a>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {APP_CONFIG.cardMetrics.map((metricId, index) => {
              const sample = values[metricId];
              const value = sample?.value ?? null;
              const quality = sample?.quality ?? QUALITY.NOT_AVAILABLE;
              return (
                <CardMetric
                  key={metricId}
                  vehicleId={vehicle.id}
                  metricId={metricId}
                  rank={index + 1}
                  value={value}
                  text={
                    quality === QUALITY.GOOD && value !== null
                      ? formatMetricValue(value, metricId)
                      : '-'
                  }
                  quality={quality}
                  severity={severities[metricId] ?? SEVERITY.UNKNOWN}
                  status={
                    index === 0 && snapshot !== undefined ? VEHICLE_STATUS_NAMES[snapshot.st] : null
                  }
                  tracked={tracked.includes(metricId)}
                />
              );
            })}
          </div>
        )}

        <span className="ml-auto size-4 shrink-0 text-fg-faint group-hover:text-fg">
          <ChevronRightIcon />
        </span>
      </div>
    </li>
  );
});

interface CardMetricProps {
  vehicleId: string;
  metricId: MetricId;
  rank: number;
  value: number | null;
  /** Отформатированное значение: по нему, а не по сырому числу решается, нужна ли перерисовка. */
  text: string;
  quality: Quality;
  severity: Severity;
  /** Для первого показателя: статус машины над скоростью. */
  status: string | null;
  tracked: boolean;
}

/** Сырое значение меняется каждый тик, а видимый текст - редко: сравнивается текст. */
function sameCardMetric(a: CardMetricProps, b: CardMetricProps): boolean {
  return (
    a.vehicleId === b.vehicleId &&
    a.metricId === b.metricId &&
    a.rank === b.rank &&
    a.text === b.text &&
    a.quality === b.quality &&
    a.severity === b.severity &&
    a.status === b.status &&
    a.tracked === b.tracked
  );
}

const CardMetric = memo(function CardMetric({
  vehicleId,
  metricId,
  rank,
  value,
  quality,
  severity,
  status,
  tracked,
}: CardMetricProps) {
  const metric = getMetric(metricId);
  return (
    <Tooltip
      placement="top"
      content={
        status === null ? (
          metric.name
        ) : (
          <>
            {metric.name}
            <div className="text-fg-muted">{status}</div>
          </>
        )
      }
    >
      {/*
        Плитка ловит указатель ради подсказки, поэтому клик по ней не доходит до кнопки плашки
        под ней - открываем страницу машины сами. С клавиатуры плашку открывает ее кнопка.
      */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: дублирует кнопку плашки, доступную с клавиатуры */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: то же - основной элемент управления это кнопка плашки */}
      <div
        data-rank={rank}
        onClick={() => useAppStore.getState().selectVehicle(vehicleId)}
        className={cx(
          'vehicle-card-metric pointer-events-auto shrink-0 cursor-pointer items-center gap-1.5',
          'rounded-control border px-2 py-1.5 transition-colors duration-150',
          // Ширина с запасом под самое длинное значение ("12,4 бар"): текст не сжимается.
          rank === 1 ? 'w-[136px]' : 'w-[132px]',
          tracked
            ? 'border-primary/30 bg-primary-soft hover:bg-primary/25'
            : 'border-border-base bg-surface hover:bg-surface-strong',
        )}
      >
        <MetricIcon
          metricId={metricId}
          className={cx('size-6 shrink-0', severityClasses(severity).text)}
        />
        <ValueDisplay
          metricId={metricId}
          value={value}
          quality={quality}
          severity={severity}
          size="xl"
        />
      </div>
    </Tooltip>
  );
}, sameCardMetric);
