/**
 * Запросы к хранилищу: выбор уровня по периоду, досворачивание до `maxPoints`,
 * сборка колоночных серий и треков (разделы 5.2, 5.3 и 6 `SPEC.md`).
 */

import {
  APP_CONFIG,
  METRICS,
  type MetricId,
  type SeriesResponse,
  type Severity,
  type TrackPoint,
  type TrackResponse,
  worstSeverity,
} from '@ra/contracts';
import { storedMetricIndex } from './stored-metrics.js';
import {
  type BucketView,
  emptyBucketView,
  emptyPositionSample,
  type StoredVehicle,
  type StoreTier,
  type TelemetryStore,
  TIERS,
} from './tiered-store.js';

/** Период, при котором еще допустим сырой уровень, секунды. */
const RAW_MAX_SPAN = 30 * 60;

/** Период, при котором допустим 10-секундный уровень, секунды. */
const S10_MAX_SPAN = 6 * 3600;

/**
 * Выбор уровня (раздел 6 `SPEC.md`): период до 30 минут и целиком внутри окна сырых данных -
 * `raw`; период до 6 часов - `s10`; иначе `m1`. Если сырое окно уже ушло вперед, запрос
 * за те же 30 минут обслуживается более грубым уровнем - данных там уже нет.
 */
export function pickTier(store: TelemetryStore, from: number, to: number): StoreTier {
  const span = to - from;
  if (span <= RAW_MAX_SPAN) {
    const first = store.vehicles[0];
    const window = first?.tiers.window('raw') ?? null;
    if (window !== null && from >= window.from && to <= window.to) {
      return 'raw';
    }
  }
  return span <= S10_MAX_SPAN ? 's10' : 'm1';
}

/** Свернутая точка ответа: то, что получается из группы бакетов уровня. */
interface FoldedPoint {
  avg: number | null;
  min: number | null;
  max: number | null;
  sev: Severity;
  count: number;
}

function foldGroup(
  vehicle: StoredVehicle,
  tier: StoreTier,
  metricIndex: number,
  firstIndex: number,
  groupSize: number,
  scratch: BucketView,
  out: FoldedPoint,
): FoldedPoint {
  let count = 0;
  let weighted = 0;
  let min: number | null = null;
  let max: number | null = null;
  let sev: Severity = 3;
  for (let i = 0; i < groupSize; i += 1) {
    const bucket = vehicle.tiers.bucket(tier, firstIndex + i, metricIndex, scratch);
    if (bucket.count === 0 || bucket.avg === null) {
      continue;
    }
    count += bucket.count;
    weighted += bucket.avg * bucket.count;
    min = min === null ? bucket.min : Math.min(min, bucket.min ?? min);
    max = max === null ? bucket.max : Math.max(max, bucket.max ?? max);
    sev = worstSeverity(sev, bucket.sev);
  }
  out.count = count;
  out.avg = count === 0 ? null : weighted / count;
  out.min = min;
  out.max = max;
  out.sev = count === 0 ? 3 : sev;
  return out;
}

export interface SeriesQueryInput {
  vehicleIds: string[];
  metrics: MetricId[];
  from: number;
  to: number;
  maxPoints: number;
}

/**
 * Колоночные серии. Дыры не интерполируются: в значениях `null`, в `count` ноль.
 * Поле `sev` сворачивается как максимум, поэтому аварийный пик не исчезает при сжатии.
 */
export function querySeries(store: TelemetryStore, input: SeriesQueryInput): SeriesResponse {
  const tier = pickTier(store, input.from, input.to);
  const step = TIERS[tier].stepSeconds;
  const firstIndex = Math.floor(input.from / step);
  const lastIndex = Math.floor((input.to - 1) / step);
  const bucketCount = Math.max(0, lastIndex - firstIndex + 1);
  const groupSize = bucketCount === 0 ? 1 : Math.max(1, Math.ceil(bucketCount / input.maxPoints));
  const pointCount = Math.ceil(bucketCount / groupSize);
  const t0 = firstIndex * step;
  const scratch = emptyBucketView();
  const folded: FoldedPoint = { avg: null, min: null, max: null, sev: 3, count: 0 };
  const series: SeriesResponse['series'] = [];
  for (const vehicleId of input.vehicleIds) {
    const vehicle = store.get(vehicleId);
    if (vehicle === undefined) {
      continue;
    }
    for (const metric of input.metrics) {
      const metricIndex = storedMetricIndex(metric);
      if (metricIndex < 0) {
        continue;
      }
      const avg: (number | null)[] = new Array(pointCount);
      const min: (number | null)[] = new Array(pointCount);
      const max: (number | null)[] = new Array(pointCount);
      const sev: Severity[] = new Array(pointCount);
      const count: number[] = new Array(pointCount);
      for (let p = 0; p < pointCount; p += 1) {
        foldGroup(
          vehicle,
          tier,
          metricIndex,
          firstIndex + p * groupSize,
          groupSize,
          scratch,
          folded,
        );
        avg[p] = folded.avg;
        min[p] = folded.min;
        max[p] = folded.max;
        sev[p] = folded.sev;
        count[p] = folded.count;
      }
      series.push({
        vehicleId,
        metric,
        unit: METRICS[metric].unitId,
        t0,
        avg,
        min,
        max,
        sev,
        count,
      });
    }
  }
  return { from: input.from, to: input.to, step: step * groupSize, tier, series };
}

