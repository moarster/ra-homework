/**
 * График одного показателя на полотне.
 *
 * Виртуализация: пока строка вне видимой области (с запасом), в ней только название, а
 * экземпляра uPlot нет. Двадцать восемь живых графиков по тысяче точек убили бы кадр, а так
 * одновременно живут только те, что на экране.
 *
 * Заголовок: значение на монитор или на последнюю точку, светофор, единица отображения.
 * Курсорное значение пишется в заголовок напрямую в DOM из хука uPlot, без перерисовки React.
 */

import {
  formatValue,
  getMetric,
  hasThresholds,
  METRICS,
  type MetricId,
  SEVERITY,
  UNITS,
  type UnitId,
  VEHICLE_STATUS_NAMES,
  VEHICLE_STATUSES,
  type VehicleModel,
  vehicleStatusFromCode,
} from '@ra/contracts';
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type uPlot from 'uplot';
import { formatTime } from '@/shared/format';
import { useAppStore, useMonitorTs } from '@/shared/store';
import { Badge, cx, MetricIcon, Select, severityClasses } from '@/shared/ui';
import {
  deviationZones,
  gearLabel,
  normativeZones,
  toDisplay,
  zonesInUnit,
} from '../charts/chart-math.js';
import { severitiesOf } from '../data/snapshot-values.js';
import { useInView } from '../scroll-root.js';
import type { SeriesBuffer } from './series-buffer.js';
import { useChartColors } from './theme-colors.js';
import { setDisplayUnit, unitOptions, useDisplayUnit } from './unit-prefs.js';
import { createSeriesPlot } from './uplot-chart.js';

/** Высота строки полотна: фиксированная, иначе виртуализация дергала бы прокрутку. */
export const SERIES_ROW_HEIGHT_PX = 214;

const PLOT_HEIGHT_PX = 150;

/** Передачи от заднего хода до шестой (раздел 6.1 `CONTEXT.md`) с половиной деления запаса. */
const GEAR_RANGE: [number, number] = [-1.5, 6.5];

const STATUS_RANGE: [number, number] = [-0.5, VEHICLE_STATUSES.length - 0.5];

const AXIS_SIZE_PX = 52;

/** Шкала статуса подписана словами, ей нужно больше места. */
const STATUS_AXIS_SIZE_PX = 118;

const FLASH_MS = 2000;

const axisNumber = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

interface Formatters {
  axis: (value: number) => string;
  value: (value: number | null) => string;
}

function statusShortName(code: number): string {
  return VEHICLE_STATUS_NAMES[vehicleStatusFromCode(code)].split(',')[0] ?? '';
}

function formattersFor(metricId: MetricId, unitId: UnitId): Formatters {
  if (metricId === 'TRANSMISSION_GEAR') {
    return { axis: (value) => (Number.isInteger(value) ? gearLabel(value) : ''), value: gearLabel };
  }
  if (metricId === 'VEHICLE_STATUS') {
    return {
      axis: (value) => (Number.isInteger(value) ? statusShortName(value) : ''),
      value: (value) => (value === null ? '-' : VEHICLE_STATUS_NAMES[vehicleStatusFromCode(value)]),
    };
  }
  const metric = getMetric(metricId);
  const precision = unitId === metric.displayUnitId ? metric.precision : UNITS[unitId].precision;
  const counter = metric.kind === 'counter';
  return {
    axis: (value) => axisNumber.format(value),
    value: (value) =>
      value === null
        ? '-'
        : `${counter && value > 0 ? '+' : ''}${formatValue(value, unitId, { precision })}`,
  };
}

/**
 * Данные графика в единице отображения. Счетчики показываются приростом за период:
 * абсолютная монотонная прямая ничего не говорит, а прирост - это работа за период.
 */
function buildData(buffer: SeriesBuffer, metricId: MetricId, unitId: UnitId): uPlot.AlignedData {
  const column = buffer.column(metricId);
  const counter = METRICS[metricId].kind === 'counter';
  const base = counter ? buffer.firstValue(metricId) : null;
  const shift = base === null ? 0 : toDisplay(base, metricId, unitId);
  const convert = (value: number | null) =>
    value === null ? null : toDisplay(value, metricId, unitId) - shift;
  return [
    buffer.xs().slice(),
    column?.avg.map(convert) ?? [],
    column?.min.map(convert) ?? [],
    column?.max.map(convert) ?? [],
  ];
}

/** Окно по времени: правый край - последний известный момент, окно скользит вместе с ним. */
function applyWindow(plot: uPlot, buffer: SeriesBuffer): void {
  const { from, to } = buffer.window();
  plot.setScale('x', { min: from, max: to });
}

export interface SeriesRowProps {
  vehicleId: string;
  metricId: MetricId;
  buffer: SeriesBuffer;
  model: VehicleModel;
  tracked: boolean;
  /** Номер подсветки после автоскролла; 0 - не подсвечивать. */
  flash: number;
}

export const SeriesRow = memo(function SeriesRow(props: SeriesRowProps) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const inView = useInView(element);

  useEffect(() => {
    if (props.flash === 0 || element === null) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const animation = element.animate(
      [{ boxShadow: '0 0 0 3px var(--accent-500)' }, { boxShadow: '0 0 0 3px transparent' }],
      { duration: FLASH_MS, easing: 'ease-out' },
    );
    return () => {
      animation.cancel();
    };
  }, [props.flash, element]);

  return (
    <div
      ref={setElement}
      data-metric={props.metricId}
      style={{ height: SERIES_ROW_HEIGHT_PX }}
      className={cx(
        'glass flex flex-col rounded-panel px-3 pt-2.5 pb-1',
        props.tracked && 'ring-1 ring-primary/50',
      )}
    >
      {inView ? (
        <SeriesRowBody {...props} />
      ) : (
        <div className="flex items-center gap-2">
          <MetricIcon metricId={props.metricId} className="size-4 text-fg-faint" />
          <span className="truncate text-[13px] font-medium">{getMetric(props.metricId).name}</span>
        </div>
      )}
    </div>
  );
});

