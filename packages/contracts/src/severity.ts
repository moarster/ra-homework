/**
 * Светофор: единая для всей системы степень отклонения точки (раздел 7 `CONTEXT.md`).
 *
 * Зеленый - все учитываемые показатели в норме и нет активных битов;
 * желтый - есть желтый показатель или взведено предупреждение;
 * красный - есть красный показатель или взведена авария;
 * серый - в рассматриваемой точке нет ни одного значения с качеством GOOD.
 */

import { payloadRatio } from './derived.js';
import type { FlagsTriple } from './flags.js';
import { METRICS, type MetricId, SEVERITY_METRIC_IDS } from './metrics.js';
import {
  resolveThreshold,
  type ThresholdContext,
  type ThresholdVehicle,
  zoneSeverity,
} from './thresholds.js';
import { VEHICLE_MODELS } from './vehicles.js';

/** 0 норма, 1 внимание, 2 авария, 3 нет данных. */
export type Severity = 0 | 1 | 2 | 3;

export const SEVERITY = {
  OK: 0,
  WARN: 1,
  ALARM: 2,
  UNKNOWN: 3,
} as const satisfies Record<string, Severity>;

export const SEVERITY_NAMES: Record<Severity, string> = {
  0: 'Норма',
  1: 'Внимание',
  2: 'Авария',
  3: 'Нет данных',
};

/** Качество значения: соответствует полю `q` компактного снапшота. */
export type Quality = 0 | 1 | 2 | 3 | 4;

export const QUALITY = {
  GOOD: 0,
  INVALID: 1,
  COMM_ERROR: 2,
  NOT_AVAILABLE: 3,
  STALE: 4,
} as const satisfies Record<string, Quality>;

export const QUALITY_NAMES: Record<Quality, string> = {
  0: 'Достоверно',
  1: 'Недостоверно',
  2: 'Ошибка связи',
  3: 'Нет значения',
  4: 'Устаревшее значение',
};

export interface MetricSample {
  value: number | null;
  quality: Quality;
}

/** Значения точки по показателям. Отсутствующий ключ = значения нет. */
export type PointValues = Partial<Record<MetricId, MetricSample>>;

export interface PointContext extends ThresholdContext {
  vehicle: ThresholdVehicle;
}

export interface PointSeverityOptions {
  /** Ограничить расчет подмножеством показателей (режим "только отслеживаемые" на карте). */
  metrics?: MetricId[];
}

/**
 * Контекст разрешения нормативов для точки: то, чего не видно в самих значениях.
 * Загрузка считается от номинала модели - она нужна правилу "у порожней машины
 * нормативы груза и осей не применяются".
 */
function buildThresholdContext(values: PointValues, ctx: PointContext): ThresholdContext {
  const cargoMass = sampleValue(values, 'CARGO_MASS');
  return {
    rpm: ctx.rpm !== undefined ? ctx.rpm : sampleValue(values, 'ENGINE_RPM'),
    speedKmh: ctx.speedKmh !== undefined ? ctx.speedKmh : sampleValue(values, 'POSITION_SPEED'),
    stoppedSeconds: ctx.stoppedSeconds ?? null,
    cargoRatioPercent:
      ctx.cargoRatioPercent !== undefined
        ? ctx.cargoRatioPercent
        : payloadRatio(cargoMass, VEHICLE_MODELS[ctx.vehicle.modelId].ratedPayloadKg),
  };
}

/** Худшая из двух степеней; "нет данных" (3) слабее любой известной степени. */
export function worstSeverity(a: Severity, b: Severity): Severity {
  if (a === 3) {
    return b;
  }
  if (b === 3) {
    return a;
  }
  return a > b ? a : b;
}

function sampleValue(values: PointValues, metric: MetricId): number | null {
  const sample = values[metric];
  if (sample === undefined || sample.quality !== QUALITY.GOOD || sample.value === null) {
    return null;
  }
  return Number.isFinite(sample.value) ? sample.value : null;
}

/**
 * Свертка в светофор точки: худшая степень среди учитываемых показателей плюс биты.
 *
 * Вынесена отдельно, потому что сервер считает степени показателей один раз (они нужны ему
 * и для бакетов, и для событий) и не должен разрешать нормативы второй раз ради светофора.
 *
 * @param worstMetricSeverity худшая степень среди учитываемых показателей (3 - неизвестна)
 * @param seenGoodValue было ли хотя бы одно годное значение учитываемого показателя
 */
export function combinePointSeverity(
  worstMetricSeverity: Severity,
  seenGoodValue: boolean,
  flags: FlagsTriple,
): Severity {
  const [alarms, warnings] = flags;
  if (alarms !== 0) {
    return SEVERITY.ALARM;
  }
  if (worstMetricSeverity === SEVERITY.ALARM) {
    return SEVERITY.ALARM;
  }
  if (warnings !== 0 || worstMetricSeverity === SEVERITY.WARN) {
    return SEVERITY.WARN;
  }
  return seenGoodValue ? SEVERITY.OK : SEVERITY.UNKNOWN;
}

/**
 * Светофор точки.
 *
 * Учитываются только показатели с `severityRelevant`, значения с качеством не GOOD
 * игнорируются, контекстные правила применяются до расчета. Взведенный бит ALARMS дает
 * красный, WARNINGS - желтый. Полное отсутствие годных значений дает серый.
 */
export function pointSeverity(
  values: PointValues,
  flags: FlagsTriple,
  ctx: PointContext,
  opts: PointSeverityOptions = {},
): Severity {
  const scope = opts.metrics ?? SEVERITY_METRIC_IDS;
  const thresholdCtx = buildThresholdContext(values, ctx);
  let worst: Severity = 3;
  let seenGoodValue = false;
  for (const metric of scope) {
    if (!METRICS[metric].severityRelevant) {
      continue;
    }
    const value = sampleValue(values, metric);
    if (value === null) {
      continue;
    }
    const resolved = resolveThreshold(metric, ctx.vehicle, thresholdCtx);
    if (resolved === null || resolved.excludeFromSeverity) {
      continue;
    }
    seenGoodValue = true;
    worst = worstSeverity(worst, zoneSeverity(resolved.zones, value));
  }
  return combinePointSeverity(worst, seenGoodValue, flags);
}

/** Степень каждого показателя точки - для всплывашек и подсветки в списках. */
export function metricSeverities(
  values: PointValues,
  ctx: PointContext,
  opts: PointSeverityOptions = {},
): Partial<Record<MetricId, Severity>> {
  const scope = opts.metrics ?? SEVERITY_METRIC_IDS;
  const thresholdCtx = buildThresholdContext(values, ctx);
  const result: Partial<Record<MetricId, Severity>> = {};
  for (const metric of scope) {
    const value = sampleValue(values, metric);
    if (value === null) {
      result[metric] = SEVERITY.UNKNOWN;
      continue;
    }
    const resolved = resolveThreshold(metric, ctx.vehicle, thresholdCtx);
    result[metric] =
      resolved === null || resolved.excludeFromSeverity
        ? SEVERITY.OK
        : zoneSeverity(resolved.zones, value);
  }
  return result;
}
