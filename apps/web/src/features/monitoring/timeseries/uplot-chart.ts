/**
 * Сборка графика полотна на uPlot: линия среднего, полоса между минимумом и максимумом,
 * фоновые зоны норматива, вертикаль монитора с подсвеченной точкой, синхронный курсор
 * и клик для установки монитора.
 *
 * Все, что меняется часто (данные, монитор), в график не пересобирается: данные уходят через
 * `setData`, монитор читается из функции при каждой отрисовке. Пересборка нужна только при
 * смене единицы, зон или темы.
 */

import { APP_CONFIG, type ThresholdZone } from '@ra/contracts';
import uPlot from 'uplot';
import { formatShortTime, formatTime } from '@/shared/format';
import { rangeWithZones } from '../charts/chart-math.js';
import type { ChartColors } from './theme-colors.js';
import 'uplot/dist/uPlot.min.css';

export interface SeriesPlotParams {
  element: HTMLElement;
  width: number;
  height: number;
  data: uPlot.AlignedData;
  /** Желтые и красные зоны в единице отображения. */
  zones: readonly ThresholdZone[];
  colors: ChartColors;
  /** Ключ синхронизации курсора: общий для всех графиков одной страницы. */
  syncKey: string;
  /** Ступенчатая линия: у передачи и статуса нет промежуточных значений. */
  stepped: boolean;
  /** Фиксированная шкала значений; null - по данным и зонам. */
  yRange: [number, number] | null;
  /** Шаг делений шкалы значений; null - на усмотрение uPlot. */
  yIncrements: number[] | null;
  /** Ширина подписей шкалы значений, пиксели. */
  yAxisSize: number;
  formatAxis: (value: number) => string;
  formatValue: (value: number | null) => string;
  getMonitorTs: () => number | null;
  onPick: (t: number) => void;
  getReadout: () => HTMLElement | null;
}

const FONT = '11px Inter, "SF Pro Text", system-ui, sans-serif';

function finite(value: number | null | undefined): number | null {
  return value === null || value === undefined || !Number.isFinite(value) ? null : value;
}

/** Последний индекс с x не больше t. */
function indexAtOrBefore(xs: ArrayLike<number>, t: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  if (hi < 0 || (xs[0] as number) > t) {
    return -1;
  }
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((xs[mid] as number) <= t) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

export function createSeriesPlot(params: SeriesPlotParams): uPlot {
  const { colors } = params;

  const drawZones = (u: uPlot) => {
    const min = u.scales.y?.min;
    const max = u.scales.y?.max;
    if (min === undefined || max === undefined || min === null || max === null) {
      return;
    }
    const { left, width } = u.bbox;
    const ctx = u.ctx;
    ctx.save();
    for (const zone of params.zones) {
      const lo = Math.max(zone.from ?? min, min);
      const hi = Math.min(zone.to ?? max, max);
      if (hi <= lo) {
        continue;
      }
      const top = u.valToPos(hi, 'y', true);
      const bottom = u.valToPos(lo, 'y', true);
      ctx.fillStyle = colors.severitySoft[zone.severity];
      ctx.fillRect(left, top, width, bottom - top);
    }
    ctx.restore();
  };

  const drawMonitor = (u: uPlot) => {
    const t = params.getMonitorTs();
    const xMin = u.scales.x?.min;
    const xMax = u.scales.x?.max;
    if (t === null || xMin == null || xMax == null || t < xMin || t > xMax) {
      return;
    }
    const { top, height } = u.bbox;
    const ratio = uPlot.pxRatio;
    const x = u.valToPos(t, 'x', true);
    const ctx = u.ctx;
    ctx.save();
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.5 * ratio;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + height);
    ctx.stroke();

    const xs = u.data[0];
    const index = indexAtOrBefore(xs, t);
    const value = index < 0 ? null : finite(u.data[1]?.[index]);
    if (value !== null) {
      const y = u.valToPos(value, 'y', true);
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(x, y, 9 * ratio, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x, y, 4.5 * ratio, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5 * ratio;
      ctx.strokeStyle = colors.fg;
      ctx.stroke();
    }
    ctx.restore();
  };

  const updateReadout = (u: uPlot) => {
    const element = params.getReadout();
    if (element === null) {
      return;
    }
    const index = u.cursor.idx;
    const x = index === null || index === undefined ? undefined : u.data[0][index];
    if (index === null || index === undefined || x === undefined) {
      element.textContent = '';
      return;
    }
    element.textContent = `${formatTime(x)}   ${params.formatValue(finite(u.data[1]?.[index]))}`;
  };

  const attachPick = (u: uPlot) => {
    u.over.style.cursor = 'crosshair';
    u.over.addEventListener('click', () => {
      const left = u.cursor.left;
      if (left === undefined || left < 0) {
        return;
      }
      params.onPick(Math.round(u.posToVal(left, 'x')));
    });
  };

  const stepped = uPlot.paths.stepped;
  const axisBase = {
    stroke: colors.fgFaint,
    font: FONT,
    ticks: { show: false },
    grid: { stroke: colors.border, width: 1 },
  };

  const options: uPlot.Options = {
    width: params.width,
    height: params.height,
    padding: [6, 10, 0, 0],
    legend: { show: false },
    tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), APP_CONFIG.timezone),
    cursor: {
      sync: { key: params.syncKey, setSeries: false },
      drag: { x: false, y: false, setScale: false },
      y: false,
      points: { size: 7 },
    },
    scales: {
      x: { time: true },
      y: {
        range: (_u, min, max) =>
          params.yRange ?? rangeWithZones(finite(min), finite(max), params.zones),
      },
    },
    axes: [
      {
        ...axisBase,
        size: 26,
        gap: 4,
        values: (_u, splits) => splits.map((value) => formatShortTime(value)),
      },
      {
        ...axisBase,
        size: params.yAxisSize,
        gap: 6,
        values: (_u, splits) => splits.map((value) => params.formatAxis(value)),
        ...(params.yIncrements === null ? {} : { incrs: params.yIncrements }),
      },
    ],
    series: [
      {},
      {
        stroke: colors.primary,
        width: 1.5,
        spanGaps: false,
        points: { show: false },
        ...(params.stepped && stepped !== undefined ? { paths: stepped({ align: 1 }) } : {}),
      },
      { stroke: 'transparent', width: 0, spanGaps: false, points: { show: false } },
      { stroke: 'transparent', width: 0, spanGaps: false, points: { show: false } },
    ],
    // Полоса между максимумом и минимумом бакета: без нее сжатие периода съедает пики.
    bands: [{ series: [3, 2], fill: colors.primarySoft }],
    hooks: {
      drawClear: [drawZones],
      draw: [drawMonitor],
      setCursor: [updateReadout],
      ready: [attachPick],
    },
  };

  return new uPlot(options, params.data, params.element);
}
