/**
 * Геометрия нормативов для графиков. Сами зоны берутся из контрактов (`resolveThreshold`),
 * здесь только их перевод в единицы отображения и в координаты: собственных порогов нет.
 */

import {
  fromBase,
  METRICS,
  type MetricId,
  resolveThreshold,
  type ThresholdContext,
  type ThresholdZone,
  toBase,
  type UnitId,
  type VehicleModelId,
} from '@ra/contracts';

/**
 * Нормативные зоны показателя для фона графика. Берется правило без контекста: фон
 * показывает норматив как таковой, а не то, применялся ли он в конкретной точке.
 * Переданный контекст нужен там, где норматив зависит от точки (давление масла на холостых).
 */
export function normativeZones(
  metric: MetricId,
  modelId: VehicleModelId,
  ctx: ThresholdContext = {},
): ThresholdZone[] {
  return resolveThreshold(metric, { modelId }, ctx)?.zones ?? [];
}

/** Значение в базовой единице показателя -> в выбранной единице отображения. */
export function toDisplay(value: number, metric: MetricId, unitId: UnitId): number {
  return fromBase(toBase(value, METRICS[metric].unitId), unitId);
}

/** Зоны в единице отображения. Все наши пересчеты возрастающие, порядок границ сохраняется. */
export function zonesInUnit(
  zones: readonly ThresholdZone[],
  metric: MetricId,
  unitId: UnitId,
): ThresholdZone[] {
  return zones.map((zone) => ({
    from: zone.from === null ? null : toDisplay(zone.from, metric, unitId),
    to: zone.to === null ? null : toDisplay(zone.to, metric, unitId),
    severity: zone.severity,
  }));
}

/** Желтые и красные зоны: только они рисуются фоном. */
export function deviationZones(zones: readonly ThresholdZone[]): ThresholdZone[] {
  return zones.filter((zone) => zone.severity === 1 || zone.severity === 2);
}

/** Доля запаса по краям шкалы, чтобы линия не упиралась в рамку. */
const RANGE_PAD = 0.06;

/**
 * Диапазон оси значений: данные плюс ближайшие к ним границы желтой или красной зоны
 * сверху и снизу. Иначе при нормальной работе фоновые зоны уезжали бы за край графика,
 * и было бы не видно, насколько далеко до норматива.
 */
export function rangeWithZones(
  dataMin: number | null,
  dataMax: number | null,
  zones: readonly ThresholdZone[],
): [number, number] {
  const edges: number[] = [];
  for (const zone of deviationZones(zones)) {
    if (zone.from !== null) {
      edges.push(zone.from);
    }
    if (zone.to !== null) {
      edges.push(zone.to);
    }
  }
  let lo = dataMin;
  let hi = dataMax;
  if (lo === null || hi === null) {
    if (edges.length === 0) {
      return [0, 1];
    }
    lo = Math.min(...edges);
    hi = Math.max(...edges);
  }
  const above = edges.filter((edge) => edge > (hi as number));
  const below = edges.filter((edge) => edge < (lo as number));
  if (above.length > 0) {
    hi = Math.min(...above);
  }
  if (below.length > 0) {
    lo = Math.max(...below);
  }
  const span = hi - lo;
  const pad = span > 0 ? span * RANGE_PAD : Math.max(1, Math.abs(hi) * RANGE_PAD);
  return [lo - pad, hi + pad];
}

export interface RedlineScale {
  /** Нижняя опорная точка шкалы: начало зеленой зоны или ноль. */
  low: number;
  /** Начало желтой зоны перед красной, если она есть. */
  warnFrom: number | null;
  /** Начало верхней красной зоны: 100% шкалы. */
  redFrom: number;
}

/**
 * Шкала "процент до красной зоны" для показателя, опасного ростом. Ноль - начало зеленой
 * зоны (у тормозов его нет - тогда ноль градусов), сто процентов - начало красной.
 */
export function redlineScale(zones: readonly ThresholdZone[]): RedlineScale | null {
  const red = zones.find((zone) => zone.severity === 2 && zone.from !== null && zone.to === null);
  if (red === undefined || red.from === null) {
    return null;
  }
  const warn = zones.find((zone) => zone.severity === 1 && zone.to === red.from);
  const green = zones.find((zone) => zone.severity === 0);
  const low = green?.from ?? 0;
  return {
    low: low < red.from ? low : 0,
    warnFrom: warn?.from ?? null,
    redFrom: red.from,
  };
}

export function redlinePercent(scale: RedlineScale, value: number): number {
  return ((value - scale.low) / (scale.redFrom - scale.low)) * 100;
}

/** Подпись передачи: -1 задний ход, 0 нейтраль (раздел 6.1 `CONTEXT.md`). */
export function gearLabel(value: number | null): string {
  if (value === null) {
    return '-';
  }
  const gear = Math.round(value);
  if (gear < 0) {
    return 'R';
  }
  return gear === 0 ? 'N' : String(gear);
}