function SeriesRowBody({ vehicleId, metricId, buffer, model }: SeriesRowProps) {
  const metric = getMetric(metricId);
  const unitId = useDisplayUnit(metricId);
  const version = useSyncExternalStore(buffer.subscribe, buffer.getVersion);
  const monitorTs = useMonitorTs();
  const colors = useChartColors();

  const plotRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLSpanElement | null>(null);
  const plotInstance = useRef<uPlot | null>(null);
  const monitorRef = useRef(monitorTs);

  const formatters = useMemo(() => formattersFor(metricId, unitId), [metricId, unitId]);
  const zones = useMemo(
    () => zonesInUnit(deviationZones(normativeZones(metricId, model.id)), metricId, unitId),
    [metricId, model.id, unitId],
  );

  // Сборка графика: только при смене показателя, единицы, зон или темы.
  useEffect(() => {
    const element = plotRef.current;
    if (element === null) {
      return;
    }
    const kind = METRICS[metricId].kind;
    const discrete = kind === 'state' || metricId === 'VEHICLE_STATUS';
    const plot = createSeriesPlot({
      element,
      width: Math.max(1, Math.round(element.clientWidth)),
      height: PLOT_HEIGHT_PX,
      data: buildData(buffer, metricId, unitId),
      zones,
      colors,
      syncKey: `vehicle-series:${vehicleId}`,
      stepped: discrete,
      yRange:
        metricId === 'TRANSMISSION_GEAR'
          ? GEAR_RANGE
          : metricId === 'VEHICLE_STATUS'
            ? STATUS_RANGE
            : null,
      yIncrements: discrete ? [1] : null,
      yAxisSize: metricId === 'VEHICLE_STATUS' ? STATUS_AXIS_SIZE_PX : AXIS_SIZE_PX,
      formatAxis: formatters.axis,
      formatValue: formatters.value,
      getMonitorTs: () => monitorRef.current,
      onPick: (t) => useAppStore.getState().setMonitorTs(t),
      getReadout: () => readoutRef.current,
    });
    applyWindow(plot, buffer);
    plotInstance.current = plot;
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (width > 0 && width !== plot.width) {
        plot.setSize({ width, height: PLOT_HEIGHT_PX });
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      plot.destroy();
      plotInstance.current = null;
    };
  }, [buffer, vehicleId, metricId, unitId, zones, colors, formatters]);

  // Новые данные: тик или новая история. Пересобирается только этот график и только если он смонтирован.
  // biome-ignore lint/correctness/useExhaustiveDependencies: буфер mutable, признак новых данных - его версия
  useEffect(() => {
    const plot = plotInstance.current;
    if (plot === null) {
      return;
    }
    plot.batch(() => {
      plot.setData(buildData(buffer, metricId, unitId), false);
      applyWindow(plot, buffer);
    });
  }, [buffer, metricId, unitId, version]);

  // Монитор: без пересборки, только перерисовка вертикали и точки.
  useEffect(() => {
    monitorRef.current = monitorTs;
    plotInstance.current?.redraw(false, false);
  }, [monitorTs]);

  const index = buffer.indexAt(monitorTs);
  const raw = index < 0 ? null : (buffer.column(metricId)?.avg[index] ?? null);
  const counter = metric.kind === 'counter';
  const base = counter ? buffer.firstValue(metricId) : null;
  const shown =
    raw === null
      ? null
      : toDisplay(raw, metricId, unitId) - (base === null ? 0 : toDisplay(base, metricId, unitId));
  const withZones = hasThresholds(metricId);
  const severity =
    raw === null
      ? SEVERITY.UNKNOWN
      : withZones
        ? (severitiesOf(buffer.pointValues(monitorTs), model, [metricId])[metricId] ??
          SEVERITY.UNKNOWN)
        : SEVERITY.OK;
  const classes = severityClasses(severity);
  const isMonitor = monitorTs !== null;
  const units = unitOptions(metricId);

  return (
    <>
      <div className="flex min-h-11 items-start gap-2">
        <MetricIcon metricId={metricId} className={cx('mt-0.5 size-4', classes.text)} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium" title={metric.name}>
            {metric.name}
          </div>
          <div className="tabular truncate text-[11px] whitespace-pre text-fg-faint">
            {counter && raw !== null && <span>всего {formatValue(raw, metric, { unitId })} </span>}
            <span ref={readoutRef} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right">
            <div
              className={cx(
                'tabular leading-none font-semibold whitespace-nowrap',
                classes.text,
                isMonitor ? 'text-[22px]' : 'text-[15px]',
              )}
            >
              {formatters.value(shown)}
            </div>
            <div
              className={cx(
                'mt-0.5 text-[10px] whitespace-nowrap',
                isMonitor ? 'text-accent-text' : 'text-fg-faint',
              )}
            >
              {isMonitor
                ? `монитор ${formatTime(monitorTs)}`
                : counter
                  ? 'прирост за период'
                  : 'последняя точка'}
            </div>
          </div>
          {withZones && <Badge severity={severity}>{classes.name}</Badge>}
          {units.length > 0 && (
            <Select
              value={unitId}
              options={units.map((id) => ({
                value: id,
                label: UNITS[id].symbol,
                hint: UNITS[id].name,
              }))}
              onChange={(next) => setDisplayUnit(metricId, next)}
              label={`Единица отображения: ${metric.shortName}`}
            />
          )}
        </div>
      </div>
      <div ref={plotRef} className="min-w-0 flex-1" />
    </>
  );
}