export interface TrackMarkInput {
  vehicleId: string;
  t: number;
  code: string;
  severity: Severity;
}

export interface TrackQueryInput {
  vehicleIds: string[];
  from: number;
  to: number;
  maxPoints: number;
  /** Светофор трека только по этим показателям (режим "только отслеживаемые"). */
  severityMetrics?: MetricId[];
  /** Флажки битовых событий, попадающие в период. */
  marks: TrackMarkInput[];
}

/** Разрыв трека: столько секунд без позиции подряд уже считается дырой. */
function gapThreshold(step: number): number {
  return step * 2;
}

/**
 * Треки с прореживанием. Минимальный шаг - `pointStepSeconds` из конфигурации, дальше
 * шаг растет пропорционально периоду, чтобы уложиться в `maxPoints`. Точки смены цвета
 * светофора и точки с флажками сохраняются всегда.
 */
export function queryTrack(store: TelemetryStore, input: TrackQueryInput): TrackResponse {
  const span = Math.max(1, input.to - input.from);
  const step = Math.max(
    APP_CONFIG.track.pointStepSeconds,
    Math.ceil(span / Math.max(1, input.maxPoints)),
  );
  const severityMetrics = input.severityMetrics ?? [];
  const severityIndexes = severityMetrics
    .map((metric) => storedMetricIndex(metric))
    .filter((index) => index >= 0);
  const tier = pickTier(store, input.from, input.to);
  const tierStep = TIERS[tier].stepSeconds;
  const scratch = emptyBucketView();
  const sample = emptyPositionSample();
  const tracks: TrackResponse['tracks'] = [];

  for (const vehicleId of input.vehicleIds) {
    const vehicle = store.get(vehicleId);
    if (vehicle === undefined) {
      continue;
    }
    const marksAt = new Map<number, TrackMarkInput[]>();
    for (const mark of input.marks) {
      if (mark.vehicleId !== vehicleId || mark.t < input.from || mark.t > input.to) {
        continue;
      }
      const list = marksAt.get(mark.t);
      if (list === undefined) {
        marksAt.set(mark.t, [mark]);
      } else {
        list.push(mark);
      }
    }
    const points: TrackPoint[] = [];
    const gaps: [number, number][] = [];
    const trackMarks: TrackResponse['tracks'][number]['marks'] = [];
    let lastKeptAt = Number.NEGATIVE_INFINITY;
    let lastSeverity: Severity | null = null;
    let gapStart: number | null = null;

    for (let t = input.from; t <= input.to; t += 1) {
      const position = vehicle.positions.read(t, sample);
      if (position === null) {
        if (gapStart === null) {
          gapStart = t;
        }
        continue;
      }
      if (gapStart !== null) {
        if (t - gapStart >= gapThreshold(step)) {
          gaps.push([gapStart, t - 1]);
        }
        gapStart = null;
      }
      const severity =
        severityIndexes.length === 0
          ? position.sev
          : trackSeverity(vehicle, tier, tierStep, t, severityIndexes, scratch);
      const marks = marksAt.get(t);
      const keep =
        t - lastKeptAt >= step ||
        (lastSeverity !== null && severity !== lastSeverity) ||
        marks !== undefined;
      if (keep) {
        points.push([t, round6(position.lat), round6(position.lon), position.heading, severity]);
        lastKeptAt = t;
      }
      lastSeverity = severity;
      if (marks !== undefined) {
        for (const mark of marks) {
          trackMarks.push({
            t,
            lat: round6(position.lat),
            lon: round6(position.lon),
            code: mark.code,
            severity: mark.severity,
          });
        }
      }
    }
    if (gapStart !== null && input.to - gapStart >= gapThreshold(step)) {
      gaps.push([gapStart, input.to]);
    }
    tracks.push({ vehicleId, points, gaps, marks: trackMarks });
  }
  return { tracks };
}

/** Светофор точки трека по подмножеству показателей: максимум по бакетам этих показателей. */
function trackSeverity(
  vehicle: StoredVehicle,
  tier: StoreTier,
  tierStep: number,
  timeSec: number,
  metricIndexes: number[],
  scratch: BucketView,
): Severity {
  const bucketIndex = Math.floor(timeSec / tierStep);
  let severity: Severity = 3;
  for (const metricIndex of metricIndexes) {
    const bucket = vehicle.tiers.bucket(tier, bucketIndex, metricIndex, scratch);
    if (bucket.count === 0) {
      continue;
    }
    severity = worstSeverity(severity, bucket.sev);
  }
  return severity;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
